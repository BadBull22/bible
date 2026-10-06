"""Lists the files in a few Wikimedia Commons categories (Bible picture collections), slowly
and politely: one request at a time, a pause between requests, maxlag, and a User-Agent with
a contact URL, as Wikimedia's API etiquette asks. Writes JSON per category to the output dir.

Usage: commons_probe.py <out_dir> "Category:A" "Category:B" ...
"""
import json
import sys
import time
import urllib.parse
import urllib.request

UA = "BibleConcordance/2.2 (https://github.com/BadBull22/bible; picture catalogue builder)"
API = "https://commons.wikimedia.org/w/api.php"


def get(params: dict) -> dict:
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "maxlag": "5"})
    for attempt in range(8):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if "error" in data and data["error"].get("code") == "maxlag":
                time.sleep(10)
                continue
            time.sleep(2)
            return data
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 30)
            print(f"  HTTP {e.code}, waiting {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("gave up: " + url)


def members(cat: str):
    files, subcats, cont = [], [], None
    while True:
        p = {"action": "query", "list": "categorymembers", "cmtitle": cat, "cmlimit": "500"}
        if cont:
            p["cmcontinue"] = cont
        d = get(p)
        for m in d["query"]["categorymembers"]:
            (files if m["ns"] == 6 else subcats if m["ns"] == 14 else []).append(m["title"])
        cont = d.get("continue", {}).get("cmcontinue")
        if not cont:
            return files, subcats


if __name__ == "__main__":
    out = sys.argv[1]
    for cat in sys.argv[2:]:
        files, subcats = members(cat)
        print(f"{cat}: {len(files)} files, {len(subcats)} subcats; e.g. {files[:3]} | subcats {subcats[:8]}", flush=True)
        safe = cat.split(":", 1)[1].replace(" ", "_").replace("'", "")
        with open(f"{out}/{safe}.json", "w", encoding="utf-8") as f:
            json.dump({"category": cat, "files": files, "subcats": subcats}, f, ensure_ascii=False, indent=1)
