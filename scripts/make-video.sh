#!/bin/bash
# Makes docs/video/leading.mp4, a 28-second film for social media, and its
# poster frame. Every picture of the app is drawn by build/Leading.app itself
# (see lib/snapshot.sh); the film around them is docs/video/film.html, a page
# that draws any moment on request, captured frame by frame in WebKit and
# encoded with ffmpeg. The text is public domain: Marcus Aurelius, in George
# Long's 1862 translation, from docs/video/sources/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/lib/snapshot.sh"
SRC="$ROOT/docs/video/sources"
WORK="$ROOT/build/video"
STILLS="$WORK/stills"
SIZE=1180x740
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed: brew install ffmpeg" >&2; exit 1; }
rm -rf "$WORK" && mkdir -p "$STILLS"

# "@@" marks the sentence the film highlights, as a real highlight.
mkdir -p "$WORK/doc"
sed 's/@@/==/g' "$SRC/Book IV.md" > "$WORK/doc/Book IV.md"
BOOK="$WORK/doc/Book IV.md"

echo "› Pictures of the app"
# The "before" picture is the same document with yellow set to the paper's own
# colour: the highlight is invisible and every line breaks exactly as in the
# "after" picture, so the film can sweep it on without the text moving.
snapshot "$STILLS/plain.png" "$BOOK" '{"theme":"light","highlightColors":{"light":{"yellow":"#FBF8F2"},"dark":{}}}' $SIZE
for font in literata newyork charter atkinson quattro; do
  snapshot "$STILLS/font-$font.png" "$BOOK" "{\"theme\":\"light\",\"font\":\"$font\"}" $SIZE
done
snapshot "$STILLS/sepia.png"   "$BOOK" '{"theme":"sepia"}' $SIZE
snapshot "$STILLS/dark.png"    "$BOOK" '{"theme":"dark"}' $SIZE
snapshot "$STILLS/edit.png"    "$BOOK" '{"theme":"dark"}' $SIZE 1
snapshot "$STILLS/outline.png" "$SRC/Meditations.md" '{"theme":"dark","outlineOpen":true}' $SIZE
python3 "$ROOT/scripts/lib/highlight_lines.py" "$STILLS/plain.png" "$STILLS/font-literata.png" > "$STILLS/highlight.json"

SECONDS_LONG=28
FPS=30
PORT=8766
python3 -m http.server $PORT --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; restore_recents' EXIT
sleep 1

film() { # name WxH
  echo "› $1 ($2)"
  rm -rf "$WORK/frames-$1" && mkdir -p "$WORK/frames-$1"
  node "$ROOT/web/scripts/film-frames.mjs" "http://127.0.0.1:$PORT/docs/video/film.html" "$WORK/frames-$1" $SECONDS_LONG $FPS "$2"
  # H.264 in MP4: what X and every browser play. yuv420p for compatibility;
  # faststart so it begins playing before it has fully loaded.
  ffmpeg -loglevel error -y -framerate $FPS -i "$WORK/frames-$1/%04d.png" \
    -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart "$ROOT/docs/video/$1.mp4"
  echo "✓ docs/video/$1.mp4 ($(du -h "$ROOT/docs/video/$1.mp4" | cut -f1))"
}
film leading 1920x1080          # for the README and anywhere wide
film leading-square 1080x1080   # for X: a square fills a phone's width
# The poster for the README: the moment the highlight is made, which says what
# Leading is, with a quiet play mark so it reads as a film.
python3 - "$WORK/frames-leading/0225.png" "$ROOT/docs/video/poster.jpg" <<'PY'
import sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert("RGBA")
mark = Image.new("RGBA", im.size, (0, 0, 0, 0))
d = ImageDraw.Draw(mark)
cx, cy, r = im.width // 2, (im.height - 200) // 2 + 12, 70   # the middle of the picture, above the caption band
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(43, 40, 36, 150))
d.polygon([(cx - 22, cy - 34), (cx - 22, cy + 34), (cx + 38, cy)], fill=(251, 248, 242, 235))
Image.alpha_composite(im, mark).convert("RGB").save(sys.argv[2], quality=88)
PY
echo "✓ docs/video/poster.jpg"
