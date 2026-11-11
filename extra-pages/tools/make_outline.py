# Makes an outline to colour in (black lines on white, 1-bit PNG) from a colour picture in the pen-and-wash style (e.g. the Sweet Publishing illustrations).
# Usage: python -I make_outline.py <picture.jpg> <outline.png>      Needs: opencv-python, numpy, pillow.
# Method: adaptive threshold on the pen lines, the picture frame (18 px) whitened, specks under 25 px removed. Always LOOK at the result.
import cv2, numpy as np, sys
from PIL import Image
def outline(src, dst):
    img = cv2.imread(src)
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    b = cv2.GaussianBlur(g, (3, 3), 0)
    out = cv2.adaptiveThreshold(b, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 12)
    # white out the picture's frame
    m = 18
    out[:m, :] = 255; out[-m:, :] = 255; out[:, :m] = 255; out[:, -m:] = 255
    inv = 255 - out
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inv, 8)
    keep = np.zeros_like(inv)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 25:
            keep[lab == i] = 255
    out = 255 - keep
    Image.fromarray(out).convert("1").save(dst, optimize=True)
src, dst = sys.argv[1], sys.argv[2]
outline(src, dst)
print(dst)
