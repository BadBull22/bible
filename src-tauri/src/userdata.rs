//! The reader's own study data: bookmarks, highlights, verse notes and reading-plan
//! progress, in `userdata.db` inside the app's data directory (per-user, on local disk,
//! outside the install folder -- so it survives reinstalls and upgrades, and is never
//! part of the bundled read-only databases).
//!
//! Export writes a readable Markdown file plus a JSON backup to the user's Documents
//! folder; import takes that JSON back (e.g. on a new PC), merging rather than replacing.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct UserDataState(pub Mutex<Connection>);

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS bookmarks (
    book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (book, chapter, verse));
CREATE TABLE IF NOT EXISTS highlights (
    book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (book, chapter, verse));
CREATE TABLE IF NOT EXISTS notes (
    book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (book, chapter, verse));
CREATE TABLE IF NOT EXISTS plans (
    plan_id TEXT PRIMARY KEY, started_on TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_days (
    plan_id TEXT NOT NULL, day INTEGER NOT NULL,
    done_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (plan_id, day));
CREATE TABLE IF NOT EXISTS basket (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL,
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS sermons (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, series TEXT NOT NULL DEFAULT '',
    preached_on TEXT NOT NULL DEFAULT '', topics TEXT NOT NULL DEFAULT '',
    passages TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS book_bookmarks (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, section INTEGER NOT NULL, para INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS book_bookmarks_module ON book_bookmarks(module);
CREATE TABLE IF NOT EXISTS sermon_templates (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, body TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS sermon_preachings (
    id INTEGER PRIMARY KEY, sermon_id INTEGER NOT NULL, date TEXT NOT NULL,
    venue TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    length_min INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS sermon_preachings_sermon ON sermon_preachings(sermon_id);
CREATE TABLE IF NOT EXISTS sermon_refs (
    sermon_id INTEGER NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, verse_end INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sermon_refs_sermon ON sermon_refs(sermon_id);
CREATE INDEX IF NOT EXISTS sermon_refs_where ON sermon_refs(book, chapter);
CREATE VIRTUAL TABLE IF NOT EXISTS sermon_fts USING fts5(title, series, topics, big_idea, words, tokenize = 'porter unicode61');
";

/// Highlight colours the UI offers; anything else is rejected so a bad value can't be
/// stored and later interpolated into a CSS class name.
pub const HIGHLIGHT_COLORS: [&str; 11] = ["yellow", "green", "blue", "pink", "orange", "lemon", "lime", "sky", "rose", "red", "violet"];

pub fn open(dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let conn = Connection::open(dir.join("userdata.db")).map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

/// Columns added after the first release: a note can cover a range of verses in its
/// chapter (`verse_end`, NULL for one verse) and carry tags (comma-separated).
fn migrate(conn: &Connection) -> Result<(), String> {
    let mut s = conn.prepare("PRAGMA table_info(notes)").map_err(err)?;
    let cols: Vec<String> = s.query_map([], |r| r.get(1)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    if !cols.iter().any(|c| c == "verse_end") {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN verse_end INTEGER").map_err(err)?;
    }
    if !cols.iter().any(|c| c == "tags") {
        conn.execute_batch("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT ''").map_err(err)?;
    }
    // a sermon's stage of preparation and where it is (to be) preached -- since 2.7
    let mut s = conn.prepare("PRAGMA table_info(sermons)").map_err(err)?;
    let cols: Vec<String> = s.query_map([], |r| r.get(1)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    if !cols.iter().any(|c| c == "stage") {
        conn.execute_batch("ALTER TABLE sermons ADD COLUMN stage TEXT NOT NULL DEFAULT 'draft'").map_err(err)?;
    }
    if !cols.iter().any(|c| c == "venue") {
        conn.execute_batch("ALTER TABLE sermons ADD COLUMN venue TEXT NOT NULL DEFAULT ''").map_err(err)?;
    }
    first_index(conn)?;
    Ok(())
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct ChapterMarks {
    pub bookmarks: Vec<i64>,
    pub highlights: Vec<(i64, String)>,
    /// Verses a note starts on.
    pub notes: Vec<i64>,
    /// (first, last) verse of each note that covers more than one verse.
    pub note_spans: Vec<(i64, i64)>,
}

pub fn chapter_marks(conn: &Connection, book: &str, chapter: i64) -> Result<ChapterMarks, String> {
    let ints = |sql: &str| -> Result<Vec<i64>, String> {
        let mut s = conn.prepare(sql).map_err(err)?;
        let v = s.query_map(params![book, chapter], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
        Ok(v)
    };
    let bookmarks = ints("SELECT verse FROM bookmarks WHERE book=?1 AND chapter=?2")?;
    let notes = ints("SELECT verse FROM notes WHERE book=?1 AND chapter=?2")?;
    let mut s = conn.prepare("SELECT verse, verse_end FROM notes WHERE book=?1 AND chapter=?2 AND verse_end > verse").map_err(err)?;
    let note_spans = s
        .query_map(params![book, chapter], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut s = conn.prepare("SELECT verse, color FROM highlights WHERE book=?1 AND chapter=?2").map_err(err)?;
    let highlights = s
        .query_map(params![book, chapter], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(ChapterMarks { bookmarks, highlights, notes, note_spans })
}

pub fn toggle_bookmark(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<bool, String> {
    let removed = conn.execute("DELETE FROM bookmarks WHERE book=?1 AND chapter=?2 AND verse=?3", params![book, chapter, verse]).map_err(err)?;
    if removed > 0 {
        return Ok(false);
    }
    conn.execute("INSERT INTO bookmarks (book, chapter, verse) VALUES (?1,?2,?3)", params![book, chapter, verse]).map_err(err)?;
    Ok(true)
}

pub fn set_highlight(conn: &Connection, book: &str, chapter: i64, verse: i64, color: Option<&str>) -> Result<(), String> {
    match color {
        None => {
            conn.execute("DELETE FROM highlights WHERE book=?1 AND chapter=?2 AND verse=?3", params![book, chapter, verse]).map_err(err)?;
        }
        Some(c) if HIGHLIGHT_COLORS.contains(&c) => {
            conn.execute(
                "INSERT INTO highlights (book, chapter, verse, color) VALUES (?1,?2,?3,?4)
                 ON CONFLICT(book, chapter, verse) DO UPDATE SET color = excluded.color",
                params![book, chapter, verse, c],
            )
            .map_err(err)?;
        }
        Some(c) => return Err(format!("unknown highlight colour: {c}")),
    }
    Ok(())
}

/// A note as the reader wrote it: it starts on `verse` and runs to `verse_end` (the same
/// verse for a one-verse note), in one chapter.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Note {
    pub verse: i64,
    pub verse_end: i64,
    pub body: String,
    pub tags: Vec<String>,
}

/// Tags as typed ("#Faith, prayer ,faith") -> clean, de-duplicated ("Faith", "prayer").
pub fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags.iter().flat_map(|t| t.split(',')) {
        let t = t.trim().trim_start_matches('#').split_whitespace().collect::<Vec<_>>().join(" ");
        let t: String = t.chars().take(40).collect();
        if !t.is_empty() && !out.iter().any(|o| o.to_lowercase() == t.to_lowercase()) {
            out.push(t);
        }
        if out.len() == 20 {
            break;
        }
    }
    out
}

fn split_tags(s: &str) -> Vec<String> {
    s.split(',').map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect()
}

fn note_row(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let verse: i64 = r.get(0)?;
    let end: Option<i64> = r.get(1)?;
    Ok(Note { verse, verse_end: end.filter(|&e| e > verse).unwrap_or(verse), body: r.get(2)?, tags: split_tags(&r.get::<_, String>(3)?) })
}

pub fn get_note(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Option<Note>, String> {
    conn.query_row("SELECT verse, verse_end, body, tags FROM notes WHERE book=?1 AND chapter=?2 AND verse=?3", params![book, chapter, verse], note_row)
        .optional()
        .map_err(err)
}

/// Every note in a chapter, in verse order (for the study sheet).
pub fn chapter_notes(conn: &Connection, book: &str, chapter: i64) -> Result<Vec<Note>, String> {
    let mut s = conn.prepare("SELECT verse, verse_end, body, tags FROM notes WHERE book=?1 AND chapter=?2 ORDER BY verse").map_err(err)?;
    let v = s.query_map(params![book, chapter], note_row).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    Ok(v)
}

/// Saving an empty (whitespace-only) note deletes it. A `verse_end` past `verse` makes it a
/// note on the whole range.
pub fn save_note(conn: &Connection, book: &str, chapter: i64, verse: i64, body: &str, verse_end: Option<i64>, tags: &[String]) -> Result<(), String> {
    if body.trim().is_empty() {
        conn.execute("DELETE FROM notes WHERE book=?1 AND chapter=?2 AND verse=?3", params![book, chapter, verse]).map_err(err)?;
    } else {
        let end = verse_end.filter(|&e| e > verse);
        let tags = clean_tags(tags).join(",");
        conn.execute(
            "INSERT INTO notes (book, chapter, verse, body, verse_end, tags) VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(book, chapter, verse) DO UPDATE SET body = excluded.body, verse_end = excluded.verse_end,
                 tags = excluded.tags, updated_at = datetime('now','localtime')",
            params![book, chapter, verse, body, end, tags],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Every tag used on a note, with how many notes carry it, most used first.
pub fn note_tags(conn: &Connection) -> Result<Vec<(String, i64)>, String> {
    let mut s = conn.prepare("SELECT tags FROM notes WHERE tags <> ''").map_err(err)?;
    let rows: Vec<String> = s.query_map([], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    let mut counts: Vec<(String, i64)> = Vec::new();
    for tag in rows.iter().flat_map(|r| split_tags(r)) {
        match counts.iter_mut().find(|(t, _)| t.to_lowercase() == tag.to_lowercase()) {
            Some((_, n)) => *n += 1,
            None => counts.push((tag, 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.to_lowercase().cmp(&b.0.to_lowercase())));
    Ok(counts)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StudyItem {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    /// Highlight colour, or the note text; empty for bookmarks.
    pub value: String,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    /// BSB text of the verse, filled in for display and export (not stored).
    #[serde(default)]
    pub verse_text: String,
    /// Notes only: the last verse of a note on a range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verse_end: Option<i64>,
    /// Notes only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

fn list(conn: &Connection, sql: &str) -> Result<Vec<StudyItem>, String> {
    let mut s = conn.prepare(sql).map_err(err)?;
    let rows = s
        .query_map([], |r| {
            let verse: i64 = r.get(2)?;
            Ok(StudyItem {
                book: r.get(0)?,
                chapter: r.get(1)?,
                verse,
                value: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
                verse_text: String::new(),
                verse_end: r.get::<_, Option<i64>>(6)?.filter(|&e| e > verse),
                tags: split_tags(&r.get::<_, String>(7)?),
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn list_bookmarks(conn: &Connection) -> Result<Vec<StudyItem>, String> {
    list(conn, "SELECT book, chapter, verse, '', created_at, created_at, NULL, '' FROM bookmarks ORDER BY created_at DESC")
}
pub fn list_highlights(conn: &Connection) -> Result<Vec<StudyItem>, String> {
    list(conn, "SELECT book, chapter, verse, color, created_at, created_at, NULL, '' FROM highlights ORDER BY created_at DESC")
}
pub fn list_notes(conn: &Connection) -> Result<Vec<StudyItem>, String> {
    list(conn, "SELECT book, chapter, verse, body, created_at, updated_at, verse_end, tags FROM notes ORDER BY updated_at DESC")
}

// ---------------------------------------------------------------- reading plans

#[derive(Serialize, Deserialize, Clone)]
pub struct PlanProgress {
    pub plan_id: String,
    pub started_on: String,
    pub done_days: Vec<i64>,
}

pub fn plan_progress(conn: &Connection) -> Result<Vec<PlanProgress>, String> {
    let mut s = conn.prepare("SELECT plan_id, started_on FROM plans ORDER BY started_on").map_err(err)?;
    let plans: Vec<(String, String)> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    let mut out = Vec::new();
    for (plan_id, started_on) in plans {
        let mut d = conn.prepare("SELECT day FROM plan_days WHERE plan_id=?1 ORDER BY day").map_err(err)?;
        let done_days = d.query_map(params![plan_id], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
        out.push(PlanProgress { plan_id, started_on, done_days });
    }
    Ok(out)
}

pub fn start_plan(conn: &Connection, plan_id: &str, started_on: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO plans (plan_id, started_on) VALUES (?1, ?2) ON CONFLICT(plan_id) DO UPDATE SET started_on = excluded.started_on",
        params![plan_id, started_on],
    )
    .map_err(err)?;
    conn.execute("DELETE FROM plan_days WHERE plan_id=?1", params![plan_id]).map_err(err)?;
    Ok(())
}

pub fn stop_plan(conn: &Connection, plan_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM plan_days WHERE plan_id=?1", params![plan_id]).map_err(err)?;
    conn.execute("DELETE FROM plans WHERE plan_id=?1", params![plan_id]).map_err(err)?;
    Ok(())
}

pub fn set_plan_day(conn: &Connection, plan_id: &str, day: i64, done: bool) -> Result<(), String> {
    if done {
        conn.execute("INSERT OR IGNORE INTO plan_days (plan_id, day) VALUES (?1, ?2)", params![plan_id, day]).map_err(err)?;
    } else {
        conn.execute("DELETE FROM plan_days WHERE plan_id=?1 AND day=?2", params![plan_id, day]).map_err(err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- study basket
//
// A working collection for preparing a study, sermon or service: verses, notes,
// commentary, dictionary entries and answers gathered from anywhere in the app, in the
// reader's chosen order, which the basket panel turns into one study sheet. Not part of
// the backup -- it's a scratch area, cleared when the study is done.

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BasketItem {
    pub id: i64,
    /// "verse" | "note" | "commentary" | "dictionary" | "answer" | "text" | "picture"
    pub kind: String,
    pub title: String,
    pub body: String,
    /// Kind-specific JSON from the frontend (e.g. a verse's book/chapter/verses/version).
    pub meta: String,
    pub created_at: String,
}

const BASKET_KINDS: [&str; 7] = ["verse", "note", "commentary", "dictionary", "answer", "text", "picture"];

pub fn basket_list(conn: &Connection) -> Result<Vec<BasketItem>, String> {
    let mut s = conn.prepare("SELECT id, kind, title, body, meta, created_at FROM basket ORDER BY position, id").map_err(err)?;
    let rows = s
        .query_map([], |r| Ok(BasketItem { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, body: r.get(3)?, meta: r.get(4)?, created_at: r.get(5)? }))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn basket_add(conn: &Connection, kind: &str, title: &str, body: &str, meta: &str) -> Result<i64, String> {
    if !BASKET_KINDS.contains(&kind) {
        return Err(format!("unknown basket item kind: {kind}"));
    }
    conn.execute(
        "INSERT INTO basket (position, kind, title, body, meta) VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM basket), ?1, ?2, ?3, ?4)",
        params![kind, title, body, meta],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn basket_update(conn: &Connection, id: i64, title: &str, body: &str) -> Result<(), String> {
    conn.execute("UPDATE basket SET title = ?2, body = ?3 WHERE id = ?1", params![id, title, body]).map_err(err)?;
    Ok(())
}

pub fn basket_remove(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM basket WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

pub fn basket_clear(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM basket", []).map_err(err)?;
    Ok(())
}

/// Rewrites the order to exactly `ids` (as dragged/moved in the panel); ids not listed
/// keep their relative order after them.
pub fn basket_reorder(conn: &mut Connection, ids: &[i64]) -> Result<(), String> {
    let current: Vec<i64> = basket_list(conn)?.into_iter().map(|i| i.id).collect();
    let mut order: Vec<i64> = ids.iter().copied().filter(|id| current.contains(id)).collect();
    let rest: Vec<i64> = current.iter().copied().filter(|id| !order.contains(id)).collect();
    order.extend(rest);
    let tx = conn.transaction().map_err(err)?;
    for (pos, id) in order.iter().enumerate() {
        tx.execute("UPDATE basket SET position = ?2 WHERE id = ?1", params![id, pos as i64 + 1]).map_err(err)?;
    }
    tx.commit().map_err(err)
}

// ---------------------------------------------------------------- bookmarks in books
//
// The reader's own bookmarks in a Library book (or one they added). A place is the
// section's position in the book's contents and the paragraph within it -- positions, not
// database ids, so bookmarks survive the book being installed again. `snippet` is the start
// of the paragraph, to recognise the place by.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BookBookmark {
    #[serde(default)]
    pub id: i64,
    pub module: String,
    pub section: i64,
    pub para: i64,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub created_at: String,
}

fn bookmark_row(r: &rusqlite::Row) -> rusqlite::Result<BookBookmark> {
    Ok(BookBookmark { id: r.get(0)?, module: r.get(1)?, section: r.get(2)?, para: r.get(3)?, label: r.get(4)?, snippet: r.get(5)?, created_at: r.get(6)? })
}

/// One book's bookmarks in reading order, or every book's (newest first) with `None`.
pub fn book_bookmarks(conn: &Connection, module: Option<&str>) -> Result<Vec<BookBookmark>, String> {
    let sql = format!(
        "SELECT id, module, section, para, label, snippet, created_at FROM book_bookmarks {}",
        if module.is_some() { "WHERE module = ?1 ORDER BY section, para, id" } else { "WHERE ?1 IS NULL ORDER BY created_at DESC, id DESC" }
    );
    let mut s = conn.prepare(&sql).map_err(err)?;
    let rows = s.query_map(params![module], bookmark_row).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    Ok(rows)
}

pub fn book_bookmark_add(conn: &Connection, b: &BookBookmark) -> Result<i64, String> {
    if b.module.trim().is_empty() || b.section < 0 || b.para < 0 {
        return Err("That place can't be bookmarked.".into());
    }
    let clip = |s: &str, n: usize| s.trim().chars().take(n).collect::<String>();
    conn.execute(
        "INSERT INTO book_bookmarks (module, section, para, label, snippet) VALUES (?1,?2,?3,?4,?5)",
        params![b.module, b.section, b.para, clip(&b.label, 120), clip(&b.snippet, 200)],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn book_bookmark_rename(conn: &Connection, id: i64, label: &str) -> Result<(), String> {
    conn.execute("UPDATE book_bookmarks SET label = ?2 WHERE id = ?1", params![id, label.trim().chars().take(120).collect::<String>()]).map_err(err)?;
    Ok(())
}

pub fn book_bookmark_remove(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM book_bookmarks WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- sermons
//
// The sermon builder's saved work: what the preacher gathered and arranged (`body`, JSON
// the page owns), with a few fields beside it for the list -- its series, the date it
// was preached, and the passages it uses (so a series can show what has been covered).

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Sermon {
    /// 0 = not saved yet
    #[serde(default)]
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub series: String,
    /// "YYYY-MM-DD", or empty
    #[serde(default)]
    pub preached_on: String,
    /// what was typed into the builder
    #[serde(default)]
    pub topics: String,
    /// the Scripture passages used, "John 3:16; Romans 8:28"
    #[serde(default)]
    pub passages: String,
    /// the arranged material (JSON); empty in a list
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub updated_at: String,
    /// idea | research | draft | ready | preached (since 2.7)
    #[serde(default = "default_stage")]
    pub stage: String,
    /// where it is (to be) preached (since 2.7)
    #[serde(default)]
    pub venue: String,
}

fn default_stage() -> String {
    "draft".into()
}

/// The stages a sermon goes through; anything else is stored as "draft".
pub const SERMON_STAGES: [&str; 5] = ["idea", "research", "draft", "ready", "preached"];

fn clean_stage(stage: &str) -> &str {
    if SERMON_STAGES.contains(&stage) {
        stage
    } else {
        "draft"
    }
}

const MAX_SERMON_BYTES: usize = 4 * 1024 * 1024;

/// Every saved sermon, newest first, without its body.
pub fn sermon_list(conn: &Connection) -> Result<Vec<Sermon>, String> {
    let mut s = conn
        .prepare("SELECT id, title, series, preached_on, topics, passages, updated_at, stage, venue FROM sermons ORDER BY updated_at DESC, id DESC")
        .map_err(err)?;
    let rows = s
        .query_map([], |r| {
            Ok(Sermon {
                id: r.get(0)?,
                title: r.get(1)?,
                series: r.get(2)?,
                preached_on: r.get(3)?,
                topics: r.get(4)?,
                passages: r.get(5)?,
                body: String::new(),
                updated_at: r.get(6)?,
                stage: r.get(7)?,
                venue: r.get(8)?,
            })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn sermon_get(conn: &Connection, id: i64) -> Result<Option<Sermon>, String> {
    conn.query_row("SELECT id, title, series, preached_on, topics, passages, body, updated_at, stage, venue FROM sermons WHERE id = ?1", params![id], |r| {
        Ok(Sermon {
            id: r.get(0)?,
            title: r.get(1)?,
            series: r.get(2)?,
            preached_on: r.get(3)?,
            topics: r.get(4)?,
            passages: r.get(5)?,
            body: r.get(6)?,
            updated_at: r.get(7)?,
            stage: r.get(8)?,
            venue: r.get(9)?,
        })
    })
    .optional()
    .map_err(err)
}

/// Saves a new sermon (id 0) or the changes to an existing one; returns its id.
pub fn sermon_save(conn: &Connection, s: &Sermon) -> Result<i64, String> {
    let title = s.title.trim();
    if title.is_empty() {
        return Err("Give the sermon a title before saving it.".into());
    }
    if s.body.len() > MAX_SERMON_BYTES {
        return Err("This sermon is too large to save. Remove some of the gathered material.".into());
    }
    let preached = if s.preached_on.len() == 10 && s.preached_on.chars().all(|c| c.is_ascii_digit() || c == '-') { s.preached_on.as_str() } else { "" };
    let stage = clean_stage(&s.stage);
    let venue = s.venue.trim();
    if s.id > 0 {
        let n = conn
            .execute(
                "UPDATE sermons SET title=?2, series=?3, preached_on=?4, topics=?5, passages=?6, body=?7, stage=?8, venue=?9, updated_at=datetime('now','localtime') WHERE id=?1",
                params![s.id, title, s.series.trim(), preached, s.topics, s.passages, s.body, stage, venue],
            )
            .map_err(err)?;
        if n > 0 {
            index_sermon(conn, s.id)?;
            return Ok(s.id);
        }
    }
    conn.execute(
        "INSERT INTO sermons (title, series, preached_on, topics, passages, body, stage, venue) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![title, s.series.trim(), preached, s.topics, s.passages, s.body, stage, venue],
    )
    .map_err(err)?;
    let id = conn.last_insert_rowid();
    index_sermon(conn, id)?;
    Ok(id)
}

/// What each saved sermon used: its passages and the keys of the material in it (from its
/// body), so the builder can say "used in <sermon> on <date>".
#[derive(Serialize, Debug, PartialEq)]
pub struct SermonUsage {
    pub id: i64,
    pub title: String,
    pub preached_on: String,
    pub stage: String,
    pub passages: String,
    pub keys: Vec<String>,
    /// every time it was preached: "YYYY-MM-DD" and where (since 2.8)
    pub preached: Vec<(String, String)>,
}

pub fn sermon_usage(conn: &Connection) -> Result<Vec<SermonUsage>, String> {
    let mut s = conn.prepare("SELECT id, title, preached_on, stage, passages, body FROM sermons ORDER BY preached_on DESC, updated_at DESC").map_err(err)?;
    let rows: Vec<(i64, String, String, String, String, String)> = s
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows
        .into_iter()
        .map(|(id, title, preached_on, stage, passages, body)| {
            let json: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            let keys = json["items"]
                .as_array()
                .map(|items| items.iter().filter_map(|i| i["material"]["key"].as_str().map(String::from)).collect())
                .unwrap_or_default();
            let preached = preachings(conn, id).map(|ps| ps.into_iter().map(|p| (p.date, p.venue)).collect()).unwrap_or_default();
            SermonUsage { id, title, preached_on, stage, passages, keys, preached }
        })
        .collect())
}

// ---------------------------------------------------------------- the preacher's own sermon templates
//
// A template is the layout of a sermon -- its sections, each with a role and a question to
// answer -- saved under a name so it can start the next sermon. `body` is JSON the page owns.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SermonTemplate {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub body: String,
    #[serde(default)]
    pub updated_at: String,
}

pub fn sermon_templates(conn: &Connection) -> Result<Vec<SermonTemplate>, String> {
    let mut s = conn.prepare("SELECT id, name, body, updated_at FROM sermon_templates ORDER BY name COLLATE NOCASE").map_err(err)?;
    let rows = s.query_map([], |r| Ok(SermonTemplate { id: r.get(0)?, name: r.get(1)?, body: r.get(2)?, updated_at: r.get(3)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Saves a template under its name (replacing one of the same name); returns its id.
pub fn sermon_template_save(conn: &Connection, name: &str, body: &str) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the template a name.".into());
    }
    if body.len() > 256 * 1024 {
        return Err("That template is too large.".into());
    }
    conn.execute(
        "INSERT INTO sermon_templates (name, body) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = datetime('now','localtime')",
        params![name, body],
    )
    .map_err(err)?;
    conn.query_row("SELECT id FROM sermon_templates WHERE name = ?1", params![name], |r| r.get(0)).map_err(err)
}

pub fn sermon_template_delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM sermon_templates WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

pub fn sermon_delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM sermons WHERE id = ?1", params![id]).map_err(err)?;
    conn.execute("DELETE FROM sermon_preachings WHERE sermon_id = ?1", params![id]).map_err(err)?;
    conn.execute("DELETE FROM sermon_refs WHERE sermon_id = ?1", params![id]).map_err(err)?;
    conn.execute("DELETE FROM sermon_fts WHERE rowid = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- when and where a sermon was preached, and finding sermons (since 2.8)
//
// One sermon can be preached many times, in different places: each time is a row of
// `sermon_preachings`. To find sermons again, every save indexes the sermon's words (title,
// series, subjects, big idea and the preacher's own text, in `sermon_fts`) and the passages it
// uses (`sermon_refs`, one row per passage, so "Romans 8" finds a sermon on Romans 8:28-39).

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Preaching {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub sermon_id: i64,
    /// "YYYY-MM-DD"
    pub date: String,
    #[serde(default)]
    pub venue: String,
    /// "morning service", "youth", ...
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub notes: String,
    /// how long it took, in minutes
    #[serde(default)]
    pub length_min: Option<i64>,
}

fn is_date(d: &str) -> bool {
    d.len() == 10 && d.as_bytes()[4] == b'-' && d.as_bytes()[7] == b'-' && d.chars().filter(|c| c.is_ascii_digit()).count() == 8
}

fn preaching_row(r: &rusqlite::Row) -> rusqlite::Result<Preaching> {
    Ok(Preaching { id: r.get(0)?, sermon_id: r.get(1)?, date: r.get(2)?, venue: r.get(3)?, audience: r.get(4)?, notes: r.get(5)?, length_min: r.get(6)? })
}

/// The times a sermon was preached, earliest first.
pub fn preachings(conn: &Connection, sermon_id: i64) -> Result<Vec<Preaching>, String> {
    let mut s = conn
        .prepare("SELECT id, sermon_id, date, venue, audience, notes, length_min FROM sermon_preachings WHERE sermon_id = ?1 ORDER BY date, id")
        .map_err(err)?;
    let rows = s.query_map(params![sermon_id], preaching_row).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Records a time the sermon was preached (or, with an id, changes one); returns its id. The
/// sermon's own "preached on" date and stage follow its latest preaching.
pub fn preaching_save(conn: &Connection, p: &Preaching) -> Result<i64, String> {
    if !is_date(&p.date) {
        return Err("Choose the date it was preached.".into());
    }
    let exists: bool = conn.query_row("SELECT 1 FROM sermons WHERE id = ?1", params![p.sermon_id], |_| Ok(true)).optional().map_err(err)?.unwrap_or(false);
    if !exists {
        return Err("Save the sermon first.".into());
    }
    let length = p.length_min.filter(|m| (1..=600).contains(m));
    let clip = |s: &str, n: usize| s.trim().chars().take(n).collect::<String>();
    let id = if p.id > 0 {
        conn.execute(
            "UPDATE sermon_preachings SET date=?2, venue=?3, audience=?4, notes=?5, length_min=?6 WHERE id=?1 AND sermon_id=?7",
            params![p.id, p.date, clip(&p.venue, 200), clip(&p.audience, 200), clip(&p.notes, 4000), length, p.sermon_id],
        )
        .map_err(err)?;
        p.id
    } else {
        conn.execute(
            "INSERT INTO sermon_preachings (sermon_id, date, venue, audience, notes, length_min) VALUES (?1,?2,?3,?4,?5,?6)",
            params![p.sermon_id, p.date, clip(&p.venue, 200), clip(&p.audience, 200), clip(&p.notes, 4000), length],
        )
        .map_err(err)?;
        conn.last_insert_rowid()
    };
    follow_preachings(conn, p.sermon_id)?;
    Ok(id)
}

pub fn preaching_delete(conn: &Connection, id: i64) -> Result<(), String> {
    let sermon: Option<i64> = conn.query_row("SELECT sermon_id FROM sermon_preachings WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(err)?;
    conn.execute("DELETE FROM sermon_preachings WHERE id = ?1", params![id]).map_err(err)?;
    if let Some(s) = sermon {
        follow_preachings(conn, s)?;
    }
    Ok(())
}

/// A sermon preached at least once is "preached", with its latest date as "preached on".
pub(crate) fn follow_preachings(conn: &Connection, sermon_id: i64) -> Result<(), String> {
    let last: Option<String> = conn.query_row("SELECT max(date) FROM sermon_preachings WHERE sermon_id = ?1", params![sermon_id], |r| r.get(0)).map_err(err)?;
    if let Some(d) = last {
        conn.execute("UPDATE sermons SET preached_on = ?2, stage = 'preached' WHERE id = ?1", params![sermon_id, d]).map_err(err)?;
    }
    Ok(())
}

/// The Scripture kinds of gathered material (sermon.ts `isScripture`).
const SCRIPTURE_KINDS: [&str; 4] = ["passage", "section", "verse", "xref"];

/// What a sermon's body says, for the index: the preacher's own words (big idea, purpose,
/// points, section names and text, notes) and the passages it uses.
fn indexed(body: &str) -> (String, String, Vec<(String, i64, i64, i64)>) {
    let json: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    let s = |v: &serde_json::Value| v.as_str().unwrap_or("").to_string();
    let big_idea = [s(&json["bigIdea"]), s(&json["purpose"])].join(" ").trim().to_string();
    let mut words = Vec::new();
    let mut refs = Vec::new();
    for i in json["items"].as_array().into_iter().flatten() {
        match i["type"].as_str() {
            Some("heading") | Some("note") => words.push(s(&i["text"])),
            Some("block") => {
                words.push(s(&i["label"]));
                words.push(s(&i["text"]));
            }
            Some("material") => {
                let m = &i["material"];
                if SCRIPTURE_KINDS.contains(&m["kind"].as_str().unwrap_or("")) {
                    let r = &m["ref"];
                    if let (Some(book), Some(ch), Some(v)) = (r["book"].as_str(), r["chapter"].as_i64(), r["verse"].as_i64()) {
                        let end = r["verseEnd"].as_i64().unwrap_or(v).max(v);
                        if !refs.iter().any(|x: &(String, i64, i64, i64)| x.0 == book && x.1 == ch && x.2 == v && x.3 == end) {
                            refs.push((book.to_string(), ch, v, end));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    (big_idea, words.join("\n"), refs)
}

/// Brings a sermon's entries in the word index and the passage list up to date.
pub fn index_sermon(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM sermon_fts WHERE rowid = ?1", params![id]).map_err(err)?;
    conn.execute("DELETE FROM sermon_refs WHERE sermon_id = ?1", params![id]).map_err(err)?;
    let row: Option<(String, String, String, String)> = conn
        .query_row("SELECT title, series, topics, body FROM sermons WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()
        .map_err(err)?;
    let Some((title, series, topics, body)) = row else { return Ok(()) };
    let (big_idea, words, refs) = indexed(&body);
    conn.execute("INSERT INTO sermon_fts (rowid, title, series, topics, big_idea, words) VALUES (?1,?2,?3,?4,?5,?6)", params![id, title, series, topics, big_idea, words])
        .map_err(err)?;
    for (book, ch, v, end) in refs {
        conn.execute("INSERT INTO sermon_refs (sermon_id, book, chapter, verse, verse_end) VALUES (?1,?2,?3,?4,?5)", params![id, book, ch, v, end]).map_err(err)?;
    }
    Ok(())
}

/// What to look for in the preacher's sermons. Every part is optional.
#[derive(Deserialize, Debug, Default, Clone)]
pub struct SermonQuery {
    /// words in the title, series, subjects, big idea or the preacher's own text
    #[serde(default)]
    pub words: String,
    /// a passage: sermons using any of it ("Romans 8" -> chapter 8; "Romans 8:28" -> verse 28)
    #[serde(default)]
    pub book: String,
    #[serde(default)]
    pub chapter: Option<i64>,
    #[serde(default)]
    pub verse: Option<i64>,
    #[serde(default)]
    pub verse_end: Option<i64>,
    /// preached (or planned) between these dates, "YYYY-MM-DD"
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
    #[serde(default)]
    pub series: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub stage: String,
    /// "newest" (default), "oldest", "most" (most preached), "title"
    #[serde(default)]
    pub sort: String,
}

/// A sermon found: its list fields, every time it was preached, and the start of its big idea.
#[derive(Serialize, Debug)]
pub struct SermonHit {
    #[serde(flatten)]
    pub sermon: Sermon,
    pub preachings: Vec<Preaching>,
    pub big_idea: String,
}

/// Words typed into the search, as an FTS5 query: every word (or its start) must be there.
fn fts_words(words: &str) -> Option<String> {
    let parts: Vec<String> = words
        .split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '’')
        .map(|w| w.trim_matches(|c| c == '\'' || c == '’'))
        .filter(|w| !w.is_empty())
        .take(12)
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

pub fn sermon_search(conn: &Connection, q: &SermonQuery) -> Result<Vec<SermonHit>, String> {
    let words = fts_words(&q.words);
    if !q.words.trim().is_empty() && words.is_none() {
        return Ok(Vec::new());
    }
    let book = q.book.trim();
    let (from, to) = (q.from.trim(), q.to.trim());
    let sql = "SELECT s.id, s.title, s.series, s.preached_on, s.topics, s.passages, s.updated_at, s.stage, s.venue, s.body FROM sermons s
         WHERE (?1 IS NULL OR s.id IN (SELECT rowid FROM sermon_fts WHERE sermon_fts MATCH ?1))
           AND (?2 = '' OR s.id IN (SELECT sermon_id FROM sermon_refs WHERE book = ?2 AND (?3 IS NULL OR chapter = ?3)
                AND (?4 IS NULL OR (verse <= coalesce(?5, ?4) AND verse_end >= ?4))))
           AND (?6 = '' OR s.series = ?6)
           AND (?7 = '' OR s.stage = ?7)
           AND (?8 = '' OR s.venue LIKE '%' || ?8 || '%' OR EXISTS (SELECT 1 FROM sermon_preachings p WHERE p.sermon_id = s.id AND p.venue LIKE '%' || ?8 || '%'))
           AND ((?9 = '' AND ?10 = '')
                OR EXISTS (SELECT 1 FROM sermon_preachings p WHERE p.sermon_id = s.id AND (?9 = '' OR p.date >= ?9) AND (?10 = '' OR p.date <= ?10))
                OR (s.preached_on <> '' AND (?9 = '' OR s.preached_on >= ?9) AND (?10 = '' OR s.preached_on <= ?10)))";
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let rows: Vec<(Sermon, String)> = stmt
        .query_map(
            params![words, book, q.chapter, q.verse, q.verse_end, q.series.trim(), q.stage.trim(), q.venue.trim(), from, to],
            |r| {
                Ok((
                    Sermon {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        series: r.get(2)?,
                        preached_on: r.get(3)?,
                        topics: r.get(4)?,
                        passages: r.get(5)?,
                        body: String::new(),
                        updated_at: r.get(6)?,
                        stage: r.get(7)?,
                        venue: r.get(8)?,
                    },
                    r.get::<_, String>(9)?,
                ))
            },
        )
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut hits = Vec::new();
    for (sermon, body) in rows {
        let json: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
        let big_idea = json["bigIdea"].as_str().unwrap_or("").trim().chars().take(200).collect();
        let preachings = preachings(conn, sermon.id)?;
        hits.push(SermonHit { sermon, preachings, big_idea });
    }
    // the date a sermon is known by: its latest preaching, its planned date, or its last edit
    let when = |h: &SermonHit| h.preachings.last().map(|p| p.date.clone()).filter(|d| !d.is_empty()).unwrap_or_else(|| if h.sermon.preached_on.is_empty() { h.sermon.updated_at.chars().take(10).collect() } else { h.sermon.preached_on.clone() });
    match q.sort.as_str() {
        "oldest" => hits.sort_by(|a, b| when(a).cmp(&when(b))),
        "most" => hits.sort_by(|a, b| b.preachings.len().cmp(&a.preachings.len()).then_with(|| when(b).cmp(&when(a)))),
        "title" => hits.sort_by(|a, b| a.sermon.title.to_lowercase().cmp(&b.sermon.title.to_lowercase())),
        _ => hits.sort_by(|a, b| when(b).cmp(&when(a))),
    }
    Ok(hits)
}

/// A preaching in a backup: its sermon is named by title and series (ids differ between computers).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PreachingBackup {
    pub sermon_title: String,
    #[serde(default)]
    pub sermon_series: String,
    #[serde(flatten)]
    pub preaching: Preaching,
}

pub fn preachings_all(conn: &Connection) -> Result<Vec<PreachingBackup>, String> {
    let mut s = conn
        .prepare(
            "SELECT p.id, p.sermon_id, p.date, p.venue, p.audience, p.notes, p.length_min, s.title, s.series FROM sermon_preachings p
             JOIN sermons s ON s.id = p.sermon_id ORDER BY p.date, p.id",
        )
        .map_err(err)?;
    let rows = s
        .query_map([], |r| Ok(PreachingBackup { sermon_title: r.get(7)?, sermon_series: r.get(8)?, preaching: Preaching { id: 0, sermon_id: 0, ..preaching_row(r)? } }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Run once when the tracker arrives (2.8): every sermon indexed, and one preaching for each
/// sermon already marked preached on a date.
fn first_index(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
    if version >= 1 {
        return Ok(());
    }
    let ids: Vec<i64> = conn.prepare("SELECT id FROM sermons").map_err(err)?.query_map([], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    for id in ids {
        index_sermon(conn, id)?;
    }
    conn.execute(
        "INSERT INTO sermon_preachings (sermon_id, date, venue)
         SELECT id, preached_on, venue FROM sermons WHERE stage = 'preached' AND length(preached_on) = 10
           AND id NOT IN (SELECT sermon_id FROM sermon_preachings)",
        [],
    )
    .map_err(err)?;
    conn.execute_batch("PRAGMA user_version = 1").map_err(err)?;
    Ok(())
}


/// All sermons with their bodies, for the backup.
pub fn sermons_all(conn: &Connection) -> Result<Vec<Sermon>, String> {
    let ids: Vec<i64> = sermon_list(conn)?.into_iter().map(|s| s.id).collect();
    let mut out = Vec::new();
    for id in ids {
        if let Some(s) = sermon_get(conn, id)? {
            out.push(s);
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- export / import

#[derive(Serialize, Deserialize, Default)]
pub struct Backup {
    pub format: String,
    pub exported_at: String,
    #[serde(default)]
    pub bookmarks: Vec<StudyItem>,
    #[serde(default)]
    pub highlights: Vec<StudyItem>,
    #[serde(default)]
    pub notes: Vec<StudyItem>,
    #[serde(default)]
    pub plans: Vec<PlanProgress>,
    /// saved sermons (sermon builder); absent in backups from before 2.5
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sermons: Vec<Sermon>,
    /// the reader's bookmarks in books; absent in backups from before 2.6
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub book_bookmarks: Vec<BookBookmark>,
    /// the preacher's own sermon templates; absent in backups from before 2.7
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sermon_templates: Vec<SermonTemplate>,
    /// when and where each sermon was preached; absent in backups from before 2.8
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sermon_preachings: Vec<PreachingBackup>,
}

pub const BACKUP_FORMAT: &str = "bible-concordance-study/1";

#[derive(Serialize)]
pub struct ExportResult {
    pub markdown_path: String,
    pub json_path: String,
    pub notes: usize,
    pub highlights: usize,
    pub bookmarks: usize,
}

fn verse_label(i: &StudyItem) -> String {
    match i.verse_end {
        Some(e) if e > i.verse => format!("{} {}:{}-{}", i.book, i.chapter, i.verse, e),
        _ => format!("{} {}:{}", i.book, i.chapter, i.verse),
    }
}

pub fn render_markdown(b: &Backup) -> String {
    let mut md = format!("# My Bible study notes\n\nExported {} from Bible Concordance.\n\n", b.exported_at);
    md.push_str(&format!("## Notes ({})\n\n", b.notes.len()));
    for n in &b.notes {
        md.push_str(&format!("### {}\n\n", verse_label(n)));
        if !n.verse_text.is_empty() {
            md.push_str(&format!("> {} (BSB)\n\n", n.verse_text));
        }
        md.push_str(&format!("{}\n\n", n.value.trim()));
        if !n.tags.is_empty() {
            md.push_str(&format!("Tags: {}\n\n", n.tags.join(", ")));
        }
    }
    md.push_str(&format!("## Highlights ({})\n\n", b.highlights.len()));
    for h in &b.highlights {
        md.push_str(&format!("- **{}** ({}) -- {}\n", verse_label(h), h.value, h.verse_text));
    }
    md.push_str(&format!("\n## Bookmarks ({})\n\n", b.bookmarks.len()));
    for k in &b.bookmarks {
        md.push_str(&format!("- **{}** -- {}\n", verse_label(k), k.verse_text));
    }
    md
}

pub fn write_export(dir: &Path, stamp: &str, backup: &Backup) -> Result<ExportResult, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let base: PathBuf = dir.join(format!("Bible study notes {stamp}"));
    let md_path = base.with_extension("md");
    let json_path = base.with_extension("json");
    std::fs::write(&md_path, render_markdown(backup)).map_err(err)?;
    std::fs::write(&json_path, serde_json::to_string_pretty(backup).map_err(err)?).map_err(err)?;
    Ok(ExportResult {
        markdown_path: md_path.display().to_string(),
        json_path: json_path.display().to_string(),
        notes: backup.notes.len(),
        highlights: backup.highlights.len(),
        bookmarks: backup.bookmarks.len(),
    })
}

#[derive(Serialize)]
pub struct ImportResult {
    pub notes: usize,
    pub highlights: usize,
    pub bookmarks: usize,
    pub plans: usize,
    pub sermons: usize,
}

/// Merge a JSON backup into the current data. Existing notes are only overwritten when the
/// backup's copy is newer, so importing an old backup can't wipe out newer writing.
pub fn import_backup(conn: &mut Connection, json: &str) -> Result<ImportResult, String> {
    let b: Backup = serde_json::from_str(json).map_err(|e| format!("That file isn't a Bible Concordance study backup ({e})."))?;
    if b.format != BACKUP_FORMAT {
        return Err(format!("Unrecognised backup format \"{}\".", b.format));
    }
    let tx = conn.transaction().map_err(err)?;
    let mut r = ImportResult { notes: 0, highlights: 0, bookmarks: 0, plans: 0, sermons: 0 };
    for k in &b.bookmarks {
        r.bookmarks += tx
            .execute("INSERT OR IGNORE INTO bookmarks (book, chapter, verse, created_at) VALUES (?1,?2,?3,?4)", params![k.book, k.chapter, k.verse, k.created_at])
            .map_err(err)?;
    }
    for h in &b.highlights {
        if !HIGHLIGHT_COLORS.contains(&h.value.as_str()) {
            continue;
        }
        r.highlights += tx
            .execute(
                "INSERT INTO highlights (book, chapter, verse, color, created_at) VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(book, chapter, verse) DO UPDATE SET color = excluded.color",
                params![h.book, h.chapter, h.verse, h.value, h.created_at],
            )
            .map_err(err)?;
    }
    for n in &b.notes {
        if n.value.trim().is_empty() {
            continue;
        }
        let updated = if n.updated_at.is_empty() { n.created_at.clone() } else { n.updated_at.clone() };
        let end = n.verse_end.filter(|&e| e > n.verse);
        let tags = clean_tags(&n.tags).join(",");
        r.notes += tx
            .execute(
                "INSERT INTO notes (book, chapter, verse, body, created_at, updated_at, verse_end, tags) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(book, chapter, verse) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at,
                     verse_end = excluded.verse_end, tags = excluded.tags
                 WHERE excluded.updated_at > notes.updated_at",
                params![n.book, n.chapter, n.verse, n.value, n.created_at, updated, end, tags],
            )
            .map_err(err)?;
    }
    for p in &b.plans {
        tx.execute("INSERT OR IGNORE INTO plans (plan_id, started_on) VALUES (?1,?2)", params![p.plan_id, p.started_on]).map_err(err)?;
        for d in &p.done_days {
            tx.execute("INSERT OR IGNORE INTO plan_days (plan_id, day) VALUES (?1,?2)", params![p.plan_id, d]).map_err(err)?;
        }
        r.plans += 1;
    }
    for m in &b.book_bookmarks {
        let exists: bool = tx
            .query_row("SELECT 1 FROM book_bookmarks WHERE module = ?1 AND section = ?2 AND para = ?3", params![m.module, m.section, m.para], |_| Ok(true))
            .optional()
            .map_err(err)?
            .unwrap_or(false);
        if !exists && !m.module.trim().is_empty() {
            tx.execute(
                "INSERT INTO book_bookmarks (module, section, para, label, snippet, created_at) VALUES (?1,?2,?3,?4,?5, CASE WHEN ?6 = '' THEN datetime('now','localtime') ELSE ?6 END)",
                params![m.module, m.section, m.para, m.label, m.snippet, m.created_at],
            )
            .map_err(err)?;
        }
    }
    // a sermon already here (same title and series) is replaced only by a newer copy
    for s in &b.sermons {
        if s.title.trim().is_empty() || s.body.len() > MAX_SERMON_BYTES {
            continue;
        }
        let existing: Option<(i64, String)> = tx
            .query_row("SELECT id, updated_at FROM sermons WHERE title = ?1 AND series = ?2", params![s.title.trim(), s.series.trim()], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(err)?;
        match existing {
            Some((_, at)) if at >= s.updated_at => {}
            Some((id, _)) => {
                tx.execute(
                    "UPDATE sermons SET preached_on=?2, topics=?3, passages=?4, body=?5, updated_at=?6, stage=?7, venue=?8 WHERE id=?1",
                    params![id, s.preached_on, s.topics, s.passages, s.body, s.updated_at, clean_stage(&s.stage), s.venue.trim()],
                )
                .map_err(err)?;
                r.sermons += 1;
            }
            None => {
                tx.execute(
                    "INSERT INTO sermons (title, series, preached_on, topics, passages, body, updated_at, stage, venue) VALUES (?1,?2,?3,?4,?5,?6, CASE WHEN ?7 = '' THEN datetime('now','localtime') ELSE ?7 END, ?8, ?9)",
                    params![s.title.trim(), s.series.trim(), s.preached_on, s.topics, s.passages, s.body, s.updated_at, clean_stage(&s.stage), s.venue.trim()],
                )
                .map_err(err)?;
                r.sermons += 1;
            }
        }
    }
    // each preaching, to its sermon by title and series; one already recorded (same date and
    // place) is not added again
    for p in &b.sermon_preachings {
        let pr = &p.preaching;
        if !is_date(&pr.date) {
            continue;
        }
        let sermon: Option<i64> = tx
            .query_row("SELECT id FROM sermons WHERE title = ?1 AND series = ?2", params![p.sermon_title.trim(), p.sermon_series.trim()], |r| r.get(0))
            .optional()
            .map_err(err)?;
        let Some(sermon) = sermon else { continue };
        let there: bool = tx
            .query_row("SELECT 1 FROM sermon_preachings WHERE sermon_id = ?1 AND date = ?2 AND venue = ?3", params![sermon, pr.date, pr.venue.trim()], |_| Ok(true))
            .optional()
            .map_err(err)?
            .unwrap_or(false);
        if !there {
            tx.execute(
                "INSERT INTO sermon_preachings (sermon_id, date, venue, audience, notes, length_min) VALUES (?1,?2,?3,?4,?5,?6)",
                params![sermon, pr.date, pr.venue.trim(), pr.audience.trim(), pr.notes, pr.length_min],
            )
            .map_err(err)?;
        }
    }
    // the preacher's templates: added by name; one already here is left as it is
    for t in &b.sermon_templates {
        if t.name.trim().is_empty() || t.body.len() > 256 * 1024 {
            continue;
        }
        tx.execute("INSERT OR IGNORE INTO sermon_templates (name, body) VALUES (?1, ?2)", params![t.name.trim(), t.body]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    // the restored sermons in the search index
    let ids: Vec<i64> = conn.prepare("SELECT id FROM sermons").map_err(err)?.query_map([], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    for id in ids {
        index_sermon(conn, id)?;
    }
    Ok(r)
}

pub fn now_stamp(conn: &Connection) -> (String, String) {
    conn.query_row("SELECT datetime('now','localtime'), strftime('%Y-%m-%d %H%M','now','localtime')", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap_or_else(|_| ("".into(), "export".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (Connection, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("bc-userdata-test-{}-{}", std::process::id(), rand_suffix()));
        (open(&dir).unwrap(), dir)
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn marks_round_trip_and_backup_restore() {
        let (c, dir) = temp_db();
        assert!(toggle_bookmark(&c, "John", 3, 16).unwrap());
        set_highlight(&c, "John", 3, 16, Some("yellow")).unwrap();
        set_highlight(&c, "John", 3, 17, Some("green")).unwrap();
        assert!(set_highlight(&c, "John", 3, 18, Some("url(evil)")).is_err());
        save_note(&c, "John", 3, 16, "God's love -- the gift of the Son.", None, &[]).unwrap();
        save_note(&c, "John", 3, 1, "Nicodemus by night", Some(8), &["#New birth, nicodemus".into(), "new BIRTH".into()]).unwrap();
        start_plan(&c, "nt90", "2026-09-26").unwrap();
        let mut sermon = Sermon { id: 0, title: " Healing ".into(), series: "Faith".into(), preached_on: "2026-10-11".into(), topics: "healing; faith".into(), passages: "James 5:14".into(), body: "{\"items\":[]}".into(), updated_at: String::new(), stage: "draft".into(), venue: String::new() };
        assert!(sermon_save(&c, &Sermon { title: "  ".into(), ..sermon.clone() }).is_err());
        sermon.id = sermon_save(&c, &sermon).unwrap();
        sermon.passages = "James 5:14; Isaiah 53:5".into();
        assert_eq!(sermon_save(&c, &sermon).unwrap(), sermon.id, "saving again updates, it doesn't add");
        let mark = BookBookmark { id: 0, module: "own-grace".into(), section: 3, para: 7, label: " The key point ".into(), snippet: "Grace and truth came".into(), created_at: String::new() };
        let mark_id = book_bookmark_add(&c, &mark).unwrap();
        book_bookmark_add(&c, &BookBookmark { section: 1, para: 0, label: String::new(), ..mark.clone() }).unwrap();
        assert!(book_bookmark_add(&c, &BookBookmark { module: " ".into(), ..mark.clone() }).is_err());
        let marks = book_bookmarks(&c, Some("own-grace")).unwrap();
        assert_eq!(marks.iter().map(|m| (m.section, m.para)).collect::<Vec<_>>(), [(1, 0), (3, 7)], "in reading order");
        assert_eq!(marks[1].label, "The key point");
        book_bookmark_rename(&c, mark_id, "Renamed").unwrap();
        assert_eq!(book_bookmarks(&c, None).unwrap().iter().find(|m| m.id == mark_id).unwrap().label, "Renamed");
        let listed = sermon_list(&c).unwrap();
        assert_eq!((listed.len(), listed[0].title.as_str(), listed[0].body.as_str()), (1, "Healing", ""));
        assert_eq!(sermon_get(&c, sermon.id).unwrap().unwrap().passages, "James 5:14; Isaiah 53:5");
        set_plan_day(&c, "nt90", 1, true).unwrap();

        let m = chapter_marks(&c, "John", 3).unwrap();
        assert_eq!(m.bookmarks, vec![16]);
        assert_eq!(m.notes.len(), 2);
        assert_eq!(m.note_spans, vec![(1, 8)]);
        let n = get_note(&c, "John", 3, 1).unwrap().unwrap();
        assert_eq!((n.verse_end, n.tags.clone()), (8, vec!["New birth".to_string(), "nicodemus".to_string()]));
        assert_eq!(get_note(&c, "John", 3, 16).unwrap().unwrap().verse_end, 16);
        assert_eq!(note_tags(&c).unwrap(), vec![("New birth".to_string(), 1), ("nicodemus".to_string(), 1)]);
        assert_eq!(chapter_notes(&c, "John", 3).unwrap().iter().map(|n| n.verse).collect::<Vec<_>>(), vec![1, 16]);
        assert_eq!(m.highlights.len(), 2);

        // export -> fresh database -> import restores everything
        let (_, stamp) = now_stamp(&c);
        let backup = Backup {
            format: BACKUP_FORMAT.into(),
            exported_at: "now".into(),
            bookmarks: list_bookmarks(&c).unwrap(),
            highlights: list_highlights(&c).unwrap(),
            notes: list_notes(&c).unwrap(),
            plans: plan_progress(&c).unwrap(),
            sermons: sermons_all(&c).unwrap(),
            book_bookmarks: book_bookmarks(&c, None).unwrap(),
            sermon_templates: sermon_templates(&c).unwrap(),
            sermon_preachings: Vec::new(),
        };
        let res = write_export(&dir, &stamp, &backup).unwrap();
        let md = std::fs::read_to_string(&res.markdown_path).unwrap();
        assert!(md.contains("John 3:16") && md.contains("gift of the Son"));
        assert!(md.contains("### John 3:1-8") && md.contains("Tags: New birth, nicodemus"), "{md}");
        let json = std::fs::read_to_string(&res.json_path).unwrap();

        let (mut c2, dir2) = temp_db();
        let r = import_backup(&mut c2, &json).unwrap();
        assert_eq!((r.bookmarks, r.highlights, r.notes, r.plans, r.sermons), (1, 2, 2, 1, 1));
        assert_eq!(sermon_list(&c2).unwrap()[0].series, "Faith");
        assert_eq!(book_bookmarks(&c2, Some("own-grace")).unwrap().len(), 2, "bookmarks in books come back from a backup");
        assert_eq!(get_note(&c2, "John", 3, 16).unwrap().map(|n| n.body).as_deref(), Some("God's love -- the gift of the Son."));
        assert_eq!(get_note(&c2, "John", 3, 1).unwrap(), get_note(&c, "John", 3, 1).unwrap());
        assert_eq!(plan_progress(&c2).unwrap()[0].done_days, vec![1]);
        // importing the same backup again adds nothing new
        let again = import_backup(&mut c2, &json).unwrap();
        assert_eq!((again.bookmarks, again.notes, again.sermons), (0, 0, 0));
        assert_eq!(book_bookmarks(&c2, None).unwrap().len(), 2, "importing again adds no duplicates");
        book_bookmark_remove(&c, mark_id).unwrap();
        assert_eq!(book_bookmarks(&c, Some("own-grace")).unwrap().len(), 1);
        sermon_delete(&c, sermon.id).unwrap();
        assert!(sermon_list(&c).unwrap().is_empty());

        // toggling/clearing
        assert!(!toggle_bookmark(&c, "John", 3, 16).unwrap());
        save_note(&c, "John", 3, 16, "   ", None, &[]).unwrap();
        assert!(get_note(&c, "John", 3, 16).unwrap().is_none());
        assert!(import_backup(&mut c2, "{\"format\":\"something-else\",\"exported_at\":\"\"}").is_err());
        drop(c);
        drop(c2);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
    }

    #[test]
    fn basket_add_reorder_edit_remove() {
        let (mut c, dir) = temp_db();
        let a = basket_add(&c, "verse", "John 3:16 (BSB)", "For God so loved…", "{\"book\":\"John\"}").unwrap();
        let b = basket_add(&c, "commentary", "Matthew Henry on John 3:16", "…", "").unwrap();
        let t = basket_add(&c, "text", "", "Opening prayer", "").unwrap();
        assert!(basket_add(&c, "<script>", "", "", "").is_err());
        let ids = |c: &Connection| basket_list(c).unwrap().iter().map(|i| i.id).collect::<Vec<_>>();
        assert_eq!(ids(&c), vec![a, b, t]);
        basket_reorder(&mut c, &[t, a]).unwrap();
        assert_eq!(ids(&c), vec![t, a, b]);
        basket_update(&c, t, "", "Opening prayer and welcome").unwrap();
        assert_eq!(basket_list(&c).unwrap()[0].body, "Opening prayer and welcome");
        // a new item goes to the end, after reordering too
        let d = basket_add(&c, "note", "My note on John 3:16", "…", "").unwrap();
        assert_eq!(*ids(&c).last().unwrap(), d);
        basket_remove(&c, a).unwrap();
        assert_eq!(ids(&c), vec![t, b, d]);
        basket_clear(&c).unwrap();
        assert!(basket_list(&c).unwrap().is_empty());
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sermon_stage_venue_usage_and_templates() {
        let (mut c, dir) = temp_db();
        let body = r#"{"items":[{"id":"a","type":"material","material":{"key":"p:John|3|16:17","kind":"passage"}},{"id":"b","type":"heading","text":"Point"}]}"#;
        let id = sermon_save(
            &c,
            &Sermon { id: 0, title: "Faith".into(), series: "".into(), preached_on: "2026-10-18".into(), topics: "faith".into(), passages: "John 3:16–17".into(), body: body.into(), updated_at: "".into(), stage: "ready".into(), venue: " South Point ".into() },
        )
        .unwrap();
        let got = sermon_get(&c, id).unwrap().unwrap();
        assert_eq!((got.stage.as_str(), got.venue.as_str()), ("ready", "South Point"));
        // an unknown stage is stored as a draft
        sermon_save(&c, &Sermon { stage: "nonsense".into(), ..got.clone() }).unwrap();
        assert_eq!(sermon_get(&c, id).unwrap().unwrap().stage, "draft");
        assert_eq!(sermon_list(&c).unwrap()[0].venue, "South Point");

        let usage = sermon_usage(&c).unwrap();
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].keys, ["p:John|3|16:17"]);
        assert_eq!(usage[0].passages, "John 3:16–17");

        let t = sermon_template_save(&c, " My three points ", r#"{"sections":[]}"#).unwrap();
        assert_eq!(sermon_template_save(&c, "My three points", r#"{"sections":[1]}"#).unwrap(), t, "same name replaces");
        assert_eq!(sermon_templates(&c).unwrap()[0].body, r#"{"sections":[1]}"#);
        assert!(sermon_template_save(&c, "  ", "{}").is_err());

        // the backup carries stage, venue and templates
        let json = serde_json::to_string(&Backup {
            format: BACKUP_FORMAT.into(),
            exported_at: "".into(),
            sermons: sermons_all(&c).unwrap(),
            sermon_templates: sermon_templates(&c).unwrap(),
            ..Default::default()
        })
        .unwrap();
        let (mut other, dir2) = temp_db();
        import_backup(&mut other, &json).unwrap();
        let s2 = &sermon_list(&other).unwrap()[0];
        assert_eq!((s2.stage.as_str(), s2.venue.as_str()), ("draft", "South Point"));
        assert_eq!(sermon_templates(&other).unwrap().len(), 1);
        sermon_template_delete(&c, t).unwrap();
        assert!(sermon_templates(&c).unwrap().is_empty());
        let _ = &mut c;
        drop(c);
        drop(other);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
    }

    #[test]
    fn an_older_sermons_table_gets_stage_and_venue() {
        let dir = std::env::temp_dir().join(format!("bc-userdata-old-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            let c = Connection::open(dir.join("userdata.db")).unwrap();
            c.execute_batch(
                "CREATE TABLE sermons (id INTEGER PRIMARY KEY, title TEXT NOT NULL, series TEXT NOT NULL DEFAULT '', preached_on TEXT NOT NULL DEFAULT '',
                 topics TEXT NOT NULL DEFAULT '', passages TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
                 created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
                 INSERT INTO sermons (title, body) VALUES ('Old one', '{}');",
            )
            .unwrap();
        }
        let c = open(&dir).unwrap();
        let s = &sermon_list(&c).unwrap()[0];
        assert_eq!((s.title.as_str(), s.stage.as_str(), s.venue.as_str()), ("Old one", "draft", ""));
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn preachings_search_and_the_backup() {
        let (mut c, dir) = temp_db();
        let body = |idea: &str, words: &str, refs: &[(&str, i64, i64, i64)]| {
            let mut items: Vec<serde_json::Value> = vec![serde_json::json!({"id": "1", "type": "heading", "text": words})];
            for (b, ch, v, e) in refs {
                items.push(serde_json::json!({"id": "x", "type": "material", "material": {"key": "k", "kind": "passage", "title": "t", "text": "", "topic": "", "ref": {"book": b, "chapter": ch, "verse": v, "verseEnd": e}}}));
            }
            serde_json::json!({"bigIdea": idea, "items": items}).to_string()
        };
        let base = Sermon { id: 0, title: String::new(), series: String::new(), preached_on: String::new(), topics: String::new(), passages: String::new(), body: String::new(), updated_at: String::new(), stage: "draft".into(), venue: String::new() };
        let hope = sermon_save(&c, &Sermon { title: "Hope that holds".into(), series: "Romans".into(), body: body("God works all things for good", "Suffering is not the end", &[("Romans", 8, 28, 39)]), ..base.clone() }).unwrap();
        let faith = sermon_save(&c, &Sermon { title: "Faith comes by hearing".into(), series: "Romans".into(), body: body("Faith hears the word", "Preaching matters", &[("Romans", 10, 14, 17)]), ..base.clone() }).unwrap();
        let other = sermon_save(&c, &Sermon { title: "The shepherd".into(), body: body("", "", &[("Psalms", 23, 1, 200)]), stage: "ready".into(), ..base.clone() }).unwrap();

        // preached three times; the sermon follows its latest preaching
        for (d, v) in [("2025-01-12", "South Point"), ("2025-06-01", "Youth camp"), ("2026-03-08", "South Point")] {
            preaching_save(&c, &Preaching { id: 0, sermon_id: hope, date: d.into(), venue: v.into(), audience: String::new(), notes: String::new(), length_min: Some(35) }).unwrap();
        }
        assert!(preaching_save(&c, &Preaching { id: 0, sermon_id: hope, date: "soon".into(), venue: String::new(), audience: String::new(), notes: String::new(), length_min: None }).is_err());
        assert!(preaching_save(&c, &Preaching { id: 0, sermon_id: 999, date: "2026-01-01".into(), venue: String::new(), audience: String::new(), notes: String::new(), length_min: None }).is_err());
        let s = sermon_get(&c, hope).unwrap().unwrap();
        assert_eq!((s.preached_on.as_str(), s.stage.as_str()), ("2026-03-08", "preached"));
        assert_eq!(preachings(&c, hope).unwrap().len(), 3);
        assert_eq!(sermon_usage(&c).unwrap().iter().find(|u| u.id == hope).unwrap().preached.len(), 3);

        let find = |c: &Connection, q: SermonQuery| sermon_search(c, &q).unwrap().into_iter().map(|h| h.sermon.id).collect::<Vec<_>>();
        // words: the title, the big idea, the preacher's own text, the start of a word
        assert_eq!(find(&c, SermonQuery { words: "holds".into(), ..Default::default() }), [hope]);
        assert_eq!(find(&c, SermonQuery { words: "suffer".into(), ..Default::default() }), [hope], "a word's start finds it");
        assert_eq!(find(&c, SermonQuery { words: "faith word".into(), ..Default::default() }), [faith], "every word must be there");
        assert!(find(&c, SermonQuery { words: "zebra".into(), ..Default::default() }).is_empty());
        // Scripture: a chapter, or a verse inside a passage
        assert_eq!(find(&c, SermonQuery { book: "Romans".into(), chapter: Some(8), ..Default::default() }), [hope]);
        assert_eq!(find(&c, SermonQuery { book: "Romans".into(), chapter: Some(8), verse: Some(31), ..Default::default() }), [hope]);
        assert!(find(&c, SermonQuery { book: "Romans".into(), chapter: Some(8), verse: Some(1), verse_end: Some(5), ..Default::default() }).is_empty());
        assert_eq!(find(&c, SermonQuery { book: "Psalms".into(), chapter: Some(23), verse: Some(4), ..Default::default() }), [other], "a whole chapter");
        let mut both = find(&c, SermonQuery { book: "Romans".into(), ..Default::default() });
        both.sort();
        assert_eq!(both, [hope, faith]);
        // dates, place, series, stage, and the order
        assert_eq!(find(&c, SermonQuery { from: "2025-05-01".into(), to: "2025-07-01".into(), ..Default::default() }), [hope]);
        assert_eq!(find(&c, SermonQuery { venue: "camp".into(), ..Default::default() }), [hope]);
        assert_eq!(find(&c, SermonQuery { stage: "ready".into(), ..Default::default() }), [other]);
        assert_eq!(find(&c, SermonQuery { series: "Romans".into(), sort: "most".into(), ..Default::default() })[0], hope);
        assert_eq!(find(&c, SermonQuery { sort: "title".into(), ..Default::default() }), [faith, hope, other]);

        // a renamed sermon is found by its new words, not its old ones
        let mut s2 = sermon_get(&c, faith).unwrap().unwrap();
        s2.title = "Faith rests on the word".into();
        sermon_save(&c, &s2).unwrap();
        assert!(find(&c, SermonQuery { words: "comes".into(), ..Default::default() }).is_empty(), "the old title is gone (\"hearing\" still finds it: the big idea says \"hears\")");
        assert_eq!(find(&c, SermonQuery { words: "rests".into(), ..Default::default() }), [faith]);

        // a preaching taken out; the sermon's date follows
        let last = preachings(&c, hope).unwrap()[2].id;
        preaching_delete(&c, last).unwrap();
        assert_eq!(sermon_get(&c, hope).unwrap().unwrap().preached_on, "2025-06-01");

        // the backup carries the preachings to another computer, once
        let backup = Backup { format: BACKUP_FORMAT.into(), exported_at: String::new(), sermons: sermons_all(&c).unwrap(), sermon_preachings: preachings_all(&c).unwrap(), ..Default::default() };
        let json = serde_json::to_string(&backup).unwrap();
        let (mut c2, dir2) = temp_db();
        import_backup(&mut c2, &json).unwrap();
        import_backup(&mut c2, &json).unwrap();
        let h2 = sermon_search(&c2, &SermonQuery { words: "holds".into(), ..Default::default() }).unwrap();
        assert_eq!(h2.len(), 1);
        assert_eq!(h2[0].preachings.iter().map(|p| p.date.as_str()).collect::<Vec<_>>(), ["2025-01-12", "2025-06-01"]);
        assert_eq!(find(&c2, SermonQuery { book: "Romans".into(), chapter: Some(10), ..Default::default() }).len(), 1, "restored sermons are indexed");

        // deleting a sermon takes its preachings and index entries with it
        sermon_delete(&mut c, hope).unwrap();
        assert!(preachings(&c, hope).unwrap().is_empty());
        assert!(find(&c, SermonQuery { words: "holds".into(), ..Default::default() }).is_empty());
        drop(c);
        drop(c2);
        let _ = std::fs::remove_dir_all(dir);
        let _ = std::fs::remove_dir_all(dir2);
    }

    #[test]
    fn sermons_from_before_the_tracker_get_their_preaching() {
        let dir = std::env::temp_dir().join(format!("bc-userdata-old-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        {
            // a 2.7 database: sermons, no tracker, user_version 0
            let c = Connection::open(dir.join("userdata.db")).unwrap();
            c.execute_batch(
                r#"CREATE TABLE sermons (id INTEGER PRIMARY KEY, title TEXT NOT NULL, series TEXT NOT NULL DEFAULT '', preached_on TEXT NOT NULL DEFAULT '',
                 topics TEXT NOT NULL DEFAULT '', passages TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
                 stage TEXT NOT NULL DEFAULT 'draft', venue TEXT NOT NULL DEFAULT '');
                 INSERT INTO sermons (title, preached_on, body, stage, venue) VALUES ('Preached', '2024-05-05', '{"bigIdea":"Grace"}', 'preached', 'Hall');
                 INSERT INTO sermons (title, preached_on, body, stage) VALUES ('Planned', '2026-12-25', '{}', 'ready');"#,
            )
            .unwrap();
        }
        let c = open(&dir).unwrap();
        let all = sermon_search(&c, &SermonQuery::default()).unwrap();
        let got = |t: &str| all.iter().find(|h| h.sermon.title == t).unwrap();
        assert_eq!(got("Preached").preachings.iter().map(|p| (p.date.as_str(), p.venue.as_str())).collect::<Vec<_>>(), [("2024-05-05", "Hall")]);
        assert!(got("Planned").preachings.is_empty());
        assert_eq!(sermon_search(&c, &SermonQuery { words: "grace".into(), ..Default::default() }).unwrap().len(), 1, "indexed on the way in");
        let id = got("Preached").sermon.id;
        drop(c);
        // opening again does not add the preaching twice
        let c = open(&dir).unwrap();
        assert_eq!(preachings(&c, id).unwrap().len(), 1);
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
}
