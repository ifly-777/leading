#!/bin/bash
# Makes the README's pictures in docs/screenshots/ from the public-domain
# documents in docs/screenshots/sources/, using build/Leading.app.
#
# Each picture is drawn by the app itself (LEADING_SNAPSHOT; see Snapshot.swift),
# at Retina size, with its reading settings held in memory only. Your own
# preferences, open windows and a running Leading are left alone; the
# documents opened here are taken off File › Open Recent afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/build/Leading.app"
SRC="$ROOT/docs/screenshots/sources"
OUT="$ROOT/docs/screenshots"
[ -d "$APP" ] || { echo "build the app first: scripts/build-app.sh" >&2; exit 1; }

# The app's Open Recent list lives here; put it back as it was afterwards.
RECENTS="$HOME/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/io.github.ifly-777.leading.sfl3"
SAVED="$(mktemp)"
HAD_RECENTS=0
if [ -f "$RECENTS" ]; then cp "$RECENTS" "$SAVED"; HAD_RECENTS=1; fi
restore() {
  if [ "$HAD_RECENTS" = 1 ]; then cp "$SAVED" "$RECENTS"; else rm -f "$RECENTS"; fi
  rm -f "$SAVED"
}
trap restore EXIT

shot() { # name document settings-json size [edit]
  local name="$1" doc="$2" settings="$3" size="$4" edit="${5:-0}"
  echo "› $name"
  rm -f "$OUT/$name.png"
  # -n: a separate instance, so a Leading you have open is not disturbed.
  open -n -W --env LEADING_SNAPSHOT="$OUT/$name.png" --env LEADING_SNAPSHOT_SETTINGS="$settings" \
    --env LEADING_SNAPSHOT_SIZE="$size" --env LEADING_SNAPSHOT_EDIT="$edit" \
    -a "$APP" "$SRC/$doc" --args -ApplePersistenceIgnoreState YES
  [ -f "$OUT/$name.png" ] || { echo "✗ no picture for $name" >&2; exit 1; }
}

shot reading   "Where I Lived.md"    '{"theme":"light"}'                      1100x780
shot outline   "Walden.md"           '{"theme":"dark","outlineOpen":true}'    1100x780
shot notes     "Notes on Walden.md"  '{"theme":"sepia","font":"charter"}'     1100x780
shot editing   "Where I Lived.md"    '{"theme":"light"}'                      1100x780 1
echo "✓ $(ls "$OUT"/*.png | wc -l | tr -d ' ') pictures in docs/screenshots"
