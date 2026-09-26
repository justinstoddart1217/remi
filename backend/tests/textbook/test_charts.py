"""Chart uploads, the chart store, garbage collection and ``GET /api/charts/{id}``."""

import hashlib
import os
import stat
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from starlette.formparsers import MultiPartParser

from remi.api.endpoints.textbook import MULTIPART_OVERHEAD
from remi.api.middleware import CHART_CSP
from remi.repositories import models as orm
from remi.services import chart_store
from tests.textbook.conftest import CHART_MAX_BYTES, Book

CHART = b"<!doctype html><title>Yield</title><svg viewBox='0 0 10 10'></svg>"


def _upload(
    book: Book, body: bytes = CHART, name: str = "yield.html", mime: str = "text/html"
) -> Any:
    return book.client.post("/api/textbook/charts", files={"file": (name, body, mime)})


def _chart_block(asset_id: str | None, block_id: str = "chart-1") -> dict[str, Any]:
    return {
        "id": block_id,
        "type": "chart",
        "assetId": asset_id,
        "name": "yield.html",
        "height": 380,
        "caption": "",
    }


def _file(book: Book, digest: str) -> Path:
    return book.data_dir / "charts" / digest[:2] / f"{digest}.html"


def _assets(book: Book) -> set[str]:
    with book.uow_factory.read() as uow:
        return {a.id for a in uow.session.query(orm.ChartAsset).all()}


def _put_blocks(book: Book, page_id: str, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    page = book.json("GET", f"/api/textbook/pages/{page_id}", 200)
    return book.json(
        "PUT",
        f"/api/textbook/pages/{page_id}/blocks",
        200,
        json={"blocks": blocks, "baseVersion": page["version"]},
    )


# ---------------------------------------------------------------------------- upload + serve
def test_upload_stores_the_file_content_addressed_and_serves_it(book: Book) -> None:
    response = _upload(book)
    assert response.status_code == 201, response.text
    out = response.json()
    digest = hashlib.sha256(CHART).hexdigest()
    assert out == {
        "assetId": out["assetId"],
        "name": "yield.html",
        "sizeBytes": len(CHART),
        "contentHash": digest,
        "deduplicated": False,
        "warnings": [],
    }
    assert _file(book, digest).read_bytes() == CHART

    served = book.client.get(f"/api/charts/{out['assetId']}")
    assert served.status_code == 200
    assert served.content == CHART
    assert served.headers["content-type"] == "text/html; charset=utf-8"
    assert served.headers.get_list("content-security-policy") == [CHART_CSP]
    assert served.headers["x-content-type-options"] == "nosniff"
    assert served.headers["referrer-policy"] == "no-referrer"
    assert served.headers["cross-origin-resource-policy"] == "same-origin"
    assert served.headers["etag"] == f'"{digest}"'

    again = book.client.get(
        f"/api/charts/{out['assetId']}", headers={"If-None-Match": served.headers["etag"]}
    )
    assert again.status_code == 304
    assert again.headers.get_list("content-security-policy") == [CHART_CSP]


@pytest.mark.skipif(os.name != "posix", reason="POSIX modes")
def test_the_charts_folder_is_private(book: Book) -> None:
    # ``charts/`` itself is 0700, not the umask's 0755 (mkdir's mode skips the parents it
    # makes), and a folder an older run left at 0755 is tightened on the next upload.
    charts = book.data_dir / "charts"
    old = os.umask(0o022)
    try:
        assert _upload(book).status_code == 201
        assert stat.S_IMODE(charts.stat().st_mode) == 0o700
        charts.chmod(0o755)
        assert _upload(book, CHART + b"<!-- 2 -->").status_code == 201
    finally:
        os.umask(old)
    assert stat.S_IMODE(charts.stat().st_mode) == 0o700
    assert {stat.S_IMODE(p.stat().st_mode) for p in charts.iterdir()} == {0o700}


def test_chart_csp_is_strict() -> None:
    directives: dict[str, str] = {}
    for part in CHART_CSP.split(";"):
        name, _, value = part.strip().partition(" ")
        directives[name] = value
    assert directives["sandbox"] == "allow-scripts"
    assert directives["default-src"] == "'none'"
    assert directives["connect-src"] == "'none'"
    assert "allow-same-origin" not in CHART_CSP


def test_identical_uploads_are_deduplicated(book: Book) -> None:
    first = _upload(book).json()
    second = _upload(book, name="copy.htm").json()
    assert second["assetId"] == first["assetId"]
    assert (second["deduplicated"], second["name"]) == (True, "copy.htm")
    assert len(_assets(book)) == 1
    assert len(book.events("textbook.chart_uploaded")) == 2


def test_upload_limits(book: Book) -> None:
    cases: list[tuple[bytes, str, int, str]] = [
        (b"x" * (CHART_MAX_BYTES + 1), "big.html", 413, "PAYLOAD_TOO_LARGE"),
        (CHART, "chart.txt", 415, "UNSUPPORTED_MEDIA_TYPE"),
        (CHART, "chart.svg", 415, "UNSUPPORTED_MEDIA_TYPE"),
        (b"\xff\xfe<html>", "latin.html", 415, "UNSUPPORTED_MEDIA_TYPE"),
        (b"  \n", "empty.html", 422, "VALIDATION_FAILED"),
    ]
    for body, name, status, code in cases:
        response = _upload(book, body, name)
        assert response.status_code == status, (name, response.text)
        error = response.json()["error"]
        assert (error["code"], error["field"]) == (code, "file")
    assert _assets(book) == set()
    assert not (book.data_dir / "charts").exists() or not any(
        (book.data_dir / "charts").rglob("*.html")
    )
    # Exactly at the limit is fine; upper-case extensions too.
    assert _upload(book, b"<p>" + b"x" * (CHART_MAX_BYTES - 3), "EXACT.HTM").status_code == 201


def test_upload_warns_about_web_urls_but_not_xml_namespaces(book: Book) -> None:
    web = (
        b'<link href="https://fonts.googleapis.com/css2?family=Albert+Sans">'
        b'<script src="http://cdn.example.org/d3.js"></script>'
        b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"
    )
    (warning,) = _upload(book, web, "web.html").json()["warnings"]
    assert "fonts.googleapis.com" in warning and "cdn.example.org" in warning
    assert "www.w3.org" not in warning
    local = b"<svg xmlns='http://www.w3.org/2000/svg'></svg><script>1</script>"
    assert _upload(book, local, "local.html").json()["warnings"] == []


def test_upload_warns_about_protocol_relative_urls(book: Book) -> None:
    web = (
        b'<script src="//cdn.example.com/d3.js"></script>'
        b"<style>@font-face{src:url(//fonts.gstatic.com/a.woff2)}</style>"
        b"<img src=//img.example.net/x.png>"
    )
    (warning,) = _upload(book, web, "relative.html").json()["warnings"]
    assert "(cdn.example.com, fonts.gstatic.com, img.example.net)" in warning
    # JavaScript comments and bare "//" strings are not URLs; w3.org namespaces never count.
    local = (
        b"<script>var a = 1; // see example.com/docs\nx.split('//');</script>"
        b"<svg xmlns='//www.w3.org/2000/svg'></svg>"
    )
    assert _upload(book, local, "local.html").json()["warnings"] == []


def test_a_body_far_over_the_limit_is_refused_before_the_form_is_parsed(
    book: Book, monkeypatch: pytest.MonkeyPatch
) -> None:
    def parse(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("the multipart body should not be parsed (or spooled to disk)")

    monkeypatch.setattr(MultiPartParser, "parse", parse)
    body = b"x" * (CHART_MAX_BYTES + MULTIPART_OVERHEAD + 1)
    response = _upload(book, body, "huge chart.html")
    assert response.status_code == 413
    error = response.json()["error"]
    assert (error["code"], error["field"]) == ("PAYLOAD_TOO_LARGE", "file")
    assert error["message"].startswith("huge chart.html is over ")
    assert _assets(book) == set()
    assert book.event_count() == 0


def test_names_are_cleaned(book: Book) -> None:
    out = _upload(book, name="../../evil\x07/Chart One.html").json()
    assert out["name"] == "Chart One.html"
    assert chart_store.clean_name(None) == "chart.html"
    assert chart_store.clean_name("C:\\Users\\me\\c.html") == "c.html"


def test_unknown_chart_is_a_json_404(book: Book) -> None:
    response = book.client.get("/api/charts/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_the_design_chart_is_served_without_web_fonts(seeded: Book) -> None:
    served = seeded.client.get("/api/charts/chart-price-yield")
    assert served.status_code == 200
    assert b"<svg" in served.content
    assert b"fonts.googleapis.com" not in served.content
    assert served.headers.get_list("content-security-policy") == [CHART_CSP]


# ---------------------------------------------------------------------------- delete + GC
def test_delete_refuses_a_chart_in_use(seeded: Book) -> None:
    response = seeded.client.delete("/api/textbook/charts/chart-price-yield")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "CONFLICT")
    assert seeded.client.delete("/api/textbook/charts/nope").status_code == 404


def test_delete_removes_an_unused_chart_and_its_file(book: Book) -> None:
    out = _upload(book).json()
    path = _file(book, out["contentHash"])
    assert book.client.delete(f"/api/textbook/charts/{out['assetId']}").status_code == 204
    assert not path.exists()
    assert list(path.parent.iterdir()) == []  # no trash left behind
    assert book.client.get(f"/api/charts/{out['assetId']}").status_code == 404


def test_removing_the_last_block_collects_the_chart(seeded: Book) -> None:
    rates = seeded.json("GET", "/api/textbook/pages/fi-rates", 200)
    with seeded.uow_factory.read() as uow:
        asset = uow.session.get(orm.ChartAsset, "chart-price-yield")
        assert asset is not None
        relpath = asset.storage_relpath
    path = seeded.data_dir / relpath
    assert path.exists()
    kept = [b for b in rates["blocks"] if b["type"] != "chart"]
    _put_blocks(seeded, "fi-rates", kept)
    assert "chart-price-yield" not in _assets(seeded)
    assert not path.exists()
    (event,) = seeded.events("textbook.charts_collected")
    assert (event["actor"], event["payload"]["input"]) == (
        "system",
        {"assetIds": ["chart-price-yield"]},
    )
    home = seeded.json("GET", "/api/textbook/home", 200)
    assert (home["counts"]["charts"], home["charts"]) == (0, [])


def test_the_empty_fixture_sweeps_every_chart_file(seeded: Book) -> None:
    """``POST /dev/fixtures {"fixture":"empty"}`` deletes the rows, then a GC sweep (after the
    commit) removes the files no row names, fresh uploads included: nothing is left on disk."""
    fresh = _upload(seeded, b"<p>fresh</p>", "fresh.html")
    assert fresh.status_code == 201, fresh.text
    assert fresh.json()["assetId"] in _assets(seeded)
    assert len(list((seeded.data_dir / "charts").rglob("*.html"))) == 2
    response = seeded.client.post("/api/dev/fixtures", json={"fixture": "empty"})
    assert response.status_code == 204, response.text
    assert _assets(seeded) == set()
    assert [p for p in (seeded.data_dir / "charts").rglob("*") if p.is_file()] == []


def test_deleting_a_page_collects_its_charts(seeded: Book) -> None:
    seeded.json("DELETE", "/api/textbook/pages/fi-rates", 200)
    assert "chart-price-yield" not in _assets(seeded)


def test_a_chart_used_twice_survives_losing_one_block(seeded: Book) -> None:
    gen = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block("chart-price-yield")])
    seeded.json("DELETE", "/api/textbook/pages/fi-rates", 200)
    assert "chart-price-yield" in _assets(seeded)
    assert seeded.client.get("/api/charts/chart-price-yield").status_code == 200


def test_fresh_uploads_wait_for_the_grace_period(seeded: Book) -> None:
    out = _upload(seeded).json()
    # Another commit runs the GC: the unused upload is younger than the grace period.
    gen = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block("chart-price-yield")])
    _put_blocks(seeded, "gen-how", gen["blocks"])
    assert out["assetId"] in _assets(seeded)

    seeded.clock.advance(chart_store.GC_GRACE + timedelta(seconds=1))
    _upload(seeded, b"<p>another</p>", "another.html")  # any upload runs the GC
    assert out["assetId"] not in _assets(seeded)
    assert not _file(seeded, out["contentHash"]).exists()


def test_a_reupload_restarts_the_grace_period(seeded: Book) -> None:
    out = _upload(seeded).json()
    seeded.clock.advance(chart_store.GC_GRACE + timedelta(seconds=1))
    again = _upload(seeded).json()  # dedupes onto the old asset and refreshes it
    assert (again["assetId"], again["deduplicated"]) == (out["assetId"], True)
    assert out["assetId"] in _assets(seeded)
    assert _file(seeded, out["contentHash"]).exists()


def test_a_reupload_before_its_block_is_removed_keeps_the_chart(seeded: Book) -> None:
    # The editor re-uploads a file whose chart is already on the page (deduplicated onto the
    # same asset), and a save that removes the old block commits before it uses the answer.
    tick = timedelta(seconds=1)
    first = _upload(seeded).json()  # 1. upload X: asset A
    asset_id = first["assetId"]
    gen = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    seeded.clock.advance(tick)
    _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block(asset_id)])  # 2. use A
    seeded.clock.advance(tick)
    again = _upload(seeded).json()  # 3. upload X again: A, deduplicated
    assert (again["assetId"], again["deduplicated"]) == (asset_id, True)
    seeded.clock.advance(tick)
    _put_blocks(seeded, "gen-how", gen["blocks"])  # 4. the old block goes
    assert asset_id in _assets(seeded)
    assert seeded.client.get(f"/api/charts/{asset_id}").status_code == 200
    assert seeded.events("textbook.charts_collected") == []

    seeded.clock.advance(tick)  # 5. the editor saves the block the re-upload was for
    saved = _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block(asset_id, "chart-2")])
    assert saved["chartCount"] == 1
    page = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    assert [b["assetId"] for b in page["blocks"] if b["type"] == "chart"] == [asset_id]

    # Once that upload has been saved, removing its block collects it at once again.
    seeded.clock.advance(tick)
    _put_blocks(seeded, "gen-how", gen["blocks"])
    assert asset_id not in _assets(seeded)
    assert not _file(seeded, first["contentHash"]).exists()


def test_a_rename_between_the_reupload_and_the_drop_keeps_the_chart(seeded: Book) -> None:
    # The re-upload's answer must hold even when the page is renamed before the save that
    # drops the old block: a rename moves ``updatedAt`` but is not a blocks save.
    tick = timedelta(seconds=1)
    first = _upload(seeded).json()
    asset_id = first["assetId"]
    gen = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    seeded.clock.advance(tick)
    _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block(asset_id)])
    seeded.clock.advance(tick)
    again = _upload(seeded).json()
    assert (again["assetId"], again["deduplicated"]) == (asset_id, True)
    seeded.clock.advance(tick)
    renamed = seeded.json(
        "PATCH", "/api/textbook/pages/gen-how", 200, json={"title": "How it works"}
    )
    assert renamed["title"] == "How it works"
    seeded.clock.advance(tick)
    _put_blocks(seeded, "gen-how", gen["blocks"])
    assert asset_id in _assets(seeded)
    assert seeded.client.get(f"/api/charts/{asset_id}").status_code == 200
    assert seeded.events("textbook.charts_collected") == []


def test_deleting_a_renamed_page_dates_its_charts_by_the_last_save(seeded: Book) -> None:
    tick = timedelta(seconds=1)
    first = _upload(seeded).json()
    asset_id = first["assetId"]
    gen = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    seeded.clock.advance(tick)
    _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block(asset_id)])
    seeded.clock.advance(tick)
    _upload(seeded)  # the editor's answer, not yet saved anywhere
    seeded.clock.advance(tick)
    seeded.json("PATCH", "/api/textbook/pages/gen-how", 200, json={"title": "Renamed"})
    seeded.clock.advance(tick)
    seeded.json("DELETE", "/api/textbook/pages/gen-how", 200)
    assert asset_id in _assets(seeded)


def test_an_upload_committed_after_the_drop_keeps_its_asset(book: Book) -> None:
    # The GC runs after the dropping save commits; an upload of the same file may commit in
    # between. The drop time says which upload the save knew about.
    out = _upload(book).json()
    with book.uow_factory.read() as uow:
        asset = uow.session.get(orm.ChartAsset, out["assetId"])
        assert asset is not None
        uploaded_at = asset.uploaded_at
    earlier = {out["assetId"]: uploaded_at - timedelta(seconds=1)}
    assert chart_store.collect_garbage(book.uow_factory, book.data_dir, dropped=earlier) == []
    assert out["assetId"] in _assets(book)
    same_time = {out["assetId"]: uploaded_at}
    collected = chart_store.collect_garbage(book.uow_factory, book.data_dir, dropped=same_time)
    assert collected == [out["assetId"]]
    assert not _file(book, out["contentHash"]).exists()


def test_a_saved_block_keeps_its_upload(seeded: Book) -> None:
    out = _upload(seeded).json()
    gen = seeded.json("GET", "/api/textbook/pages/gen-how", 200)
    saved = _put_blocks(seeded, "gen-how", [*gen["blocks"], _chart_block(out["assetId"])])
    assert saved["chartCount"] == 1
    seeded.clock.advance(chart_store.GC_GRACE * 3)
    _upload(seeded, b"<p>another</p>", "another.html")
    assert out["assetId"] in _assets(seeded)
    assert seeded.json("GET", "/api/textbook/home", 200)["counts"]["charts"] == 2


def test_gc_sweeps_stray_files(book: Book) -> None:
    stray_hash = hashlib.sha256(b"orphan").hexdigest()
    stray = _file(book, stray_hash)
    stray.parent.mkdir(parents=True)
    stray.write_bytes(b"orphan")
    unrelated = book.data_dir / "charts" / "notes.txt"
    unrelated.write_text("keep me")
    assert chart_store.collect_garbage(book.uow_factory, book.data_dir) == []
    assert not stray.exists()
    assert unrelated.exists()


# ---------------------------------------------------------------------------- store internals
def test_a_rolled_back_upload_leaves_no_file(book: Book) -> None:
    class Boom(Exception):
        pass

    digest = hashlib.sha256(CHART).hexdigest()
    with pytest.raises(Boom), book.uow_factory() as uow:
        stored = chart_store.store_file(uow, book.data_dir, CHART)
        assert stored.created
        assert _file(book, digest).exists()
        raise Boom
    assert not _file(book, digest).exists()


def test_a_rolled_back_delete_keeps_the_file(book: Book) -> None:
    out = _upload(book).json()
    path = _file(book, out["contentHash"])

    class Boom(Exception):
        pass

    with pytest.raises(Boom), book.uow_factory() as uow:
        chart_store.trash_file(uow, path)
        assert not path.exists()
        raise Boom
    assert path.read_bytes() == CHART
    assert [p.name for p in path.parent.iterdir()] == [path.name]


def test_a_corrupt_file_is_rewritten(book: Book) -> None:
    out = _upload(book).json()
    path = _file(book, out["contentHash"])
    path.write_bytes(b"tampered")
    assert _upload(book).json()["deduplicated"] is True
    assert path.read_bytes() == CHART


def test_stored_paths_cannot_leave_the_charts_folder(tmp_path: Path) -> None:
    digest = "ab" + "0" * 62
    assert (
        chart_store.resolve_file(tmp_path, f"charts/ab/{digest}.html")
        == (tmp_path / "charts" / "ab" / f"{digest}.html").resolve()
    )
    for bad in ("../etc/passwd", "/etc/passwd", "charts/../remi.db", "charts", "remi.db"):
        assert chart_store.resolve_file(tmp_path, bad) is None, bad
