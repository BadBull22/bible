"""Makes the bundled voices file: the English voices only (American + British, 28 of the
54 in voices-v1.0.bin), roughly halving its size. Usage: make_voices.py <in.bin> <out.bin>"""
import sys

import numpy as np

src, dst = sys.argv[1], sys.argv[2]
voices = np.load(src)
keep = {k: voices[k] for k in voices.files if k[:3] in ("af_", "am_", "bf_", "bm_")}
with open(dst, "wb") as f:  # a file object, so numpy doesn't append ".npz"
    np.savez(f, **keep)
print(f"{len(keep)} English voices -> {dst}")
