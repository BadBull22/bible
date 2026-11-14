"""Finds MORE candidate nature photos for the verse-picture backgrounds (phone and computer), beyond the first 100.

    python mobile/data/backgrounds_more.py <work dir> [theme ...]

The same rule as backgrounds_candidates.py: CC0 only (on Commons' structured data), so a picture made over one needs no credit and
no licence of its own; real photographs, at least 1600 x 1000 pixels. This one goes DEEPER: several pages of results per search, more
searches per theme, more themes, and it leaves out what is already in mobile/data/backgrounds.json. It ranks what it finds by a few
simple measures (sharp, colourful, neither too dark nor too bright, not several of one photographer's series) and keeps the best
PER_THEME per theme. Writes <work dir>/<theme>.json and, for all themes, numbered contact sheets <work dir>/sheet-NN.jpg to look through
by eye (people, text, logos and dull pictures are weeded out by hand). The chosen ones are appended to mobile/data/backgrounds.json and
mobile/data/build_backgrounds.py builds the download.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageStat

UA = {"User-Agent": "BibleConcordance-backgrounds/0.2 (https://bible4me.org)"}
API = "https://commons.wikimedia.org/w/api.php"
CC0 = "haswbstatement:P275=Q6938433"
HERE = Path(__file__).parent

THEMES = {
    # the 24 themes of the first 100
    "lake": ["lake", "lake reflection", "mountain lake", "pond"],
    "river": ["river", "stream", "creek"],
    "mountain": ["mountain", "mountains peak", "alpine"],
    "sea": ["sea", "ocean", "ocean waves", "seascape"],
    "coast": ["coast", "beach", "cliff", "sand dunes beach"],
    "sunrise": ["sunrise", "dawn", "morning light", "morning fog"],
    "sunset": ["sunset", "dusk", "evening sky"],
    "waterfall": ["waterfall", "cascade"],
    "forest": ["forest", "woodland", "trees forest path"],
    "meadow": ["meadow", "grassland", "green hills"],
    "desert": ["desert", "dunes", "sand desert"],
    "snow": ["snow landscape", "winter landscape", "frost"],
    "fire": ["fire", "flames", "campfire", "bonfire"],
    "clouds": ["clouds", "cloudscape", "sky clouds", "cumulus"],
    "stars": ["milky way", "starry sky", "night sky stars"],
    "flowers": ["flowers", "blossom", "wildflowers", "tulips field"],
    "deer": ["deer", "stag", "red deer"],
    "lion": ["lion", "Panthera leo"],
    "eagle": ["eagle", "bald eagle", "golden eagle"],
    "sheep": ["sheep", "lamb", "sheep pasture"],
    "horse": ["horse", "horses field"],
    "birds": ["dove", "swan", "bird flying", "birds in flight"],
    "valley": ["valley", "canyon valley"],
    "fields": ["wheat field", "olive tree", "vineyard", "harvest field"],
    # new themes
    "mist": ["mist", "fog", "misty forest", "mist lake"],
    "autumn": ["autumn leaves", "autumn forest", "fall foliage"],
    "path": ["footpath", "trail", "country road", "path through"],
    "tree": ["lone tree", "oak tree", "tree silhouette", "old tree"],
    "rainbow": ["rainbow", "double rainbow"],
    "storm": ["storm clouds", "thunderstorm", "lightning"],
    "rocks": ["rock formation", "canyon", "red rocks", "sandstone"],
    "glacier": ["glacier", "iceberg", "ice"],
    "island": ["island", "tropical island", "archipelago"],
    "moon": ["moon", "full moon", "moonlight"],
    "palm": ["palm trees", "oasis", "date palm"],
    "rain": ["raindrops", "rain", "dew", "water drops"],
    "light": ["sunbeams", "crepuscular rays", "light through trees", "golden hour"],
    "butterfly": ["butterfly", "bee flower", "dragonfly"],
}
PER_THEME = 12


def api(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
        except Exception:
            time.sleep(2 + attempt * 3)
    return {}


def search(words: str, offset: int, quality: bool) -> list[dict]:
    r = api(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"{words} {'incategory:Quality_images ' if quality else ''}filetype:bitmap {CC0}",
            "gsrnamespace": "6",
            "gsrlimit": "50",
            "gsroffset": str(offset),
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|mime",
            "iiurlwidth": "360",
            "iiextmetadatafilter": "LicenseShortName|Artist",
        }
    )
    out = []
    for p in sorted(r.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]
        w, h = ii.get("width", 0), ii.get("height", 0)
        if ii.get("mime") not in ("image/jpeg", "image/png") or w < 1600 or h < 1000 or w / max(h, 1) > 2.4 or h / max(w, 1) > 1.6:
            continue
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if not lic.lower().startswith("cc0"):
            continue
        out.append({"title": p["title"], "page": ii.get("descriptionurl", ""), "thumb": ii.get("thumburl", ""), "width": w, "height": h, "licence": lic, "artist": meta.get("Artist", {}).get("value", "")})
    return out


def plain_artist(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip().lower()


def score(thumb: bytes) -> float:
    """Higher is better: sharp, colourful, well exposed."""
    im = Image.open(BytesIO(thumb)).convert("RGB")
    im.thumbnail((360, 360))
    lum = ImageStat.Stat(im.convert("L"))
    mean = lum.mean[0]
    if mean < 28 or mean > 228:
        return -1
    edges = ImageStat.Stat(im.convert("L").filter(ImageFilter.FIND_EDGES)).var[0]
    sat = ImageStat.Stat(im.convert("HSV")).mean[1]
    return edges ** 0.5 + sat * 0.25 + (1 - abs(mean - 120) / 120) * 8


def fetch(url: str) -> bytes:
    for attempt in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception:
            time.sleep(2 + attempt * 3)
    return b""


def gather(theme: str, known: set[str]) -> list[dict]:
    seen: dict[str, dict] = {}
    for words in THEMES[theme]:
        for quality in (True, False):
            for offset in (0, 50, 100) if quality else (0, 50):
                for it in search(words, offset, quality):
                    if it["title"] not in known:
                        seen.setdefault(it["title"], it)
    items = list(seen.values())
    with ThreadPoolExecutor(8) as pool:
        thumbs = list(pool.map(lambda it: fetch(it["thumb"]), items))
    ranked = []
    for it, data in zip(items, thumbs):
        if not data:
            continue
        try:
            s = score(data)
        except Exception:
            continue
        if s > 0:
            ranked.append((s, it))
    ranked.sort(key=lambda x: -x[0])
    out, per_artist = [], {}
    for s, it in ranked:
        who = plain_artist(it["artist"])[:40]
        if per_artist.get(who, 0) >= 3:  # not several of one photographer's series
            continue
        per_artist[who] = per_artist.get(who, 0) + 1
        it["score"] = round(s, 1)
        out.append(it)
        if len(out) >= PER_THEME:
            break
    return out


def sheet(items: list[dict], path: Path) -> None:
    cols, cell = 6, 240
    rows = (len(items) + cols - 1) // cols
    img = Image.new("RGB", (cols * cell, rows * cell), "white")
    draw = ImageDraw.Draw(img)
    with ThreadPoolExecutor(8) as pool:
        thumbs = list(pool.map(lambda it: fetch(it["thumb"]), items))
    for i, (it, data) in enumerate(zip(items, thumbs)):
        x, y = (i % cols) * cell, (i // cols) * cell
        try:
            im = Image.open(BytesIO(data)).convert("RGB")
            im.thumbnail((cell - 8, cell - 28))
            img.paste(im, (x + 4, y + 24))
        except Exception:
            pass
        draw.rectangle([x, y, x + 78, y + 20], fill="black")
        draw.text((x + 4, y + 4), it["label"], fill="yellow")
    img.save(path, quality=82)


def main() -> None:
    work = Path(sys.argv[1])
    work.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[2:] or list(THEMES)
    known = {c["title"] for c in json.loads((HERE / "backgrounds.json").read_text(encoding="utf-8"))}
    taken: set[str] = set(known)
    allitems: list[dict] = []
    for theme in wanted:
        items = gather(theme, taken)
        for n, it in enumerate(items):
            it["theme"] = theme
            it["label"] = f"{theme[:5]}{n}"
            taken.add(it["title"])
        (work / f"{theme}.json").write_text(json.dumps(items, indent=1), encoding="utf-8")
        allitems += items
        print(theme, len(items), flush=True)
    (work / "all.json").write_text(json.dumps(allitems, indent=1), encoding="utf-8")
    per = 30
    for n in range(0, len(allitems), per):
        sheet(allitems[n : n + per], work / f"sheet-{n // per + 1:02d}.jpg")
    print("total", len(allitems), "sheets", (len(allitems) + per - 1) // per)


if __name__ == "__main__":
    main()
