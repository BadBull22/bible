"""Add public-domain commentaries from CrossWire SWORD modules to commentaries.db, alongside
the seven from the Free Use Bible API that build_commentaries.py imports:

  * John Wesley's Explanatory Notes on the Bible (1754-65) -- Wesleyan-Arminian: the new
    birth, holiness, a salvation that can be forfeited; the tradition the holiness and
    Pentecostal movements grew out of.
  * Scofield Reference Notes (1917) -- dispensational premillennialism and the pre-
    tribulation rapture, the end-times framework this app's answers lead with.

Both are public domain. Added to balance the bundled set, which otherwise leans Reformed
(Calvin, Gill, Matthew Henry). Re-runnable: existing rows for these ids are replaced.

Built on LOCAL disk and copied back (SQLite random writes corrupt files over SMB --
HANDOVER gotcha #1).

    python add_sword_commentaries.py
"""

import html
import re
import shutil
import sqlite3
import sys
import urllib.request
import zipfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from books import CANONICAL_BOOKS  # noqa: E402
from build_study import SRC, WORK  # noqa: E402
from sword_commentary import read_zcom  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BIBLE = ROOT / "src-tauri" / "resources" / "bible.db"
DB = ROOT / "src-tauri" / "resources" / "commentaries.db"
SWORD = "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/"
PD = "https://creativecommons.org/publicdomain/mark/1.0/"

MODULES = [
    # id, SWORD module, display name, website, sort_order
    ("john-wesley", "Wesley", "John Wesley's Explanatory Notes", "https://en.wikipedia.org/wiki/Explanatory_Notes_upon_the_New_Testament", 7),
    ("scofield", "Scofield", "Scofield Reference Notes (1917)", "https://en.wikisource.org/wiki/Scofield_Reference_Bible_Notes", 8),
]


def to_text(raw: str) -> str:
    """ThML / OSIS commentary markup -> the plain text the other commentaries are stored as."""
    s = raw.replace("\r", "")
    # Scofield: a bold lemma introduces each note ("caught up" -> "caught up — ...")
    s = re.sub(r'<hi type="bold">(.*?)</hi>', lambda m: f"{m.group(1).strip()} — ", s, flags=re.S)
    s = re.sub(r"<(?:div|chapter)[^>]*\beID=[^>]*/>", "\n", s)  # paragraph ends
    s = re.sub(r"<br\s*/?>|</p>|<p\b[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    s = re.sub(r"—\s*—", "—", s)
    return s.strip().rstrip("—").strip()


def gz(text: str) -> bytes:
    return zlib.compress(text.encode("utf-8"), 9)


def ensure_module(mod: str) -> Path:
    SRC.mkdir(parents=True, exist_ok=True)
    z = SRC / f"{mod}.zip"
    if not z.exists():
        print("download", z.name)
        urllib.request.urlretrieve(SWORD + z.name, z)
    d = SRC / f"sword-{mod}"
    if not d.exists():
        zipfile.ZipFile(z).extractall(d)
    return d


def main():
    bible = sqlite3.connect(BIBLE)
    chapter_verses: dict[str, list[int]] = {}
    for name, _ch, n in bible.execute(
        "SELECT b.name, v.chapter, MAX(v.verse) FROM verses v JOIN books b ON b.id=v.book_id "
        "JOIN versions ver ON ver.id=v.version_id WHERE ver.code='KJV' GROUP BY b.name, v.chapter ORDER BY b.order_index, v.chapter"
    ):
        chapter_verses.setdefault(name, []).append(n)
    order = {name: o for (o, name, _, _) in CANONICAL_BOOKS}
    ot = [n for (_, n, t, _) in CANONICAL_BOOKS if t == "OT"]
    nt = [n for (_, n, t, _) in CANONICAL_BOOKS if t == "NT"]

    local = WORK / "commentaries-sword.db"
    shutil.copyfile(DB, local)
    con = sqlite3.connect(local)

    for cid, mod, name, site, sort in MODULES:
        # remove a previous import, including its contentless-FTS entries (which can only
        # be deleted by re-supplying the original text)
        old = con.execute("SELECT id, text_gz FROM commentary_sections WHERE commentary_id=?", (cid,)).fetchall()
        for sid, blob in old:
            con.execute("INSERT INTO commentary_fts(commentary_fts, rowid, text) VALUES('delete', ?, ?)", (sid, zlib.decompress(blob).decode("utf-8")))
        for table in ("commentary_sections", "commentary_chapters", "commentary_books", "commentaries"):
            key = "id" if table == "commentaries" else "commentary_id"
            con.execute(f"DELETE FROM {table} WHERE {key}=?", (cid,))

        con.execute(
            "INSERT INTO commentaries (id, name, website, license_url, license_name, sort_order) VALUES (?,?,?,?,?,?)",
            (cid, name, site, PD, "Public domain (via CrossWire SWORD module)", sort),
        )
        books_seen = set()
        sections = chapters = intros = 0
        for book, ch, v, raw in read_zcom(ensure_module(mod), chapter_verses, ot, nt):
            text = to_text(raw)
            if not text:
                continue
            if book not in books_seen:
                con.execute("INSERT INTO commentary_books (commentary_id, book, book_order, introduction_gz) VALUES (?,?,?,NULL)",
                            (cid, book, order[book]))
                books_seen.add(book)
            if ch == 0:
                con.execute("UPDATE commentary_books SET introduction_gz=? WHERE commentary_id=? AND book=?", (gz(text), cid, book))
                intros += 1
            elif v == 0:
                con.execute("INSERT OR REPLACE INTO commentary_chapters (commentary_id, book, chapter, introduction_gz) VALUES (?,?,?,?)",
                            (cid, book, ch, gz(text)))
                chapters += 1
            else:
                cur = con.execute(
                    "INSERT INTO commentary_sections (commentary_id, book, book_order, chapter, verse_start, text_gz) VALUES (?,?,?,?,?,?)",
                    (cid, book, order[book], ch, v, gz(text)),
                )
                con.execute("INSERT INTO commentary_fts (rowid, text) VALUES (?, ?)", (cur.lastrowid, text))
                sections += 1
        print(f"{name:40} {len(books_seen):>3} books, {sections:>6,} notes, {chapters:>4} chapter intros, {intros:>3} book intros")

    con.commit()
    ok = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.execute("INSERT INTO commentary_fts(commentary_fts) VALUES('optimize')")
    con.commit()
    sample = con.execute(
        "SELECT commentary_id, text_gz FROM commentary_sections WHERE book='John' AND chapter=3 AND verse_start=7 AND commentary_id='john-wesley'"
    ).fetchone()
    con.close()
    print("integrity_check:", ok)
    if sample:
        print("Wesley on John 3:7:", zlib.decompress(sample[1]).decode()[:160])
    if ok != "ok":
        raise SystemExit("integrity check failed; commentaries.db NOT replaced")
    backup = WORK / "commentaries.db.before-sword"
    if not backup.exists():
        shutil.copyfile(DB, backup)
    shutil.copyfile(local, DB)
    print(f"commentaries.db updated ({DB.stat().st_size / 1e6:.1f} MB); original backed up to {backup}")


if __name__ == "__main__":
    main()
