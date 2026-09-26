from datetime import date
from pathlib import Path

import pytest
import uvicorn
from pydantic import ValidationError

from app import main
from app.core.clock import FixedClock, OffsetClock, SystemClock, build_clock
from app.core.config import DEFAULT_PORT, LOOPBACK_HOST, RemiConfig, is_loopback_host
from app.core.paths import default_data_dir


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


def test_browser_url_brackets_ipv6() -> None:
    assert main._browser_url("127.0.0.1", 8765) == "http://127.0.0.1:8765/"  # pyright: ignore[reportPrivateUsage]
    assert main._browser_url("::1", 8765) == "http://[::1]:8765/"  # pyright: ignore[reportPrivateUsage]
