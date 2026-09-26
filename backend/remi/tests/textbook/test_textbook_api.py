"""The Textbook API: tree, home, search, sections, pages and block autosave."""

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from remi.services.textbook import NEW_ACCENTS
from remi.tests.textbook.conftest import Book

SEED_PAGES = ["fi-rates", "fi-rot", "pc-ret", "gen-how"]


def _page(book: Book, page_id: str) -> dict[str, Any]:
    return book.json("GET", f"/api/textbook/pages/{page_id}", 200)


def _save(book: Book, page_id: str, blocks: list[dict[str, Any]], version: int) -> Any:
    return book.client.put(
        f"/api/textbook/pages/{page_id}/blocks",
        json={"blocks": blocks, "baseVersion": version},
    )


def _new_page(book: Book, section: str, **extra: Any) -> dict[str, Any]:
    return book.json("POST", "/api/textbook/pages", 201, json={"sectionId": section, **extra})


def _error(response: Any) -> dict[str, Any]:
    return response.json()["error"]


# ---------------------------------------------------------------------------- reads (design seed)
def test_tree_lists_sections_and_pages_in_sidebar_order(seeded: Book) -> None:
    tree = seeded.json("GET", "/api/textbook", 200)
    assert [(s["id"], s["label"], s["pageCount"]) for s in tree["sections"]] == [
        ("fi", "Fixed Income", 2),
        ("pc", "Private Credit", 1),
        ("gen", "General", 1),
    ]
    assert [s["accent"] for s in tree["sections"]] == [
        "var(--fi-accent)",
        "var(--pc-accent)",
        "var(--ink-faint)",
    ]
    assert [p["id"] for p in tree["pages"]] == SEED_PAGES
    rates = tree["pages"][0]
    assert rates["title"] == "Rates primer"
    assert (rates["chartCount"], rates["childCount"], rates["descendantCount"]) == (1, 0, 0)
    assert rates["version"] == 1
    assert rates["wordCount"] > 0


def test_home_matches_the_design(seeded: Book) -> None:
    home = seeded.json("GET", "/api/textbook/home", 200)
    # "4 pages · 3 sections · 1 live chart · 256 words" (textbook-home baseline).
    assert home["counts"] == {"pages": 4, "sections": 3, "charts": 1, "words": 256}
    assert [r["id"] for r in home["recent"]] == SEED_PAGES
    first = home["recent"][0]
    assert first["path"] == ["Fixed Income"]
    assert first["snippet"].startswith("A bond\u2019s price is the present value")
    assert home["recent"][2]["snippet"].startswith("Monthly returns use Modified Dietz")
    assert home["charts"] == [
        {
            "pageId": "fi-rates",
            "pageTitle": "Rates primer",
            "blockId": "fi-rates-b06",
            "assetId": "chart-price-yield",
            "name": "price-yield.html",
            "caption": "The marker drifts through yields. The dashed tangent is what duration "
            "predicts; the shaded gap is what it misses.",
        }
    ]
    fi = home["sections"][0]
    assert (fi["label"], fi["pageCount"], fi["moreCount"]) == ("Fixed Income", 2, 0)
    assert [(p["title"], p["chartCount"]) for p in fi["topPages"]] == [
        ("Rates primer", 1),
        ("Eurozone sovereign rotation", 0),
    ]


def test_page_blocks_round_trip_every_type(seeded: Book) -> None:
    page = _page(seeded, "fi-rates")
    assert (page["title"], page["sectionId"], page["parentId"], page["version"]) == (
        "Rates primer",
        "fi",
        None,
        1,
    )
    types = [b["type"] for b in page["blocks"]]
    assert types == ["h1", "h2", "p", "formula", "p", "chart", "callout", "h2", "p", "formula"]
    assert page["blocks"][3] == {
        "id": "fi-rates-b04",
        "type": "formula",
        "tex": "\\frac{\\Delta P}{P} \\approx -D \\times \\Delta y",
    }
    chart = page["blocks"][5]
    assert chart["assetId"] == "chart-price-yield"
    assert (chart["name"], chart["height"]) == ("price-yield.html", 380)
    assert chart["caption"].startswith("The marker drifts")


def test_unknown_page_is_a_404(seeded: Book) -> None:
    response = seeded.client.get("/api/textbook/pages/nope")
    assert response.status_code == 404
    assert _error(response)["field"] == "pageId"


# ---------------------------------------------------------------------------- search
def test_search_is_case_insensitive_over_titles_and_block_text(seeded: Book) -> None:
    hits = seeded.json("GET", "/api/textbook/search", 200, params={"q": "DIETZ"})["hits"]
    assert [(h["pageId"], h["inTitle"]) for h in hits] == [("pc-ret", False)]
    assert "Modified Dietz" in hits[0]["snippet"]

    hits = seeded.json("GET", "/api/textbook/search", 200, params={"q": "primer"})["hits"]
    assert hits == [
        {"pageId": "fi-rates", "title": "Rates primer", "sectionId": "fi", "inTitle": True,
         "snippet": ""}
    ]  # fmt: skip

    # Formulas are searched (their text is the LaTeX); chart file names are not.
    hits = seeded.json("GET", "/api/textbook/search", 200, params={"q": "\\frac{V_1"})["hits"]
    assert [h["pageId"] for h in hits] == ["pc-ret"]
    hits = seeded.json("GET", "/api/textbook/search", 200, params={"q": "price-yield"})["hits"]
    assert hits == []


def test_blank_search_finds_nothing(seeded: Book) -> None:
    assert seeded.json("GET", "/api/textbook/search", 200, params={"q": "   "}) == {
        "q": "   ",
        "hits": [],
    }
    assert seeded.client.get("/api/textbook/search", params={"q": ""}).status_code == 422


def test_long_matches_are_cut_to_a_snippet_around_the_match(seeded: Book) -> None:
    page = _new_page(seeded, "gen", title="Long")["page"]
    text = "lorem " * 80 + "needle in the haystack " + "ipsum " * 80
    _save(seeded, page["id"], [{"id": "long-b1", "type": "p", "text": text}], page["version"])
    (hit,) = seeded.json("GET", "/api/textbook/search", 200, params={"q": "Needle"})["hits"]
    assert "needle in the haystack" in hit["snippet"]
    assert hit["snippet"].startswith("…") and hit["snippet"].endswith("…")
    assert len(hit["snippet"]) <= 162


def test_search_lists_hits_per_section_in_creation_order(seeded: Book) -> None:
    # The prototype filters its page array (creation order) section by section; sub-pages are
    # not nested under their parents: A, B, then A's later sub-page A1.
    a = _new_page(seeded, "gen", title="Alpha findme")["page"]
    seeded.clock.advance(timedelta(seconds=1))
    b = _new_page(seeded, "gen", title="Beta findme")["page"]
    seeded.clock.advance(timedelta(seconds=1))
    a1 = _new_page(seeded, "gen", parentId=a["id"], title="Alpha child findme")["page"]
    seeded.clock.advance(timedelta(seconds=1))
    fi = _new_page(seeded, "fi", title="Rates findme")["page"]
    tree = [p["id"] for p in seeded.json("GET", "/api/textbook", 200)["pages"]]
    assert tree.index(a1["id"]) == tree.index(a["id"]) + 1  # the sidebar nests it
    hits = seeded.json("GET", "/api/textbook/search", 200, params={"q": "FINDME"})["hits"]
    assert [h["pageId"] for h in hits] == [fi["id"], a["id"], b["id"], a1["id"]]

    # Section order still comes first once the sections are reordered.
    seeded.json("PUT", "/api/textbook/sections/order", 200, json={"ids": ["gen", "pc", "fi"]})
    hits = seeded.json("GET", "/api/textbook/search", 200, params={"q": "findme"})["hits"]
    assert [h["pageId"] for h in hits] == [a["id"], b["id"], a1["id"], fi["id"]]


# ---------------------------------------------------------------------------- sections
def test_sections_create_rename_collapse_and_reorder(seeded: Book) -> None:
    created = seeded.json("POST", "/api/textbook/sections", 201, json={})
    assert created["label"] == ""
    assert created["accent"] == NEW_ACCENTS[0]  # (3 - 3) mod 5
    assert (created["sortOrder"], created["pageCount"], created["collapsed"]) == (3, 0, False)
    second = seeded.json("POST", "/api/textbook/sections", 201, json={"label": "  Macro  "})
    assert (second["label"], second["accent"]) == ("Macro", NEW_ACCENTS[1])

    renamed = seeded.json(
        "PATCH", f"/api/textbook/sections/{created['id']}", 200, json={"label": " Credit\nnotes "}
    )
    assert renamed["label"] == "Creditnotes"
    collapsed = seeded.json("PATCH", "/api/textbook/sections/fi", 200, json={"collapsed": True})
    assert (collapsed["collapsed"], collapsed["pageCount"]) == (True, 2)

    order = ["gen", second["id"], "fi", created["id"], "pc"]
    tree = seeded.json("PUT", "/api/textbook/sections/order", 200, json={"ids": order})
    assert [s["id"] for s in tree["sections"]] == order
    assert [p["id"] for p in tree["pages"]] == ["gen-how", "fi-rates", "fi-rot", "pc-ret"]


def test_reorder_needs_every_section_exactly_once(seeded: Book) -> None:
    for ids in (["fi", "pc"], ["fi", "pc", "gen", "gen"], ["fi", "pc", "nope"]):
        response = seeded.client.put("/api/textbook/sections/order", json={"ids": ids})
        assert response.status_code == 422
        assert _error(response) | {"message": ""} == {
            "code": "VALIDATION_FAILED",
            "field": "ids",
            "message": "",
        }


def test_blank_name_removes_an_empty_unnamed_section(seeded: Book) -> None:
    created = seeded.json("POST", "/api/textbook/sections", 201, json={})
    answer = seeded.json(
        "PATCH", f"/api/textbook/sections/{created['id']}", 200, json={"label": "   "}
    )
    assert answer["id"] == created["id"]
    ids = [s["id"] for s in seeded.json("GET", "/api/textbook", 200)["sections"]]
    assert ids == ["fi", "pc", "gen"]
    assert seeded.events("textbook.section_deleted")[-1]["payload"]["input"] == {
        "sectionId": created["id"],
        "reason": "blank_name",
    }


def test_blank_name_keeps_a_named_section(seeded: Book) -> None:
    before = seeded.event_count()
    answer = seeded.json("PATCH", "/api/textbook/sections/gen", 200, json={"label": ""})
    assert answer["label"] == "General"
    assert seeded.event_count() == before  # nothing changed, nothing recorded


def test_delete_section_rules(seeded: Book) -> None:
    response = seeded.client.delete("/api/textbook/sections/fi")
    assert (response.status_code, _error(response)["code"]) == (409, "SECTION_NOT_EMPTY")
    assert seeded.client.delete("/api/textbook/sections/nope").status_code == 404

    empty = seeded.json("POST", "/api/textbook/sections", 201, json={"label": "Spare"})
    assert seeded.client.delete(f"/api/textbook/sections/{empty['id']}").status_code == 204


def test_the_last_section_cannot_be_deleted(book: Book) -> None:
    only = book.json("POST", "/api/textbook/sections", 201, json={"label": "Only"})
    response = book.client.delete(f"/api/textbook/sections/{only['id']}")
    assert (response.status_code, _error(response)["code"]) == (409, "LAST_SECTION")
    # A blank name does not remove it either: the Textbook keeps one section.
    unnamed = book.json("POST", "/api/textbook/sections", 201, json={})
    book.json("PATCH", f"/api/textbook/sections/{only['id']}", 200, json={"label": "Kept"})
    assert book.client.delete(f"/api/textbook/sections/{only['id']}").status_code == 204
    kept = book.json("PATCH", f"/api/textbook/sections/{unnamed['id']}", 200, json={"label": ""})
    assert kept["id"] == unnamed["id"]
    assert [s["id"] for s in book.json("GET", "/api/textbook", 200)["sections"]] == [unnamed["id"]]


# ---------------------------------------------------------------------------- pages
def test_the_textbook_works_before_setup(book: Book) -> None:
    assert book.client.get("/api/plan").status_code == 409  # setup still required
    assert book.json("GET", "/api/textbook", 200) == {"sections": [], "pages": []}
    section = book.json("POST", "/api/textbook/sections", 201, json={"label": "Notes"})
    created = _new_page(book, section["id"], title="First")
    page = created["page"]
    assert created["parent"] is None
    assert (page["title"], page["version"], page["parentId"]) == ("First", 1, None)
    assert [(b["type"], b["text"]) for b in page["blocks"]] == [("p", "")]
    home = book.json("GET", "/api/textbook/home", 200)
    assert home["counts"] == {"pages": 1, "sections": 1, "charts": 0, "words": 0}
    assert home["recent"][0]["path"] == ["Notes"]


def test_a_new_top_level_page_expands_its_section(seeded: Book) -> None:
    seeded.json("PATCH", "/api/textbook/sections/pc", 200, json={"collapsed": True})
    _new_page(seeded, "pc", parentId="pc-ret")  # a sub-page leaves the section as it is
    assert seeded.json("GET", "/api/textbook", 200)["sections"][1]["collapsed"] is True
    _new_page(seeded, "pc")
    assert seeded.json("GET", "/api/textbook", 200)["sections"][1]["collapsed"] is False


def test_words_are_counted_as_the_editor_counts_them(seeded: Book) -> None:
    page = _new_page(seeded, "gen")["page"]
    blocks = [
        {"id": "w1", "type": "p", "text": "  two   words "},
        {"id": "w2", "type": "bullet", "text": "   "},  # the editor counts this as one
        {"id": "w3", "type": "p", "text": ""},
        {"id": "w4", "type": "formula", "tex": "a + b"},  # formulas are not words
    ]
    assert _save(seeded, page["id"], blocks, page["version"]).json()["wordCount"] == 3


def test_create_page_uses_a_client_id_once(seeded: Book) -> None:
    page = _new_page(seeded, "gen", id="client-page-1", title="Mine")["page"]
    assert page["id"] == "client-page-1"
    response = seeded.client.post(
        "/api/textbook/pages", json={"sectionId": "gen", "id": "client-page-1"}
    )
    assert (response.status_code, _error(response)["field"]) == (409, "id")


def test_create_page_validates_its_references(seeded: Book) -> None:
    cases = [
        ({"sectionId": "nope"}, 404, "sectionId"),
        ({"sectionId": "fi", "parentId": "nope"}, 404, "parentId"),
        ({"sectionId": "pc", "parentId": "fi-rates"}, 422, "sectionId"),
        ({"sectionId": "fi", "replaceBlockId": "fi-rates-b03"}, 422, "replaceBlockId"),
        ({"sectionId": "fi", "parentId": "fi-rates", "replaceBlockId": "x"}, 404, "replaceBlockId"),
    ]
    for body, status, field in cases:
        response = seeded.client.post("/api/textbook/pages", json=body)
        assert (response.status_code, _error(response)["field"]) == (status, field), body


def test_sub_page_link_goes_before_a_trailing_empty_paragraph(seeded: Book) -> None:
    # "Eurozone sovereign rotation" ends with an empty paragraph (the seed's France stub).
    before = _page(seeded, "fi-rot")
    assert before["blocks"][-1] == {"id": "fi-rot-b07", "type": "p", "text": ""}
    created = _new_page(seeded, "fi", parentId="fi-rot", title="Germany")
    child, parent = created["page"], created["parent"]
    assert (child["parentId"], child["sectionId"]) == ("fi-rot", "fi")
    assert parent["version"] == before["version"] + 1
    link = parent["blocks"][-2]
    assert link["type"] == "page"
    assert link["targetPageId"] == child["id"]
    assert parent["blocks"][-1]["id"] == "fi-rot-b07"
    assert len(parent["blocks"]) == len(before["blocks"]) + 1

    # Without a trailing empty paragraph the link is appended.
    grandchild = _new_page(seeded, "fi", parentId=child["id"])
    # The child's only block is an empty paragraph, so the link goes before it.
    assert [b["type"] for b in grandchild["parent"]["blocks"]] == ["page", "p"]
    tree = seeded.json("GET", "/api/textbook", 200)
    rot = next(p for p in tree["pages"] if p["id"] == "fi-rot")
    assert (rot["childCount"], rot["descendantCount"]) == (1, 2)
    assert [p["id"] for p in tree["pages"]][:4] == [
        "fi-rates",
        "fi-rot",
        child["id"],
        grandchild["page"]["id"],
    ]
    appended = _new_page(seeded, "pc", parentId="pc-ret")
    assert appended["parent"]["blocks"][-1]["targetPageId"] == appended["page"]["id"]


def test_sub_page_can_replace_a_block(seeded: Book) -> None:
    seeded.clock.advance(timedelta(hours=1))  # the seed's pages were edited at 08:30Z
    created = _new_page(seeded, "gen", parentId="gen-how", replaceBlockId="gen-how-b06")
    blocks = created["parent"]["blocks"]
    assert blocks[5] == {
        "id": "gen-how-b06",
        "type": "page",
        "targetPageId": created["page"]["id"],
    }
    assert len(blocks) == 6
    home = seeded.json("GET", "/api/textbook/home", 200)
    assert home["recent"][0]["id"] == created["page"]["id"]
    assert home["recent"][0]["path"] == ["General", "How the Textbook works"]


def test_rename_strips_newlines_and_keeps_the_block_version(seeded: Book) -> None:
    summary = seeded.json(
        "PATCH", "/api/textbook/pages/fi-rates", 200, json={"title": "Rates\nprimer \r\n2 "}
    )
    assert summary["title"] == "Ratesprimer 2 "
    assert summary["version"] == 1
    assert _page(seeded, "fi-rates")["title"] == "Ratesprimer 2 "
    assert seeded.client.patch("/api/textbook/pages/nope", json={"title": "x"}).status_code == 404


# ---------------------------------------------------------------------------- block autosave
def test_autosave_bumps_the_version_and_records_a_small_event(seeded: Book) -> None:
    page = _page(seeded, "gen-how")
    blocks = [
        *page["blocks"][:2],
        {"id": "new-b1", "type": "h2", "text": "Shortcuts"},
        {"id": "new-b2", "type": "divider"},
        {"id": "new-b3", "type": "formula", "tex": "x^2"},
    ]
    response = _save(seeded, "gen-how", blocks, 1)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert (saved["id"], saved["version"], saved["chartCount"]) == ("gen-how", 2, 0)
    assert saved["wordCount"] == 1 + 16 + 1  # "Writing", the paragraph, "Shortcuts"
    assert _page(seeded, "gen-how")["blocks"] == blocks

    (event,) = seeded.events("textbook.blocks_saved")
    assert event["payload"]["input"] == {"pageId": "gen-how", "version": 2, "blockCount": 5}
    assert "diff" not in event["payload"]


def test_stale_base_version_is_a_409(seeded: Book) -> None:
    page = _page(seeded, "gen-how")
    assert _save(seeded, "gen-how", page["blocks"], 1).status_code == 200
    response = _save(seeded, "gen-how", page["blocks"][:1], 1)
    assert (response.status_code, _error(response)["code"]) == (409, "VERSION_CONFLICT")
    assert len(_page(seeded, "gen-how")["blocks"]) == len(page["blocks"])
    assert _save(seeded, "nope", [], 1).status_code == 404


def test_block_ids_must_be_unique(seeded: Book) -> None:
    block = {"id": "same", "type": "p", "text": "a"}
    response = _save(seeded, "gen-how", [block, block], 1)
    assert (response.status_code, _error(response)["field"]) == (422, "blocks.1.id")
    # An id that belongs to another page is refused too (ids are global).
    response = _save(seeded, "gen-how", [{"id": "fi-rates-b01", "type": "p", "text": "x"}], 1)
    assert (response.status_code, _error(response)["field"]) == (422, "blocks.0.id")


def test_links_to_missing_pages_and_charts_save_as_empty(seeded: Book) -> None:
    blocks = [
        {"id": "l1", "type": "page", "targetPageId": "gone"},
        {"id": "l2", "type": "page", "targetPageId": "fi-rot"},
        {
            "id": "c1",
            "type": "chart",
            "assetId": "no-such-asset",
            "name": "x.html",
            "height": 280,
            "caption": "",
        },
    ]
    assert _save(seeded, "gen-how", blocks, 1).status_code == 200
    stored = _page(seeded, "gen-how")["blocks"]
    assert [b.get("targetPageId") for b in stored[:2]] == [None, "fi-rot"]
    assert (stored[2]["assetId"], stored[2]["name"], stored[2]["height"]) == (None, "x.html", 280)


@pytest.mark.parametrize("height", [199, 901])
def test_chart_height_is_clamped_by_the_schema(seeded: Book, height: int) -> None:
    block = {"id": "c", "type": "chart", "assetId": None, "name": "", "height": height,
             "caption": ""}  # fmt: skip
    assert _save(seeded, "gen-how", [block], 1).status_code == 422


# ---------------------------------------------------------------------------- page delete
def test_delete_cascades_and_strips_links(seeded: Book) -> None:
    child = _new_page(seeded, "fi", parentId="fi-rot", title="Germany")["page"]
    grandchild = _new_page(seeded, "fi", parentId=child["id"], title="Bunds")["page"]
    # Another page links to the grandchild too.
    rates = _page(seeded, "fi-rates")
    link = {"id": "rates-link", "type": "page", "targetPageId": grandchild["id"]}
    assert _save(seeded, "fi-rates", [*rates["blocks"], link], rates["version"]).status_code == 200
    rates = _page(seeded, "fi-rates")
    rot = _page(seeded, "fi-rot")

    deleted = seeded.json("DELETE", f"/api/textbook/pages/{child['id']}", 200)
    assert deleted == {"deletedIds": [child["id"], grandchild["id"]], "nextPageId": "fi-rot"}
    for page_id in deleted["deletedIds"]:
        assert seeded.client.get(f"/api/textbook/pages/{page_id}").status_code == 404

    rates_after = _page(seeded, "fi-rates")
    assert "rates-link" not in [b["id"] for b in rates_after["blocks"]]
    assert rates_after["version"] == rates["version"] + 1
    assert rates_after["updatedAt"] == rates["updatedAt"]  # nothing the user wrote changed
    rot_after = _page(seeded, "fi-rot")
    assert all(b["type"] != "page" for b in rot_after["blocks"])
    assert rot_after["version"] == rot["version"] + 1

    (event,) = seeded.events("textbook.page_deleted")
    assert event["payload"]["input"]["deletedIds"] == [child["id"], grandchild["id"]]
    assert event["payload"]["input"]["strippedLinks"] == {"fi-rates": 1, "fi-rot": 1}
    assert [p["id"] for p in seeded.json("GET", "/api/textbook", 200)["pages"]] == SEED_PAGES


def test_deleting_the_last_page_never_reseeds_a_help_page(seeded: Book) -> None:
    for page_id in SEED_PAGES[:-1]:
        seeded.json("DELETE", f"/api/textbook/pages/{page_id}", 200)
    last = seeded.json("DELETE", "/api/textbook/pages/gen-how", 200)
    assert last == {"deletedIds": ["gen-how"], "nextPageId": None}
    tree = seeded.json("GET", "/api/textbook", 200)
    assert tree["pages"] == []
    assert len(tree["sections"]) == 3
    assert seeded.client.delete("/api/textbook/pages/gen-how").status_code == 404


def test_delete_goes_to_the_first_page_when_there_is_no_parent(seeded: Book) -> None:
    assert seeded.json("DELETE", "/api/textbook/pages/fi-rates", 200)["nextPageId"] == "fi-rot"


def test_delete_goes_to_the_first_page_in_creation_order_not_tree_order(seeded: Book) -> None:
    # The prototype's ``next[0]`` is the first remaining page of its page array. With the
    # sections reordered, the sidebar starts with pc-ret, but fi-rates was created first.
    seeded.json("PUT", "/api/textbook/sections/order", 200, json={"ids": ["gen", "pc", "fi"]})
    tree = [p["id"] for p in seeded.json("GET", "/api/textbook", 200)["pages"]]
    assert tree == ["gen-how", "pc-ret", "fi-rates", "fi-rot"]
    deleted = seeded.json("DELETE", "/api/textbook/pages/gen-how", 200)
    assert deleted == {"deletedIds": ["gen-how"], "nextPageId": "fi-rates"}

    # Pages created later come after the seed pages, whichever section they are in.
    seeded.clock.advance(timedelta(minutes=1))
    late = _new_page(seeded, "pc", title="Late")["page"]
    for page_id in ["fi-rates", "fi-rot"]:
        seeded.json("DELETE", f"/api/textbook/pages/{page_id}", 200)
    assert seeded.json("DELETE", "/api/textbook/pages/pc-ret", 200)["nextPageId"] == late["id"]


def test_delete_forgets_the_remembered_page(seeded: Book) -> None:
    settings = seeded.json("GET", "/api/settings", 200)
    assert settings["uiPrefs"]["lastTextbookPageId"] == "fi-rates"
    seeded.json("DELETE", "/api/textbook/pages/fi-rates", 200)
    settings = seeded.json("GET", "/api/settings", 200)
    assert settings["uiPrefs"]["lastTextbookPageId"] == "fi-rot"


def test_every_textbook_write_records_one_event(seeded: Book) -> None:
    before = seeded.event_count()
    section = seeded.json("POST", "/api/textbook/sections", 201, json={"label": "S"})
    page = _new_page(seeded, section["id"])["page"]
    seeded.json("PATCH", f"/api/textbook/pages/{page['id']}", 200, json={"title": "T"})
    assert _save(seeded, page["id"], [], page["version"]).status_code == 200
    seeded.json("DELETE", f"/api/textbook/pages/{page['id']}", 200)
    assert seeded.client.delete(f"/api/textbook/sections/{section['id']}").status_code == 204
    assert seeded.event_count() == before + 6


# ---------------------------------------------------------------------------- prototype baselines
def _baseline_lines(state: str) -> list[str]:
    path = Path(__file__).resolve().parents[1] / "golden" / f"baseline-{state}.json"
    if not path.exists():
        pytest.skip(f"no prototype baseline {state}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return [line for region in data["regions"] for line in region["lines"]]


def test_home_numbers_match_the_prototype_baseline(seeded: Book) -> None:
    lines = _baseline_lines("textbook-home")
    home = seeded.json("GET", "/api/textbook/home", 200)
    counts = home["counts"]
    charts = f"{counts['charts']} live chart" + ("" if counts["charts"] == 1 else "s")
    sub = (
        f"{counts['pages']} pages · {counts['sections']} sections · {charts}"
        f" · {counts['words']:,} words"
    )
    assert sub in lines
    snippets = [r["snippet"] for r in home["recent"]]
    assert [line for line in lines if line in snippets] == snippets  # same order
    assert home["charts"][0]["name"] in lines


def test_page_word_count_matches_the_prototype_baseline(seeded: Book) -> None:
    # Rates primer's meta line: "1 section · 1 live chart · 108 words · edited 5 Oct".
    lines = _baseline_lines("textbook-katex")
    rates = next(
        p for p in seeded.json("GET", "/api/textbook", 200)["pages"] if p["id"] == "fi-rates"
    )
    meta = f"1 section · {rates['chartCount']} live chart · {rates['wordCount']} words"
    assert any(line.startswith(meta + " · edited") for line in lines)
