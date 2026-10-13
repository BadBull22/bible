"""Builds the phone app's database from the desktop app's bundled ones.

    python mobile/data/build_phone_db.py

Reads  src-tauri/resources/bible.db and study.db (never changes them) and writes
mobile/src-tauri/resources/phone.db.gz: the English translations with their full-text
index, the two topical Bibles' headings and references, the two Bible dictionaries, and
the best cross-references for each verse, and which words are the words of Jesus (from
src/redLetter.json, the desktop app's red-letter data). Since 0.3.0 also: Strong's numbers
for the BSB and KJV words with the Strong's dictionary, and one small commentary (the
Tyndale Open Study Notes, with its book introductions, from commentaries.db). Nothing else
-- no other translations' tagging, other commentaries or search-by-meaning vectors -- which
is what keeps the phone app small.

The database is built on local disk (SQLite's random writes are unreliable over the
network share the project lives on) and only the finished .gz is copied in.
"""
import gzip
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import zlib
from pathlib import Path

# not resolve(): that turns the mapped drive into its network path, which SQLite cannot open by URI
ROOT = Path(os.path.abspath(__file__)).parents[2]
BIBLE = ROOT / "src-tauri" / "resources" / "bible.db"
STUDY = ROOT / "src-tauri" / "resources" / "study.db"
RED = ROOT / "src" / "redLetter.json"
COMMENTARIES = ROOT / "src-tauri" / "resources" / "commentaries.db"
OUT = ROOT / "mobile" / "src-tauri" / "resources" / "phone.db.gz"

# Public-domain English translations already bundled with the desktop app.
VERSIONS = ["BSB", "KJV", "ASV", "WEB", "YLT"]
TOPICAL = ["nave", "torrey"]
# Public-domain Bible dictionaries, with their articles.
DICTIONARIES = ["easton", "smith"]
# Cross-references kept for each verse: the ones most readers agreed on.
XREFS_PER_VERSE = 12
# Translations whose words carry Strong's numbers on the phone (the others' tagging is large).
TAGGED = ["BSB", "KJV"]
# The commentary: short, modern notes (CC BY-SA 4.0, attributed in the app).
COMMENTARY = "tyndale"


def tidy(text: str) -> str:
    """The stored text has spaces left by the way it was put together, as in `“ Let there be
    light, ”`. No space after an opening quote or bracket, none before a closing one or before
    punctuation -- what the desktop app does when it shows a verse (tidyPunctuation in
    src/verseSegments.ts). The words, and so the red-letter word ranges, are unchanged."""
    text = re.sub(r"([“‘(\[]) +", r"\1", text)
    text = re.sub(r" +([”’)\]])", r"\1", text)
    return re.sub(r" +([,.;:!?])", r"\1", text)


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
        -- the words of Jesus in a verse: inclusive [first, last] word ranges as JSON, counting words
        -- (runs of letters and digits) in the verse's text, as the desktop app's red-letter data does
        CREATE TABLE red_letter (version_id INTEGER NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
            ranges TEXT NOT NULL, PRIMARY KEY (version_id, book_id, chapter, verse)) WITHOUT ROWID;
        CREATE TABLE xrefs (book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, rank INTEGER NOT NULL,
            to_book_id INTEGER NOT NULL, to_chapter INTEGER NOT NULL, to_verse INTEGER NOT NULL, to_verse_end INTEGER NOT NULL,
            PRIMARY KEY (book_id, chapter, verse, rank)) WITHOUT ROWID;
        CREATE TABLE dict_refs (entry_id INTEGER NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER, verse_end INTEGER);
        -- a verse's words with their Strong's numbers, in order: JSON [[surface, "H1 H2"], ...]
        -- (one surface word can carry several numbers; untranslated particles are left out)
        CREATE TABLE strongs_words (version_id INTEGER NOT NULL, book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
            words TEXT NOT NULL, PRIMARY KEY (version_id, book_id, chapter, verse)) WITHOUT ROWID;
        CREATE TABLE strongs_dict (strongs_number TEXT PRIMARY KEY, language TEXT NOT NULL, lemma TEXT, xlit TEXT, pronunciation TEXT,
            derivation TEXT, strongs_def TEXT, kjv_def TEXT) WITHOUT ROWID;
        -- how often a number occurs in a tagged translation: in how many verses, how many times
        CREATE TABLE strongs_counts (strongs_number TEXT NOT NULL, version_id INTEGER NOT NULL, verses INTEGER NOT NULL, occurrences INTEGER NOT NULL,
            PRIMARY KEY (strongs_number, version_id)) WITHOUT ROWID;
        -- the commentary: a note covers its verse_start up to the next note's
        CREATE TABLE notes (book_id INTEGER NOT NULL, chapter INTEGER NOT NULL, verse_start INTEGER NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL,
            PRIMARY KEY (book_id, chapter, verse_start, seq)) WITHOUT ROWID;
        CREATE TABLE book_intros (book_id INTEGER PRIMARY KEY, text TEXT NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """
    )

    bible = ro(BIBLE)
    marks = ",".join("?" * len(VERSIONS))
    out.executemany("INSERT INTO versions VALUES (?,?,?,?,?,?)", bible.execute(f"SELECT * FROM versions WHERE code IN ({marks})", VERSIONS))
    out.executemany("INSERT INTO books VALUES (?,?,?,?)", bible.execute("SELECT * FROM books WHERE testament IN ('OT','NT')"))
    out.executemany(
        "INSERT INTO verses VALUES (?,?,?,?,?,?)",
        (
            (*row[:5], tidy(row[5]))
            for row in bible.execute(
            f"""SELECT v.id, v.version_id, v.book_id, v.chapter, v.verse, v.text FROM verses v
                JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
                WHERE ver.code IN ({marks}) AND b.testament IN ('OT','NT')
                ORDER BY v.version_id, b.order_index, v.chapter, v.verse""",
            VERSIONS,
            )
        ),
    )
    out.execute("INSERT INTO verses_fts(verses_fts) VALUES ('rebuild')")
    out.execute("INSERT INTO verses_fts(verses_fts) VALUES ('optimize')")

    red = json.loads(RED.read_text(encoding="utf-8"))
    version_ids = dict(out.execute("SELECT code, id FROM versions"))
    book_ids = dict(out.execute("SELECT name, id FROM books"))
    out.executemany(
        "INSERT INTO red_letter VALUES (?,?,?,?,?)",
        (
            (version_ids[code], book_ids[book], int(chapter), int(verse), json.dumps(ranges, separators=(",", ":")))
            for code in VERSIONS
            for book, chapters in red.get(code, {}).items()
            if book in book_ids
            for chapter, verses in chapters.items()
            for verse, ranges in verses.items()
        ),
    )

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
    # Strong's: the words of the tagged translations, grouped per verse as the desktop app groups
    # them (consecutive rows with one word_order are one surface word with several numbers)
    tagged = ",".join("?" * len(TAGGED))
    rows = bible.execute(
        f"""SELECT v.version_id, v.book_id, v.chapter, v.verse, s.word_order, s.surface_text, s.strongs_number
            FROM strongs_links s JOIN verses v ON v.id = s.verse_id JOIN versions ver ON ver.id = v.version_id
            JOIN books b ON b.id = v.book_id
            WHERE ver.code IN ({tagged}) AND b.testament IN ('OT','NT')
            ORDER BY v.id, s.word_order, s.id""",
        TAGGED,
    )
    per_verse: dict = {}
    counts: dict = {}
    for version_id, book_id, chapter, verse, order, surface, number in rows:
        words = per_verse.setdefault((version_id, book_id, chapter, verse), [])
        if words and words[-1][0] == order:
            words[-1][2].append(number)
        else:
            words.append([order, surface.strip(), [number]])
        c = counts.setdefault((number, version_id), [set(), 0])
        c[0].add((book_id, chapter, verse))
        c[1] += 1
    out.executemany(
        "INSERT INTO strongs_words VALUES (?,?,?,?,?)",
        (
            (*key, json.dumps([[w[1], " ".join(w[2])] for w in words if w[1]], ensure_ascii=False, separators=(",", ":")))
            for key, words in per_verse.items()
        ),
    )
    out.executemany("INSERT INTO strongs_counts VALUES (?,?,?,?)", ((n, v, len(c[0]), c[1]) for (n, v), c in counts.items()))
    out.executemany(
        "INSERT INTO strongs_dict VALUES (?,?,?,?,?,?,?,?)",
        bible.execute("SELECT strongs_number, language, lemma, xlit, pronunciation, derivation, strongs_def, kjv_def FROM strongs_dict"),
    )

    # the commentary and its book introductions (stored zlib-compressed in the desktop database)
    comm = ro(COMMENTARIES)
    seq: dict = {}
    note_rows = []
    for book, chapter, verse_start, blob in comm.execute(
        "SELECT book, chapter, verse_start, text_gz FROM commentary_sections WHERE commentary_id = ? ORDER BY book_order, chapter, verse_start, id",
        (COMMENTARY,),
    ):
        if book not in book_ids:
            continue
        key = (book_ids[book], chapter, verse_start)
        seq[key] = seq.get(key, 0) + 1
        note_rows.append((*key, seq[key], zlib.decompress(blob).decode("utf-8").strip()))
    out.executemany("INSERT INTO notes VALUES (?,?,?,?,?)", note_rows)
    out.executemany(
        "INSERT INTO book_intros VALUES (?,?)",
        (
            (book_ids[book], zlib.decompress(blob).decode("utf-8").strip())
            for book, blob in comm.execute(
                "SELECT book, introduction_gz FROM commentary_books WHERE commentary_id = ? AND introduction_gz IS NOT NULL", (COMMENTARY,)
            )
            if book in book_ids
        ),
    )
    name, licence, licence_url, website = comm.execute(
        "SELECT name, license_name, license_url, website FROM commentaries WHERE id = ?", (COMMENTARY,)
    ).fetchone()
    out.executemany(
        "INSERT INTO meta VALUES (?,?)",
        [("commentary_name", name), ("commentary_licence", licence), ("commentary_licence_url", licence_url or ""), ("commentary_website", website or "")],
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
        "verses with words of Jesus": out.execute("SELECT count(*) FROM red_letter").fetchone()[0],
        "tagged verses": out.execute("SELECT count(*) FROM strongs_words").fetchone()[0],
        "strong's entries": out.execute("SELECT count(*) FROM strongs_dict").fetchone()[0],
        "commentary notes": out.execute("SELECT count(*) FROM notes").fetchone()[0],
        "book introductions": out.execute("SELECT count(*) FROM book_intros").fetchone()[0],
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
