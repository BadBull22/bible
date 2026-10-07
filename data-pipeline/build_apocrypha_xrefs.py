"""Builds src-tauri/resources/apocrypha_xrefs.json: cross-references between the Apocrypha
(deuterocanonical books) and the 66 books, and within the Apocrypha.

The app's main cross-reference data (OpenBible.info / Treasury of Scripture Knowledge)
covers only the 66 books. These come instead from the reference notes that public-domain
Bibles printed with their Apocrypha:

  Swe1917        Swedish Bible of 1917 (Apocrypha 1921), the fullest set
  engwebu2025eb  World English Bible (its Apocrypha notes follow the Revised Version, 1895)
  GerMenge       Menge-Bibel (1939)

Every entry names the Bible(s) it comes from: the app presents them as "the editors of X
noted a connection here", not as its own claim, and always marks the Apocrypha as outside
the canon.

Input: notes.tsv, written by the Rust helper
    cargo test dump_xref_notes -- --ignored
from the module zips in %LOCALAPPDATA%\\bible-concordance-build\\library-probe\\xref.

Each reference is checked against real text and dropped if its verse doesn't exist there:
canonical verses against the bundled KJV (bible.db), Apocrypha verses against an installed
KJV-with-Apocrypha (the user's library.db, module KJVA). The source Bibles number a few
Apocrypha chapters differently from the KJV, so a link can land a verse or two off; the
app says so.

    python data-pipeline/build_apocrypha_xrefs.py
"""

import collections
import json
import os
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROBE = Path(os.path.expandvars(r"%LOCALAPPDATA%\bible-concordance-build\library-probe\xref"))
NOTES = PROBE / "notes.tsv"
OUT = ROOT / "src-tauri" / "resources" / "apocrypha_xrefs.json"
REFS_RS = ROOT / "src-tauri" / "src" / "library" / "refs.rs"
BIBLE_DB = ROOT / "src-tauri" / "resources" / "bible.db"
LIBRARY_DB = Path(os.path.expandvars(r"%APPDATA%\com.local.bibleconcordance\library\library.db"))
APOCRYPHA_MODULE = "KJVA"

SOURCES = {
    "Swe1917": "Swedish Bible (1917)",
    "engwebu2025eb": "World English Bible / Revised Version (1895)",
    "GerMenge": "Menge-Bibel (1939)",
}
# only notes that are cross-references, not translation notes that happen to cite a verse
CROSS_REF_ONLY = {"Swe1917"}


def book_maps():
    """OSIS id -> app name for the 66 books and for the Apocrypha, from refs.rs."""
    src = REFS_RS.read_text(encoding="utf-8")
    canon_part = src.split("const OSIS")[1].split("];")[0]
    apoc_part = src.split("pub const APOCRYPHA")[1].split("];")[0]
    pair = re.compile(r'\("([^"]+)", "([^"]+)"\)')
    return dict(pair.findall(canon_part)), dict(pair.findall(apoc_part))


def parse_osis(ref, canon, apoc):
    """'Gen.46.24', 'Bible:Wis.2.12-Wis.2.20', 'Sir.36' -> (name, chapter, verse|None, verse_end|None, is_apocrypha)."""
    ref = ref.split(":")[-1]
    start, _, end = ref.partition("-")
    bits = start.split(".")
    name = canon.get(bits[0]) or apoc.get(bits[0])
    if not name or len(bits) < 2 or not bits[1].isdigit():
        return None
    chapter = int(bits[1])
    verse = int(bits[2]) if len(bits) > 2 and bits[2].isdigit() else None
    verse_end = None
    if end and verse is not None:
        eb = end.split(".")
        if len(eb) == 3 and eb[0] == bits[0] and eb[1] == bits[1] and eb[2].isdigit() and int(eb[2]) > verse:
            verse_end = int(eb[2])
    return name, chapter, verse, verse_end, bits[0] in apoc


def main():
    canon, apoc = book_maps()

    bible = sqlite3.connect(str(BIBLE_DB))  # read only: nothing here writes
    canon_verses = set(
        bible.execute(
            "SELECT b.name, v.chapter, v.verse FROM verses v JOIN books b ON b.id = v.book_id "
            "JOIN versions ver ON ver.id = v.version_id WHERE ver.code = 'KJV'"
        )
    )
    library = sqlite3.connect(str(LIBRARY_DB))
    apoc_verses = set(library.execute("SELECT book, chapter, verse FROM lib_verses WHERE module = ?", (APOCRYPHA_MODULE,)))
    apoc_names = set(apoc.values())
    if not any(b in apoc_names for b, _, _ in apoc_verses):
        raise SystemExit(f"{APOCRYPHA_MODULE} with the Apocrypha must be installed in the app's Library first")

    def exists(name, chapter, verse, is_apoc):
        pool = apoc_verses if is_apoc else canon_verses
        return (name, chapter, verse if verse is not None else 1) in pool

    links = collections.OrderedDict()  # (from, to) -> set(sources)
    stats = collections.Counter()
    for line in NOTES.read_text(encoding="utf-8").splitlines():
        module, _vers, book, chapter, verse, note = line.split("\t", 5)
        if module not in SOURCES:
            continue
        if module in CROSS_REF_ONLY and 'type="crossReference"' not in note:
            continue
        # Swe1917 keeps a chapter's notes together at its end; each note starts with the
        # verse it belongs to ("7.") in an x-origin reference
        own = re.search(r'subType="x-origin"[^>]*>\s*(\d+)', note)
        if own:
            verse = own.group(1)
        origin = parse_osis(f"{book}.{chapter}.{verse}", canon, apoc)
        if not origin or origin[2] in (None, 0):
            continue
        for m in re.finditer(r"<reference\b([^>]*)>", note):
            attrs = m.group(1)
            if 'type="source"' in attrs or "x-origin" in attrs:
                continue
            o = re.search(r'osisRef="([^"]*)"', attrs)
            for target_ref in (o.group(1).split() if o else []):
                target = parse_osis(target_ref, canon, apoc)
                if not target:
                    stats["unparsed target"] += 1
                    continue
                if not origin[4] and not target[4]:
                    continue  # both in the 66 books: the app's main data covers those
                if origin[:3] == target[:3]:
                    continue
                if not exists(*origin[:3], origin[4]):
                    stats[f"dropped: no such verse (from) [{module}]"] += 1
                    continue
                if not exists(*target[:3], target[4]) or (target[3] and not exists(target[0], target[1], target[3], target[4])):
                    stats[f"dropped: no such verse (to) [{module}]"] += 1
                    continue
                key = (origin[:3], target[:4])
                links.setdefault(key, set()).add(module)
                stats[f"kept [{module}]"] += 1

    order = {name: i for i, name in enumerate(list(canon.values()) + list(apoc.values()))}
    rows = []
    for (frm, to), sources in links.items():
        rows.append(
            {
                "from": [frm[0], frm[1], frm[2]],
                "to": [to[0], to[1], to[2], to[3]],
                "sources": sorted(sources, key=list(SOURCES).index),
            }
        )
    rows.sort(key=lambda r: (order[r["from"][0]], r["from"][1], r["from"][2], order[r["to"][0]], r["to"][1], r["to"][2] or 0))
    out = {
        "note": "Cross-references printed in public-domain Bibles that include the Apocrypha. Built by data-pipeline/build_apocrypha_xrefs.py.",
        "sources": SOURCES,
        "links": rows,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    kinds = collections.Counter()
    for r in rows:
        a, b = r["from"][0] in apoc_names, r["to"][0] in apoc_names
        kinds["Apocrypha -> 66 books" if a and not b else "66 books -> Apocrypha" if b and not a else "within the Apocrypha"] += 1
    print(f"{len(rows)} links -> {OUT} ({OUT.stat().st_size // 1024} KB)")
    for k, n in kinds.items():
        print(f"  {n:5} {k}")
    for k, n in sorted(stats.items()):
        print(f"  {n:5} {k}")
    by_book = collections.Counter(r["from"][0] for r in rows if r["from"][0] in apoc_names)
    print("  from each Apocrypha book:", dict(by_book))


if __name__ == "__main__":
    main()
