#!/usr/bin/env sh
# Regenerate src/assets/fonts/material-symbols-remi.woff2 (committed) and
# src/components/Icon/icons.generated.ts.
#
# Build-time only: this downloads the pinned Material Symbols Outlined variable font from the
# npm registry (package `material-symbols`), checks its sha256, then subsets and instances it
# with fonttools (see subset_icons.py). The running app never fetches fonts.
#
# To add an icon: add its name to subset_icons.py, then run `npm run subset-icons`.
set -eu

MS_VERSION="0.47.5"
MS_SHA256="c5c96fcb27145d17a04cb2fa68d33921ca4258c6bb2cf6fac8b1bce401595e57"

HERE=$(cd "$(dirname "$0")" && pwd)
FRONTEND=$(dirname "$HERE")
OUT_FONT="$FRONTEND/src/assets/fonts/material-symbols-remi.woff2"
OUT_TS="$FRONTEND/src/components/Icon/icons.generated.ts"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/remi-icons.XXXXXX")
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "fetching material-symbols@$MS_VERSION"
(cd "$WORK" && npm pack --silent "material-symbols@$MS_VERSION" >/dev/null && tar xzf "material-symbols-$MS_VERSION.tgz")
SRC="$WORK/package/material-symbols-outlined.woff2"
echo "$MS_SHA256  $SRC" | shasum -a 256 -c - >/dev/null

uv run --no-project --python 3.12 --with fonttools --with brotli --with uharfbuzz \
  python "$HERE/subset_icons.py" "$SRC" "$OUT_FONT" "$OUT_TS"
