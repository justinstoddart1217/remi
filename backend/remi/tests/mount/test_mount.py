"""Remi mounted in APEX's process (``remi.mount``), through Flask's test client.

The stand-in APEX (``fake_apex``) is wrapped exactly as APEX's ``server.py`` wraps its app. These
are the checks of docs/apex/INTEGRATION_REQUIREMENTS.md R-65, plus the failure isolation of R-33,
the one-process lock of R-44 and the key hand-over of R-50. After the import, APEX runs the same
tests against its real app.
"""

import io
import logging
import os
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from flask import Flask
from flask.testing import FlaskClient

from remi import __version__, mount
from remi.api.middleware import CHART_CSP
from remi.tests.mount.fake_apex import APEX_HOME, create_fake_apex

PUBLIC = "https://apex.ny1.ninetyone.com"
PUBLIC_URL = f"{PUBLIC}/remi"
WRITE = {"Origin": PUBLIC, "X-Remi-Client": "1"}
SETUP = {"moveDate": "2027-01-04", "timezone": "Europe/London", "holidayRegion": "GB-ENG"}
INDEX = '<!doctype html><html><head><base href="/" /><title>Remi</title></head><body></body></html>'
ASSET = "assets/index-abc123.js"
CHART = b"<!doctype html><title>Yield</title><svg viewBox='0 0 10 10'></svg>"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX, encoding="utf-8")
    (root / ASSET).write_text("console.log(1)", encoding="utf-8")
    return root


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "runtime" / "remi"


@pytest.fixture(autouse=True)
def host_env(monkeypatch: pytest.MonkeyPatch, dist: Path, data_dir: Path) -> None:
    """The host's settings (R-37), and nothing else from the developer's shell."""
    for name in list(os.environ):
        if name.startswith("REMI_") or name in {mount.ENABLE_VAR, mount.APEX_KEY_VAR}:
            monkeypatch.delenv(name)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("REMI_PUBLIC_URL", PUBLIC_URL)
    monkeypatch.setenv("REMI_DATA_DIR", str(data_dir))
    monkeypatch.setenv("REMI_FRONTEND_DIST", str(dist))
    monkeypatch.setenv("REMI_ENV", "prod")


def _apex() -> tuple[Flask, mount.Mounted]:
    apex = create_fake_apex()
    remi = mount.start()
    apex.wsgi_app = mount.PrefixDispatcher(apex.wsgi_app, remi)  # pyright: ignore[reportAttributeAccessIssue]
    return apex, remi


@pytest.fixture
def mounted() -> Iterator[tuple[FlaskClient, mount.Mounted]]:
    apex, remi = _apex()
    yield apex.test_client(), remi
    remi.close()


@pytest.fixture
def client(mounted: tuple[FlaskClient, mount.Mounted]) -> FlaskClient:
    assert mounted[1].available, mounted[1].problem
    return mounted[0]


def _unavailable(client: FlaskClient, *expected: str) -> None:
    response = client.get("/remi/app/today")
    assert response.status_code == 503
    body = response.get_data(as_text=True)
    for text in expected:
        assert text in body
    assert client.get("/").status_code == 200  # APEX itself is untouched
    assert client.get("/api/pm/health").json == {"status": "ok", "app": "apex"}


# ---------------------------------------------------------------- R-65: through the mount
def test_health(client: FlaskClient) -> None:
    response = client.get("/remi/api/health")
    assert response.status_code == 200
    assert response.json == {"app": "remi", "version": __version__}


@pytest.mark.parametrize(("path", "location"), [("/remi", "/remi/"), ("/remi?x=1", "/remi/?x=1")])
def test_the_bare_prefix_redirects_to_the_slash(
    client: FlaskClient, path: str, location: str
) -> None:
    response = client.get(path)
    assert response.status_code == 302
    assert response.headers["Location"] == location


@pytest.mark.parametrize("path", ["/remi/", "/remi/app/timeline", "/remi/textbook/p1"])
def test_pages_carry_the_remi_base(client: FlaskClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert '<base href="/remi/">' in page
    assert page.count("<base") == 1
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]


def test_hashed_assets_are_cached_forever(client: FlaskClient) -> None:
    response = client.get(f"/remi/{ASSET}")
    assert response.status_code == 200
    assert "immutable" in response.headers["Cache-Control"]


@pytest.mark.parametrize("base_url", ["http://localhost:8000", PUBLIC])
def test_a_change_from_the_public_origin_saves(client: FlaskClient, base_url: str) -> None:
    # Whichever Host IIS forwards to waitress: its own, or the public one.
    response = client.post("/remi/api/setup", json=SETUP, headers=WRITE, base_url=base_url)
    assert response.status_code == 201, response.get_data(as_text=True)
    assert client.get("/remi/api/settings").json["moveDate"] == "2027-01-04"  # type: ignore[index]


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example", "X-Remi-Client": "1"},
        {"Origin": "http://apex.ny1.ninetyone.com", "X-Remi-Client": "1"},
        {"Origin": PUBLIC},
    ],
)
def test_other_origins_and_a_missing_header_are_refused(
    client: FlaskClient, headers: dict[str, str]
) -> None:
    response = client.post("/remi/api/setup", json=SETUP, headers=headers)
    assert response.status_code == 403


def test_a_foreign_host_is_refused(client: FlaskClient) -> None:
    assert client.get("/remi/api/health", base_url="http://evil.example").status_code == 400


def test_a_mounted_chart_is_sandboxed(client: FlaskClient) -> None:
    """R-52: chart HTML is served from APEX's own origin, so it must stay in its sandbox."""
    upload = client.post(
        "/remi/api/textbook/charts",
        data={"file": (io.BytesIO(CHART), "yield.html", "text/html")},
        headers=WRITE,
        content_type="multipart/form-data",
    )
    assert upload.status_code == 201, upload.get_data(as_text=True)
    asset: dict[str, Any] = upload.json  # type: ignore[assignment]
    chart = client.get(f"/remi/api/charts/{asset['assetId']}")
    assert chart.status_code == 200
    assert chart.headers["Content-Security-Policy"] == CHART_CSP
    assert "allow-same-origin" not in chart.headers["Content-Security-Policy"]


def test_apex_is_untouched(client: FlaskClient) -> None:
    health = client.get("/api/pm/health")
    assert health.json == {"status": "ok", "app": "apex"}
    assert "Content-Security-Policy" not in health.headers
    for path in ("/", "/private-markets/overview", "/remix", "/remi-notes"):
        page = client.get(path)
        assert page.get_data(as_text=True) == APEX_HOME, path
        assert "Content-Security-Policy" not in page.headers, path


def test_an_error_inside_remi_stays_inside_remi(
    mounted: tuple[FlaskClient, mount.Mounted], caplog: pytest.LogCaptureFixture
) -> None:
    client, remi = mounted
    assert remi.asgi is not None

    def boom() -> None:
        raise RuntimeError("a bug in a Remi route")

    remi.asgi.add_api_route("/api/test-boom", boom)
    with caplog.at_level(logging.ERROR):
        response = client.get("/remi/api/test-boom")
    assert response.status_code == 500
    assert response.json["error"]["code"] == "INTERNAL_ERROR"  # type: ignore[index]
    # The next request, on the same worker, is served normally.
    assert client.get("/remi/api/health").status_code == 200
    assert client.get("/api/pm/health").status_code == 200


# ---------------------------------------------------------------- R-33, R-35, R-41, R-44
def test_an_unusable_data_folder_leaves_apex_running(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    blocker = tmp_path / "not-a-folder"
    blocker.write_text("a file where the data folder should be", encoding="utf-8")
    monkeypatch.setenv("REMI_DATA_DIR", str(blocker / "remi"))
    with caplog.at_level(logging.ERROR, logger="remi.mount"):
        apex, remi = _apex()
    assert not remi.available
    failures = [r for r in caplog.records if r.name == "remi.mount" and r.levelno == logging.ERROR]
    assert len(failures) == 1  # logged once, loudly
    _unavailable(apex.test_client(), "Remi is not available", "remi.mount")


@pytest.mark.parametrize("name", ["REMI_PUBLIC_URL", "REMI_DATA_DIR"])
def test_a_missing_setting_leaves_apex_running(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.delenv(name)
    apex, remi = _apex()
    assert not remi.available
    _unavailable(apex.test_client(), name)


def test_remi_can_be_switched_off(monkeypatch: pytest.MonkeyPatch, data_dir: Path) -> None:
    monkeypatch.setenv(mount.ENABLE_VAR, "0")
    apex, remi = _apex()
    assert not remi.available
    _unavailable(apex.test_client(), "switched off")
    assert not data_dir.exists()  # nothing was opened


def test_the_host_never_runs_on_a_pinned_date(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_TODAY", "2026-10-05")
    apex, remi = _apex()
    assert not remi.available
    _unavailable(apex.test_client(), "REMI_TODAY")


def test_only_one_process_serves_the_data_folder() -> None:
    """A second APEX server on the same checkout must not migrate the same remi.db (R-44)."""
    apex, first = _apex()
    try:
        assert first.available
        _, second = _apex()
        assert not second.available
        assert "another process" in (second.problem or "")
    finally:
        first.close()
    _, third = _apex()  # the lock went with the first
    assert third.available
    third.close()
    del apex


def test_a_newer_database_leaves_apex_running(data_dir: Path) -> None:
    _, remi = _apex()
    assert remi.available
    remi.close()
    import sqlite3

    with sqlite3.connect(data_dir / "remi.db") as db:
        db.execute("UPDATE alembic_version SET version_num = '9999_from_the_future'")
    apex, again = _apex()
    assert not again.available
    _unavailable(apex.test_client(), "Remi is not available")


# ---------------------------------------------------------------- R-15, R-38, R-50
def test_mounting_needs_no_uvicorn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "uvicorn", None)
    _, remi = _apex()
    assert remi.available, remi.problem
    remi.close()


def test_apexs_assistant_key_is_handed_to_remi(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(mount.APEX_KEY_VAR, "sk-ant-test-0123456789")
    apex, remi = _apex()
    try:
        assert os.environ[mount.REMI_KEY_VAR] == "sk-ant-test-0123456789"
        settings: dict[str, Any] = apex.test_client().get("/remi/api/settings").json  # type: ignore[assignment]
        assert settings["aiKeyConfigured"] is True
        assert "sk-ant" not in str(settings)
    finally:
        remi.close()


def test_remis_own_key_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(mount.APEX_KEY_VAR, "sk-ant-apex-0123456789")
    monkeypatch.setenv(mount.REMI_KEY_VAR, "sk-ant-remi-0123456789")
    _, remi = _apex()
    remi.close()
    assert os.environ[mount.REMI_KEY_VAR] == "sk-ant-remi-0123456789"


def test_the_banner_line(monkeypatch: pytest.MonkeyPatch) -> None:
    app = mount.mount(create_fake_apex().wsgi_app)
    try:
        assert mount.status() == f"Remi {__version__}: {PUBLIC_URL}/"
    finally:
        assert isinstance(app, mount.PrefixDispatcher)
        app.remi.close()
    monkeypatch.setenv(mount.ENABLE_VAR, "off")
    mount.mount(create_fake_apex().wsgi_app)
    assert mount.status().startswith("Remi: unavailable (Remi is switched off")
