"""Step 2 of the picture catalogue: turn the Commons metadata fetched by pictures_fetch.py
into src-tauri/resources/pictures.json -- the collections the Pictures panel offers and
every picture's title, caption, linked passage(s), 1280 px download URL, credit and source
page. Every passage link is checked against the bundled Bible: the book must exist and the
chapter (and verse) must be within it, or the picture is kept without a link.

How each collection's passages are found:
  sweet      file names carry book + chapter ("Book of Genesis Chapter 3-2 ...")
  tissot-ot  file names carry the verse ("Les filles de Lot (Genesis 19 30) ...")
  dore       titles only -> the hand-made table DORE_REFS below
  tissot-nt  titles only -> the hand-made table TISSOT_NT_REFS (tissot_nt_refs.py)

Usage: pictures_build.py
"""
import html
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from refs import parse_ref_list, resolve_book  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(os.environ.get("LOCALAPPDATA", ".")) / "bible-concordance-build" / "pictures"
OUT = ROOT / "src-tauri" / "resources" / "pictures.json"
BIBLE = ROOT / "src-tauri" / "resources" / "bible.db"

COLLECTIONS = [
    {
        "key": "dore",
        "title": "Gustave Doré — Bible engravings",
        "artist": "Gustave Doré",
        "year": "1866",
        "licence": "Public domain",
        "licence_url": "https://creativecommons.org/publicdomain/mark/1.0/",
        "about": "The famous wood engravings of La Grande Bible de Tours: dramatic black-and-white scenes from Genesis to Revelation.",
    },
    {
        "key": "tissot-nt",
        "title": "James Tissot — The Life of Jesus Christ",
        "artist": "James Tissot",
        "year": "1886–1894",
        "licence": "Public domain",
        "licence_url": "https://creativecommons.org/publicdomain/mark/1.0/",
        "about": "Watercolours of the life of Christ, painted after Tissot's journeys to the Holy Land; Brooklyn Museum.",
    },
    {
        "key": "tissot-ot",
        "title": "James Tissot — The Old Testament",
        "artist": "James Tissot (published 1904)",
        "year": "1896–1902",
        "licence": "Public domain artwork; scans by Phillip Medhurst (CC BY-SA)",
        "licence_url": "https://creativecommons.org/licenses/by-sa/3.0/",
        "about": "Tissot's Old Testament paintings, from the 1904 printed edition (Phillip Medhurst collection).",
    },
    {
        "key": "sweet",
        "title": "Sweet Publishing — Bible illustrations",
        "artist": "Jim Padgett, Sweet Publishing",
        "year": "1984",
        "licence": "CC BY-SA 3.0",
        "licence_url": "https://creativecommons.org/licenses/by-sa/3.0/",
        "about": "Colour illustrations of Bible stories, chapter by chapter through most of the Bible.",
    },
]

ORDINAL = {"first": "1", "second": "2", "third": "3", "1st": "1", "2nd": "2", "3rd": "3"}


def strip_html(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def chapter_limits() -> dict[tuple[str, int], int]:
    """(book, chapter) -> last verse, from the bundled KJV (the canonical shape)."""
    con = sqlite3.connect(f"file:{BIBLE}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT b.name, v.chapter, MAX(v.verse) FROM verses v JOIN books b ON b.id = v.book_id "
        "JOIN versions x ON x.id = v.version_id WHERE x.code = 'KJV' GROUP BY b.name, v.chapter"
    )
    return {(b, c): n for b, c, n in rows}


LIMITS: dict = {}
BOOK_ORDER: dict = {}


def valid(ref) -> bool:
    book, ch, v, v_end = ref
    last = LIMITS.get((book, ch))
    return last is not None and (v is None or 1 <= v <= last) and (v_end is None or v_end <= last)


def sweet_book(phrase: str) -> str | None:
    """"Book of Genesis", "First Book of Samuel", "Gospel of Matthew", "Acts of the
    Apostles", "First Epistle to the Corinthians", "Epistle of James", "Book of Psalms"."""
    p = phrase.strip()
    p = re.sub(r"^(First|Second|Third)\b", lambda m: ORDINAL[m.group(1).lower()], p, flags=re.I)
    p = re.sub(r"\b(Book|Gospel|Epistle|Letter)s?\s+(of|to)\s+(the\s+)?", "", p, flags=re.I)
    p = re.sub(r"\bBook of\b", "", p, flags=re.I)
    p = p.replace("Acts of the Apostles", "Acts").replace("Song of Songs", "Song of Solomon")
    p = re.sub(r"\s+", " ", p).strip()
    return resolve_book(p)


def thumb_mb(rec) -> float:
    size = rec.get("size") or 0
    w = rec.get("width") or 1
    if w > 1280:
        size = size * (1280 / w) ** 2
    return size / 1_000_000


def build_sweet(data: dict) -> list[dict]:
    out = []
    for title, rec in data.items():
        m = re.match(r"File:(.+?) Chapter (\d+)-(\d+)", title)
        if not m:
            continue
        book = sweet_book(m.group(1))
        ch, n = int(m.group(2)), int(m.group(3))
        ref = (book, ch, None, None) if book else None
        # Commons only describes these generically ("Biblical illustration of Book of
        # Exodus Chapter 9"), so the title is the chapter and the picture's number in it.
        credit = strip_html(rec["meta"].get("Credit")).split(" Released under")[0].split(". Copyright")[0]
        out.append({
            "id": f"sweet-{(book or 'x').replace(' ', '').lower()}-{ch:03d}-{n:02d}",
            "c": "sweet",
            "title": f"{book or m.group(1)} {ch} · picture {n}",
            "caption": "",
            "refs": [ref] if ref and valid(ref) else [],
            "order": (book or "", ch, n),
            "rec": rec,
            "credit": credit or "Jim Padgett, courtesy of Sweet Publishing and Gospel Light",
        })
    return out


def build_tissot_ot(data: dict) -> list[dict]:
    out = []
    for title, rec in data.items():
        m = re.search(r"\(([1-3]?\s?[A-Za-z][A-Za-z ]*?) (\d+) (\d+)(?:[-–](\d+))?\)", title)
        ref = None
        if m:
            book = resolve_book(m.group(1))
            if book:
                ref = (book, int(m.group(2)), int(m.group(3)), int(m.group(4)) if m.group(4) else None)
        name = re.sub(r"^File:", "", title)
        name = re.sub(r"\(.*$", "", name)
        name = re.sub(r"^[\d.]+\s+[\d ]+\s*", "", name).strip(" .")
        caption = strip_html(rec["meta"].get("ImageDescription"))
        out.append({
            "id": "tissot-ot-" + re.sub(r"[^a-z0-9]+", "-", title.lower())[5:60].strip("-"),
            "c": "tissot-ot",
            "title": name,
            "caption": caption[:300],
            "refs": [ref] if ref and valid(ref) else [],
            "order": title,
            "rec": rec,
            "credit": "James Tissot; scan Phillip Medhurst",
        })
    return out


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def ref_of(text: str):
    refs = parse_ref_list(text)
    return tuple(refs[0]) if refs else None


def build_from_table(data: dict, key: str, table: dict, clean, prefer=None, credit="") -> list[dict]:
    """Pictures whose titles are looked up in a hand-made table; one per title (preferring
    files for which `prefer(title)` is true), unlisted titles left out."""
    lookup = {norm_title(k): v for k, v in table.items()}
    chosen: dict[str, tuple] = {}
    for title, rec in data.items():
        name = clean(title)
        if not name:
            continue
        ref_text = lookup.get(norm_title(name))
        if not ref_text:
            continue
        k = norm_title(name)
        better = prefer(title) if prefer else False
        if k not in chosen or (better and not chosen[k][2]):
            chosen[k] = (name, rec, better, ref_text)
    out = []
    for k, (name, rec, _, ref_text) in chosen.items():
        ref = ref_of(ref_text)
        if not ref or not valid(ref):
            print(f"  {key}: bad reference {ref_text!r} for {name!r}")
            continue
        out.append({
            "id": f"{key}-{k[:60]}",
            "c": key,
            "title": name,
            "caption": "",
            "refs": [ref],
            "order": (BOOK_ORDER.get(ref[0], 99), ref[1], ref[2] or 0),
            "rec": rec,
            "credit": credit,
        })
    return out


def clean_dore(title: str) -> str | None:
    m = re.match(r"File:\d{3}[A-Z]?\.\s*(.+?)\.(jpg|jpeg|png)$", title, flags=re.I)
    return m.group(1).strip() if m else None  # unnumbered files are duplicates


def clean_tissot_nt(title: str) -> str:
    n = title[5:]
    n = re.sub(r"^Brooklyn Museum - ", "", n)
    n = re.sub(r"\s*-\s*James Tissot.*$|\s*\(James Tissot\).*$|\.(jpg|jpeg|png|tif)$", "", n, flags=re.I)
    n = re.sub(r"\s*\((?:Une|Le|La|Les|L'|Ecce|Consummatum|Domine|Eli|Noli|Stabat|Mater|Pais|Anne|Conspiration|Celui|Judas|Joseph|Lazare|Marthe|Madeleine|Nathanaël|En |Pilate|Portrait|Premier|Saint|Sainte|Vocation|Confession|Dernier|Protestations|Titre|Retour|Vision|On |Ce |Vous|Retour)[^)]*\)", "", n)
    return re.sub(r"\s+", " ", n).strip()


STOP = set("""the and with from that this into unto upon their them they there have been were when what which while
jesus christ lord saint holy blessed virgin mary our his him her before after among appears appear goes went
takes taken called calling about away down over under through against near alone tissot james brooklyn""".split())


def chapter_words(book: str, ch: int) -> set[str]:
    con = sqlite3.connect(f"file:{BIBLE}?mode=ro", uri=True)
    text = " ".join(t for (t,) in con.execute(
        "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions x ON x.id = v.version_id "
        "WHERE x.code IN ('BSB','KJV') AND b.name = ? AND v.chapter = ?", (book, ch)))
    return {w[:5] for w in re.findall(r"[a-z]+", text.lower())}


def check_words(pics: list[dict]) -> None:
    """Report pictures none of whose title words occur in their chapter -- for review."""
    for p in pics:
        if not p["refs"]:
            continue
        book, ch = p["refs"][0][0], p["refs"][0][1]
        words = {w[:5] for w in re.findall(r"[a-z]+", p["title"].lower()) if len(w) >= 4 and w not in STOP}
        if words and not (words & chapter_words(book, ch)):
            print(f"  REVIEW {p['c']}: {p['title']!r} -> {book} {ch}")


def finish(items: list[dict]) -> list[dict]:
    pics = []
    for it in items:
        rec = it.pop("rec")
        it.pop("order", None)
        url = (rec.get("thumb") or rec.get("url") or "").split("?")[0]  # drop Commons' utm_ tracking parameters
        if not url or not (rec.get("mime") or "").startswith("image/"):
            continue
        it.update({
            "url": url,
            "w": rec.get("thumb_width") or rec.get("width") or 0,
            "h": rec.get("thumb_height") or rec.get("height") or 0,
            "page": rec.get("page") or "",
        })
        it["refs"] = [list(r) for r in it["refs"]]
        it["_mb"] = thumb_mb(rec)
        pics.append(it)
    return pics


def sample_mb(pics: list[dict], n: int = 6) -> float | None:
    """Average download size of a few of the collection's pictures (HEAD requests, gently),
    for the size shown before downloading."""
    import random
    import time
    import urllib.request

    sizes = []
    for p in random.Random(1).sample(pics, min(n, len(pics))):
        try:
            req = urllib.request.Request(p["url"], method="HEAD", headers={"User-Agent": "BibleConcordance/2.2 (https://github.com/BadBull22/bible; picture catalogue builder)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                sizes.append(int(r.headers.get("Content-Length") or 0))
        except Exception:
            pass
        time.sleep(0.5)
    sizes = [s for s in sizes if s > 0]
    return sum(sizes) / len(sizes) / 1_000_000 if sizes else None


def main():
    global LIMITS, BOOK_ORDER
    LIMITS = chapter_limits()
    con = sqlite3.connect(f"file:{BIBLE}?mode=ro", uri=True)
    BOOK_ORDER = {n: o for n, o in con.execute("SELECT name, order_index FROM books")}
    from picture_refs import DORE_REFS, TISSOT_NT_REFS

    builders = {
        "sweet": build_sweet,
        # only the 1904 edition scans, which carry their verse; the other copies of the same
        # paintings have no reference and would just duplicate them
        "tissot-ot": lambda d: [p for p in build_tissot_ot(d) if p["refs"]],
        "dore": lambda d: build_from_table(d, "dore", DORE_REFS, clean_dore, credit="Gustave Doré"),
        "tissot-nt": lambda d: build_from_table(
            d, "tissot-nt", TISSOT_NT_REFS, clean_tissot_nt, prefer=lambda t: "Brooklyn Museum" in t, credit="James Tissot; Brooklyn Museum"
        ),
    }
    pictures, collections = [], []
    for c in COLLECTIONS:
        src = SRC / f"{c['key']}.json"
        if c["key"] not in builders or not src.exists():
            print(f"{c['key']}: skipped (no builder or no fetched data yet)")
            continue
        data = json.loads(src.read_text(encoding="utf-8"))
        items = builders[c["key"]](data)
        items.sort(key=lambda i: i["order"] if isinstance(i["order"], tuple) else (i["order"],))
        pics = finish(items)
        if c["key"] in ("dore", "tissot-nt"):
            check_words(pics)
        linked = sum(1 for p in pics if p["refs"])
        est = round(sum(p.pop("_mb") for p in pics))
        avg = sample_mb(pics)
        mb = round(avg * len(pics)) if avg else est
        collections.append({**c, "count": len(pics), "approx_mb": max(mb, 1)})
        pictures.extend(pics)
        print(f"{c['key']}: {len(pics)} pictures, {linked} linked to a passage, ~{mb} MB")
    OUT.write_text(json.dumps({"collections": collections, "pictures": pictures}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
