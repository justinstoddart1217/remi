"""``remi db path|upgrade|backup``."""

import sqlite3
from pathlib import Path

import pytest

from app import main
from app.core.migrations import head_revision


@pytest.fixture(autouse=True)
def _no_remi_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("HOST", "PORT", "ENV", "TODAY", "DATA_DIR", "OPEN_BROWSER", "FRONTEND_DIST"):
        monkeypatch.delenv(f"REMI_{name}", raising=False)


def _run(argv: list[str]) -> int:
    with pytest.raises(SystemExit) as exit_info:
        main.cli(argv)
    code = exit_info.value.code
    return code if isinstance(code, int) else 1


def _revision(db: Path) -> str:
    with sqlite3.connect(db) as conn:
        (revision,) = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    return str(revision)


def test_db_path_prints_the_database_file(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(["--data-dir", str(tmp_path), "db", "path"]) == 0
    assert capsys.readouterr().out.strip() == str(tmp_path / "remi.db")
    # --data-dir also works after the subcommand, and nothing is created.
    assert _run(["db", "path", "--data-dir", str(tmp_path / "x")]) == 0
    assert capsys.readouterr().out.strip() == str(tmp_path / "x" / "remi.db")
    assert not (tmp_path / "x").exists()


def test_db_upgrade_creates_and_migrates(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    data = tmp_path / "data"
    assert _run(["db", "upgrade", "--data-dir", str(data)]) == 0
    assert "upgraded to" in capsys.readouterr().out
    assert _revision(data / "remi.db") == head_revision()
    assert _run(["db", "upgrade", "--data-dir", str(data)]) == 0
    assert "already at the latest schema" in capsys.readouterr().out


def test_db_backup_copies_the_database(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    data = tmp_path / "data"
    assert _run(["db", "backup", "--data-dir", str(data)]) == 1
    assert "nothing to back up" in capsys.readouterr().err

    assert _run(["db", "upgrade", "--data-dir", str(data)]) == 0
    capsys.readouterr()
    assert _run(["db", "backup", "--data-dir", str(data)]) == 0
    backup = Path(capsys.readouterr().out.strip())
    assert backup.parent == data / "backups"
    assert backup.name.startswith("remi-manual-")
    assert _revision(backup) == head_revision()


def test_db_needs_a_known_action(capsys: pytest.CaptureFixture[str]) -> None:
    assert _run(["db", "drop"]) == 2
    assert "invalid choice" in capsys.readouterr().err
