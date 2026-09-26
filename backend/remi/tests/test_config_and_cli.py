from datetime import date
from pathlib import Path

import pytest
import uvicorn
from pydantic import ValidationError

from remi import main
from remi.core import config as config_module
from remi.core.clock import FixedClock, OffsetClock, SystemClock, build_clock
from remi.core.config import DEFAULT_PORT, LOOPBACK_HOST, RemiConfig, is_loopback_host
from remi.core.paths import default_data_dir


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.2", "::1", "[::1]", "localhost"])
def test_loopback_hosts_are_accepted(host: str) -> None:
    assert is_loopback_host(host)


@pytest.mark.parametrize(
    "host",
    ["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "example.com", ""],  # noqa: S104
)
def test_non_loopback_hosts_are_rejected(host: str) -> None:
    assert not is_loopback_host(host)


def test_config_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("HOST", "PORT", "ENV", "TODAY", "DATA_DIR", "OPEN_BROWSER"):
        monkeypatch.delenv(f"REMI_{name}", raising=False)

    cfg = RemiConfig()

    assert cfg.host == LOOPBACK_HOST
    assert cfg.port == DEFAULT_PORT
    assert cfg.env == "prod"
    assert cfg.today is None
    assert cfg.open_browser is True
    assert cfg.chart_max_bytes == 4 * 1024 * 1024
    assert cfg.data_dir == default_data_dir()
    assert cfg.data_dir.name == "Remi"


def test_config_reads_remi_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("REMI_PORT", "9001")
    monkeypatch.setenv("REMI_ENV", "test")
    monkeypatch.setenv("REMI_TODAY", "2026-10-05")
    monkeypatch.setenv("REMI_DATA_DIR", str(tmp_path))

    cfg = RemiConfig()

    assert cfg.port == 9001
    assert cfg.env == "test"
    assert cfg.today == date(2026, 10, 5)
    assert cfg.data_dir == tmp_path


def test_config_refuses_non_loopback_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_HOST", "0.0.0.0")  # noqa: S104
    with pytest.raises(ValidationError, match="local-only"):
        RemiConfig()


def test_server_mode_may_bind_any_address(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_NETWORK", "1")
    monkeypatch.setenv("REMI_HOST", "0.0.0.0")  # noqa: S104
    monkeypatch.setenv("REMI_ALLOWED_HOSTS", " Apex , 10.0.0.5,, ")

    cfg = RemiConfig()

    assert cfg.network is True
    assert cfg.host == "0.0.0.0"  # noqa: S104
    assert cfg.extra_hosts == ["apex", "10.0.0.5"]


def test_allowed_hosts_need_server_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_ALLOWED_HOSTS", "apex")
    with pytest.raises(ValidationError, match="server mode only"):
        RemiConfig()


@pytest.mark.parametrize("value", ["http://apex", "apex:8765", "apex/remi", "a b"])
def test_allowed_hosts_are_names_only(value: str) -> None:
    with pytest.raises(ValidationError, match="names or addresses only"):
        RemiConfig(network=True, allowed_hosts=value)


def _fake_machine(
    monkeypatch: pytest.MonkeyPatch, hostname: str, domain: str, addresses: list[str]
) -> None:
    """This computer, as the socket module reports it (no DNS in tests)."""

    def getfqdn(name: str = "") -> str:
        return f"{name}{domain}"

    def gethostbyname_ex(name: str) -> tuple[str, list[str], list[str]]:
        return (name, [], addresses)

    monkeypatch.setattr(config_module.socket, "gethostname", lambda: hostname)
    monkeypatch.setattr(config_module.socket, "getfqdn", getfqdn)
    monkeypatch.setattr(config_module.socket, "gethostbyname_ex", gethostbyname_ex)


def test_machine_names_are_lowercase_and_skip_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_machine(monkeypatch, "APEXSERVER", ".Corp.Example", ["127.0.1.1", "10.1.2.3"])
    assert config_module.machine_names() == ["apexserver", "apexserver.corp.example", "10.1.2.3"]


def test_machine_names_survive_a_failed_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_: object) -> str:
        raise OSError("no DNS")

    monkeypatch.setattr(config_module.socket, "gethostname", fail)
    assert config_module.machine_names() == []


@pytest.mark.parametrize(
    ("value", "url", "base", "origin", "host"),
    [
        (
            "https://apex.ny1.ninetyone.com/remi/",
            "https://apex.ny1.ninetyone.com/remi",
            "/remi",
            "https://apex.ny1.ninetyone.com",
            "apex.ny1.ninetyone.com",
        ),
        (
            " HTTPS://APEX.Example.com:443/remi// ",
            "https://apex.example.com/remi",
            "/remi",
            "https://apex.example.com",
            "apex.example.com",
        ),
        (
            "http://127.0.0.1:8807/remi",
            "http://127.0.0.1:8807/remi",
            "/remi",
            "http://127.0.0.1:8807",
            "127.0.0.1",
        ),
        (
            "https://apex.example.com/",
            "https://apex.example.com",
            "",
            "https://apex.example.com",
            "apex.example.com",
        ),
        ("http://apex:80/a/b", "http://apex/a/b", "/a/b", "http://apex", "apex"),
        ("", "", "", "", ""),
    ],
)
def test_public_url_is_normalised(value: str, url: str, base: str, origin: str, host: str) -> None:
    cfg = RemiConfig(public_url=value)
    assert (cfg.public_url, cfg.base_path, cfg.public_origin, cfg.public_host) == (
        url,
        base,
        origin,
        host,
    )


@pytest.mark.parametrize(
    "value",
    [
        "ftp://apex.example.com/remi",
        "apex.example.com/remi",
        "/remi",
        "https://apex.example.com/remi?x=1",
        "https://apex.example.com/remi#top",
        "https:///remi",
        "https://user:pw@apex.example.com/remi",
        "https://apex.example.com:99999/remi",
    ],
)
def test_public_url_must_be_an_absolute_http_address(value: str) -> None:
    with pytest.raises(ValidationError, match="REMI_PUBLIC_URL"):
        RemiConfig(public_url=value)


def test_public_url_needs_no_server_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REMI_PUBLIC_URL", "https://apex.ny1.ninetyone.com/remi")
    cfg = RemiConfig()
    assert cfg.network is False
    assert cfg.host == LOOPBACK_HOST
    assert cfg.base_path == "/remi"


def test_remi_today_pins_only_the_date() -> None:
    assert isinstance(build_clock(None), SystemClock)
    clock = build_clock(date(2026, 10, 5))
    assert isinstance(clock, OffsetClock)
    assert clock.today() == date(2026, 10, 5)
    assert clock.now().tzinfo is not None


def test_fixed_clock(clock: FixedClock) -> None:
    assert clock.today() == date(2026, 10, 5)


def test_cli_refuses_non_loopback_host(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main.cli(["--host", "0.0.0.0", "--no-browser"])  # noqa: S104

    assert exit_info.value.code == 2
    assert "non-loopback" in capsys.readouterr().err


def test_cli_serves_on_loopback_without_browser(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("REMI_HOST", raising=False)
    monkeypatch.delenv("REMI_PORT", raising=False)
    served: list[tuple[str, int]] = []
    opened: list[str] = []

    def fake_run(self: uvicorn.Server, sockets: object = None) -> None:
        served.append((self.config.host, self.config.port))

    monkeypatch.setattr(uvicorn.Server, "run", fake_run)
    monkeypatch.setattr(main.webbrowser, "open", opened.append)

    main.cli(["--no-browser", "--data-dir", str(tmp_path)])

    assert served == [(LOOPBACK_HOST, DEFAULT_PORT)]
    assert opened == []


def test_cli_network_mode_binds_all_addresses_and_opens_no_browser(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("REMI_PORT", raising=False)
    _fake_machine(monkeypatch, "APEXSERVER", "", [])
    served: list[tuple[str, int]] = []
    opened: list[str] = []

    def fake_run(self: uvicorn.Server, sockets: object = None) -> None:
        served.append((self.config.host, self.config.port))

    monkeypatch.setattr(uvicorn.Server, "run", fake_run)
    monkeypatch.setattr(main.webbrowser, "open", opened.append)

    main.cli(["--network", "--host", "0.0.0.0", "--data-dir", str(tmp_path)])  # noqa: S104

    assert served == [("0.0.0.0", DEFAULT_PORT)]  # noqa: S104
    assert opened == []
    out = capsys.readouterr().out
    assert "server mode" in out
    assert "http://apexserver:8765/" in out
    assert "no sign-in" in out


def test_browser_url_brackets_ipv6() -> None:
    assert main._browser_url("127.0.0.1", 8765) == "http://127.0.0.1:8765/"  # pyright: ignore[reportPrivateUsage]
    assert main._browser_url("::1", 8765) == "http://[::1]:8765/"  # pyright: ignore[reportPrivateUsage]
