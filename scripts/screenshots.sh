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
# Math, a diagram and coloured code; and a vault note with its highlights listed and another note embedded.
snapshot "$OUT/technical.png" "$SRC/Lift and Range.md" '{"theme":"sepia"}'                    1100x830
snapshot "$OUT/vault.png"   "$SRC/Reading Marcus.md"  '{"theme":"dark"}'                     1100x820 0 showHighlights
echo "✓ 6 pictures in docs/screenshots"
