"""An index of C. H. Spurgeon's sermons by their texts, for the sermon builder's "Spurgeon
preached on this": the New Park Street and Metropolitan Tabernacle Pulpit (1855-1917,
public domain), from the Christian Classics Ethereal Library's ThML editions.

    python data-pipeline/build_spurgeon.py <folder with v01.xml .. v63.xml>

The volumes are https://ccel.org/ccel/s/spurgeon/sermonsNN.xml. In each, a sermon is a
<div1 title="Sermon 1332. Our Urgent Need of the Holy Spirit"> holding its text as
<scripCom passage="Romans 15:13." osisRef="Bible:Rom.15.13"/>, then "(No. 1332)",
"DELIVERED ON LORD'S DAY MORNING, JANUARY 7, 1877," and the sermon.

Writes src-tauri/resources/spurgeon_sermons.json: one entry per sermon and text --
{n, title, book, chapter, verse, verse_end, date, place, opening, url} -- where `opening` is
the sermon's first paragraph (to see where it goes) and `url` its page at CCEL.
"""
import html
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from refs import OSIS  # noqa: E402

# not resolve(): that turns the mapped drive into its network path, which SQLite cannot open by URI
ROOT = Path(os.path.abspath(__file__)).parents[1]
OUT = ROOT / "src-tauri" / "resources" / "spurgeon_sermons.json"

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
DATE = re.compile(r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", re.I)
DIV = re.compile(r"<div1\b([^>]*)>(.*?)(?=<div1\b|</ThML.body>|$)", re.S)
SERMON = re.compile(r'title="Sermon\s+(\d+)\.?\s*([^"]*)"')
DIV_ID = re.compile(r'\bid="([^"]+)"')
SCRIP = re.compile(r'<scripCom[^>]*osisRef="Bible:([^"]+)"[^>]*/>')
# sermon numbers misprinted in the CCEL headings (vol. 12: "Sermon 6823", between 682 and 684)
MISPRINTS = {6823: 683}
PARA = re.compile(r"<p[^>]*>(.*?)</p>", re.S)


def plain(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("�", "—").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def refs_of(osis: str) -> list[tuple[str, int, int, int]]:
    """"Rom.15.13", "Rom.15.13-Rom.15.19", "Ps.23" -> (book, chapter, verse, last verse); several
    separated by spaces."""
    out = []
    for one in osis.split():
        a, _, b = one.partition("-")
        pa, pb = a.split("."), b.split(".") if b else []
        book = OSIS.get(pa[0])
        if not book or len(pa) < 2 or not pa[1].isdigit():
            continue
        ch = int(pa[1])
        v = int(pa[2]) if len(pa) > 2 and pa[2].isdigit() else 0
        end = v
        if pb and len(pb) > 2 and pb[0] == pa[0] and pb[1] == pa[1] and pb[2].isdigit():
            end = int(pb[2])
        out.append((book, ch, v, max(end, v)))
    return out


def main() -> None:
    src = Path(sys.argv[1])
    db = ROOT / "src-tauri" / "resources" / "bible.db"
    c = sqlite3.connect(f"file:{db.as_posix()}?mode=ro&immutable=1", uri=True)
    last = {(b, ch): m for b, ch, m in c.execute(
        "SELECT b.name, v.chapter, max(v.verse) FROM verses v JOIN books b ON b.id = v.book_id JOIN versions x ON x.id = v.version_id WHERE x.code = 'KJV' GROUP BY b.name, v.chapter")}
    out: list[dict] = []
    seen = set()
    no_text = bad = 0
    for f in sorted(src.glob("v*.xml")):
        vol = f.stem[1:]
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in DIV.finditer(text):
            head_attrs, body = m.group(1), m.group(2)
            sm, im = SERMON.search(head_attrs), DIV_ID.search(head_attrs)
            if not sm or not im:
                continue
            n, title, div_id = int(sm.group(1)), plain(sm.group(2)), im.group(1)
            n = MISPRINTS.get(n, n)
            if n in seen:
                continue
            seen.add(n)
            refs = [r for o in SCRIP.findall(body[:4000]) for r in refs_of(o)]
            if not refs:
                no_text += 1
                continue
            paras = [plain(p) for p in PARA.findall(body[:20000])]
            head = " ".join(paras[:8])
            # the date it was preached ("DELIVERED ON ... JANUARY 7, 1877"), else any date in the heading
            when = DATE.search(head[head.upper().find("DELIVERED"):]) if "DELIVERED" in head.upper() else None
            when = when or DATE.search(head)
            date = f"{when.group(3)}-{MONTHS.index(when.group(1).lower()) + 1:02d}-{int(when.group(2)):02d}" if when else ""
            place = ""
            # "AT THE METROPOLITAN TABERNACLE, NEWINGTON." -> "Metropolitan Tabernacle"
            at = re.search(r"\bAT (?:THE )?([A-Z][A-Z' \-]{3,60}?)\s*[,.]", head)
            if at:
                place = at.group(1).strip().title()
            # the opening: the first real paragraph after the heading and the text
            opening = next((p for p in paras if len(p) > 200 and not p.startswith('"') and "DELIVERED" not in p.upper()[:40]), "")
            if len(opening) > 700:
                opening = opening[:700].rsplit(" ", 1)[0] + " …"
            for book, ch, v, end in refs[:3]:
                top = last.get((book, ch))
                if not top or v > top:
                    bad += 1
                    continue
                out.append({
                    "n": n,
                    "title": title,
                    "book": book,
                    "chapter": ch,
                    "verse": v,
                    "verse_end": min(end, top),
                    "date": date,
                    "place": place,
                    "opening": opening,
                    "url": f"https://ccel.org/ccel/spurgeon/sermons{vol}/sermons{vol}.{div_id}.html",
                })
        print(f"{f.name}: up to No. {max(seen) if seen else '-'}")
    out.sort(key=lambda d: (d["n"], d["book"], d["chapter"], d["verse"]))
    print(f"{len(seen)} sermons read, {no_text} without a text, {bad} texts that don't exist dropped; {len(out)} entries")
    print(f"{sum(1 for d in out if d['date'])} with a date, {sum(1 for d in out if d['opening'])} with an opening")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT} {OUT.stat().st_size / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
