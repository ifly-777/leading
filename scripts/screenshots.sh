#!/bin/bash
# Makes the README's pictures in docs/screenshots/ from the public-domain
# documents in docs/screenshots/sources/, using build/Leading.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/lib/snapshot.sh"
SRC="$ROOT/docs/screenshots/sources"
OUT="$ROOT/docs/screenshots"

snapshot "$OUT/reading.png" "$SRC/Where I Lived.md"   '{"theme":"light"}'                    1100x780
snapshot "$OUT/outline.png" "$SRC/Walden.md"          '{"theme":"dark","outlineOpen":true}'  1100x780
snapshot "$OUT/notes.png"   "$SRC/Notes on Walden.md" '{"theme":"sepia","font":"charter"}'   1100x780
snapshot "$OUT/editing.png" "$SRC/Where I Lived.md"   '{"theme":"light"}'                    1100x780 1
echo "✓ 4 pictures in docs/screenshots"
