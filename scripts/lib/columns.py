# Measures where the text column sits in each picture of the app, so the film
# can frame every typeface with a margin (iA Writer Quattro sets a wider column
# than the others at the same size).
#
#   python3 columns.py stills/*.png > columns.json   →  {"font-quattro": {"x0": …, "x1": …}, …}
import json
import os
import sys

import numpy as np
from PIL import Image

out = {}
for path in sys.argv[1:]:
    grey = np.asarray(Image.open(path).convert("L"), dtype=np.int16)
    # The page below the title bar and inside the window's edges.
    page = grey[300:1500, 120:2400]
    ink = np.abs(page - np.median(page)) > 60   # clearly not paper
    cols = np.where(ink.any(axis=0))[0]
    out[os.path.splitext(os.path.basename(path))[0]] = {"x0": int(cols[0]) + 120, "x1": int(cols[-1]) + 120}
json.dump(out, sys.stdout)
