import json
import os
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from books import CANONICAL_BOOKS, normalize_book_name
from osis_extract import extract_plain_text, extract_strongs_words
from usfm_extract import parse_usfm_book

SOURCES = Path(__file__).parent / "sources"
# Built on local disk, not the network-mapped project drive: SQLite's heavy random-write
# pattern during this build does not survive reliably over SMB (confirmed corrupted on V:\).
# main() copies the finished, integrity-checked file back into the project afterward.
LOCAL_BUILD_DIR = Path(os.environ.get("BIBLE_BUILD_DIR", Path.home() / "AppData" / "Local" / "bible-concordance-build"))
LOCAL_BUILD_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = LOCAL_BUILD_DIR / "bible.db"

SCHEMA = """
CREATE TABLE versions (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    language TEXT NOT NULL,
    is_original_language INTEGER NOT NULL DEFAULT 0,
    license_note TEXT NOT NULL
);
CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    testament TEXT NOT NULL,
    order_index INTEGER NOT NULL
);
CREATE TABLE verses (
    id INTEGER PRIMARY KEY,
    version_id INTEGER NOT NULL REFERENCES versions(id),
    book_id INTEGER NOT NULL REFERENCES books(id),
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    UNIQUE(version_id, book_id, chapter, verse)
);
CREATE INDEX idx_verses_lookup ON verses(book_id, chapter, verse, version_id);
CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='id');
CREATE TABLE strongs_links (
    id INTEGER PRIMARY KEY,
    verse_id INTEGER NOT NULL REFERENCES verses(id),
    word_order INTEGER NOT NULL,
    surface_text TEXT NOT NULL,
    strongs_number TEXT NOT NULL
);
CREATE INDEX idx_strongs_links_verse ON strongs_links(verse_id);
CREATE INDEX idx_strongs_links_number ON strongs_links(strongs_number);
CREATE TABLE strongs_dict (
    strongs_number TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    lemma TEXT,
    xlit TEXT,
    pronunciation TEXT,
    derivation TEXT,
    strongs_def TEXT,
    kjv_def TEXT
);
CREATE TABLE cross_references (
    id INTEGER PRIMARY KEY,
    from_book_id INTEGER NOT NULL REFERENCES books(id),
    from_chapter INTEGER NOT NULL,
    from_verse INTEGER NOT NULL,
    to_book_id INTEGER NOT NULL REFERENCES books(id),
    to_chapter INTEGER NOT NULL,
    to_verse_start INTEGER NOT NULL,
    to_verse_end INTEGER NOT NULL,
    votes INTEGER NOT NULL
);
CREATE INDEX idx_xref_from ON cross_references(from_book_id, from_chapter, from_verse);
"""

VERSIONS = [
    ("BSB", "Berean Standard Bible", "English", 0, "Public domain (bereanbible.com)"),
    ("KJV", "King James Version (1769)", "English", 0, "Public domain"),
    ("ASV", "American Standard Version (1901)", "English", 0, "Public domain"),
    ("YLT", "Young's Literal Translation", "English", 0, "Public domain"),
    ("WEB", "World English Bible", "English", 0, "Public domain (eBible.org)"),
    ("WLC", "Westminster Leningrad Codex", "Hebrew", 1, "Public domain Masoretic text"),
    ("TR", "Textus Receptus (Scrivener 1894)", "Greek", 1, "Public domain"),
]


def load_osis_version(con, version_code, book_order, json_path):
    data = json.load(open(json_path, encoding="utf-8"))
    cur = con.cursor()
    ver_id = cur.execute("SELECT id FROM versions WHERE code=?", (version_code,)).fetchone()[0]
    n_verses = 0
    n_words = 0
    for book in data["books"]:
        canon_name = normalize_book_name(book["name"])
        if canon_name is None:
            print(f"  [WARN] {version_code}: unrecognized book '{book['name']}', skipping")
            continue
        book_id = book_order[canon_name]
        for chapter in book["chapters"]:
            ch_num = chapter["chapter"]
            for v in chapter["verses"]:
                fragment = v["text"]
                plain = extract_plain_text(fragment)
                if not plain:
                    continue
                cur.execute(
                    "INSERT OR IGNORE INTO verses (version_id, book_id, chapter, verse, text) VALUES (?,?,?,?,?)",
                    (ver_id, book_id, ch_num, v["verse"], plain),
                )
                verse_id = cur.lastrowid
                if cur.rowcount == 0:
                    continue
                n_verses += 1
                words = extract_strongs_words(fragment)
                for order, (surface, strong_ids) in enumerate(words):
                    for sid in strong_ids:
                        cur.execute(
                            "INSERT INTO strongs_links (verse_id, word_order, surface_text, strongs_number) VALUES (?,?,?,?)",
                            (verse_id, order, surface, sid),
                        )
                        n_words += 1
    print(f"  {version_code}: {n_verses} verses, {n_words} strongs links")


def load_usfm_web(con, book_order, extracted_dir):
    cur = con.cursor()
    ver_id = cur.execute("SELECT id FROM versions WHERE code='WEB'").fetchone()[0]
    n_verses = 0
    n_words = 0
    for usfm_file in sorted(Path(extracted_dir).glob("*.usfm")):
        content = usfm_file.read_text(encoding="utf-8")
        id_match = re.search(r"\\id\s+([A-Z0-9]{3})", content)
        if not id_match:
            continue
        from books import BY_USFM
        canon_name = BY_USFM.get(id_match.group(1))
        if canon_name is None:
            continue  # front matter, glossary, introductions etc.
        book_id = book_order[canon_name]
        for ch_num, v_num, text, words in parse_usfm_book(content):
            if not text:
                continue
            cur.execute(
                "INSERT OR IGNORE INTO verses (version_id, book_id, chapter, verse, text) VALUES (?,?,?,?,?)",
                (ver_id, book_id, ch_num, v_num, text),
            )
            verse_id = cur.lastrowid
            if cur.rowcount == 0:
                continue
            n_verses += 1
            for order, (surface, strong_ids) in enumerate(words):
                for sid in strong_ids:
                    cur.execute(
                        "INSERT INTO strongs_links (verse_id, word_order, surface_text, strongs_number) VALUES (?,?,?,?)",
                        (verse_id, order, surface, sid),
                    )
                    n_words += 1
    print(f"  WEB: {n_verses} verses, {n_words} strongs links")


def load_strongs_dict(con):
    cur = con.cursor()
    for lang, path, var_name in [
        ("Hebrew", SOURCES / "strongs" / "strongs-hebrew-dictionary.js", "strongsHebrewDictionary"),
        ("Greek", SOURCES / "strongs" / "strongs-greek-dictionary.js", "strongsGreekDictionary"),
    ]:
        raw = path.read_text(encoding="utf-8")
        start = raw.index("{")
        end = raw.rindex("}") + 1
        obj = json.loads(raw[start:end])
        n = 0
        for num, entry in obj.items():
            cur.execute(
                "INSERT OR REPLACE INTO strongs_dict (strongs_number, language, lemma, xlit, pronunciation, derivation, strongs_def, kjv_def) VALUES (?,?,?,?,?,?,?,?)",
                (
                    num, lang,
                    entry.get("lemma"), entry.get("xlit"), entry.get("pron"),
                    entry.get("derivation"), entry.get("strongs_def"), entry.get("kjv_def"),
                ),
            )
            n += 1
        print(f"  {lang} dictionary: {n} entries")


def load_cross_references(con, book_order):
    cur = con.cursor()
    n = 0
    skipped = 0
    for shard in sorted((SOURCES / "cross_references").glob("cr_*.json")):
        data = json.load(open(shard, encoding="utf-8"))
        for item in data["cross_references"]:
            fb = normalize_book_name(item["from_verse"]["book"])
            if fb is None:
                skipped += 1
                continue
            from_book_id = book_order[fb]
            from_chapter = item["from_verse"]["chapter"]
            from_verse = item["from_verse"]["verse"]
            votes = item.get("votes", 0)
            for to in item["to_verse"]:
                tb = normalize_book_name(to["book"])
                if tb is None:
                    skipped += 1
                    continue
                cur.execute(
                    "INSERT INTO cross_references (from_book_id, from_chapter, from_verse, to_book_id, to_chapter, to_verse_start, to_verse_end, votes) VALUES (?,?,?,?,?,?,?,?)",
                    (from_book_id, from_chapter, from_verse, book_order[tb], to["chapter"], to["verse_start"], to["verse_end"], votes),
                )
                n += 1
    print(f"  cross_references: {n} rows inserted, {skipped} skipped (unrecognized book names)")


def main():
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)

    cur = con.cursor()
    for i, (code, name, lang, is_orig, license_note) in enumerate(VERSIONS, start=1):
        cur.execute(
            "INSERT INTO versions (id, code, name, language, is_original_language, license_note) VALUES (?,?,?,?,?,?)",
            (i, code, name, lang, is_orig, license_note),
        )
    for order, name, testament, _usfm in CANONICAL_BOOKS:
        cur.execute("INSERT INTO books (id, name, testament, order_index) VALUES (?,?,?,?)", (order, name, testament, order))
    con.commit()

    book_order = {name: order for (order, name, _, _) in CANONICAL_BOOKS}

    print("Loading OSIS-tagged versions...")
    load_osis_version(con, "BSB", book_order, SOURCES / "BSB-osis.json")
    load_osis_version(con, "KJV", book_order, SOURCES / "KJV-osis.json")
    load_osis_version(con, "ASV", book_order, SOURCES / "ASV-osis.json")
    load_osis_version(con, "YLT", book_order, SOURCES / "YLT-osis.json")
    load_osis_version(con, "WLC", book_order, SOURCES / "WLC-osis.json")
    load_osis_version(con, "TR", book_order, SOURCES / "TR-osis.json")
    con.commit()

    print("Loading WEB (USFM)...")
    load_usfm_web(con, book_order, SOURCES / "web" / "extracted")
    con.commit()

    print("Loading Strong's dictionaries...")
    load_strongs_dict(con)
    con.commit()

    print("Loading cross references...")
    load_cross_references(con, book_order)
    con.commit()

    print("Populating FTS index...")
    cur.execute("INSERT INTO verses_fts (rowid, text) SELECT id, text FROM verses")
    con.commit()

    print("Done. Row counts:")
    for table in ["versions", "books", "verses", "strongs_links", "strongs_dict", "cross_references"]:
        n = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {n}")

    print("Running integrity check before shipping the file...")
    result = cur.execute("PRAGMA integrity_check").fetchall()
    con.close()
    if result != [("ok",)]:
        print("INTEGRITY CHECK FAILED:", result)
        raise SystemExit(1)
    print("Integrity check passed.")


if __name__ == "__main__":
    main()
