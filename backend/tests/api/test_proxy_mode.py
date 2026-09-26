"""Behind a reverse proxy under a path (``REMI_PUBLIC_URL``, docs/decisions/0013).

APEX's IIS serves Remi at ``https://apex.ny1.ninetyone.com/remi/`` and forwards to
``http://127.0.0.1:8765`` with the ``/remi`` prefix removed. Remi binds loopback only; it must
accept the public host and origin, keep refusing every other, and never answer with a
root-absolute redirect the proxy would not rewrite.
"""

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from remi.api.middleware import allowed_hosts, allowed_origins
from remi.core.clock import FixedClock
from remi.core.config import RemiConfig
from tests.api.conftest import build_app

PUBLIC_URL = "https://apex.ny1.ninetyone.com/remi"
PUBLIC_ORIGIN = "https://apex.ny1.ninetyone.com"
PUBLIC_HOST = "apex.ny1.ninetyone.com"
MUTATION = "/api/projects"
MUTATION_BODY = {"domain": "pc"}


def _client(tmp_path: Path, clock: FixedClock, public_url: str) -> Iterator[TestClient]:
    config = RemiConfig(data_dir=tmp_path, env="prod", open_browser=False, public_url=public_url)
    client = TestClient(build_app(config, clock), base_url="http://127.0.0.1:8765")
    yield client
    client.close()


@pytest.fixture
def proxied(tmp_path: Path, clock: FixedClock) -> Iterator[TestClient]:
    yield from _client(tmp_path, clock, PUBLIC_URL)


@pytest.fixture
def direct(tmp_path: Path, clock: FixedClock) -> Iterator[TestClient]:
    yield from _client(tmp_path, clock, "")


def _post(client: TestClient, origin: str, host: str = "127.0.0.1:8765") -> int:
    headers = {"Origin": origin, "X-Remi-Client": "1", "Host": host}
    return client.post(MUTATION, json=MUTATION_BODY, headers=headers).status_code


# ---------------------------------------------------------------- Origin
@pytest.mark.parametrize("host", ["127.0.0.1:8765", PUBLIC_HOST])
def test_a_change_from_the_public_origin_passes(proxied: TestClient, host: str) -> None:
    # Whichever Host IIS forwards: the original one, or the backend's own.
    assert _post(proxied, PUBLIC_ORIGIN, host) != 403


def test_the_public_origin_is_refused_without_the_setting(direct: TestClient) -> None:
    assert _post(direct, PUBLIC_ORIGIN) == 403


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        f"http://{PUBLIC_HOST}",  # the right host on the wrong scheme
        f"{PUBLIC_ORIGIN}:8443",
        f"{PUBLIC_ORIGIN}/remi",
        "null",
    ],
)
def test_other_origins_are_still_refused(proxied: TestClient, origin: str) -> None:
    response = proxied.post(
        MUTATION, json=MUTATION_BODY, headers={"Origin": origin, "X-Remi-Client": "1"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN_ORIGIN"


def test_the_client_header_is_still_required(proxied: TestClient) -> None:
    response = proxied.post(MUTATION, json=MUTATION_BODY, headers={"Origin": PUBLIC_ORIGIN})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLIENT_HEADER_REQUIRED"


def test_the_laptop_origin_still_works_behind_a_proxy(proxied: TestClient) -> None:
    assert _post(proxied, "http://127.0.0.1:8765") != 403


# ---------------------------------------------------------------- Host
def test_the_public_host_is_accepted_with_the_setting(proxied: TestClient) -> None:
    assert proxied.get("/api/health", headers={"Host": PUBLIC_HOST}).status_code == 200


def test_the_public_host_is_refused_without_the_setting(direct: TestClient) -> None:
    assert direct.get("/api/health", headers={"Host": PUBLIC_HOST}).status_code == 400


def test_other_hosts_are_still_refused(proxied: TestClient) -> None:
    assert proxied.get("/api/health", headers={"Host": "evil.example"}).status_code == 400


def test_hosts_and_origins_behind_a_proxy(tmp_path: Path) -> None:
    config = RemiConfig(data_dir=tmp_path, open_browser=False, public_url=PUBLIC_URL + "/")
    assert config.network is False
    assert config.host == "127.0.0.1"
    assert allowed_hosts(config) == ["127.0.0.1", "localhost", "[::1]", PUBLIC_HOST]
    assert PUBLIC_ORIGIN in allowed_origins(config)
    assert "http://127.0.0.1:8765" in allowed_origins(config)


# ---------------------------------------------------------------- no root-absolute redirects
def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)


def test_no_api_response_redirects(proxied: TestClient) -> None:
    """IIS does not rewrite Location: a redirect to /api/... would leave /remi/. Every route in
    the contract, with and without a trailing slash, answers without one."""
    spec = proxied.get("/api/openapi.json").json()
    operations = [
        (method.upper(), _concrete(path))
        for path, item in spec["paths"].items()
        for method in item
        if method in {"get", "post", "put", "patch", "delete"}
    ]
    assert len(operations) > 40, "the contract lists Remi's API"
    headers = {"Origin": "http://127.0.0.1:8765", "X-Remi-Client": "1"}
    for method, path in operations:
        for variant in (path, path.rstrip("/") + "/"):
            response = proxied.request(method, variant, headers=headers, json={})
            where = f"{method} {variant}"
            assert "location" not in response.headers, where
            assert not 300 <= response.status_code < 400, where
