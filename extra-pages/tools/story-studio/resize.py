# Makes a JPEG small enough for the phone's additional-stories file (at most 600,000 bytes): shrinks the long side to 1500 pixels, then lowers the quality
# step by step if it is still too big. Usage: python -I resize.py <in.jpg> <out.jpg> [max_bytes]
import io, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 600000
side = int(sys.argv[4]) if len(sys.argv) > 4 else 1500
first_q = int(sys.argv[5]) if len(sys.argv) > 5 else 85
im = Image.open(src).convert("RGB")
while True:
    w, h = im.size
    k = min(1.0, side / max(w, h))
    pic = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS) if k < 1 else im
    for q in [x for x in (85, 80, 75, 70, 65) if x <= first_q]:
        buf = io.BytesIO(); pic.save(buf, "JPEG", quality=q, optimize=True)
        if buf.tell() <= limit:
            open(dst, "wb").write(buf.getvalue()); print(f"{pic.size[0]}x{pic.size[1]} q{q} {buf.tell()} bytes"); sys.exit(0)
    side = int(side * 0.85)
    if side < 500: sys.exit("could not make it small enough")
