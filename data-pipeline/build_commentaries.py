"""Downloads the public-domain / CC-licensed commentaries and the Theographic people/places/
events dataset from the Free Use Bible API (bible.helloao.org, AO Lab) and builds
`commentaries.db` for offline bundling alongside bible.db.

Rerunnable: raw JSON is cached under LOCAL_BUILD_DIR/helloao-cache so a rerun only fetches
what is missing. Like build_db.py, the SQLite file is written to LOCAL disk (never the
network-share checkout -- see HANDOVER.md gotcha #1) and copied into src-tauri/resources/
only after PRAGMA integrity_check passes.

Usage:  python build_commentaries.py            (download + build + copy)
        python build_commentaries.py --no-copy  (build only)
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from books import BY_USFM, CANONICAL_BOOKS

BASE = "https://bible.helloao.org"
LOCAL_BUILD_DIR = Path(os.environ.get("BIBLE_BUILD_DIR", Path.home() / "AppData" / "Local" / "bible-concordance-build"))
CACHE = LOCAL_BUILD_DIR / "helloao-cache"
DB_PATH = LOCAL_BUILD_DIR / "commentaries.db"
TARGET = Path(__file__).parent.parent / "src-tauri" / "resources" / "commentaries.db"
WORKERS = 12

BOOK_ORDER = {name: order for (order, name, _, _) in CANONICAL_BOOKS}

# Python 3.13+ enables OpenSSL's X509_STRICT checks by default, which reject helloao's CA
# chain ("Basic Constraints of CA cert not marked critical") even though browsers and curl
# accept it. Certificate verification itself stays on; only the strict-profile flag is off.
SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.verify_flags &= ~ssl.VERIFY_X509_STRICT

SCHEMA = """
CREATE TABLE commentaries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT,
    license_url TEXT,
    license_name TEXT,
    sort_order INTEGER NOT NULL
);
CREATE TABLE commentary_books (
    commentary_id TEXT NOT NULL,
    book TEXT NOT NULL,
    book_order INTEGER NOT NULL,
    introduction_gz BLOB,
    PRIMARY KEY (commentary_id, book)
);
CREATE TABLE commentary_chapters (
    commentary_id TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    introduction_gz BLOB,
    PRIMARY KEY (commentary_id, book, chapter)
);
-- One row per commentary section; verse_start is the first verse the section covers
-- (sections usually span a verse range; the next section's verse_start ends it).
CREATE TABLE commentary_sections (
    id INTEGER PRIMARY KEY,
    commentary_id TEXT NOT NULL,
    book TEXT NOT NULL,
    book_order INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    verse_start INTEGER NOT NULL,
    text_gz BLOB NOT NULL
);
CREATE INDEX idx_sections_lookup ON commentary_sections(commentary_id, book, chapter, verse_start);
-- Contentless FTS index over section text: hits give section ids, the app decompresses
-- the section for display, so the (large) text is stored only once, compressed.
CREATE VIRTUAL TABLE commentary_fts USING fts5(text, content='');

CREATE TABLE entities (
    kind TEXT NOT NULL,            -- 'person' | 'place' | 'event'
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    gender TEXT,
    birth_year INTEGER,
    death_year INTEGER,
    feature_type TEXT,
    latitude REAL,
    longitude REAL,
    start_date TEXT,
    relations_json TEXT,           -- father/mother/children/partners/locations/participants...
    reference_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, id)
);
CREATE TABLE entity_refs (
    kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    book TEXT NOT NULL,
    book_order INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    end_verse INTEGER
);
CREATE INDEX idx_entity_refs_chapter ON entity_refs(book, chapter);
CREATE INDEX idx_entity_refs_entity ON entity_refs(kind, entity_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""

LICENSE_NAMES = {
    "https://creativecommons.org/publicdomain/mark/1.0/": "Public domain (CC Public Domain Mark 1.0)",
    "https://creativecommons.org/licenses/by-sa/4.0/": "CC BY-SA 4.0",
    "https://creativecommons.org/licenses/by/4.0/": "CC BY 4.0",
}


def fetch_json(path: str, retries: int = 4) -> dict | list:
    """GET BASE+path, cached as a file under CACHE (path mirrored)."""
    local = CACHE / path.lstrip("/")
    if local.exists() and local.stat().st_size > 0:
        with local.open("rb") as f:
            return json.loads(f.read().decode("utf-8"))
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(BASE + path, headers={"User-Agent": "bible-concordance-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=60, context=SSL_CONTEXT) as resp:
                data = resp.read()
            parsed = json.loads(data.decode("utf-8"))
            local.parent.mkdir(parents=True, exist_ok=True)
            tmp = local.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(local)
            return parsed
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
            if isinstance(e, urllib.error.HTTPError) and e.code == 404:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed {path}: {last_err}")


def download_all(paths: list[str], label: str) -> dict[str, object]:
    out: dict[str, object] = {}
    failed: list[str] = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_json, p): p for p in paths}
        done = 0
        for fut in as_completed(futures):
            p = futures[fut]
            try:
                out[p] = fut.result()
            except Exception as e:  # noqa: BLE001
                failed.append(p)
                print(f"  ! {p}: {e}")
            done += 1
            if done % 250 == 0 or done == len(paths):
                print(f"  {label}: {done}/{len(paths)} ({time.time()-t0:.0f}s)", flush=True)
    if failed:
        print(f"  {label}: {len(failed)} failed")
    return out


def gz(text: str | None) -> bytes | None:
    if not text:
        return None
    return zlib.compress(text.encode("utf-8"), 9)


def join_content(parts) -> str:
    """Commentary content arrays hold strings (occasionally nested objects); flatten to text."""
    out = []
    for p in parts or []:
        if isinstance(p, str):
            out.append(p.strip())
        elif isinstance(p, dict):
            if "text" in p:
                out.append(str(p["text"]).strip())
            elif "content" in p:
                out.append(join_content(p["content"]))
    return "\n\n".join(x for x in out if x)


def build_commentaries(cur: sqlite3.Cursor) -> None:
    listing = fetch_json("/api/available_commentaries.json")
    commentaries = listing["commentaries"] if isinstance(listing, dict) else listing
    print(f"{len(commentaries)} commentaries listed")

    chapter_paths: list[str] = []
    per_commentary_books: dict[str, list[dict]] = {}
    for order, c in enumerate(commentaries):
        cid = c["id"]
        books = fetch_json(f"/api/c/{cid}/books.json")["books"]
        canon_books = [b for b in books if b["id"] in BY_USFM]
        per_commentary_books[cid] = canon_books
        cur.execute(
            "INSERT INTO commentaries (id, name, website, license_url, license_name, sort_order) VALUES (?,?,?,?,?,?)",
            (cid, c["name"], c.get("website"), c.get("licenseUrl"), LICENSE_NAMES.get(c.get("licenseUrl") or "", c.get("licenseUrl")), order),
        )
        for b in canon_books:
            name = BY_USFM[b["id"]]
            cur.execute(
                "INSERT INTO commentary_books (commentary_id, book, book_order, introduction_gz) VALUES (?,?,?,?)",
                (cid, name, BOOK_ORDER[name], gz(b.get("introduction"))),
            )
            for ch in range(int(b.get("firstChapterNumber") or 1), int(b["numberOfChapters"]) + 1):
                chapter_paths.append(f"/api/c/{cid}/{b['id']}/{ch}.json")
        print(f"  {cid}: {len(canon_books)} books")

    print(f"downloading {len(chapter_paths)} commentary chapters...")
    chapters = download_all(chapter_paths, "chapters")

    n_sections = 0
    raw_bytes = 0
    for path in chapter_paths:
        data = chapters.get(path)
        if not data:
            continue
        cid = data["commentary"]["id"]
        name = BY_USFM[data["book"]["id"]]
        ch = data["chapter"]
        chapter_num = int(ch["number"])
        cur.execute(
            "INSERT OR REPLACE INTO commentary_chapters (commentary_id, book, chapter, introduction_gz) VALUES (?,?,?,?)",
            (cid, name, chapter_num, gz(ch.get("introduction"))),
        )
        for node in ch.get("content", []):
            if node.get("type") != "verse":
                continue
            text = join_content(node.get("content"))
            if not text:
                continue
            raw_bytes += len(text.encode("utf-8"))
            cur.execute(
                "INSERT INTO commentary_sections (commentary_id, book, book_order, chapter, verse_start, text_gz) VALUES (?,?,?,?,?,?)",
                (cid, name, BOOK_ORDER[name], chapter_num, int(node.get("number") or 1), gz(text)),
            )
            cur.execute("INSERT INTO commentary_fts (rowid, text) VALUES (?, ?)", (cur.lastrowid, text))
            n_sections += 1
    print(f"  {n_sections} sections, {raw_bytes/1e6:.0f} MB of text before compression")


def build_entities(cur: sqlite3.Cursor) -> None:
    lists = {
        "person": ("/api/d/theographic/people.json", "people"),
        "place": ("/api/d/theographic/places.json", "places"),
        "event": ("/api/d/theographic/events.json", "events"),
    }
    detail_paths: dict[str, list[str]] = {}
    for kind, (path, key) in lists.items():
        items = fetch_json(path)[key]
        detail_paths[kind] = [i[f"this{ {'person':'Person','place':'Place','event':'Event'}[kind] }ApiLink"] for i in items]
        print(f"  {kind}: {len(items)} listed")
    all_paths = [p for ps in detail_paths.values() for p in ps]
    print(f"downloading {len(all_paths)} entity records...")
    details = download_all(all_paths, "entities")

    relation_keys = {
        "person": ["birthPlace", "deathPlace", "father", "mother", "partners", "children", "siblings", "memberOf", "events"],
        "place": [],
        "event": ["participants", "locations", "predecessor"],
    }
    n_refs = 0
    for kind, paths in detail_paths.items():
        wrapper_key = {"person": "person", "place": "place", "event": "event"}[kind]
        for p in paths:
            data = details.get(p)
            if not data:
                continue
            e = data[wrapper_key]
            relations = {}
            for k in relation_keys[kind]:
                v = e.get(k)
                if not v:
                    continue
                items = v if isinstance(v, list) else [v]
                relations[k] = [{"id": x.get("id"), "type": x.get("type"), "name": x.get("name")} for x in items if isinstance(x, dict)]
            refs = [r for r in (e.get("references") or []) if r.get("book") in BY_USFM]
            cur.execute(
                """INSERT OR REPLACE INTO entities (kind, id, name, description, gender, birth_year, death_year, feature_type,
                   latitude, longitude, start_date, relations_json, reference_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    kind, e["id"], e.get("name") or e["id"], "\n\n".join(e.get("description") or []) or None,
                    e.get("gender"), e.get("birthYear"), e.get("deathYear"),
                    " / ".join(x for x in [e.get("featureType"), e.get("featureSubType")] if x) or None,
                    e.get("latitude"), e.get("longitude"), e.get("startDate"),
                    json.dumps(relations) if relations else None, len(refs),
                ),
            )
            for r in refs:
                name = BY_USFM[r["book"]]
                cur.execute(
                    "INSERT INTO entity_refs (kind, entity_id, book, book_order, chapter, verse, end_verse) VALUES (?,?,?,?,?,?,?)",
                    (kind, e["id"], name, BOOK_ORDER[name], int(r["chapter"]), int(r["verse"]), r.get("endVerse")),
                )
                n_refs += 1
    print(f"  {n_refs} entity references")


def main() -> None:
    copy = "--no-copy" not in sys.argv
    LOCAL_BUILD_DIR.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    cur = con.cursor()
    t0 = time.time()

    print("== commentaries ==")
    build_commentaries(cur)
    con.commit()
    print("== entities ==")
    build_entities(cur)
    cur.execute("INSERT INTO meta VALUES ('source', 'Free Use Bible API (bible.helloao.org), AO Lab')")
    cur.execute("INSERT INTO meta VALUES ('built_at', ?)", (time.strftime("%Y-%m-%d"),))
    con.commit()
    print("optimizing...")
    cur.execute("INSERT INTO commentary_fts(commentary_fts) VALUES('optimize')")
    con.commit()
    con.execute("VACUUM")
    check = con.execute("PRAGMA integrity_check").fetchone()[0]
    print("integrity_check:", check)
    for t in ("commentaries", "commentary_sections", "entities", "entity_refs"):
        print(f"  {t}: {con.execute(f'SELECT count(*) FROM {t}').fetchone()[0]}")
    con.close()
    print(f"built {DB_PATH} ({DB_PATH.stat().st_size/1e6:.0f} MB) in {time.time()-t0:.0f}s")
    if check != "ok":
        sys.exit("integrity check failed; not copying")
    if copy:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DB_PATH, TARGET)
        print(f"copied to {TARGET}")


if __name__ == "__main__":
    main()
