"""Host check, the mutation guard (Origin + X-Remi-Client) and the security headers."""

import logging
import re
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.testclient import TestClient

from app.api.errors import install_error_handlers
from app.api.middleware import (
    APP_CSP,
    CHART_CSP,
    allowed_hosts,
    allowed_origins,
    install_security,
)
from app.core.clock import FixedClock
from app.core.config import RemiConfig
from tests.api.conftest import BASE_URL, ORIGIN, build_app

MUTATION = "/api/projects"
MUTATION_BODY = {"domain": "pc"}


# ---------------------------------------------------------------- Host (DNS rebinding)
@pytest.mark.parametrize(
    "host", ["127.0.0.1:8765", "localhost:8765", "[::1]:8765", "127.0.0.1", "localhost"]
)
def test_loopback_hosts_are_served(bare_client: TestClient, host: str) -> None:
    response = bare_client.get("/api/health", headers={"Host": host})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "host", ["evil.example", "evil.example:8765", "192.168.1.20:8765", "127.0.0.1.nip.io:8765"]
)
def test_other_hosts_are_rejected(bare_client: TestClient, host: str) -> None:
    response = bare_client.get("/api/health", headers={"Host": host})
    assert response.status_code == 400
    assert "remi" not in response.text


def test_host_check_covers_non_api_paths(bare_client: TestClient) -> None:
    response = bare_client.get("/", headers={"Host": "evil.example"})
    assert response.status_code == 400


def test_allowed_hosts_include_the_configured_loopback(
    tmp_path_factory: pytest.TempPathFactory,
) -> None:
    config = RemiConfig(
        data_dir=tmp_path_factory.mktemp("d"), host="::1", env="prod", open_browser=False
    )
    assert "[::1]" in allowed_hosts(config)
    assert "http://[::1]:8765" in allowed_origins(config)


# ---------------------------------------------------------------- mutation guard
def test_mutation_with_origin_and_header_passes_the_guard(client: TestClient) -> None:
    response = client.post(MUTATION, json=MUTATION_BODY)
    assert response.status_code == 501  # reached the (stub) route


def test_mutation_without_origin_is_forbidden(bare_client: TestClient) -> None:
    response = bare_client.post(MUTATION, json=MUTATION_BODY, headers={"X-Remi-Client": "1"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN_ORIGIN"


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "http://evil.example:8765",
        "http://127.0.0.1:9999",
        "https://127.0.0.1:8765",
        "null",
        "http://127.0.0.1:8765/",
    ],
)
def test_mutation_from_another_origin_is_forbidden(bare_client: TestClient, origin: str) -> None:
    response = bare_client.post(
        MUTATION, json=MUTATION_BODY, headers={"Origin": origin, "X-Remi-Client": "1"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN_ORIGIN"


@pytest.mark.parametrize("value", [None, "0", "true", ""])
def test_mutation_without_client_header_is_forbidden(
    bare_client: TestClient, value: str | None
) -> None:
    headers = {"Origin": ORIGIN}
    if value is not None:
        headers["X-Remi-Client"] = value
    response = bare_client.post(MUTATION, json=MUTATION_BODY, headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLIENT_HEADER_REQUIRED"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("PUT", "/api/settings/ai-key"),
        ("PATCH", "/api/settings"),
        ("DELETE", "/api/projects/p-1"),
        ("POST", "/api/dev/fixtures"),
    ],
)
def test_every_mutating_method_is_guarded(bare_client: TestClient, method: str, path: str) -> None:
    response = bare_client.request(method, path, json={})
    assert response.status_code == 403


def test_reads_need_no_origin_or_header(bare_client: TestClient) -> None:
    assert bare_client.get("/api/health").status_code == 200
    assert bare_client.get("/api/plan").status_code == 501
    assert bare_client.head("/api/health").status_code in {200, 405}


def test_localhost_origin_is_allowed(bare_client: TestClient) -> None:
    response = bare_client.post(
        MUTATION,
        json=MUTATION_BODY,
        headers={"Origin": "http://localhost:8765", "X-Remi-Client": "1"},
    )
    assert response.status_code == 501


def test_vite_dev_origin_is_allowed_outside_prod(bare_client: TestClient) -> None:
    response = bare_client.post(
        MUTATION,
        json=MUTATION_BODY,
        headers={"Origin": "http://127.0.0.1:5173", "X-Remi-Client": "1"},
    )
    assert response.status_code == 501


def test_vite_dev_origin_is_rejected_in_prod(prod_config: RemiConfig, clock: FixedClock) -> None:
    with_prod = TestClient(build_app(prod_config, clock), base_url=BASE_URL)
    try:
        response = with_prod.post(
            MUTATION,
            json=MUTATION_BODY,
            headers={"Origin": "http://127.0.0.1:5173", "X-Remi-Client": "1"},
        )
        assert response.status_code == 403
        ok = with_prod.post(
            MUTATION, json=MUTATION_BODY, headers={"Origin": ORIGIN, "X-Remi-Client": "1"}
        )
        assert ok.status_code == 501
    finally:
        with_prod.close()


def test_origins_follow_the_configured_port(tmp_path_factory: pytest.TempPathFactory) -> None:
    config = RemiConfig(
        data_dir=tmp_path_factory.mktemp("d"), port=9000, env="prod", open_browser=False
    )
    origins = allowed_origins(config)
    assert "http://127.0.0.1:9000" in origins
    assert "http://127.0.0.1:8765" not in origins
    assert all(o.startswith("http://") for o in origins)


def test_non_api_mutations_are_not_the_guards_business(bare_client: TestClient) -> None:
    # Outside /api there is nothing to mutate; the guard only protects the API.
    response = bare_client.post("/not-api", json={})
    assert response.status_code in {404, 405}


# ---------------------------------------------------------------- security headers and CSP
def _csp_directives(value: str) -> dict[str, list[str]]:
    directives: dict[str, list[str]] = {}
    for part in value.split(";"):
        tokens = part.split()
        if tokens:
            directives[tokens[0]] = tokens[1:]
    return directives


def test_app_csp_is_self_only() -> None:
    directives = _csp_directives(APP_CSP)
    assert directives["default-src"] == ["'self'"]
    assert directives["script-src"] == ["'self'"]
    assert directives["connect-src"] == ["'self'"]
    assert directives["frame-ancestors"] == ["'none'"]
    assert directives["object-src"] == ["'none'"]
    # The page's <base href> (ADR-0013) may only point at Remi's own origin.
    assert directives["base-uri"] == ["'self'"]
    assert not re.search(r"https?:|\*|'unsafe-eval'", APP_CSP)
    # Inline scripts are never allowed; inline styles are (KaTeX).
    assert "'unsafe-inline'" not in directives["script-src"]


def test_chart_csp_is_sandboxed_with_no_network() -> None:
    directives = _csp_directives(CHART_CSP)
    assert directives["sandbox"] == ["allow-scripts"]
    assert directives["default-src"] == ["'none'"]
    assert directives["connect-src"] == ["'none'"]
    assert "allow-same-origin" not in CHART_CSP
    assert not re.search(r"https?:|\*|'self'", " ".join(directives["script-src"]))


@pytest.mark.parametrize("path", ["/api/health", "/api/plan", "/api/nope"])
def test_responses_carry_the_app_csp(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.headers["content-security-policy"] == APP_CSP
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_rejections_carry_the_csp_too(bare_client: TestClient) -> None:
    forbidden = bare_client.post(MUTATION, json=MUTATION_BODY)
    assert forbidden.status_code == 403
    assert forbidden.headers["content-security-policy"] == APP_CSP
    bad_host = bare_client.get("/api/health", headers={"Host": "evil.example"})
    assert bad_host.status_code == 400
    assert bad_host.headers["content-security-policy"] == APP_CSP


def test_no_cors_headers(bare_client: TestClient) -> None:
    response = bare_client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers
    preflight = bare_client.options(
        MUTATION,
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in preflight.headers


@pytest.fixture
def chart_client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    """A bare app whose route sets its own CSP, as the chart endpoint will."""
    config = RemiConfig(data_dir=tmp_path_factory.mktemp("d"), env="test", open_browser=False)
    app = FastAPI()
    install_security(app, config)

    @app.get("/api/charts/demo", response_class=HTMLResponse)
    def chart() -> HTMLResponse:  # pyright: ignore[reportUnusedFunction]
        return HTMLResponse("<p>chart</p>", headers={"Content-Security-Policy": CHART_CSP})

    test_client = TestClient(app, base_url=BASE_URL)
    yield test_client
    test_client.close()


def test_a_route_with_its_own_csp_keeps_it(chart_client: TestClient) -> None:
    response = chart_client.get("/api/charts/demo")
    assert response.status_code == 200
    assert response.headers.get_list("content-security-policy") == [CHART_CSP]
    assert response.headers["x-content-type-options"] == "nosniff"


# ---------------------------------------------------------------- unexpected errors (500)
@pytest.fixture
def boom_client(config: RemiConfig, clock: FixedClock) -> Iterator[TestClient]:
    """The full app plus routes that raise, as a bug in a service would."""
    app = build_app(config, clock)

    @app.get("/api/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("secret detail that must not leak")

    @app.post("/api/boom")
    def boom_mutation() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("secret detail that must not leak")

    @app.get("/boom")
    def boom_outside_api() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("secret detail that must not leak")

    test_client = TestClient(
        app,
        base_url=BASE_URL,
        headers={"Origin": ORIGIN, "X-Remi-Client": "1"},
        raise_server_exceptions=False,
    )
    yield test_client
    test_client.close()


@pytest.mark.parametrize(
    ("method", "path"), [("GET", "/api/boom"), ("POST", "/api/boom"), ("GET", "/boom")]
)
def test_unexpected_errors_are_the_envelope_with_security_headers(
    boom_client: TestClient, method: str, path: str
) -> None:
    response = boom_client.request(method, path)
    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong inside Remi.",
            "field": None,
        }
    }
    assert "secret" not in response.text
    assert response.headers["content-security-policy"] == APP_CSP
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cross-origin-opener-policy"] == "same-origin"


def test_unexpected_errors_are_logged_once_without_details(
    boom_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR, logger="remi.api"):
        boom_client.get("/api/boom")
    records = [r for r in caplog.records if r.name == "remi.api"]
    assert len(records) == 1
    assert "RuntimeError" in records[0].getMessage()
    assert "/api/boom" in records[0].getMessage()
    assert "secret" not in records[0].getMessage()


def test_unexpected_errors_still_reach_the_server(config: RemiConfig, clock: FixedClock) -> None:
    """The exception is re-raised after the envelope is sent, so the server can log it."""
    app = build_app(config, clock)

    @app.get("/api/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("boom")

    with (
        TestClient(app, base_url=BASE_URL) as raising_client,
        pytest.raises(RuntimeError, match="boom"),
    ):
        raising_client.get("/api/boom")


def test_security_alone_still_sends_the_envelope(tmp_path_factory: pytest.TempPathFactory) -> None:
    """``install_security`` without the handlers (Starlette's default 500 path)."""
    config = RemiConfig(data_dir=tmp_path_factory.mktemp("d"), env="test", open_browser=False)
    app = FastAPI()
    install_security(app, config)

    @app.get("/api/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("secret")

    with TestClient(app, base_url=BASE_URL, raise_server_exceptions=False) as bare:
        response = bare.get("/api/boom")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert response.headers["content-security-policy"] == APP_CSP


def test_handlers_alone_keep_the_envelope() -> None:
    """``install_error_handlers`` without the middleware: Starlette's own 500 path."""
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/api/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("secret")

    with TestClient(app, base_url=BASE_URL, raise_server_exceptions=False) as bare:
        response = bare.get("/api/boom")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
