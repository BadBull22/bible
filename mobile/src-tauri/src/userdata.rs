//! The reader's own bookmarks and highlights, in a small database of their own in the
//! app's data folder (the Bible database is replaced with each version of the app; this
//! one never is).

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// The highlight colours, named as in the desktop app so a backup means the same in both.
pub const COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "orange"];

pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(err)?;
    init(&conn)?;
    Ok(conn)
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bookmarks (
            book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (book, chapter, verse));
         CREATE TABLE IF NOT EXISTS highlights (
            book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, color TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (book, chapter, verse));
         -- verse_end and tags are the desktop app's (a note on a range; its tags): kept, so a
         -- note made there goes back unchanged, but not shown or edited on the phone
         CREATE TABLE IF NOT EXISTS notes (
            book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            verse_end INTEGER, tags TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (book, chapter, verse));
         CREATE TABLE IF NOT EXISTS plans (plan_id TEXT PRIMARY KEY, started_on TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS plan_days (
            plan_id TEXT NOT NULL, day INTEGER NOT NULL,
            done_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (plan_id, day));",
    )
    .map_err(err)
}

/// What is marked in one chapter: the bookmarked verses, each highlighted verse's colour,
/// and the verses with a note.
#[derive(Serialize, Debug, Default, PartialEq)]
pub struct ChapterMarks {
    pub bookmarks: Vec<i64>,
    pub highlights: Vec<(i64, String)>,
    pub notes: Vec<i64>,
}

pub fn chapter_marks(conn: &Connection, book: &str, chapter: i64) -> Result<ChapterMarks, String> {
    let mut b = conn.prepare("SELECT verse FROM bookmarks WHERE book = ?1 AND chapter = ?2 ORDER BY verse").map_err(err)?;
    let bookmarks = b.query_map(params![book, chapter], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    let mut h = conn.prepare("SELECT verse, color FROM highlights WHERE book = ?1 AND chapter = ?2 ORDER BY verse").map_err(err)?;
    let highlights = h.query_map(params![book, chapter], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    let mut n = conn.prepare("SELECT verse FROM notes WHERE book = ?1 AND chapter = ?2 ORDER BY verse").map_err(err)?;
    let notes = n.query_map(params![book, chapter], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    Ok(ChapterMarks { bookmarks, highlights, notes })
}

/// Bookmarks the verse, or removes its bookmark. Returns whether it is bookmarked now.
pub fn toggle_bookmark(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<bool, String> {
    let removed = conn.execute("DELETE FROM bookmarks WHERE book = ?1 AND chapter = ?2 AND verse = ?3", params![book, chapter, verse]).map_err(err)?;
    if removed == 0 {
        conn.execute("INSERT INTO bookmarks (book, chapter, verse) VALUES (?1,?2,?3)", params![book, chapter, verse]).map_err(err)?;
    }
    Ok(removed == 0)
}

/// Highlights the verse in a colour, or (None) clears its highlight.
pub fn set_highlight(conn: &Connection, book: &str, chapter: i64, verse: i64, color: Option<&str>) -> Result<(), String> {
    match color {
        Some(c) if COLORS.contains(&c) => conn
            .execute(
                "INSERT INTO highlights (book, chapter, verse, color) VALUES (?1,?2,?3,?4)
                 ON CONFLICT (book, chapter, verse) DO UPDATE SET color = excluded.color",
                params![book, chapter, verse, c],
            )
            .map(|_| ())
            .map_err(err),
        Some(c) => Err(format!("\"{c}\" isn't one of the highlight colours.")),
        None => conn.execute("DELETE FROM highlights WHERE book = ?1 AND chapter = ?2 AND verse = ?3", params![book, chapter, verse]).map(|_| ()).map_err(err),
    }
}

/// A bookmarked, highlighted or noted verse, for the lists (the text is added by the caller).
#[derive(Serialize, Debug, Clone)]
pub struct Mark {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    /// the highlight's colour, or the note; "" for a bookmark
    pub color: String,
    pub created_at: String,
    pub text: String,
}

/// Newest first.
pub fn bookmarks(conn: &Connection) -> Result<Vec<Mark>, String> {
    let mut s = conn.prepare("SELECT book, chapter, verse, created_at FROM bookmarks ORDER BY created_at DESC, rowid DESC").map_err(err)?;
    let rows = s
        .query_map([], |r| Ok(Mark { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, color: String::new(), created_at: r.get(3)?, text: String::new() }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Newest first.
pub fn highlights(conn: &Connection) -> Result<Vec<Mark>, String> {
    let mut s = conn.prepare("SELECT book, chapter, verse, color, created_at FROM highlights ORDER BY created_at DESC, rowid DESC").map_err(err)?;
    let rows = s
        .query_map([], |r| Ok(Mark { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, color: r.get(3)?, created_at: r.get(4)?, text: String::new() }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------- notes

pub fn note(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<String, String> {
    let body: Option<String> = conn.query_row("SELECT body FROM notes WHERE book = ?1 AND chapter = ?2 AND verse = ?3", params![book, chapter, verse], |r| r.get(0)).optional().map_err(err)?;
    Ok(body.unwrap_or_default())
}

/// Saves the note on a verse; an empty note removes it.
pub fn set_note(conn: &Connection, book: &str, chapter: i64, verse: i64, body: &str) -> Result<(), String> {
    let body = body.trim();
    if body.is_empty() {
        conn.execute("DELETE FROM notes WHERE book = ?1 AND chapter = ?2 AND verse = ?3", params![book, chapter, verse]).map_err(err)?;
    } else {
        conn.execute(
            "INSERT INTO notes (book, chapter, verse, body) VALUES (?1,?2,?3,?4)
             ON CONFLICT (book, chapter, verse) DO UPDATE SET body = excluded.body, updated_at = datetime('now','localtime')",
            params![book, chapter, verse, body],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// Most recently changed first; the note is in `color`.
pub fn notes(conn: &Connection) -> Result<Vec<Mark>, String> {
    let mut s = conn.prepare("SELECT book, chapter, verse, body, updated_at FROM notes ORDER BY updated_at DESC, rowid DESC").map_err(err)?;
    let rows = s
        .query_map([], |r| Ok(Mark { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, color: r.get(3)?, created_at: r.get(4)?, text: String::new() }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------- reading plans
//
// The plans themselves are worked out by the page from the list of books (as in the desktop
// app); only when one was started and which days are ticked off is kept.

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PlanProgress {
    pub plan_id: String,
    pub started_on: String,
    #[serde(default)]
    pub done_days: Vec<i64>,
}

pub fn plan_progress(conn: &Connection) -> Result<Vec<PlanProgress>, String> {
    let mut s = conn.prepare("SELECT plan_id, started_on FROM plans ORDER BY started_on").map_err(err)?;
    let plans: Vec<(String, String)> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    let mut days = conn.prepare("SELECT day FROM plan_days WHERE plan_id = ?1 ORDER BY day").map_err(err)?;
    let mut out = Vec::new();
    for (plan_id, started_on) in plans {
        let done_days = days.query_map(params![plan_id], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
        out.push(PlanProgress { plan_id, started_on, done_days });
    }
    Ok(out)
}

pub fn start_plan(conn: &Connection, plan_id: &str, started_on: &str) -> Result<(), String> {
    conn.execute("INSERT OR REPLACE INTO plans (plan_id, started_on) VALUES (?1,?2)", params![plan_id, started_on]).map_err(err)?;
    Ok(())
}

/// Stops a plan and forgets its ticked-off days.
pub fn stop_plan(conn: &Connection, plan_id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM plan_days WHERE plan_id = ?1", params![plan_id]).map_err(err)?;
    conn.execute("DELETE FROM plans WHERE plan_id = ?1", params![plan_id]).map_err(err)?;
    Ok(())
}

pub fn set_plan_day(conn: &Connection, plan_id: &str, day: i64, done: bool) -> Result<(), String> {
    if done {
        conn.execute("INSERT OR IGNORE INTO plan_days (plan_id, day) VALUES (?1,?2)", params![plan_id, day]).map_err(err)?;
    } else {
        conn.execute("DELETE FROM plan_days WHERE plan_id = ?1 AND day = ?2", params![plan_id, day]).map_err(err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- backup
//
// The same file as the desktop app's My Study backup ("bible-concordance-study/1"), so one
// made on the phone restores on the computer and the other way round. The desktop file also
// carries sermons and bookmarks in Library books, which the phone has no place for and leaves
// alone. Restoring adds to what is here and never deletes: a bookmark, highlight or ticked
// day already here stays as it is, and a note is replaced only by a newer copy of itself.

pub const BACKUP_FORMAT: &str = "bible-concordance-study/1";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StudyItem {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    /// the highlight's colour, or the note; empty for a bookmark
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verse_end: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Backup {
    pub format: String,
    #[serde(default)]
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

/// How many of each a backup held, or a restore brought in.
#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Counts {
    pub bookmarks: usize,
    pub highlights: usize,
    pub notes: usize,
    pub plans: usize,
}

pub fn backup(conn: &Connection) -> Result<Backup, String> {
    let items = |sql: &str| -> Result<Vec<StudyItem>, String> {
        let mut s = conn.prepare(sql).map_err(err)?;
        let rows = s
            .query_map([], |r| {
                let tags: String = r.get(7)?;
                Ok(StudyItem {
                    book: r.get(0)?,
                    chapter: r.get(1)?,
                    verse: r.get(2)?,
                    value: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                    verse_end: r.get(6)?,
                    tags: tags.split(',').map(str::trim).filter(|t| !t.is_empty()).map(String::from).collect(),
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    };
    Ok(Backup {
        format: BACKUP_FORMAT.into(),
        exported_at: conn.query_row("SELECT datetime('now','localtime')", [], |r| r.get(0)).map_err(err)?,
        bookmarks: items("SELECT book, chapter, verse, '', created_at, '', NULL, '' FROM bookmarks ORDER BY created_at, rowid")?,
        highlights: items("SELECT book, chapter, verse, color, created_at, '', NULL, '' FROM highlights ORDER BY created_at, rowid")?,
        notes: items("SELECT book, chapter, verse, body, created_at, updated_at, verse_end, tags FROM notes ORDER BY created_at, rowid")?,
        plans: plan_progress(conn)?,
    })
}

pub fn backup_json(conn: &Connection) -> Result<(String, Counts), String> {
    let b = backup(conn)?;
    let counts = Counts { bookmarks: b.bookmarks.len(), highlights: b.highlights.len(), notes: b.notes.len(), plans: b.plans.len() };
    Ok((serde_json::to_string_pretty(&b).map_err(err)?, counts))
}

/// Adds a backup's contents to what is here. Returns how many of each were new (or, for a
/// note, newer).
pub fn restore(conn: &mut Connection, json: &str) -> Result<Counts, String> {
    let b: Backup = serde_json::from_str(json.trim_start_matches('\u{feff}')).map_err(|_| "That file isn't a Bible Concordance backup.".to_string())?;
    if b.format != BACKUP_FORMAT {
        return Err("That file isn't a Bible Concordance backup this version can read.".into());
    }
    let now = |s: &str| if s.is_empty() { None } else { Some(s.to_string()) };
    let tx = conn.transaction().map_err(err)?;
    let mut n = Counts::default();
    for m in &b.bookmarks {
        n.bookmarks += tx
            .execute("INSERT OR IGNORE INTO bookmarks (book, chapter, verse, created_at) VALUES (?1,?2,?3, coalesce(?4, datetime('now','localtime')))", params![m.book, m.chapter, m.verse, now(&m.created_at)])
            .map_err(err)?;
    }
    for h in &b.highlights {
        // the desktop app has more colours than the phone: one of those is kept as the nearest of the phone's
        let color = match h.value.as_str() {
            c if COLORS.contains(&c) => c,
            "lemon" => "yellow",
            "lime" => "green",
            "sky" | "violet" => "blue",
            "rose" => "pink",
            "red" => "orange",
            _ => "yellow",
        };
        n.highlights += tx
            .execute(
                "INSERT OR IGNORE INTO highlights (book, chapter, verse, color, created_at) VALUES (?1,?2,?3,?4, coalesce(?5, datetime('now','localtime')))",
                params![h.book, h.chapter, h.verse, color, now(&h.created_at)],
            )
            .map_err(err)?;
    }
    for note in &b.notes {
        if note.value.trim().is_empty() {
            continue;
        }
        let updated = if note.updated_at.is_empty() { note.created_at.clone() } else { note.updated_at.clone() };
        n.notes += tx
            .execute(
                "INSERT INTO notes (book, chapter, verse, body, created_at, updated_at, verse_end, tags)
                 VALUES (?1,?2,?3,?4, coalesce(?5, datetime('now','localtime')), coalesce(?6, datetime('now','localtime')), ?7, ?8)
                 ON CONFLICT (book, chapter, verse) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, verse_end = excluded.verse_end, tags = excluded.tags
                 WHERE excluded.updated_at > notes.updated_at",
                params![note.book, note.chapter, note.verse, note.value, now(&note.created_at), now(&updated), note.verse_end, note.tags.join(",")],
            )
            .map_err(err)?;
    }
    for p in &b.plans {
        let mut changed = tx.execute("INSERT OR IGNORE INTO plans (plan_id, started_on) VALUES (?1,?2)", params![p.plan_id, p.started_on]).map_err(err)?;
        for d in &p.done_days {
            changed += tx.execute("INSERT OR IGNORE INTO plan_days (plan_id, day) VALUES (?1,?2)", params![p.plan_id, d]).map_err(err)?;
        }
        n.plans += usize::from(changed > 0);
    }
    tx.commit().map_err(err)?;
    Ok(n)
}
