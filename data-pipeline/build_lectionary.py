"""The Sunday and holy-day lectionary of the 1979 Book of Common Prayer (The Episcopal
Church; the Prayer Book is not under copyright), for the sermon planner: a three-year cycle
(Years A, B and C) of an Old Testament reading, a psalm, an epistle and a gospel for every
Sunday and major feast, with the Prayer Book's collect of the day.

The Revised Common Lectionary, which replaced it in many churches, is copyright the
Consultation on Common Texts and needs their written permission to include in software, so
it is not used here. The two are close: the RCL grew out of this family of lectionaries.

    python data-pipeline/build_lectionary.py <folder>

<folder> holds The Lectionary Page's index of the 1979 texts (bcpidx.html, from
https://www.lectionarypage.net/CalndrsIndexes/TxtindexBCP.html) and its pages in pages/
(each saved as its path with "/" made "_": YearA_Advent_AAdv1.html). Only the citations,
the day's name and the collect are kept -- never the Bible text on the pages (the NRSV,
which is not free).

Writes src/lectionary.json: [{key, year ("A" | "B" | "C" | "" for every year), season,
name, title, readings: [citation, ...], psalm, collect}].
"""
import html
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.path.abspath(__file__)).parents[1]
OUT = ROOT / "src" / "lectionary.json"

LINK = re.compile(r'<a [^>]*href="\.\./([^"]+)"[^>]*>(.*?)</a>', re.S)
H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S | re.I)
CITE = re.compile(r'<a href="#([A-Za-z]+[0-9]*)">(.*?)</a>', re.S | re.I)
COLLECT = re.compile(r'<p class="collectText">(.*?)</p>', re.S | re.I)


def text(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    # "well¯beloved": the older pages' Mac hyphen
    s = html.unescape(s).replace(" ", " ").replace("¯", "-")
    return re.sub(r"\s+", " ", s).strip()


def read(page: Path) -> str:
    raw = page.read_bytes()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:  # the older pages are Latin-1 / Windows-1252
        return raw.decode("cp1252", errors="replace")


def main() -> None:
    src = Path(sys.argv[1])
    index = (src / "bcpidx.html").read_text(encoding="utf-8", errors="replace")
    out, seen, missing = [], set(), []
    for m in LINK.finditer(index):
        path, title = m.group(1), text(m.group(2))
        if not path.endswith(".html") or path.count("/") != 2 or path in seen:
            continue
        seen.add(path)
        page = src / "pages" / path.replace("/", "_")
        if not page.exists() or page.stat().st_size < 1000:
            missing.append(path)
            continue
        body = read(page)
        folder, season, file = path.split("/")
        key = file[:-5]
        year = folder[-1] if folder in ("YearA", "YearB", "YearC") else ""
        h1 = H1.search(body)
        name = text(h1.group(1)) if h1 else title
        # the citations: links to the readings further down the page, before the collect
        # (older pages mark it with an image, newer ones with a heading)
        cut = next((body.find(k) for k in ("Collect.gif", "The Collect") if k in body), 6000)
        readings, psalm = [], ""
        for anchor, cite in CITE.findall(body[:cut]):
            cite = text(cite)
            if not cite:
                continue
            if anchor.lower().startswith("ps") or cite.lower().startswith(("psalm", "canticle")):
                psalm = f"{psalm} or {cite}" if psalm else cite
            else:
                readings.append(cite)
        # the collect: its own paragraphs (newer pages), or those after its heading image up to
        # the first reading (older ones)
        collect = " ".join(p for p in (text(x) for x in COLLECT.findall(body)) if p)
        if not collect and "Collect.gif" in body:
            after = body[body.find("Collect.gif"):]
            # past the image (and the paragraph holding it, when there is one)
            after = after[after.find(">") + 1 :].lstrip()
            if after.lower().startswith("</p>"):
                after = after[4:]
            end = after.lower().find("<a name=")
            collect = " ".join(p for p in (text(x) for x in re.findall(r"<p[^>]*>(.*?)</p>", after[: end if end > 0 else 4000], re.S | re.I)) if p)
        if not readings:
            missing.append(path + " (no readings)")
            continue
        out.append({"key": key, "year": year, "season": season, "name": name, "title": title, "readings": readings, "psalm": psalm, "collect": collect})
    # a page without its collect (Palm Sunday, Year C): the day's collect is the same every year
    for d in out:
        if not d["collect"]:
            d["collect"] = next((x["collect"] for x in out if x["name"] == d["name"] and x["collect"]), "")
    print(f"{len(out)} days; {sum(1 for d in out if d['collect'])} with a collect; {len(missing)} missing:")
    for p in missing:
        print("  ", p)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{OUT} {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
