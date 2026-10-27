"""Builds the phone app's "Original words" download: the Greek and Hebrew words of every verse, one by one.

    python mobile/data/build_original_pack.py

Reads  src-tauri/resources/study.db (never changes it) and writes
installer/packs/original-words-v1.zip: a zip with one SQLite file, `original.db`, holding
  words        every word of the Hebrew/Aramaic Old Testament and the Greek New Testament, in order,
               with its transliteration, English meaning, Strong's number, dictionary form and grammar code
  lemmas       the dictionary forms and what they mean
  morph_codes  what each grammar code says, in words
  meta         the version and the credit that must go with it

It is the desktop app's interlinear (STEPBible's TAHOT and TAGNT, CC BY 4.0, Tyndale House
Cambridge). The phone app downloads the zip once from its GitHub releases (release
`original-pack-v1`, file `original-words-v1.zip`), checks its SHA-256 and unpacks it
(`src-tauri/src/original_pack.rs`), exactly as it does for the Advanced search upgrade.
The numbers this prints (size and SHA-256) go into `original_pack.rs`.

The database is built on local disk (SQLite's random writes are unreliable over the network
share the project lives on) and only the finished zip is copied to installer/packs.
"""
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

# not resolve(): that turns the mapped drive into its network path, which SQLite cannot open by URI
ROOT = Path(os.path.abspath(__file__)).parents[2]
STUDY = ROOT / "src-tauri" / "resources" / "study.db"
OUT_DIR = ROOT / "installer" / "packs"
OUT = OUT_DIR / "original-words-v1.zip"

CREDIT = (
    "Word-by-word data: Translators Amalgamated Hebrew OT (TAHOT) and Greek NT (TAGNT) and the grammar-code "
    "explanations, from STEPBible.org, Tyndale House, Cambridge (github.com/STEPBible/STEPBible-Data), CC BY 4.0."
)

SCHEMA = """
-- `seq` counts the words of a verse in reading order (two words may share a position: a written and a read form),
-- so the table is its own index and takes no more room than the words
CREATE TABLE words (
    book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, seq INTEGER NOT NULL, pos INTEGER NOT NULL,
    type TEXT NOT NULL, original TEXT NOT NULL, translit TEXT NOT NULL, gloss TEXT NOT NULL,
    strongs TEXT NOT NULL, lemma_key TEXT NOT NULL, morph TEXT NOT NULL, editions INTEGER NOT NULL,
    PRIMARY KEY (book, chapter, verse, seq)) WITHOUT ROWID;
CREATE TABLE lemmas (key TEXT PRIMARY KEY, lemma TEXT NOT NULL, gloss TEXT NOT NULL);
CREATE TABLE morph_codes (code TEXT NOT NULL, lang TEXT NOT NULL, formal TEXT NOT NULL, short TEXT NOT NULL, PRIMARY KEY (code, lang));
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def main() -> None:
    if not STUDY.exists():
        sys.exit(f"Not found: {STUDY}")
    work = Path(tempfile.mkdtemp(prefix="original_pack_"))
    try:
        db = work / "original.db"
        con = sqlite3.connect(db)
        con.executescript(SCHEMA)
        # the desktop's database is opened read-only, so it is never changed
        src = sqlite3.connect(f"file:{STUDY.as_posix()}?mode=ro", uri=True)
        cur = con.cursor()
        rows = src.execute(
            "SELECT book, chapter, verse, word_pos, word_type, original, translit, gloss, strongs, lemma_key, morph, editions "
            "FROM interlinear ORDER BY book, chapter, verse, word_pos, id"
        )
        def numbered():
            last, seq = None, 0
            for r in rows:
                at = r[:3]
                seq = seq + 1 if at == last else 1
                last = at
                yield (*r[:3], seq, *r[3:])

        cur.executemany("INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", numbered())
        cur.executemany("INSERT INTO lemmas VALUES (?,?,?)", src.execute("SELECT key, lemma, gloss FROM lemmas"))
        cur.executemany("INSERT INTO morph_codes VALUES (?,?,?,?)", src.execute("SELECT code, lang, formal, short FROM morph_codes"))
        cur.executemany("INSERT INTO meta VALUES (?,?)", [("version", "1"), ("credit", CREDIT)])
        con.commit()
        n = con.execute("SELECT count(*) FROM words").fetchone()[0]
        heb = con.execute("SELECT count(*) FROM words WHERE strongs LIKE 'H%'").fetchone()[0]
        grk = con.execute("SELECT count(*) FROM words WHERE strongs LIKE 'G%'").fetchone()[0]
        con.execute("VACUUM")
        con.close()
        src.close()
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        tmp_zip = work / "original-words-v1.zip"
        with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            z.write(db, "original.db")
        shutil.copyfile(tmp_zip, OUT)
        sha = hashlib.sha256(OUT.read_bytes()).hexdigest()
        print(f"{OUT}")
        print(f"  {n:,} words ({heb:,} with a Hebrew number, {grk:,} with a Greek one)")
        print(f"  database {db.stat().st_size / 1e6:.1f} MB; zip {OUT.stat().st_size / 1e6:.1f} MB")
        print(f"  SHA256: {sha}")
        print(f"  SIZE_MB: {round(OUT.stat().st_size / 1e6)}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
