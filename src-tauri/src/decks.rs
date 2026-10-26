// The Sunday service's other presentations: the notices and the music, saved apart from any
// sermon so they can be reused, and the library of songs the words are kept in.
//
// A deck is the slides of one presentation (the same slides the sermon's slide page makes) kept as
// JSON; the database does not look inside it. A song is its sections (verse, chorus, ...) kept as
// JSON, with its words also in plain text so a song can be found by a line of it.

use crate::userdata::UserDataState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const MAX_BYTES: usize = 4 * 1024 * 1024;
/// "songlist": a chosen selection of songs, saved with a name and a date; "notice": one reusable notice in the library
/// (Welcome 1, Bible study on Tuesdays...), kept in an order the preacher sets (all in the same table).
const KINDS: [&str; 4] = ["notices", "music", "songlist", "notice"];

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Deck {
    #[serde(default)]
    pub id: i64,
    /// "notices", "music", "songlist" or "notice"
    pub kind: String,
    pub title: String,
    /// the slides and background (JSON); empty in a list
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub updated_at: String,
}

/// Every saved deck of a kind, the most recently changed first, without the slides.
pub fn deck_list(conn: &Connection, kind: &str) -> Result<Vec<Deck>, String> {
    // the notices in the library are in the order the preacher put them; the rest, the most recently changed first
    let order = if kind == "notice" { "position, id" } else { "updated_at DESC, id DESC" };
    let mut s = conn.prepare(&format!("SELECT id, kind, title, updated_at FROM decks WHERE kind = ?1 ORDER BY {order}")).map_err(err)?;
    let rows = s
        .query_map(params![kind], |r| Ok(Deck { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, body: String::new(), updated_at: r.get(3)? }))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn deck_get(conn: &Connection, id: i64) -> Result<Option<Deck>, String> {
    conn.query_row("SELECT id, kind, title, body, updated_at FROM decks WHERE id = ?1", params![id], |r| {
        Ok(Deck { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, body: r.get(3)?, updated_at: r.get(4)? })
    })
    .optional()
    .map_err(err)
}

/// Saves a new deck (id 0) or the changes to one; returns its id.
pub fn deck_save(conn: &Connection, d: &Deck) -> Result<i64, String> {
    let title = d.title.trim();
    if title.is_empty() {
        return Err("Give it a name before saving it.".into());
    }
    if !KINDS.contains(&d.kind.as_str()) {
        return Err(format!("Unknown kind of presentation: {}", d.kind));
    }
    if d.body.len() > MAX_BYTES {
        return Err("This is too large to save. Remove some of the slides.".into());
    }
    if d.id > 0 {
        let n = conn
            .execute("UPDATE decks SET title=?2, body=?3, updated_at=datetime('now','localtime') WHERE id=?1 AND kind=?4", params![d.id, title, d.body, d.kind])
            .map_err(err)?;
        if n > 0 {
            return Ok(d.id);
        }
    }
    // a new notice goes to the end of the library
    let position: i64 = conn.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM decks WHERE kind = ?1", params![d.kind], |r| r.get(0)).map_err(err)?;
    conn.execute("INSERT INTO decks (kind, title, body, position) VALUES (?1,?2,?3,?4)", params![d.kind, title, d.body, position]).map_err(err)?;
    Ok(conn.last_insert_rowid())
}

/// Puts the decks of a kind in the order of these ids (the first gets the first place).
pub fn deck_order(conn: &Connection, kind: &str, ids: &[i64]) -> Result<(), String> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute("UPDATE decks SET position = ?3 WHERE id = ?1 AND kind = ?2", params![id, kind, i as i64 + 1]).map_err(err)?;
    }
    Ok(())
}

pub fn deck_delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM decks WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Song {
    #[serde(default)]
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub author: String,
    /// the CCLI song number, if the church knows it
    #[serde(default)]
    pub ccli: String,
    /// the sections, JSON (`{"sections":[{"label","text"}],"arrangement":[..]}`); empty in a list
    #[serde(default)]
    pub body: String,
    /// the first line, for a list
    #[serde(default)]
    pub first: String,
    #[serde(default)]
    pub updated_at: String,
}

/// All the words of a song as plain lines, from its JSON body, to search in.
fn plain_words(body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    v["sections"].as_array().map(|a| a.iter().filter_map(|s| s["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

fn first_line(words: &str) -> String {
    words.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(80).collect()
}

/// The songs whose title, author or words contain the text (all of them for none), by title.
pub fn song_search(conn: &Connection, q: &str) -> Result<Vec<Song>, String> {
    let like = format!("%{}%", q.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let mut s = conn
        .prepare(
            "SELECT id, title, author, ccli, words, updated_at FROM songs
             WHERE title LIKE ?1 ESCAPE '\\' OR author LIKE ?1 ESCAPE '\\' OR words LIKE ?1 ESCAPE '\\'
             ORDER BY title COLLATE NOCASE, id",
        )
        .map_err(err)?;
    let rows = s
        .query_map(params![like], |r| {
            let words: String = r.get(4)?;
            Ok(Song { id: r.get(0)?, title: r.get(1)?, author: r.get(2)?, ccli: r.get(3)?, body: String::new(), first: first_line(&words), updated_at: r.get(5)? })
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

pub fn song_get(conn: &Connection, id: i64) -> Result<Option<Song>, String> {
    conn.query_row("SELECT id, title, author, ccli, body, updated_at FROM songs WHERE id = ?1", params![id], |r| {
        Ok(Song { id: r.get(0)?, title: r.get(1)?, author: r.get(2)?, ccli: r.get(3)?, body: r.get(4)?, first: String::new(), updated_at: r.get(5)? })
    })
    .optional()
    .map_err(err)
}

/// Saves a new song (id 0) or the changes to one; returns its id. A song with the title of one
/// already kept (and no id) replaces it, so searching and saving a song twice keeps one copy.
pub fn song_save(conn: &Connection, s: &Song) -> Result<i64, String> {
    let title = s.title.trim();
    if title.is_empty() {
        return Err("Give the song a title before saving it.".into());
    }
    if s.body.len() > MAX_BYTES {
        return Err("This song is too large to save.".into());
    }
    let words = plain_words(&s.body);
    let mut id = s.id;
    if id <= 0 {
        id = conn
            .query_row("SELECT id FROM songs WHERE title = ?1 COLLATE NOCASE AND author = ?2 COLLATE NOCASE", params![title, s.author.trim()], |r| r.get(0))
            .optional()
            .map_err(err)?
            .unwrap_or(0);
    }
    if id > 0 {
        let n = conn
            .execute(
                "UPDATE songs SET title=?2, author=?3, ccli=?4, words=?5, body=?6, updated_at=datetime('now','localtime') WHERE id=?1",
                params![id, title, s.author.trim(), s.ccli.trim(), words, s.body],
            )
            .map_err(err)?;
        if n > 0 {
            return Ok(id);
        }
    }
    conn.execute(
        "INSERT INTO songs (title, author, ccli, words, body) VALUES (?1,?2,?3,?4,?5)",
        params![title, s.author.trim(), s.ccli.trim(), words, s.body],
    )
    .map_err(err)?;
    Ok(conn.last_insert_rowid())
}

pub fn song_delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM songs WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- commands

fn conn<'a>(state: &'a State<UserDataState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(err)
}

#[tauri::command]
pub fn deck_list_cmd(state: State<UserDataState>, kind: String) -> Result<Vec<Deck>, String> {
    deck_list(&*conn(&state)?, &kind)
}

#[tauri::command]
pub fn deck_get_cmd(state: State<UserDataState>, id: i64) -> Result<Option<Deck>, String> {
    deck_get(&*conn(&state)?, id)
}

#[tauri::command]
pub fn deck_save_cmd(state: State<UserDataState>, deck: Deck) -> Result<i64, String> {
    deck_save(&*conn(&state)?, &deck)
}

#[tauri::command]
pub fn deck_order_cmd(state: State<UserDataState>, kind: String, ids: Vec<i64>) -> Result<(), String> {
    deck_order(&*conn(&state)?, &kind, &ids)
}

#[tauri::command]
pub fn deck_delete_cmd(state: State<UserDataState>, id: i64) -> Result<(), String> {
    deck_delete(&*conn(&state)?, id)
}

#[tauri::command]
pub fn song_search_cmd(state: State<UserDataState>, query: String) -> Result<Vec<Song>, String> {
    song_search(&*conn(&state)?, &query)
}

#[tauri::command]
pub fn song_get_cmd(state: State<UserDataState>, id: i64) -> Result<Option<Song>, String> {
    song_get(&*conn(&state)?, id)
}

#[tauri::command]
pub fn song_save_cmd(state: State<UserDataState>, song: Song) -> Result<i64, String> {
    song_save(&*conn(&state)?, &song)
}

#[tauri::command]
pub fn song_delete_cmd(state: State<UserDataState>, id: i64) -> Result<(), String> {
    song_delete(&*conn(&state)?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE decks (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
             CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', ccli TEXT NOT NULL DEFAULT '', words TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));",
        )
        .unwrap();
        c
    }

    #[test]
    fn decks_are_kept_by_kind_and_updated_in_place() {
        let c = db();
        let mut d = Deck { id: 0, kind: "notices".into(), title: "Notices".into(), body: "{\"slides\":[]}".into(), updated_at: String::new() };
        assert!(deck_save(&c, &Deck { title: " ".into(), ..d.clone() }).is_err());
        assert!(deck_save(&c, &Deck { kind: "sermon".into(), ..d.clone() }).is_err(), "sermons are not decks");
        d.id = deck_save(&c, &d).unwrap();
        d.title = "Notices, March".into();
        assert_eq!(deck_save(&c, &d).unwrap(), d.id, "saving again updates, it doesn't add");
        deck_save(&c, &Deck { id: 0, kind: "music".into(), title: "Songs".into(), ..d.clone() }).unwrap();
        let n = deck_list(&c, "notices").unwrap();
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].title, "Notices, March");
        assert_eq!(n[0].body, "", "a list has no slides");
        assert_eq!(deck_get(&c, d.id).unwrap().unwrap().body, "{\"slides\":[]}");
        assert_eq!(deck_list(&c, "music").unwrap().len(), 1);
        deck_delete(&c, d.id).unwrap();
        assert!(deck_list(&c, "notices").unwrap().is_empty());
    }

    #[test]
    fn notices_in_the_library_keep_the_order_they_are_given() {
        let c = db();
        let n = |t: &str| Deck { id: 0, kind: "notice".into(), title: t.into(), body: "{}".into(), updated_at: String::new() };
        let a = deck_save(&c, &n("Welcome 1")).unwrap();
        let b = deck_save(&c, &n("Bible study")).unwrap();
        let d = deck_save(&c, &n("Birthdays")).unwrap();
        let titles = |c: &Connection| deck_list(c, "notice").unwrap().into_iter().map(|d| d.title).collect::<Vec<_>>();
        assert_eq!(titles(&c), vec!["Welcome 1", "Bible study", "Birthdays"], "new ones go to the end");
        deck_order(&c, "notice", &[d, a, b]).unwrap();
        assert_eq!(titles(&c), vec!["Birthdays", "Welcome 1", "Bible study"]);
        // changing one does not move it
        deck_save(&c, &Deck { id: a, ..n("Welcome one") }).unwrap();
        assert_eq!(titles(&c), vec!["Birthdays", "Welcome one", "Bible study"]);
        // the order of the library does not touch the other kinds, or a deck of another kind with the same id
        deck_save(&c, &Deck { id: 0, kind: "notices".into(), title: "Notices for March".into(), body: "{}".into(), updated_at: String::new() }).unwrap();
        deck_order(&c, "notices", &[a]).unwrap();
        assert_eq!(titles(&c), vec!["Birthdays", "Welcome one", "Bible study"]);
        assert_eq!(deck_list(&c, "notices").unwrap().len(), 1);
    }

    #[test]
    fn songs_are_found_by_a_line_of_them_and_kept_once() {
        let c = db();
        let body = r#"{"sections":[{"label":"Verse 1","text":"Amazing grace how sweet the sound\nThat saved a wretch like me"},{"label":"Chorus","text":"My chains are gone"}],"arrangement":[0,1]}"#;
        let a = song_save(&c, &Song { id: 0, title: "Amazing Grace".into(), author: "John Newton".into(), ccli: String::new(), body: body.into(), first: String::new(), updated_at: String::new() }).unwrap();
        let again = song_save(&c, &Song { id: 0, title: "amazing grace".into(), author: "John Newton".into(), ccli: "4".into(), body: body.into(), first: String::new(), updated_at: String::new() }).unwrap();
        assert_eq!(a, again, "the same song saved twice stays one song");
        assert_eq!(song_search(&c, "").unwrap().len(), 1);
        let hit = song_search(&c, "wretch like").unwrap();
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].first, "Amazing grace how sweet the sound");
        assert_eq!(hit[0].ccli, "4");
        assert!(song_search(&c, "100%").unwrap().is_empty(), "a % is a letter, not a wildcard");
        assert_eq!(song_get(&c, a).unwrap().unwrap().body, body);
        song_delete(&c, a).unwrap();
        assert!(song_search(&c, "").unwrap().is_empty());
    }
}
