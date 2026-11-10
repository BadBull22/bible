"""Builds the two optional picture packs of the phone app (since 3.0.0) from the desktop app's Browse pictures.

    python mobile/data/build_picture_packs.py

Reads  src/browse/pictures/stories (31 paintings and engravings, with credits.json) and src/browse/pictures/kids
(the children's pictures, original artwork), and writes into installer/packs:

  story-pictures-v1.zip   the story pictures, shown at a smaller file size (the long side at most 1500 pixels, JPEG), otherwise unchanged,
                          with credits.json (who made each, where it is from, the licence)
  kids-pictures-v1.zip    the children's pictures (SVG, in colour and as an outline to colour in)

and prints each file's size and SHA-256, which go into mobile/src-tauri/src/picture_packs.rs. The zips are made the same way every time
(fixed file order and times), so the same pictures give the same checksum. They are uploaded to the app's GitHub releases
(story-pictures-v1, kids-pictures-v1) only when the owner says so.
"""
import hashlib
import io
import json
import os
import sys
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(os.path.abspath(__file__)).parents[2]
STORIES = ROOT / "src" / "browse" / "pictures" / "stories"
KIDS = ROOT / "src" / "browse" / "pictures" / "kids"
OUT = ROOT / "installer" / "packs"
LONG_SIDE = 1500
QUALITY = 82
STAMP = (2026, 11, 10, 0, 0, 0)


def add(z: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, STAMP)
    info.compress_type = zipfile.ZIP_STORED if name.endswith((".jpg", ".jpeg")) else zipfile.ZIP_DEFLATED
    z.writestr(info, data)


def shrink(path: Path) -> bytes:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    k = LONG_SIDE / max(w, h)
    if k < 1:
        im = im.resize((round(w * k), round(h * k)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return buf.getvalue()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    credits = json.loads((STORIES / "credits.json").read_text(encoding="utf-8"))
    stories = OUT / "story-pictures-v1.zip"
    kept = {}
    with zipfile.ZipFile(stories, "w") as z:
        for f in sorted(STORIES.glob("*.jpg")):
            if f.stem not in credits:
                print("no credit for", f.name, "- left out")
                continue
            add(z, f.name, shrink(f))
            kept[f.stem] = credits[f.stem]
        add(z, "credits.json", json.dumps(kept, ensure_ascii=False, indent=1).encode("utf-8"))
    kids = OUT / "kids-pictures-v1.zip"
    with zipfile.ZipFile(kids, "w") as z:
        for f in sorted(KIDS.glob("*.svg")):
            add(z, f.name, f.read_bytes())
        add(z, "ready.txt", b"children's pictures\n")
    for p, n in ((stories, len(kept)), (kids, len(list(KIDS.glob("*.svg"))))):
        print(f"{p.name}: {n} pictures, {p.stat().st_size / 1048576:.2f} MB, sha256 {sha(p)}")


if __name__ == "__main__":
    sys.exit(main())
