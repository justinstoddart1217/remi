"""Production serving: the built SPA next to the API (``app/api/static.py``)."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.middleware import APP_CSP
from app.api.static import IMMUTABLE, SpaFiles, install_static, safe_file
from app.core.clock import FixedClock
from app.core.config import RemiConfig
from app.main import create_app

BASE_URL = "http://127.0.0.1:8765"
INDEX_HTML = "<!doctype html><title>Remi</title><div id=root></div>"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    root = tmp_path / "web" / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (root / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (root / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (root / ".env").write_text("SECRET=1", encoding="utf-8")
    (tmp_path / "web" / "secret.txt").write_text("outside dist", encoding="utf-8")
    return root


def _client(tmp_path: Path, dist: Path, clock: FixedClock, env: str = "prod") -> TestClient:
    config = RemiConfig(
        data_dir=tmp_path / "data",
        env=env,  # type: ignore[arg-type]
        open_browser=False,
        frontend_dist=dist,
    )
    # No lifespan: these requests never touch the database.
    return TestClient(create_app(config, clock), base_url=BASE_URL)


@pytest.fixture
def web(tmp_path: Path, dist: Path, clock: FixedClock) -> Iterator[TestClient]:
    client = _client(tmp_path, dist, clock)
    yield client
    client.close()


@pytest.mark.parametrize(
    "path", ["/", "/app/today", "/app/calendar/2026-10", "/textbook/p1", "/setup"]
)
def test_client_routes_get_index_html_uncached(web: TestClient, path: str) -> None:
    response = web.get(path)
    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["content-security-policy"] == APP_CSP


def test_hashed_assets_are_cached_forever(web: TestClient) -> None:
    response = web.get("/assets/index-abc123.js")
    assert response.status_code == 200
    assert response.text == "console.log(1)"
    assert response.headers["cache-control"] == IMMUTABLE
    assert "javascript" in response.headers["content-type"]


def test_a_missing_asset_is_a_404_not_the_app(web: TestClient) -> None:
    response = web.get("/assets/index-old999.js")
    assert response.status_code == 404
    assert response.text != INDEX_HTML


def test_top_level_files_are_served(web: TestClient) -> None:
    response = web.get("/favicon.svg")
    assert (response.status_code, response.text) == (200, "<svg/>")
    assert response.headers["cache-control"] == "no-cache"


def test_head_requests_work(web: TestClient) -> None:
    response = web.head("/app/today")
    assert response.status_code == 200
    assert response.content == b""


def test_api_misses_stay_json(web: TestClient) -> None:
    for path in ("/api/nope", "/api", "/api/textbook/nope/deeper"):
        response = web.get(path)
        assert response.status_code == 404, path
        assert response.headers["content-type"] == "application/json"
        assert response.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("path", ["/charts/abc", "/charts", "/docs", "/redoc"])
def test_reserved_paths_are_never_the_app(web: TestClient, path: str) -> None:
    response = web.get(path)
    assert response.status_code == 404
    assert INDEX_HTML not in response.text


def test_writes_outside_the_api_are_not_served(web: TestClient) -> None:
    assert web.post("/app/today", json={}).status_code in {404, 405}


@pytest.mark.parametrize(
    "path",
    [
        "/%2e%2e/secret.txt",
        "/..%2fsecret.txt",
        "/assets/%2e%2e/%2e%2e/secret.txt",
        "/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
        "/.env",
        "/assets/..%5c..%5csecret.txt",
    ],
)
def test_path_traversal_never_leaks_files(web: TestClient, path: str) -> None:
    response = web.get(path)
    assert "outside dist" not in response.text
    assert "SECRET" not in response.text
    assert "root:" not in response.text
    assert response.status_code in {200, 404}
    if response.status_code == 200:
        assert response.text == INDEX_HTML


def test_symlinks_out_of_dist_are_not_followed(web: TestClient, dist: Path) -> None:
    (dist / "leak.txt").symlink_to(dist.parent / "secret.txt")
    (dist / "assets" / "leak.js").symlink_to(dist.parent / "secret.txt")
    assert web.get("/leak.txt").text == INDEX_HTML
    assert web.get("/assets/leak.js").status_code == 404


def test_safe_file_rules(dist: Path) -> None:
    assert safe_file(dist, "index.html") == (dist / "index.html").resolve()
    assert safe_file(dist, "assets/index-abc123.js") is not None
    for bad in ("", "..", "../secret.txt", "/etc/passwd", ".env", "assets", "a\x00b", "a\\b"):
        assert safe_file(dist, bad) is None, bad
    assert safe_file(dist.parent / "missing", "index.html") is None


def test_missing_dist_is_a_503_page_and_the_api_still_works(
    tmp_path: Path, clock: FixedClock
) -> None:
    with _client(tmp_path, tmp_path / "nowhere", clock) as client:
        response = client.get("/app/today")
        assert response.status_code == 503
        assert "make build" in response.text
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/nope").status_code == 404


def test_a_build_after_startup_is_picked_up(tmp_path: Path, dist: Path, clock: FixedClock) -> None:
    later = tmp_path / "later"
    with _client(tmp_path, later, clock) as client:
        assert client.get("/").status_code == 503
        later.mkdir()
        (later / "index.html").write_text(INDEX_HTML, encoding="utf-8")
        assert client.get("/").text == INDEX_HTML


def test_routes_added_later_still_win(tmp_path: Path, dist: Path, clock: FixedClock) -> None:
    config = RemiConfig(data_dir=tmp_path / "d", env="test", open_browser=False, frontend_dist=dist)
    app = create_app(config, clock)

    @app.get("/late")
    def late() -> dict[str, bool]:  # pyright: ignore[reportUnusedFunction]
        return {"late": True}

    with TestClient(app, base_url=BASE_URL) as client:
        assert client.get("/late").json() == {"late": True}
        assert client.get("/early").text == INDEX_HTML


def test_install_static_is_idempotent(tmp_path: Path, dist: Path) -> None:
    app = FastAPI()
    install_static(app, tmp_path)
    install_static(app, dist)
    handler = app.router.default
    assert isinstance(handler, SpaFiles)
    assert handler.dist == dist
    assert not isinstance(handler.fallback, SpaFiles)
