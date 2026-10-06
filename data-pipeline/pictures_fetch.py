"""Step 1 of the picture catalogue: fetch, from Wikimedia Commons, the file list and the
image metadata (size, a 1280 px rendition URL, description, artist, licence) for each Bible
picture collection, and cache it as JSON in the build folder. Step 2 (pictures_build.py)
links each picture to its passage and writes the catalogue the app ships.

Polite by design (Wikimedia API etiquette): one request at a time with a pause, maxlag,
retries honouring Retry-After, and a User-Agent with a contact URL.

Usage: pictures_fetch.py [collection ...]   (default: all)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = "BibleConcordance/2.2 (https://github.com/BadBull22/bible; picture catalogue builder)"
API = "https://commons.wikimedia.org/w/api.php"
OUT = Path(os.environ.get("LOCALAPPDATA", ".")) / "bible-concordance-build" / "pictures"

COLLECTIONS = {
    "sweet": ["Category:Bible illustrations by Sweet Media"],
    "tissot-ot": ["Category:Old Testament by James Tissot"],
    "tissot-nt": ["Category:The Life of Jesus Christ by James Tissot"],
    "dore": ["Category:Doré's English Bible"],
    "schnorr": ["Category:Die Bibel in Bildern by Julius Schnorr von Carolsfeld"],
}


def get(params: dict) -> dict:
    """API call; sent as a POST (some file names are long enough that 50 of them overflow a
    URL -- HTTP 414)."""
    body = urllib.parse.urlencode({**params, "format": "json", "maxlag": "5"}).encode()
    url = API
    for _ in range(10):
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.load(r)
            if data.get("error", {}).get("code") == "maxlag":
                time.sleep(10)
                continue
            time.sleep(1.5)
            return data
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 30)
            print(f"  HTTP {e.code}; waiting {wait}s", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  {e}; retrying", flush=True)
            time.sleep(15)
    raise RuntimeError("gave up: " + url)


def files_in(cat: str, depth: int = 1) -> list[str]:
    """Files in a category and (to `depth`) its subcategories."""
    out, subs, cont = [], [], None
    while True:
        p = {"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": "500"}
        if cont:
            p["cmcontinue"] = cont
        d = get(p)
        for m in d["query"]["categorymembers"]:
            if m["ns"] == 6:
                out.append(m["title"])
            elif m["ns"] == 14:
                subs.append(m["title"])
        cont = d.get("continue", {}).get("cmcontinue")
        if not cont:
            break
    if depth > 0:
        for s in subs:
            out.extend(files_in(s, depth - 1))
    return out


def image_info(titles: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(titles), 50):
        batch = titles[i : i + 50]
        d = get({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": "1280",
            "iiextmetadatafilter": "ImageDescription|ObjectName|Artist|LicenseShortName|LicenseUrl|DateTimeOriginal|Credit",
        })
        for page in d["query"]["pages"].values():
            ii = (page.get("imageinfo") or [None])[0]
            if not ii:
                continue
            meta = {k: v.get("value") for k, v in (ii.get("extmetadata") or {}).items()}
            out[page["title"]] = {
                "title": page["title"],
                "width": ii.get("width"),
                "height": ii.get("height"),
                "size": ii.get("size"),
                "mime": ii.get("mime"),
                "url": ii.get("url"),
                "thumb": ii.get("thumburl"),
                "thumb_width": ii.get("thumbwidth"),
                "thumb_height": ii.get("thumbheight"),
                "page": ii.get("descriptionurl"),
                "meta": meta,
            }
        print(f"  {min(i + 50, len(titles))}/{len(titles)}", flush=True)
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or list(COLLECTIONS)
    for key in wanted:
        dest = OUT / f"{key}.json"
        if dest.exists():
            print(f"{key}: cached ({dest})")
            continue
        titles = []
        for cat in COLLECTIONS[key]:
            titles.extend(files_in(cat))
        titles = sorted(set(t for t in titles if t.lower().endswith((".jpg", ".jpeg", ".png", ".tif", ".tiff"))))
        print(f"{key}: {len(titles)} image files; fetching metadata…", flush=True)
        info = image_info(titles)
        dest.write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{key}: wrote {len(info)} records to {dest}", flush=True)
