"""Server mode (``REMI_NETWORK=1``): the APEX server, where other computers open Remi.

Remi then answers to this computer's own names and ``REMI_ALLOWED_HOSTS``, and accepts changes
from pages served under those names. Everything else stays as guarded as on loopback.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from remi.api import middleware
from remi.api.middleware import allowed_hosts, allowed_origins
from remi.core.clock import FixedClock
from remi.core.config import RemiConfig
from remi.tests.api.conftest import build_app

MUTATION = "/api/projects"
MUTATION_BODY = {"domain": "pc"}
SERVER = "apexserver"


@pytest.fixture(autouse=True)
def _machine_names(monkeypatch: pytest.MonkeyPatch) -> None:
    # No DNS in tests: this computer is "apexserver" at 10.1.2.3.
    monkeypatch.setattr(middleware, "machine_names", lambda: [SERVER, "10.1.2.3"])


def _server_client(
    tmp_path: Path, clock: FixedClock, allowed: str = "apex"
) -> Iterator[TestClient]:
    config = RemiConfig(
        data_dir=tmp_path,
        env="prod",
        open_browser=False,
        network=True,
        host="0.0.0.0",  # noqa: S104
        allowed_hosts=allowed,
    )
    client = TestClient(build_app(config, clock), base_url=f"http://{SERVER}:8765")
    yield client
    client.close()


@pytest.fixture
def server(tmp_path: Path, clock: FixedClock) -> Iterator[TestClient]:
    yield from _server_client(tmp_path, clock)


@pytest.fixture
def any_host_server(tmp_path: Path, clock: FixedClock) -> Iterator[TestClient]:
    yield from _server_client(tmp_path, clock, allowed="*")


@pytest.mark.parametrize(
    "host",
    # Browsers send the Host in lowercase, whatever the link says.
    ["apexserver:8765", "10.1.2.3:8765", "apex:8765", "127.0.0.1:8765"],
)
def test_server_answers_to_its_own_names(server: TestClient, host: str) -> None:
    response = server.get("/api/health", headers={"Host": host})
    assert response.status_code == 200


@pytest.mark.parametrize("host", ["evil.example:8765", "0.0.0.0:8765", "10.9.9.9:8765"])
def test_server_still_rejects_other_names(server: TestClient, host: str) -> None:
    assert server.get("/api/health", headers={"Host": host}).status_code == 400


@pytest.mark.parametrize("origin", ["http://apexserver:8765", "http://apex:8765"])
def test_changes_from_the_servers_own_pages_pass(server: TestClient, origin: str) -> None:
    response = server.post(
        MUTATION, json=MUTATION_BODY, headers={"Origin": origin, "X-Remi-Client": "1"}
    )
    assert response.status_code != 403


@pytest.mark.parametrize(
    "origin", ["http://evil.example:8765", "http://apexserver:9999", "https://apexserver:8765"]
)
def test_changes_from_elsewhere_are_forbidden(server: TestClient, origin: str) -> None:
    response = server.post(
        MUTATION, json=MUTATION_BODY, headers={"Origin": origin, "X-Remi-Client": "1"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN_ORIGIN"


def test_the_client_header_is_still_required(server: TestClient) -> None:
    response = server.post(
        MUTATION, json=MUTATION_BODY, headers={"Origin": f"http://{SERVER}:8765"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLIENT_HEADER_REQUIRED"


def test_any_host_accepts_any_name_but_only_same_origin_changes(
    any_host_server: TestClient,
) -> None:
    headers = {"Host": "whatever.corp:8765"}
    assert any_host_server.get("/api/health", headers=headers).status_code == 200
    same = any_host_server.post(
        MUTATION,
        json=MUTATION_BODY,
        headers={**headers, "Origin": "http://whatever.corp:8765", "X-Remi-Client": "1"},
    )
    assert same.status_code != 403
    cross = any_host_server.post(
        MUTATION,
        json=MUTATION_BODY,
        headers={**headers, "Origin": "http://evil.example:8765", "X-Remi-Client": "1"},
    )
    assert cross.status_code == 403


def test_hosts_and_origins_in_server_mode(tmp_path: Path) -> None:
    config = RemiConfig(
        data_dir=tmp_path,
        env="prod",
        open_browser=False,
        network=True,
        host="0.0.0.0",  # noqa: S104
        allowed_hosts="Apex; remi.corp.example",
    )
    hosts = allowed_hosts(config)
    assert hosts[:3] == ["127.0.0.1", "localhost", "[::1]"]
    assert {SERVER, "10.1.2.3", "apex", "remi.corp.example"} <= set(hosts)
    assert "0.0.0.0" not in hosts  # noqa: S104
    assert "http://apex:8765" in allowed_origins(config)
    assert "http://127.0.0.1:5173" not in allowed_origins(config)


def test_loopback_mode_ignores_the_machines_names(tmp_path: Path) -> None:
    config = RemiConfig(data_dir=tmp_path, env="prod", open_browser=False)
    assert allowed_hosts(config) == ["127.0.0.1", "localhost", "[::1]"]
