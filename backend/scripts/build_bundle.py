"""Build the Windows server bundle for the APEX server: ``remi-<version>-windows.zip``.

Usage, from ``backend/``: ``uv run python -m scripts.build_bundle [--out DIR] [--no-build]
[--python-dir DIR]`` (``make bundle``; the release workflow runs it on a Windows runner).

The bundle is self-contained, so the server needs nothing installed (docs/deploy/APEX.md):

    remi-<version>-windows/
      install-remi.bat      run as administrator on the server (first install)
      VERSION               version and git commit
      python/               CPython 3.12 for Windows x64 (python-build-standalone, via uv)
      site-packages/        the backend's locked runtime dependencies, Windows wheels
      backend/              app/, alembic/, alembic.ini, pyproject.toml
      frontend/dist/        the built SPA (stay-local checked)
      server/               remi-server.ps1 and its .bat shortcuts

``backend/`` and ``frontend/dist/`` keep their places relative to each other, so
``remi.core.paths`` finds the SPA and the migrations exactly as in a checkout. Everything is
precompiled (unchecked-hash .pyc, since the bundle never changes), because the Windows
account that runs Remi cannot write ``__pycache__`` beside the code.
"""

import argparse
import compileall
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from py_compile import PycInvalidationMode

from remi import __version__
from remi.core.paths import backend_root, repo_root

PYTHON_REQUEST = "cpython-3.12-windows-x86_64-none"
WINDOWS_PLATFORM = "x86_64-pc-windows-msvc"
PYTHON_VERSION = "3.12"

# Parts of the Python distribution a web server never uses (Tk, IDLE, headers, pip ...).
PYTHON_STRIP = (
    "tcl",
    "include",
    "libs",
    "Scripts",
    "Lib/idlelib",
    "Lib/tkinter",
    "Lib/turtledemo",
    "Lib/ensurepip",
    "Lib/site-packages",
    "DLLs/_tkinter.pyd",
    "DLLs/tcl86t.dll",
    "DLLs/tk86t.dll",
)
BACKEND_FILES = ("alembic.ini", "pyproject.toml")
BACKEND_DIRS = ("app", "alembic")
SKIP_NAMES = frozenset({"__pycache__", ".DS_Store"})
# Windows files: CRLF line endings and plain ASCII (Windows PowerShell 5.1 reads a .ps1
# without a byte-order mark in the ANSI code page, so anything else can garble the script).
WINDOWS_TEXT = frozenset({".bat", ".cmd", ".ps1"})
# Deep paths break on Windows past 260 characters; the install folder adds about 40.
MAX_RELATIVE_PATH = 200


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=repo_root(),
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return out.stdout.strip()


def copy_tree(src: Path, dst: Path) -> None:
    """Copy ``src`` to ``dst`` without caches or symlinks (a Windows zip has no symlinks)."""

    def ignore(directory: str, names: list[str]) -> set[str]:
        return {
            name
            for name in names
            if name in SKIP_NAMES or (Path(directory) / name).is_symlink()
        }

    shutil.copytree(src, dst, ignore=ignore)


def windows_python(python_dir: Path | None, work: Path) -> Path:
    """The Windows CPython to ship: ``--python-dir``, else downloaded by ``uv python install``."""
    if python_dir is None:
        install_dir = work / "uv-python"
        run(
            [
                "uv",
                "python",
                "install",
                PYTHON_REQUEST,
                "--no-bin",
                "--install-dir",
                str(install_dir),
            ]
        )
        found = sorted(p for p in install_dir.iterdir() if (p / "python.exe").is_file())
        if not found:
            sys.exit(f"uv did not install a Windows python.exe under {install_dir}")
        python_dir = found[-1]
    if not (python_dir / "python.exe").is_file():
        sys.exit(
            f"{python_dir} has no python.exe: --python-dir must be a Windows CPython folder"
        )
    return python_dir


def add_python(python_dir: Path, dest: Path) -> None:
    copy_tree(python_dir, dest)
    for part in PYTHON_STRIP:
        target = dest / part
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
    (dest / "Lib" / "site-packages").mkdir()


def add_site_packages(dest: Path, work: Path) -> None:
    """The backend's locked runtime dependencies, resolved and installed for Windows x64."""
    requirements = work / "requirements.txt"
    run(
        [
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--no-hashes",
            "--quiet",
            "--output-file",
            str(requirements),
        ],
        cwd=backend_root(),
    )
    run(
        [
            "uv",
            "pip",
            "install",
            "--target",
            str(dest),
            "--python-platform",
            WINDOWS_PLATFORM,
            "--python-version",
            PYTHON_VERSION,
            "--only-binary",
            ":all:",
            "--requirement",
            str(requirements),
        ]
    )
    # Console-script launchers and C headers are neither relocatable nor needed.
    for name in ("bin", "Scripts", "include"):
        if (dest / name).is_dir():
            shutil.rmtree(dest / name)


def add_backend(dest: Path) -> None:
    dest.mkdir()
    for name in BACKEND_DIRS:
        copy_tree(backend_root() / name, dest / name)
    for name in BACKEND_FILES:
        shutil.copy2(backend_root() / name, dest / name)


def add_frontend(dest: Path, build: bool) -> None:
    frontend = repo_root() / "frontend"
    npm = shutil.which("npm") or "npm"
    if build:
        run([npm, "run", "build"], cwd=frontend)
    dist = frontend / "dist"
    if not (dist / "index.html").is_file():
        sys.exit(
            f"{dist} has no index.html: build the frontend first (or drop --no-build)"
        )
    node = shutil.which("node") or "node"
    run([node, "scripts/check-dist-urls.mjs", "dist"], cwd=frontend)
    copy_tree(dist, dest)


def add_windows_text(src: Path, dst: Path) -> None:
    """Copy a Windows script with CRLF line endings, refusing anything but ASCII."""
    text = src.read_text(encoding="utf-8")
    if not text.isascii():
        bad = next(i for i, ch in enumerate(text) if not ch.isascii())
        line = text.count("\n", 0, bad) + 1
        sys.exit(f"{src}:{line}: Windows scripts must be plain ASCII")
    lines = text.replace("\r\n", "\n").split("\n")
    dst.write_bytes("\r\n".join(lines).encode("ascii"))


def add_server_files(stage: Path) -> None:
    deploy = repo_root() / "deploy"
    server = stage / "server"
    server.mkdir()
    for src in sorted((deploy / "windows").iterdir()):
        if src.name in SKIP_NAMES:
            continue
        target = stage if src.name == "install-remi.bat" else server
        if src.suffix in WINDOWS_TEXT:
            add_windows_text(src, target / src.name)
        else:
            shutil.copy2(src, target / src.name)


def compile_python(stage: Path) -> None:
    """Precompile the backend and its dependencies for CPython 3.12 (this interpreter must be
    3.12 too: .pyc files are specific to the minor version)."""
    if sys.version_info[:2] != (3, 12):
        sys.exit("build_bundle must run on Python 3.12 (uv run from backend/ does)")
    for folder in ("backend", "site-packages"):
        ok = compileall.compile_dir(
            stage / folder,
            quiet=1,
            workers=0,
            invalidation_mode=PycInvalidationMode.UNCHECKED_HASH,
            stripdir=str(stage),
            prependdir="",
        )
        if not ok:
            sys.exit(f"could not precompile {folder}/")


def check_paths(stage: Path) -> None:
    paths = (str(p.relative_to(stage.parent)) for p in stage.rglob("*"))
    longest = max(paths, key=len)
    if len(longest) > MAX_RELATIVE_PATH:
        sys.exit(
            f"path too long for Windows once installed ({len(longest)}): {longest}"
        )


def write_zip(stage: Path, out: Path) -> Path:
    archive = out / f"{stage.name}.zip"
    with zipfile.ZipFile(
        archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as zf:
        for path in sorted(stage.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(stage.parent).as_posix())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (out / f"{archive.name}.sha256").write_text(
        f"{digest}  {archive.name}\n", encoding="ascii"
    )
    return archive


def build(out: Path, python_dir: Path | None, build_frontend: bool) -> Path:
    name = f"remi-{__version__}-windows"
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="remi-bundle-") as tmp:
        work = Path(tmp)
        stage = work / name
        stage.mkdir()
        add_frontend(stage / "frontend" / "dist", build_frontend)
        add_python(windows_python(python_dir, work), stage / "python")
        add_site_packages(stage / "site-packages", work)
        add_backend(stage / "backend")
        add_server_files(stage)
        (stage / "VERSION").write_text(
            f"{__version__}\n{git_commit()}\n", encoding="ascii"
        )
        compile_python(stage)
        check_paths(stage)
        for old in out.glob("remi-*-windows.zip*"):
            old.unlink()
        archive = write_zip(stage, out)
    size = archive.stat().st_size / 1024 / 1024
    print(f"Built {archive} ({size:.0f} MB)")
    return archive


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="build_bundle", description="Build the server bundle."
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=repo_root() / "build" / "release",
        help="output folder",
    )
    parser.add_argument(
        "--python-dir",
        type=Path,
        default=None,
        help="a Windows CPython 3.12 folder to ship",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="use the existing frontend/dist as it is",
    )
    args = parser.parse_args(argv[1:])
    os.environ.setdefault("UV_PYTHON_DOWNLOADS", "automatic")
    build(Path(args.out).resolve(), args.python_dir, build_frontend=not args.no_build)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
