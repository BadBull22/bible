//! Keeping the reader's data in step with their other computers and phone: the desktop's
//! records on top of the shared engine (`bible_core::sync`, which explains how it merges).
//! A computer keeps, besides the bookmarks, highlights, notes and reading plans every device
//! keeps, its sermons (`sermon|<uid>`), sermon templates (`tmpl|<name>`), when sermons were
//! preached (`preach|<uid>`) and the basket (`basket|<uid>`). Those are numbered differently
//! on each computer, so each also has a `uid`, the same everywhere.

use bible_core::sync::{self as core, i, kind, rest, s, Rec, Store};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

pub use bible_core::sync::{set_setting, setting, SyncReport};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The sync tables, and a `uid` on sermons, preachings and basket items.
pub fn init(conn: &Connection) -> Result<(), String> {
    core::init(conn)?;
    for t in ["sermons", "sermon_preachings", "basket"] {
        core::add_column(conn, t, "uid", "TEXT")?;
    }
    give_uids(conn)
}

/// A uid for each sermon, preaching and basket item that has none yet (new since the last
/// sync, or from before it existed).
fn give_uids(conn: &Connection) -> Result<(), String> {
    for t in ["sermons", "sermon_preachings", "basket"] {
        conn.execute(&format!("UPDATE {t} SET uid = lower(hex(randomblob(12))) WHERE uid IS NULL OR uid = ''"), []).map_err(err)?;
    }
    Ok(())
}

fn sermon_id(conn: &Connection, uid: &str) -> Result<Option<i64>, String> {
    conn.query_row("SELECT id FROM sermons WHERE uid = ?1", params![uid], |r| r.get(0)).optional().map_err(err)
}

/// One sync of this computer with the shared folder.
pub fn sync(conn: &mut Connection, folder: &Path, name: &str, device_kind: &str) -> Result<SyncReport, String> {
    core::sync(conn, &Desktop, &core::DirFolder::new(folder)?, name, device_kind)
}

pub fn sync_media(local: &Path, folder: &Path) -> Result<usize, String> {
    core::sync_media(local, folder)
}

/// What a computer keeps in step.
pub struct Desktop;

const KINDS: [&str; 9] = ["bm", "hl", "note", "plan", "pday", "sermon", "tmpl", "preach", "basket"];

impl Store for Desktop {
    fn kinds(&self) -> &[&'static str] {
        &KINDS
    }

    fn collect(&self, conn: &Connection) -> Result<BTreeMap<String, Value>, String> {
        give_uids(conn)?;
        let mut out = BTreeMap::new();
        core::common_collect(conn, &mut out)?;
        let mut put = |sql: &str, f: &dyn Fn(&rusqlite::Row) -> rusqlite::Result<(String, Value)>| -> Result<(), String> {
            let mut st = conn.prepare(sql).map_err(err)?;
            for r in st.query_map([], |r| f(r)).map_err(err)? {
                let (k, v) = r.map_err(err)?;
                out.insert(k, v);
            }
            Ok(())
        };
        put("SELECT uid, title, series, preached_on, topics, passages, body, stage, venue, created_at, updated_at FROM sermons", &|r| {
            Ok((
                format!("sermon|{}", r.get::<_, String>(0)?),
                json!({
                    "title": r.get::<_, String>(1)?, "series": r.get::<_, String>(2)?, "preached_on": r.get::<_, String>(3)?,
                    "topics": r.get::<_, String>(4)?, "passages": r.get::<_, String>(5)?, "body": r.get::<_, String>(6)?,
                    "stage": r.get::<_, String>(7)?, "venue": r.get::<_, String>(8)?, "created_at": r.get::<_, String>(9)?, "updated_at": r.get::<_, String>(10)?,
                }),
            ))
        })?;
        put("SELECT name, body FROM sermon_templates", &|r| Ok((format!("tmpl|{}", r.get::<_, String>(0)?), json!({ "body": r.get::<_, String>(1)? }))))?;
        put(
            "SELECT p.uid, s.uid, p.date, p.venue, p.audience, p.notes, p.length_min FROM sermon_preachings p JOIN sermons s ON s.id = p.sermon_id",
            &|r| {
                Ok((
                    format!("preach|{}", r.get::<_, String>(0)?),
                    json!({ "sermon": r.get::<_, String>(1)?, "date": r.get::<_, String>(2)?, "venue": r.get::<_, String>(3)?, "audience": r.get::<_, String>(4)?, "notes": r.get::<_, String>(5)?, "length_min": r.get::<_, Option<i64>>(6)? }),
                ))
            },
        )?;
        put("SELECT uid, position, kind, title, body, meta, created_at FROM basket", &|r| {
            Ok((
                format!("basket|{}", r.get::<_, String>(0)?),
                json!({ "position": r.get::<_, i64>(1)?, "kind": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?, "body": r.get::<_, String>(4)?, "meta": r.get::<_, String>(5)?, "created_at": r.get::<_, String>(6)? }),
            ))
        })?;
        Ok(out)
    }

    fn apply(&self, conn: &Connection, key: &str, v: Option<&Value>) -> Result<bool, String> {
        if core::common_apply(conn, key, v)? {
            return Ok(true);
        }
        match (kind(key), v) {
            ("sermon", None) => {
                if let Some(id) = sermon_id(conn, rest(key))? {
                    crate::userdata::sermon_delete(conn, id)?;
                }
            }
            ("sermon", Some(v)) => {
                let uid = rest(key);
                let vals = params![s(v, "title"), s(v, "series"), s(v, "preached_on"), s(v, "topics"), s(v, "passages"), s(v, "body"), s(v, "stage"), s(v, "venue"), s(v, "created_at"), s(v, "updated_at"), uid];
                let id = match sermon_id(conn, uid)? {
                    Some(id) => {
                        conn.execute(
                            "UPDATE sermons SET title=?1, series=?2, preached_on=?3, topics=?4, passages=?5, body=?6, stage=?7, venue=?8, created_at=?9, updated_at=?10 WHERE uid=?11",
                            vals,
                        )
                        .map_err(err)?;
                        id
                    }
                    None => {
                        conn.execute(
                            "INSERT INTO sermons (title, series, preached_on, topics, passages, body, stage, venue, created_at, updated_at, uid) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                            vals,
                        )
                        .map_err(err)?;
                        conn.last_insert_rowid()
                    }
                };
                crate::userdata::index_sermon(conn, id)?;
            }
            ("tmpl", None) => {
                conn.execute("DELETE FROM sermon_templates WHERE name = ?1", params![rest(key)]).map_err(err)?;
            }
            ("tmpl", Some(v)) => {
                conn.execute(
                    "INSERT INTO sermon_templates (name, body) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET body=?2, updated_at=datetime('now','localtime')",
                    params![rest(key), s(v, "body")],
                )
                .map_err(err)?;
            }
            ("preach", None) => {
                conn.execute("DELETE FROM sermon_preachings WHERE uid = ?1", params![rest(key)]).map_err(err)?;
            }
            ("preach", Some(v)) => {
                let Some(sid) = sermon_id(conn, &s(v, "sermon"))? else { return Ok(false) };
                let vals = params![sid, s(v, "date"), s(v, "venue"), s(v, "audience"), s(v, "notes"), i(v, "length_min"), rest(key)];
                let n = conn
                    .execute("UPDATE sermon_preachings SET sermon_id=?1, date=?2, venue=?3, audience=?4, notes=?5, length_min=?6 WHERE uid=?7", vals)
                    .map_err(err)?;
                if n == 0 {
                    conn.execute("INSERT INTO sermon_preachings (sermon_id, date, venue, audience, notes, length_min, uid) VALUES (?1,?2,?3,?4,?5,?6,?7)", vals).map_err(err)?;
                }
            }
            ("basket", None) => {
                conn.execute("DELETE FROM basket WHERE uid = ?1", params![rest(key)]).map_err(err)?;
            }
            ("basket", Some(v)) => {
                let vals = params![i(v, "position").unwrap_or(0), s(v, "kind"), s(v, "title"), s(v, "body"), s(v, "meta"), s(v, "created_at"), rest(key)];
                let n = conn.execute("UPDATE basket SET position=?1, kind=?2, title=?3, body=?4, meta=?5, created_at=?6 WHERE uid=?7", vals).map_err(err)?;
                if n == 0 {
                    conn.execute("INSERT INTO basket (position, kind, title, body, meta, created_at, uid) VALUES (?1,?2,?3,?4,?5,?6,?7)", vals).map_err(err)?;
                }
            }
            _ => {}
        }
        Ok(true)
    }

    fn order(&self, key: &str) -> u8 {
        match kind(key) {
            "sermon" => 0,
            "preach" => 2,
            _ => 1,
        }
    }

    /// The first sync between two computers that both already have the same sermons (from a
    /// backup): the same sermon has a different uid on each. A sermon here that no other
    /// device knows takes the other's uid when its title and creation time match, rather than
    /// arriving twice. The same for preachings (sermon and date) and basket items.
    fn prepare(&self, conn: &Connection, theirs: &HashMap<String, (Rec, String)>) -> Result<(), String> {
        give_uids(conn)?;
        let known = |k: &str| theirs.contains_key(k);
        let adopt = |table: &str, kind: &str, uid: &str, mine: Vec<String>| -> Result<(), String> {
            if let Some(m) = mine.into_iter().find(|m| !known(&format!("{kind}|{m}"))) {
                conn.execute(&format!("UPDATE {table} SET uid = ?1 WHERE uid = ?2"), params![uid, m]).map_err(err)?;
                conn.execute("UPDATE sync_state SET key = ?1 WHERE key = ?2", params![format!("{kind}|{uid}"), format!("{kind}|{m}")]).map_err(err)?;
            }
            Ok(())
        };
        let uids = |sql: &str, p: &[&dyn rusqlite::ToSql]| -> Result<Vec<String>, String> {
            let mut st = conn.prepare(sql).map_err(err)?;
            let rows = st.query_map(p, |r| r.get(0)).map_err(err)?;
            rows.collect::<Result<_, _>>().map_err(err)
        };
        let mut list: Vec<(&String, &Value)> = theirs.iter().filter_map(|(k, (r, _))| if r.d { None } else { r.v.as_ref().map(|v| (k, v)) }).collect();
        list.sort_by_key(|(k, _)| (self.order(k), (*k).clone()));
        for (k, v) in list {
            let uid = rest(k);
            match kind(k) {
                "sermon" if sermon_id(conn, uid)?.is_none() => {
                    let mine = uids("SELECT uid FROM sermons WHERE title = ?1 AND created_at = ?2", &[&s(v, "title"), &s(v, "created_at")])?;
                    adopt("sermons", "sermon", uid, mine)?;
                }
                "preach" => {
                    let here: bool = conn.query_row("SELECT 1 FROM sermon_preachings WHERE uid = ?1", params![uid], |_| Ok(true)).optional().map_err(err)?.unwrap_or(false);
                    if let (false, Some(sid)) = (here, sermon_id(conn, &s(v, "sermon"))?) {
                        let mine = uids("SELECT uid FROM sermon_preachings WHERE sermon_id = ?1 AND date = ?2", &[&sid, &s(v, "date")])?;
                        adopt("sermon_preachings", "preach", uid, mine)?;
                    }
                }
                "basket" => {
                    let here: bool = conn.query_row("SELECT 1 FROM basket WHERE uid = ?1", params![uid], |_| Ok(true)).optional().map_err(err)?.unwrap_or(false);
                    if !here {
                        let mine = uids("SELECT uid FROM basket WHERE title = ?1 AND body = ?2", &[&s(v, "title"), &s(v, "body")])?;
                        adopt("basket", "basket", uid, mine)?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// A sermon's "preached on" and stage follow its preachings.
    fn finish(&self, conn: &Connection, applied: &[(String, Option<Value>)]) -> Result<(), String> {
        for (k, v) in applied {
            if let (true, Some(v)) = (kind(k) == "preach", v) {
                if let Some(id) = sermon_id(conn, &s(v, "sermon"))? {
                    crate::userdata::follow_preachings(conn, id)?;
                }
            }
        }
        Ok(())
    }

    /// The same sermon changed here and on another computer: theirs is kept as a copy.
    fn clash(&self, conn: &Connection, key: &str, theirs: &Value, from: &str) -> Result<Option<(Vec<String>, String)>, String> {
        if kind(key) != "sermon" {
            return Ok(None);
        }
        let uid: String = conn.query_row("SELECT lower(hex(randomblob(12)))", [], |r| r.get(0)).map_err(err)?;
        let mut copy = theirs.clone();
        copy["title"] = Value::String(format!("{} (from {from})", s(theirs, "title")));
        let copy_key = format!("sermon|{uid}");
        self.apply(conn, &copy_key, Some(&copy))?;
        Ok(Some((vec![copy_key], format!("The sermon “{}” was changed here and on {from}: theirs is kept as a copy beside yours.", s(theirs, "title")))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn device(dir: &Path, name: &str) -> Connection {
        let d = dir.join(name);
        let conn = crate::userdata::open(&d).unwrap();
        init(&conn).unwrap();
        conn
    }
    /// One sync of a computer, as the app does it.
    fn sync(conn: &mut Connection, folder: &Path, name: &str, kind: &str) -> Result<SyncReport, String> {
        super::sync(conn, folder, name, kind)
    }
    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn two_devices_keep_in_step() {
        let root = std::env::temp_dir().join(format!("bc-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = root.join("shared");
        let mut pc = device(&root, "pc");
        let mut phone = device(&root, "phone");

        // a note and a highlight on the PC reach the phone
        crate::userdata::save_note(&pc, "John", 3, 16, "God so loved", None, &[]).unwrap();
        crate::userdata::set_highlight(&pc, "John", 3, 16, Some("yellow")).unwrap();
        let r = sync(&mut pc, &folder, "Study PC", "computer").unwrap();
        assert_eq!((r.sent, r.received), (2, 0));
        let r = sync(&mut phone, &folder, "Phone", "phone").unwrap();
        assert_eq!(r.received, 2);
        assert_eq!(r.devices[0].name, "Study PC");
        assert_eq!(crate::userdata::get_note(&phone, "John", 3, 16).unwrap().unwrap().body, "God so loved");

        // nothing new: nothing moves, and nothing comes back as "changed"
        let r = sync(&mut pc, &folder, "Study PC", "computer").unwrap();
        assert_eq!((r.sent, r.received), (0, 0), "{r:?}");
        let r = sync(&mut phone, &folder, "Phone", "phone").unwrap();
        assert_eq!((r.sent, r.received), (0, 0), "{r:?}");

        // deleted on the phone: deleted on the PC, and not brought back
        crate::userdata::set_highlight(&phone, "John", 3, 16, None).unwrap();
        sync(&mut phone, &folder, "Phone", "phone").unwrap();
        let r = sync(&mut pc, &folder, "Study PC", "computer").unwrap();
        assert_eq!(r.received, 1);
        assert_eq!(count(&pc, "SELECT count(*) FROM highlights"), 0);
        sync(&mut phone, &folder, "Phone", "phone").unwrap();
        assert_eq!(count(&phone, "SELECT count(*) FROM highlights"), 0);

        // the same note changed on both before they synced: both texts are kept
        crate::userdata::save_note(&pc, "John", 3, 16, "Loved the world", None, &[]).unwrap();
        crate::userdata::save_note(&phone, "John", 3, 16, "Whoever believes", None, &[]).unwrap();
        sync(&mut phone, &folder, "Phone", "phone").unwrap();
        let r = sync(&mut pc, &folder, "Study PC", "computer").unwrap();
        assert_eq!(r.conflicts.len(), 1, "{r:?}");
        let body = crate::userdata::get_note(&pc, "John", 3, 16).unwrap().unwrap().body;
        assert!(body.contains("Loved the world") && body.contains("Whoever believes") && body.contains("from Phone"), "{body}");
        sync(&mut phone, &folder, "Phone", "phone").unwrap();
        assert_eq!(crate::userdata::get_note(&phone, "John", 3, 16).unwrap().unwrap().body, body, "the phone takes the merged note");

        // a reading-plan day
        crate::userdata::start_plan(&phone, "nt90", "2026-10-01").unwrap();
        crate::userdata::set_plan_day(&phone, "nt90", 3, true).unwrap();
        sync(&mut phone, &folder, "Phone", "phone").unwrap();
        sync(&mut pc, &folder, "Study PC", "computer").unwrap();
        assert_eq!(count(&pc, "SELECT count(*) FROM plan_days WHERE plan_id='nt90' AND day=3"), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sermons_and_their_preachings_between_two_computers() {
        let root = std::env::temp_dir().join(format!("bc-sync-s-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = root.join("shared");
        let mut a = device(&root, "a");
        let mut b = device(&root, "b");
        let sermon = |title: &str| serde_json::from_value::<crate::userdata::Sermon>(json!({ "title": title, "body": r#"{"bigIdea":"Grace"}"# })).unwrap();

        // the same sermon on both already (from a backup): it doesn't arrive twice
        for c in [&a, &b] {
            c.execute("INSERT INTO sermons (title, body, created_at) VALUES ('Shared one', '{}', '2026-01-01 10:00:00')", []).unwrap();
        }
        let id = crate::userdata::sermon_save(&a, &sermon("Faith that works")).unwrap();
        crate::userdata::preaching_save(&a, &crate::userdata::Preaching { id: 0, sermon_id: id, date: "2026-10-12".into(), venue: "South Point".into(), audience: String::new(), notes: String::new(), length_min: None }).unwrap();
        sync(&mut a, &folder, "PC A", "computer").unwrap();
        let r = sync(&mut b, &folder, "PC B", "computer").unwrap();
        assert_eq!(count(&b, "SELECT count(*) FROM sermons"), 2, "{r:?}");
        let bid: i64 = b.query_row("SELECT id FROM sermons WHERE title = 'Faith that works'", [], |r| r.get(0)).unwrap();
        let p = crate::userdata::preachings(&b, bid).unwrap();
        assert_eq!((p.len(), p[0].venue.as_str()), (1, "South Point"));
        assert_eq!(b.query_row("SELECT stage FROM sermons WHERE id = ?1", [bid], |r| r.get::<_, String>(0)).unwrap(), "preached");
        // found by the search there too
        assert_eq!(crate::userdata::sermon_search(&b, &crate::userdata::SermonQuery { words: "faith".into(), ..Default::default() }).unwrap().len(), 1);
        sync(&mut a, &folder, "PC A", "computer").unwrap();
        assert_eq!(count(&a, "SELECT count(*) FROM sermons"), 2, "nothing doubled on the way back");

        // changed on both: B keeps its own and gets A's as a copy
        a.execute("UPDATE sermons SET body = '{\"bigIdea\":\"A\"}', updated_at = '2026-10-13 09:00:00' WHERE title = 'Faith that works'", []).unwrap();
        b.execute("UPDATE sermons SET body = '{\"bigIdea\":\"B\"}', updated_at = '2026-10-13 09:05:00' WHERE title = 'Faith that works'", []).unwrap();
        sync(&mut a, &folder, "PC A", "computer").unwrap();
        let r = sync(&mut b, &folder, "PC B", "computer").unwrap();
        assert_eq!(r.conflicts.len(), 1, "{r:?}");
        assert_eq!(count(&b, "SELECT count(*) FROM sermons WHERE title = 'Faith that works (from PC A)'"), 1);
        sync(&mut a, &folder, "PC A", "computer").unwrap();
        assert_eq!(count(&a, "SELECT count(*) FROM sermons"), 3, "the copy reaches A as well");

        // deleted on A: gone from B, with its preachings
        let aid: i64 = a.query_row("SELECT id FROM sermons WHERE title = 'Faith that works'", [], |r| r.get(0)).unwrap();
        crate::userdata::sermon_delete(&a, aid).unwrap();
        sync(&mut a, &folder, "PC A", "computer").unwrap();
        sync(&mut b, &folder, "PC B", "computer").unwrap();
        assert_eq!(count(&b, "SELECT count(*) FROM sermons WHERE title = 'Faith that works'"), 0);
        assert_eq!(count(&b, "SELECT count(*) FROM sermon_preachings"), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn media_files_are_copied_both_ways() {
        let root = std::env::temp_dir().join(format!("bc-sync-m-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (a, b, folder) = (root.join("a"), root.join("b"), root.join("shared"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join("abc.jpg"), b"picture").unwrap();
        assert_eq!(core::sync_media(&a, &folder).unwrap(), 1);
        assert_eq!(core::sync_media(&b, &folder).unwrap(), 1);
        assert_eq!(std::fs::read(b.join("abc.jpg")).unwrap(), b"picture");
        assert_eq!(core::sync_media(&a, &folder).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&root);
    }
}
