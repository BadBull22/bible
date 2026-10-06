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
}

/// Merge a JSON backup into the current data. Existing notes are only overwritten when the
/// backup's copy is newer, so importing an old backup can't wipe out newer writing.
pub fn import_backup(conn: &mut Connection, json: &str) -> Result<ImportResult, String> {
    let b: Backup = serde_json::from_str(json).map_err(|e| format!("That file isn't a Bible Concordance study backup ({e})."))?;
    if b.format != BACKUP_FORMAT {
        return Err(format!("Unrecognised backup format \"{}\".", b.format));
    }
    let tx = conn.transaction().map_err(err)?;
    let mut r = ImportResult { notes: 0, highlights: 0, bookmarks: 0, plans: 0 };
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
    tx.commit().map_err(err)?;
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
        };
        let res = write_export(&dir, &stamp, &backup).unwrap();
        let md = std::fs::read_to_string(&res.markdown_path).unwrap();
        assert!(md.contains("John 3:16") && md.contains("gift of the Son"));
        assert!(md.contains("### John 3:1-8") && md.contains("Tags: New birth, nicodemus"), "{md}");
        let json = std::fs::read_to_string(&res.json_path).unwrap();

        let (mut c2, dir2) = temp_db();
        let r = import_backup(&mut c2, &json).unwrap();
        assert_eq!((r.bookmarks, r.highlights, r.notes, r.plans), (1, 2, 2, 1));
        assert_eq!(get_note(&c2, "John", 3, 16).unwrap().map(|n| n.body).as_deref(), Some("God's love -- the gift of the Son."));
        assert_eq!(get_note(&c2, "John", 3, 1).unwrap(), get_note(&c, "John", 3, 1).unwrap());
        assert_eq!(plan_progress(&c2).unwrap()[0].done_days, vec![1]);
        // importing the same backup again adds nothing new
        let again = import_backup(&mut c2, &json).unwrap();
        assert_eq!((again.bookmarks, again.notes), (0, 0));

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
}
