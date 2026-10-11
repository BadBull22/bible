"""Builds the phone app's database from the desktop app's bundled ones.

    python mobile/data/build_phone_db.py

Reads  src-tauri/resources/bible.db and study.db (never changes them) and writes
mobile/src-tauri/resources/phone.db.gz: the English translations with their full-text
index, the two topical Bibles' headings and references, the two Bible dictionaries, and
the best cross-references for each verse. Nothing else -- no Strong's tagging,
commentaries or search-by-meaning vectors -- which is what keeps the phone app small.

The database is built on local disk (SQLite's random writes are unreliable over the
network share the project lives on) and only the finished .gz is copied in.
"""
import gzip
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

# not resolve(): that turns the mapped drive into its network path, which SQLite cannot open by URI
ROOT = Path(os.path.abspath(__file__)).parents[2]
BIBLE = ROOT / "src-tauri" / "resources" / "bible.db"
STUDY = ROOT / "src-tauri" / "resources" / "study.db"
OUT = ROOT / "mobile" / "src-tauri" / "resources" / "phone.db.gz"

# Public-domain English translations already bundled with the desktop app.
VERSIONS = ["BSB", "KJV", "ASV", "WEB", "YLT"]
TOPICAL = ["nave", "torrey"]
# Public-domain Bible dictionaries, with their articles.
DICTIONARIES = ["easton", "smith"]
# Cross-references kept for each verse: the ones most readers agreed on.
XREFS_PER_VERSE = 12


def ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix="phone-db-"))
    db_path = work / "phone.db"
    out = sqlite3.connect(db_path)
    out.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA page_size = 4096;
        CREATE TABLE versions (id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, language TEXT NOT NULL,
            is_original_language INTEGER NOT NULL DEFAULT 0, license_note TEXT NOT NULL);
        CREATE TABLE books (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, testament TEXT NOT NULL, order_index INTEGER NOT NULL);
        CREATE TABLE verses (id INTEGER PRIMARY KEY, version_id INTEGER NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL,
            verse INTEGER NOT NULL, text TEXT NOT NULL, UNIQUE(version_id, book_id, chapter, verse));
        CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='id');
        CREATE TABLE dictionaries (code TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL);
        -- body: the article, for the dictionaries ('' for a topical heading, which is only its references)
        CREATE TABLE dict_entries (id INTEGER PRIMARY KEY, dict_code TEXT NOT NULL, headword TEXT NOT NULL, headword_fold TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '');
        CREATE TABLE xrefs (book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, rank INTEGER NOT NULL,
            to_book_id INTEGER NOT NULL, to_chapter INTEGER NOT NULL, to_verse INTEGER NOT NULL, to_verse_end INTEGER NOT NULL,
            PRIMARY KEY (book_id, chapter, verse, rank)) WITHOUT ROWID;
        CREATE TABLE dict_refs (entry_id INTEGER NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER, verse_end INTEGER);
        """
    )

    bible = ro(BIBLE)
    marks = ",".join("?" * len(VERSIONS))
    out.executemany("INSERT INTO versions VALUES (?,?,?,?,?,?)", bible.execute(f"SELECT * FROM versions WHERE code IN ({marks})", VERSIONS))
    out.executemany("INSERT INTO books VALUES (?,?,?,?)", bible.execute("SELECT * FROM books WHERE testament IN ('OT','NT')"))
    out.executemany(
        "INSERT INTO verses VALUES (?,?,?,?,?,?)",
        bible.execute(
            f"""SELECT v.id, v.version_id, v.book_id, v.chapter, v.verse, v.text FROM verses v
                JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
                WHERE ver.code IN ({marks}) AND b.testament IN ('OT','NT')
                ORDER BY v.version_id, b.order_index, v.chapter, v.verse""",
            VERSIONS,
        ),
    )
    out.execute("INSERT INTO verses_fts(verses_fts) VALUES ('rebuild')")
    out.execute("INSERT INTO verses_fts(verses_fts) VALUES ('optimize')")

    study = ro(STUDY)
    codes = ",".join("?" * len(TOPICAL))
    out.executemany("INSERT INTO dict_entries VALUES (?,?,?,?,'')", study.execute(f"SELECT id, dict_code, headword, headword_fold FROM dict_entries WHERE dict_code IN ({codes})", TOPICAL))
    dicts = ",".join("?" * len(DICTIONARIES))
    out.executemany("INSERT INTO dict_entries VALUES (?,?,?,?,?)", study.execute(f"SELECT id, dict_code, headword, headword_fold, body FROM dict_entries WHERE dict_code IN ({dicts})", DICTIONARIES))
    out.executemany("INSERT INTO dictionaries VALUES (?,?,?)", study.execute(f"SELECT code, name, kind FROM dictionaries WHERE code IN ({codes},{dicts})", TOPICAL + DICTIONARIES))

    # the best cross-references for each verse (by readers' votes), between canonical books
    out.executemany(
        "INSERT INTO xrefs VALUES (?,?,?,?,?,?,?,?)",
        bible.execute(
            """SELECT from_book_id, from_chapter, from_verse, n, to_book_id, to_chapter, to_verse_start, max(to_verse_end, to_verse_start) FROM (
                   SELECT c.*, row_number() OVER (PARTITION BY from_book_id, from_chapter, from_verse ORDER BY c.votes DESC, c.id) AS n
                   FROM cross_references c JOIN books a ON a.id = c.from_book_id JOIN books b ON b.id = c.to_book_id
                   WHERE c.votes > 0 AND a.testament IN ('OT','NT') AND b.testament IN ('OT','NT'))
               WHERE n <= ?""",
            (XREFS_PER_VERSE,),
        ),
    )
    out.executemany(
        "INSERT INTO dict_refs VALUES (?,?,?,?,?)",
        study.execute(f"SELECT entry_id, book, chapter, verse, verse_end FROM dict_refs WHERE entry_id IN (SELECT id FROM dict_entries WHERE dict_code IN ({codes}))", TOPICAL),
    )
    out.execute("CREATE INDEX dict_refs_entry ON dict_refs(entry_id)")
    out.execute("CREATE INDEX dict_entries_fold ON dict_entries(headword_fold)")
    out.commit()

    counts = {
        "versions": out.execute("SELECT count(*) FROM versions").fetchone()[0],
        "books": out.execute("SELECT count(*) FROM books").fetchone()[0],
        "verses": out.execute("SELECT count(*) FROM verses").fetchone()[0],
        "topics": out.execute("SELECT count(*) FROM dict_entries WHERE body = ''").fetchone()[0],
        "topic refs": out.execute("SELECT count(*) FROM dict_refs").fetchone()[0],
        "dictionary articles": out.execute("SELECT count(*) FROM dict_entries WHERE body <> ''").fetchone()[0],
        "cross-references": out.execute("SELECT count(*) FROM xrefs").fetchone()[0],
    }
    assert counts["versions"] == len(VERSIONS) and counts["books"] == 66, counts
    assert out.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    out.execute("VACUUM")
    out.close()

    gz = work / "phone.db.gz"
    with open(db_path, "rb") as src, gzip.open(gz, "wb", compresslevel=9) as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(gz, OUT)
    print(counts)
    print(f"phone.db {os.path.getsize(db_path) / 1048576:.1f} MB -> {OUT} {os.path.getsize(OUT) / 1048576:.1f} MB")
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
