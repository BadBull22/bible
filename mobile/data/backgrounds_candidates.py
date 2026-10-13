"""Finds candidate nature photos for the verse-picture backgrounds (phone app 0.3.0).

    python mobile/data/backgrounds_candidates.py <work dir> [theme ...]

Searches Wikimedia Commons, per theme, for photos released under CC0 (on Commons'
structured data) -- so a verse picture made over one needs no credit and no licence of its
own -- among its reviewed "Quality images" (real photos, sharp and well exposed), at least
1600x1000 pixels. (Public-domain "Quality images" are left out: most are photographs of old
paintings.) Writes, per theme, <work dir>/<theme>.json and a numbered contact sheet
contact-<theme>.jpg to choose from by eye. The chosen ones go in mobile/data/backgrounds.json;
mobile/data/build_backgrounds.py makes the download from it.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

UA = {"User-Agent": "BibleConcordance-backgrounds/0.1 (https://bible4me.org)"}
API = "https://commons.wikimedia.org/w/api.php"
CC0 = "haswbstatement:P275=Q6938433"

# each theme: simple searches, combined (OR inside a search doesn't mix with the filters)
THEMES = {
    "lake": ["lake", "lake reflection"],
    "river": ["river"],
    "mountain": ["mountain"],
    "sea": ["sea", "ocean"],
    "coast": ["coast", "beach", "cliff"],
    "sunrise": ["sunrise", "dawn", "morning fog"],
    "sunset": ["sunset", "dusk"],
    "waterfall": ["waterfall"],
    "forest": ["forest"],
    "meadow": ["meadow", "hills"],
    "desert": ["desert", "dunes"],
    "snow": ["snow landscape", "winter"],
    "fire": ["fire", "flames", "campfire"],
    "clouds": ["clouds", "sky"],
    "stars": ["stars", "milky way", "night sky"],
    "flowers": ["flowers", "blossom"],
    "deer": ["deer"],
    "lion": ["lion"],
    "eagle": ["eagle"],
    "sheep": ["sheep", "lamb"],
    "horse": ["horse"],
    "birds": ["dove", "swan", "bird flying"],
    "valley": ["valley"],
    "fields": ["olive tree", "wheat field", "vineyard"],
    # second tries for the themes the plain words found little in (searched as below)
    "lion2": ["Panthera leo"],
    "sheep2": ["Ovis aries", "sheep pasture"],
    "fire2": ["campfire", "bonfire", "fire flames wood"],
    "stars2": ["milky way", "starry sky", "night sky stars", "star trails"],
}
# themes searched outside "Quality images" (there are too few there), and public domain
# allowed as well as CC0 (NASA's photographs are public domain)
NOT_ONLY_QUALITY = {"fire2", "stars2"}
PUBLIC_DOMAIN_TOO = {"stars2"}
PD = "haswbstatement:P6216=Q19652"
PER_THEME = 36


def api(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
        except Exception:
            time.sleep(2 + attempt * 3)
    raise RuntimeError(url)


def search(words: str, quality: bool = True, licence: str = CC0) -> list[dict]:
    r = api(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"{words} {'incategory:Quality_images ' if quality else ''}filetype:bitmap {licence}",
            "gsrnamespace": "6",
            "gsrlimit": "50",
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|mime",
            "iiurlwidth": "360",
            "iiextmetadatafilter": "LicenseShortName|Artist",
        }
    )
    out = []
    pages = sorted(r.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        w, h = ii.get("width", 0), ii.get("height", 0)
        if ii.get("mime") not in ("image/jpeg", "image/png") or w < 1600 or h < 1000 or w / max(h, 1) > 2.4 or h / max(w, 1) > 1.6:
            continue
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if not lic.lower().startswith(("cc0", "public domain") if licence == PD else "cc0"):
            continue
        out.append(
            {
                "title": p["title"],
                "page": ii.get("descriptionurl", ""),
                "thumb": ii.get("thumburl", ""),
                "width": w,
                "height": h,
                "licence": lic,
                "artist": meta.get("Artist", {}).get("value", ""),
            }
        )
    return out


def contact_sheet(items: list[dict], path: Path) -> None:
    cols, cell = 6, 240
    rows = max(1, (len(items) + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * cell, rows * cell), "white")
    draw = ImageDraw.Draw(sheet)
    for i, it in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * cell
        try:
            data = urllib.request.urlopen(urllib.request.Request(it["thumb"], headers=UA), timeout=60).read()
            im = Image.open(BytesIO(data)).convert("RGB")
            im.thumbnail((cell - 8, cell - 28))
            sheet.paste(im, (x + 4, y + 24))
        except Exception:
            pass
        draw.rectangle([x, y, x + 34, y + 20], fill="black")
        draw.text((x + 4, y + 4), str(i), fill="yellow")
    sheet.save(path, quality=80)


def main() -> None:
    work = Path(sys.argv[1])
    work.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[2:] or list(THEMES)
    for theme in wanted:
        seen: dict[str, dict] = {}
        for words in THEMES[theme]:
            quality = theme not in NOT_ONLY_QUALITY
            for lic in [CC0, PD] if theme in PUBLIC_DOMAIN_TOO else [CC0]:
                for it in search(words, quality, lic):
                    seen.setdefault(it["title"], it)
        items = list(seen.values())[:PER_THEME]
        (work / f"{theme}.json").write_text(json.dumps(items, indent=1), encoding="utf-8")
        if items:
            contact_sheet(items, work / f"contact-{theme}.jpg")
        print(theme, len(items), flush=True)


if __name__ == "__main__":
    main()
