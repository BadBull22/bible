"""Add the Tyndale House Greek New Testament (THGNT, 2017) to bible.db as reading version
'THGNT', with per-word Strong's links like the existing TR.

The text is assembled from STEPBible's TAGNT (CC BY 4.0), which marks every word with the
editions that contain it; words marked 'Tyn' are the THGNT's, using the THGNT spelling
where TAGNT lists it as a variant. THGNT itself is licensed CC BY-SA 4.0 by Tyndale House.

This is a critical text (like NA28/SBLGNT), complementing the Textus Receptus already
bundled -- chosen over the SBLGNT because the SBLGNT is under its own EULA, not an open
license. Re-runnable: existing THGNT rows are replaced.

As with build_db.py, the database is modified on LOCAL disk and copied back afterwards
(SQLite random writes corrupt files over SMB -- HANDOVER gotcha #1).

    python add_thgnt.py      # requires build_study.py to have downloaded the TAGNT files
"""

import re
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_study import SRC, WORK, parse_tagnt, tyndale_spelling  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "src-tauri" / "resources" / "bible.db"
CODE = "THGNT"


def main():
    verses: dict[tuple, list] = {}
    order: list[tuple] = []
    for f in sorted(SRC.glob("TAGNT*.txt")):
        for w in parse_tagnt(f):
            if not w["book"]:
                continue
            eds = {e.strip() for e in re.split(r"[+\s]", w["editions"]) if e.strip()}
            if "Tyn" not in eds:
                continue
            key = (w["book"], w["ch"], w["v"])
            if key not in verses:
                verses[key] = []
                order.append(key)
            verses[key].append((w["pos"], tyndale_spelling(w), w["strongs"]))
    print("THGNT verses:", len(verses), "words:", sum(len(v) for v in verses.values()))

    local = WORK / "bible-thgnt.db"
    shutil.copyfile(DB, local)
    con = sqlite3.connect(local)
    books = {name: bid for bid, name in con.execute("SELECT id, name FROM books")}

    old = con.execute("SELECT id FROM versions WHERE code=?", (CODE,)).fetchone()
    if old:
        vid = old[0]
        ids = [r[0] for r in con.execute("SELECT id FROM verses WHERE version_id=?", (vid,))]
        con.executemany("INSERT INTO verses_fts(verses_fts, rowid, text) SELECT 'delete', id, text FROM verses WHERE id=?",
                        [(i,) for i in ids])
        con.execute("DELETE FROM strongs_links WHERE verse_id IN (SELECT id FROM verses WHERE version_id=?)", (vid,))
        con.execute("DELETE FROM verses WHERE version_id=?", (vid,))
        con.execute("DELETE FROM versions WHERE id=?", (vid,))
    cur = con.execute(
        "INSERT INTO versions (code, name, language, is_original_language, license_note) VALUES (?,?,?,?,?)",
        (CODE, "Tyndale House Greek New Testament (2017)", "Greek", 1,
         "CC BY-SA 4.0, Tyndale House, Cambridge; word data via STEPBible TAGNT (CC BY 4.0)"))
    vid = cur.lastrowid

    missing = 0
    for key in order:
        book, ch, v = key
        bid = books.get(book)
        if bid is None:
            missing += 1
            continue
        words = sorted(verses[key])
        text = " ".join(w for _, w, _ in words)
        vcur = con.execute("INSERT INTO verses (version_id, book_id, chapter, verse, text) VALUES (?,?,?,?,?)",
                           (vid, bid, ch, v, text))
        verse_id = vcur.lastrowid
        con.execute("INSERT INTO verses_fts(rowid, text) VALUES (?,?)", (verse_id, text))
        con.executemany(
            "INSERT INTO strongs_links (verse_id, word_order, surface_text, strongs_number) VALUES (?,?,?,?)",
            [(verse_id, i, re.sub(r"[^\wͰ-Ͽἀ-῿]", "", w), s)
             for i, (_, w, s) in enumerate(words) if s])
    con.commit()
    ok = con.execute("PRAGMA integrity_check").fetchone()[0]
    n = con.execute("SELECT COUNT(*) FROM verses WHERE version_id=?", (vid,)).fetchone()[0]
    sample = con.execute(
        "SELECT v.text FROM verses v JOIN books b ON b.id=v.book_id WHERE v.version_id=? AND b.name='John' AND v.chapter=3 AND v.verse=16",
        (vid,)).fetchone()
    con.close()
    print("verses inserted:", n, "| unmapped books:", missing, "| integrity:", ok)
    print("John 3:16:", sample[0] if sample else None)
    if ok != "ok":
        raise SystemExit("integrity check failed; bible.db NOT replaced")
    backup = WORK / "bible.db.before-thgnt"
    if not backup.exists():
        shutil.copyfile(DB, backup)
    shutil.copyfile(local, DB)
    print(f"bible.db updated ({DB.stat().st_size / 1e6:.1f} MB); original backed up to {backup}")


if __name__ == "__main__":
    main()
