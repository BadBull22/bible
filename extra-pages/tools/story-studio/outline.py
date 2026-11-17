# Makes an outline to colour in (black lines on white, 1-bit PNG) from a pen-and-wash picture (the Sweet Publishing illustrations).
# Usage: python -I outline.py <picture.jpg> <outline.png>
# Uses OpenCV when it is installed (the same method as extra-pages/tools/make_outline.py); otherwise a Pillow-only version of the same idea:
# a pixel is a pen line when it is clearly darker than its neighbourhood; the picture frame is whitened and small specks are removed.
import sys
from PIL import Image, ImageChops, ImageFilter

def outline_pillow(src, dst):
    img = Image.open(src).convert("L")
    local = img.filter(ImageFilter.GaussianBlur(3.5))
    diff = ImageChops.subtract(local, img)               # how much darker than around it (0 when lighter)
    mask = diff.point(lambda v: 255 if v > 12 else 0)      # lines = 255
    w, h = mask.size
    m = 18
    for box in ((0, 0, w, m), (0, h - m, w, h), (0, 0, m, h), (w - m, 0, w, h)):
        mask.paste(0, box)
    mask = mask.filter(ImageFilter.MedianFilter(3))        # takes away single specks
    out = ImageChops.invert(mask).convert("1")             # black lines on white
    out.save(dst, optimize=True)

try:
    import cv2, numpy  # noqa: F401
    import runpy, os
    sys.argv = ["make_outline.py", sys.argv[1], sys.argv[2]]
    runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "make_outline.py"), run_name="__main__")
except ImportError:
    outline_pillow(sys.argv[1], sys.argv[2])
print("outline made")
