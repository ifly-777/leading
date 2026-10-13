#!/bin/bash
# Packs build/Leading.app into build/Leading-<version>.dmg: the app and an
# Applications shortcut side by side over a background that says "drag one
# onto the other", and below them the "If macOS blocks Leading" guide.
#
# The window layout is written by dmgbuild, which makes Finder's layout file
# directly (no scripting Finder, so it also works on CI). It is installed into
# build/.dmg-venv from PyPI at pinned versions with pinned hashes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/mac/Config/app.env"
VERSION="${VERSION_OVERRIDE:-$VERSION}"
APP="$ROOT/build/$APP_NAME.app"
DMG="$ROOT/build/$APP_NAME-$VERSION.dmg"
WORK="$ROOT/build/dmg"
VENV="$ROOT/build/.dmg-venv"
# Use the full Xcode for the renderer, as build-app.sh does.
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app ]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi

if [ ! -x "$VENV/bin/dmgbuild" ]; then
  echo "› dmgbuild (pinned, hash-checked)"
  # dmgbuild 1.6.7 needs Python 3.10 or later (macOS's own python3 is 3.9).
  python3 -m venv "$VENV"
  cat > "$WORK.req" <<'REQ'
dmgbuild==1.6.7 --hash=sha256:37ee5771c377beb3203d9164aae8046ffed8531c06edf9227f5788b3c599b1bf
ds-store==1.3.2 --hash=sha256:3b37332d9f8c18ff04c385d2933b66a1d84950071364f94bfc5f5a3ab1fb361e
mac-alias==2.2.2 --hash=sha256:504ab8ac546f35bbd75ad014d6ad977c426660aa721f2cd3acf3dc2f664141bd
REQ
  "$VENV/bin/pip" install --quiet --disable-pip-version-check --require-hashes --only-binary :all: -r "$WORK.req"
  rm -f "$WORK.req"
fi

echo "› Guide and background"
rm -rf "$WORK" && mkdir -p "$WORK"
# The guide carries the version; the page's own copy has a placeholder.
sed "s/@VERSION@/$VERSION/" "$ROOT/mac/Resources/dmg/guide.html" > "$ROOT/mac/Resources/dmg/.guide-$VERSION.html"
GUIDE="$WORK/If macOS blocks $APP_NAME.pdf"
swift "$ROOT/scripts/render.swift" "$ROOT/mac/Resources/dmg/.guide-$VERSION.html" "$GUIDE" 595 842
rm -f "$ROOT/mac/Resources/dmg/.guide-$VERSION.html"
swift "$ROOT/scripts/render.swift" "$ROOT/mac/Resources/dmg/background.html" "$WORK/bg.png" 600 470 1
swift "$ROOT/scripts/render.swift" "$ROOT/mac/Resources/dmg/background.html" "$WORK/bg@2x.png" 600 470 2
# One TIFF holding both sizes, so Finder picks the sharp one on Retina screens.
tiffutil -cathidpicheck "$WORK/bg.png" "$WORK/bg@2x.png" -out "$WORK/background.tiff" >/dev/null 2>&1

echo "› Disk image"
rm -f "$DMG"
"$VENV/bin/dmgbuild" -s "$ROOT/scripts/dmg-settings.py" \
  -D app="$APP" -D guide="$GUIDE" -D background="$WORK/background.tiff" \
  "$APP_NAME" "$DMG" 2> >(grep -v "is deprecated" >&2) >/dev/null
echo "✓ $DMG ($(du -h "$DMG" | cut -f1))"
