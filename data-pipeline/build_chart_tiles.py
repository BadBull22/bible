"""Slices Adams' Synchronological Chart into a Leaflet tile pyramid for the Timeline panel.

The source scan is a single ~218MB, 50195x5347 JPEG. Shipping that file as-is would put
all 218MB into `dist/` (vite.config.ts robocopies public/ wholesale) and from there into
the installer, for an image no browser can decode smoothly anyway. Tiled at half its
native width it costs ~17MB and pans/zooms instantly, because Leaflet only ever fetches
the handful of 256px tiles actually on screen.

Output is an XYZ pyramid under public/chart/{z}/{x}/{y}.jpg plus a chart.json manifest,
consumed by TimelinePanel's facsimile layer through L.CRS.Simple.

Usage:
    python data-pipeline/build_chart_tiles.py [--no-copy] [--native]

    --no-copy   leave the result in the local build dir, don't copy into public/
    --native    tile at full 50195px width (~67MB) instead of half (~17MB)

Like the other pipeline scripts this builds on local disk first (gotcha #1: this project
lives on an SMB share, and writing ~10,000 small files straight to it is painfully slow),
then copies the finished pyramid across in one robocopy pass.
"""

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

# A 268-megapixel source is far past Pillow's decompression-bomb guard, which exists to
# stop hostile images exhausting memory. This one is a known local file we chose to open.
Image.MAX_IMAGE_PIXELS = None

PROJECT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT / "public" / "Adams_Synchronological_Chart,_1881.jpg"
PUBLIC_OUT = PROJECT / "public" / "chart"
LOCAL_BUILD_DIR = Path(os.environ.get("BIBLE_BUILD_DIR", Path.home() / "AppData" / "Local" / "bible-concordance-build"))
BUILD_OUT = LOCAL_BUILD_DIR / "chart-tiles"

TILE = 256
QUALITY = 75  # measured: ~0.19 bytes/px on this scan, and visually indistinguishable at q85

ATTRIBUTION = {
    "title": "Adams' Synchronological Chart or Map of History",
    "author": "Sebastian C. Adams",
    "edition": "Third edition, revised to 1876; first published 1871",
    "licence": "Public domain (published 1871; author died 1898)",
    "source": "Wikimedia Commons",
    # Adams' own caveat, printed at the top-left of the chart itself. Worth carrying into
    # the app so the Ussher dating is presented the way its own author presented it.
    "chronology_note": (
        "Dated on Archbishop Ussher's chronology, beginning at 4004 BC. Adams printed his own "
        "caveat on the chart: \"Moses assigns no date to this Creation... The author is fully "
        "aware of the difficulties and uncertainties of any system of Chronology extant.\""
    ),
}


def build_pyramid(img: Image.Image, out_dir: Path) -> dict:
    """Writes levels 0..Z, where Z is the level at which `img` is shown 1:1. Level z-1 is
    always exactly half of level z, so Leaflet's doubling zoom lines up with the tiles."""
    width, height = img.size
    max_zoom = max(0, math.ceil(math.log2(max(width, height) / TILE)))
    print(f"  pyramid: {width}x{height}, levels 0..{max_zoom}")

    total_tiles = 0
    total_bytes = 0
    level = img
    for z in range(max_zoom, -1, -1):
        lw, lh = level.size
        cols = math.ceil(lw / TILE)
        rows = math.ceil(lh / TILE)
        for x in range(cols):
            col_dir = out_dir / str(z) / str(x)
            col_dir.mkdir(parents=True, exist_ok=True)
            for y in range(rows):
                box = (x * TILE, y * TILE, min((x + 1) * TILE, lw), min((y + 1) * TILE, lh))
                tile = level.crop(box)
                if tile.size != (TILE, TILE):
                    # Edge tiles are padded rather than left short: Leaflet positions tiles
                    # on a fixed grid, so a smaller image would be stretched to fill the cell.
                    padded = Image.new("RGB", (TILE, TILE), (238, 232, 216))
                    padded.paste(tile, (0, 0))
                    tile = padded
                path = col_dir / f"{y}.jpg"
                tile.save(path, "JPEG", quality=QUALITY, optimize=True)
                total_tiles += 1
                total_bytes += path.stat().st_size
        print(f"    z={z}: {cols}x{rows} = {cols*rows} tiles ({lw}x{lh})")
        if z:
            level = level.resize((max(1, lw // 2), max(1, lh // 2)), Image.LANCZOS)

    manifest = {
        "width": width,
        "height": height,
        "tileSize": TILE,
        "maxZoom": max_zoom,
        "tileUrl": "/chart/{z}/{x}/{y}.jpg",
        "attribution": ATTRIBUTION,
    }
    (out_dir / "chart.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"  {total_tiles} tiles, {total_bytes/1e6:.1f} MB")
    return manifest


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(
            f"Source scan not found: {SOURCE}\n"
            "It is gitignored (218MB, no LFS configured) -- download the 1881 chart scan from "
            "Wikimedia Commons and place it there, then re-run."
        )

    native = "--native" in sys.argv
    if BUILD_OUT.exists():
        shutil.rmtree(BUILD_OUT)
    BUILD_OUT.mkdir(parents=True, exist_ok=True)

    print(f"Opening {SOURCE.name} ({SOURCE.stat().st_size/1e6:.0f} MB)...")
    img = Image.open(SOURCE)
    if not native:
        # draft() does the downscale inside the JPEG decoder (DCT domain), which is both
        # far faster and far cheaper in memory than decoding 268MP and resizing after.
        img.draft("RGB", (img.width // 2, img.height // 2))
    img = img.convert("RGB")
    print(f"  working size: {img.size[0]}x{img.size[1]}")

    build_pyramid(img, BUILD_OUT)

    if "--no-copy" in sys.argv:
        print(f"Left in {BUILD_OUT} (--no-copy).")
        return
    print(f"Copying to {PUBLIC_OUT}...")
    PUBLIC_OUT.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["robocopy", str(BUILD_OUT), str(PUBLIC_OUT), "/E", "/PURGE", "/NFL", "/NDL", "/NJH", "/NJS"],
        check=False,
    )
    # robocopy returns a bitmask: 0-7 are all forms of success, 8+ is a real failure.
    if result.returncode >= 8:
        raise SystemExit(f"robocopy failed with code {result.returncode}")
    print("Done.")


if __name__ == "__main__":
    main()
