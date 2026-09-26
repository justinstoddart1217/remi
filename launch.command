#!/bin/bash
# Remi launcher for macOS: double-click this file in Finder (or run ./launch.command).
#
# - If Remi is already running, it just opens it in your browser.
# - Otherwise it builds the dashboard when needed (first run, or after the code changed),
#   starts Remi on http://127.0.0.1:8765 and opens it in your browser.
# - Close this Terminal window (or press Ctrl+C) to stop Remi. Your data stays in
#   ~/Library/Application Support/Remi and nothing ever leaves this Mac.
#
# Extra arguments are passed to Remi, e.g. ./launch.command --no-browser
# REMI_PORT=9000 ./launch.command runs it on another port.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${REMI_PORT:-8765}"
URL="http://127.0.0.1:${PORT}/"

# Finder-launched Terminals may not have Homebrew or uv on PATH yet.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

say() { printf '\n  %s\n' "$*"; }
fail() {
  say "$*"
  read -r -p "  Press Return to close this window. " _ || true
  exit 1
}

# Already running? Just open it.
if curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"app":"remi"'; then
  say "Remi is already running. Opening ${URL}"
  open "$URL"
  exit 0
fi

command -v uv >/dev/null 2>&1 || fail "uv is not installed. Install it with: brew install uv"
command -v npm >/dev/null 2>&1 || fail "Node.js is not installed. Install it with: brew install node"

# Build the dashboard if it is missing or older than its sources.
DIST="$ROOT/frontend/dist/index.html"
if [ ! -f "$DIST" ] || [ -n "$(find "$ROOT/frontend/src" "$ROOT/frontend/index.html" \
    "$ROOT/frontend/package.json" -newer "$DIST" -print -quit 2>/dev/null)" ]; then
  say "Building the dashboard (first run, or the code changed). This takes a minute."
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm ci --no-audit --no-fund || fail "Installing frontend packages failed."
  npm run build || fail "Building the dashboard failed. See the messages above."
fi

say "Starting Remi on ${URL}"
say "Keep this window open while you use Remi. Close it (or press Ctrl+C) to stop."
cd "$ROOT/backend"
# `python -m remi.main` rather than the `remi` shim: on the iCloud Desktop, macOS hides the
# virtualenv's .pth files, which breaks the shim (see README).
exec uv run python -m remi.main --port "$PORT" "$@"
