"""Builds the nature backgrounds download for the phone app's verse pictures.

    python mobile/data/build_backgrounds.py <out dir>

Reads mobile/data/backgrounds.json (the photos chosen from backgrounds_candidates.py's
contact sheets: theme, Commons title and page, licence, author -- all CC0 or public domain),
downloads each at 1400 px wide, crops the middle square, and writes
<out dir>/nature-backgrounds-v1.zip:

    backgrounds.json   [{id, theme, title, author, licence, source}]
    full/<id>.jpg      720 x 720
    thumb/<id>.jpg     180 x 180

It prints the zip's size and SHA-256: put both in mobile/src-tauri/src/backgrounds.rs (SIZE_MB,
SHA256), and upload the zip to the GitHub release `backgrounds-v1` (never marked latest).
"""
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

UA = {"User-Agent": "BibleConcordance-backgrounds/0.1 (https://bible4me.org)"}
HERE = Path(__file__).parent
FULL, THUMB = 720, 180


def fetch(url: str) -> bytes:
    for attempt in range(5):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
        except Exception:
            time.sleep(3 + attempt * 5)
    raise RuntimeError(url)


def square(im: Image.Image, size: int) -> Image.Image:
    return ImageOps.fit(im, (size, size), method=Image.LANCZOS, centering=(0.5, 0.5))


def jpeg(im: Image.Image, quality: int) -> bytes:
    out = BytesIO()
    im.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out.getvalue()


def clean(text: str) -> str:
    """Commons' author field is HTML; keep its words."""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()[:120]


def main() -> None:
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    chosen = json.loads((HERE / "backgrounds.json").read_text(encoding="utf-8"))
    listing = []
    zpath = out_dir / "nature-backgrounds-v1.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_STORED) as z:
        for i, c in enumerate(chosen, 1):
            name = c["title"].removeprefix("File:")
            url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(name) + "?width=1400"
            im = ImageOps.exif_transpose(Image.open(BytesIO(fetch(url)))).convert("RGB")
            pid = f"{i:03d}"
            z.writestr(f"full/{pid}.jpg", jpeg(square(im, FULL), 60))
            z.writestr(f"thumb/{pid}.jpg", jpeg(square(im, THUMB), 62))
            listing.append(
                {
                    "id": pid,
                    "theme": c["theme"],
                    "title": re.sub(r"\.(jpe?g|png)$", "", name, flags=re.I).replace("_", " ")[:120],
                    "author": clean(c.get("artist", "")),
                    "licence": c["licence"],
                    "source": c["page"],
                }
            )
            print(pid, c["theme"], name[:60], flush=True)
        z.writestr("backgrounds.json", json.dumps(listing, ensure_ascii=False, indent=1))
    data = zpath.read_bytes()
    print(f"{zpath}: {len(data) / 1048576:.1f} MB, {len(listing)} photos, sha256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
