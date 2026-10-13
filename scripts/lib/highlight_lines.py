# Finds where a highlight sits in a picture of the app: compares the page
# without it to the page with it, and returns one box per line of text the
# highlight covers, in image pixels. The film sweeps the highlight on over
# these boxes, line by line, left to right, as a marker would.
#
#   python3 highlight_lines.py plain.png marked.png > highlight.json
import json
import sys

import numpy as np
from PIL import Image

plain = np.asarray(Image.open(sys.argv[1]).convert("RGB"), dtype=np.int16)
marked = np.asarray(Image.open(sys.argv[2]).convert("RGB"), dtype=np.int16)
# A highlight changes the paper colour behind the text clearly; small
# anti-aliasing differences do not count.
changed = np.abs(plain - marked).sum(axis=2) > 24

rows = np.where(changed.any(axis=1))[0]
lines = []
# Rows belong to one line of highlight while they are consecutive and span the
# same columns; lines of a highlight can touch, but each starts and ends at its
# own place, so a change in the span starts a new line.
def span(r):
    cols = np.where(changed[r])[0]
    return int(cols[0]), int(cols[-1])
box = None
for r in rows:
    left, right = span(r)
    if box and r - box["last"] <= 3 and abs(left - box["x0"]) <= 8 and abs(right - box["x1"]) <= 8:
        box["last"] = int(r)
        box["x0"], box["x1"] = min(box["x0"], left), max(box["x1"], right)
        continue
    if box: lines.append(box)
    box = {"first": int(r), "last": int(r), "x0": left, "x1": right}
lines.append(box)
# Ignore slivers (the rounded ends of a line can start a row or two early).
out = [{"x": b["x0"], "y": b["first"], "w": b["x1"] - b["x0"] + 1, "h": b["last"] - b["first"] + 1} for b in lines if b["last"] - b["first"] >= 8]
json.dump(out, sys.stdout)
