from dataclasses import replace

from remi.services.engine.aliases import (
    AliasIndex,
    Tag,
    build_index,
    match_project,
    mentions,
    normalise_key,
    tags_for,
)
from remi.tests.engine import seed as S


def index() -> AliasIndex:
    return build_index(S.projects(), S.ROUTINES, S.ALIASES)


def ids(text: str) -> list[str]:
    return [t.id for t in tags_for(text, index())]


def test_seed_notes_are_tagged_like_the_prototype() -> None:
    today = S.NOTES["2026-10-05"]
    assert ids(today[0]) == ["r-ret"]
    assert ids(today[1]) == ["ret", "r-ret"]
    assert ids(today[2]) == ["manco"]
    assert ids(S.NOTES["2026-10-02"][0]) == ["play"]
    assert ids(S.NOTES["2026-10-02"][1]) == ["fion"]
    assert ids(S.NOTES["2026-10-01"][0]) == ["fion"]


def test_word_boundaries_and_casefold() -> None:
    assert ids("The ALPHA ENGINE is next") == ["alpha"]
    assert ids("Reading the alphabet") == []
    assert ids("pipelines everywhere") == []
    assert ids("Returns-pipeline, again") == ["ret", "r-ret"]
    assert ids("returns\npipeline") == ["ret", "r-ret"]
    assert tags_for("Alpha", index()) == [Tag("project", "alpha")]


def test_short_aliases_are_ignored_and_bd8_now_counts() -> None:
    idx = build_index(S.projects(), S.ROUTINES, {"ret": ("rp", "ab")})
    assert ids("rp ab") == []
    assert [t.id for t in tags_for("rp ab", idx)] == []
    assert ids("The BD8 pack went out") == ["r-man"]


def test_routine_is_suppressed_by_its_project_unless_co_tagged() -> None:
    assert ids("ManCo pack took all morning") == ["manco"]
    assert ids("The pipeline and the returns") == ["ret", "r-ret"]
    no_co_tag = (replace(S.ROUTINES[0], co_tag=False), S.ROUTINES[1])
    idx = build_index(S.projects(), no_co_tag, S.ALIASES)
    assert [t.id for t in tags_for("The pipeline and the returns", idx)] == ["ret"]


def test_projects_come_first_in_their_own_order() -> None:
    assert ids("returns, then the playbook and the pipeline") == ["ret", "play", "r-ret"]


def test_match_project_and_normalise() -> None:
    assert match_project("Push the playbook target", index()) == "play"
    assert match_project("nothing here", index()) is None
    assert normalise_key("  Returns   Pipeline ") == "returns pipeline"


def test_mentions_count_notes_most_first() -> None:
    result = mentions(S.NOTES["2026-10-05"], index())
    assert [(m.tag.id, m.count) for m in result] == [("r-ret", 2), ("ret", 1), ("manco", 1)]


def test_entity_without_usable_keys() -> None:
    blank = replace(S.project("alpha"), name="")
    plan = replace(blank.plan, short="")
    idx = build_index([replace(blank, plan=plan)], (), {})
    assert idx.projects[0].pattern is None
    assert tags_for("alpha", idx) == []
    assert match_project("alpha", idx) is None
