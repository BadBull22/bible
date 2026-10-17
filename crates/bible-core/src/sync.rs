//! Keeping the reader's own data the same on their computers and phone, through a folder
//! they already share (OneDrive, Google Drive, Dropbox, a Synology drive). There is no
//! account and no server: each device writes one file of its own into
//! `<folder>/Bible Concordance sync/<device>.json` and reads the others'.
//!
//! How it merges. Each record (a bookmark, a highlight, a note, a reading-plan day, and on a
//! computer a sermon, a template, a preaching, a basket item) has a key that is the same on
//! every device ("note|John|3|16", "sermon|<uid>"). `sync_state` remembers, for every key, the
//! hash of its value when last synced and the time it last changed (`stamp`, milliseconds).
//! A sync first looks at the local data: a key whose value changed (or that is new) gets the
//! time now, and one that has gone becomes a tombstone (deleted, with the time), so it isn't
//! brought back from another device. Then it reads the other devices' files and takes each
//! record that changed there later than here (adding, changing or deleting it locally). Last,
//! it writes this device's file: every key, its time, and its value (or the tombstone).
//!
//! The newer change wins. When the same note was changed on two devices since they last
//! synced, both texts are kept in the note; what else happens on such a clash is the app's
//! choice (`Store::clash`: the desktop keeps the other sermon as a copy).
//!
//! Each app says which records it keeps with a `Store`: the shared verse records (`common_*`)
//! and, on a computer, the sermons.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

/// The folder inside the chosen one that holds the sync files.
pub const SUBFOLDER: &str = "Bible Concordance sync";
const FORMAT: u32 = 1;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// The tables the sync keeps, and the column both apps' bookmarks need (the phone tags them).
pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, hash TEXT NOT NULL, stamp INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS sync_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(err)?;
    add_column(conn, "bookmarks", "tags", "TEXT NOT NULL DEFAULT ''")
}

/// Adds a column to a table unless it is there already.
pub fn add_column(conn: &Connection, table: &str, col: &str, decl: &str) -> Result<(), String> {
    let has: bool = conn.prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = '{col}'")).and_then(|mut s| s.exists([])).map_err(err)?;
    if !has {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}")).map_err(err)?;
    }
    Ok(())
}

pub fn setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM sync_settings WHERE key = ?1", params![key], |r| r.get(0)).optional().map_err(err)
}

pub fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(v) => conn.execute("INSERT INTO sync_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2", params![key, v]),
        None => conn.execute("DELETE FROM sync_settings WHERE key = ?1", params![key]),
    }
    .map_err(err)?;
    Ok(())
}

/// This device's id in the sync folder (made once).
pub fn device_id(conn: &Connection) -> Result<String, String> {
    if let Some(id) = setting(conn, "device")? {
        return Ok(id);
    }
    let id: String = conn.query_row("SELECT lower(hex(randomblob(8)))", [], |r| r.get(0)).map_err(err)?;
    set_setting(conn, "device", Some(&id))?;
    Ok(id)
}

pub fn hash(v: &Value) -> String {
    Sha256::digest(v.to_string().as_bytes()).iter().take(12).map(|b| format!("{b:02x}")).collect()
}

/// A key's kind: "note" of "note|John|3|16".
pub fn kind(key: &str) -> &str {
    key.split('|').next().unwrap_or("")
}
/// What follows the kind: "John|3|16".
pub fn rest(key: &str) -> &str {
    key.split_once('|').map(|x| x.1).unwrap_or("")
}
/// A text field of a value ("" when missing).
pub fn s(v: &Value, f: &str) -> String {
    v.get(f).and_then(Value::as_str).unwrap_or("").to_string()
}
/// A number field of a value.
pub fn i(v: &Value, f: &str) -> Option<i64> {
    v.get(f).and_then(Value::as_i64)
}

/// (book, chapter, verse) from "<kind>|Book|ch|v".
pub fn place(key: &str) -> Option<(String, i64, i64)> {
    let p: Vec<&str> = key.split('|').collect();
    if p.len() != 4 {
        return None;
    }
    Some((p[1].to_string(), p[2].parse().ok()?, p[3].parse().ok()?))
}

// ---------------------------------------------------------------- the records

/// What an app keeps in step: its records, and how to change one.
pub trait Store {
    /// The kinds of record this device keeps; others in a sync file are left alone.
    fn kinds(&self) -> &[&'static str];
    /// Every record here, by key. Values are built the same way on every device.
    fn collect(&self, conn: &Connection) -> Result<BTreeMap<String, Value>, String>;
    /// Makes a record here what another device says it is (None: deleted there). False when
    /// it can't be done yet (a preaching whose sermon isn't here), to try again next time.
    fn apply(&self, conn: &Connection, key: &str, v: Option<&Value>) -> Result<bool, String>;
    /// Order of applying (lower first): a sermon before its preachings.
    fn order(&self, _key: &str) -> u8 {
        1
    }
    /// Before anything is compared: the first sync between devices that already share data.
    fn prepare(&self, _conn: &Connection, _theirs: &HashMap<String, (Rec, String)>) -> Result<(), String> {
        Ok(())
    }
    /// After the other devices' records were applied (the keys and values applied).
    fn finish(&self, _conn: &Connection, _applied: &[(String, Option<Value>)]) -> Result<(), String> {
        Ok(())
    }
    /// A record changed here and on `from` since the last sync, beyond a note (whose texts are
    /// both kept): what to do. Returns the keys it added or changed and what to tell the reader;
    /// None keeps this device's version.
    fn clash(&self, _conn: &Connection, _key: &str, _theirs: &Value, _from: &str) -> Result<Option<(Vec<String>, String)>, String> {
        Ok(None)
    }
}

/// The records both apps keep, the same way: bookmarks, highlights, notes and reading plans.
pub const COMMON_KINDS: [&str; 5] = ["bm", "hl", "note", "plan", "pday"];

pub fn common_collect(conn: &Connection, out: &mut BTreeMap<String, Value>) -> Result<(), String> {
    let mut put = |sql: &str, f: &dyn Fn(&rusqlite::Row) -> rusqlite::Result<(String, Value)>| -> Result<(), String> {
        let mut st = conn.prepare(sql).map_err(err)?;
        for r in st.query_map([], |r| f(r)).map_err(err)? {
            let (k, v) = r.map_err(err)?;
            out.insert(k, v);
        }
        Ok(())
    };
    let at = |kind: &str, b: String, c: i64, v: i64| format!("{kind}|{b}|{c}|{v}");
    put("SELECT book, chapter, verse, created_at, tags FROM bookmarks", &|r| {
        Ok((at("bm", r.get(0)?, r.get(1)?, r.get(2)?), json!({ "created_at": r.get::<_, String>(3)?, "tags": r.get::<_, String>(4)? })))
    })?;
    put("SELECT book, chapter, verse, color FROM highlights", &|r| Ok((at("hl", r.get(0)?, r.get(1)?, r.get(2)?), json!({ "color": r.get::<_, String>(3)? }))))?;
    put("SELECT book, chapter, verse, body, verse_end, tags, created_at FROM notes", &|r| {
        Ok((
            at("note", r.get(0)?, r.get(1)?, r.get(2)?),
            json!({ "body": r.get::<_, String>(3)?, "verse_end": r.get::<_, Option<i64>>(4)?, "tags": r.get::<_, String>(5)?, "created_at": r.get::<_, String>(6)? }),
        ))
    })?;
    put("SELECT plan_id, started_on FROM plans", &|r| Ok((format!("plan|{}", r.get::<_, String>(0)?), json!({ "started_on": r.get::<_, String>(1)? }))))?;
    put("SELECT plan_id, day, done_at FROM plan_days", &|r| {
        Ok((format!("pday|{}|{}", r.get::<_, String>(0)?, r.get::<_, i64>(1)?), json!({ "done_at": r.get::<_, String>(2)? })))
    })?;
    Ok(())
}

/// Applies a common record; false when the key is not one of them.
pub fn common_apply(conn: &Connection, key: &str, v: Option<&Value>) -> Result<bool, String> {
    let k = kind(key);
    match k {
        "bm" | "hl" | "note" => {
            let Some((book, ch, verse)) = place(key) else { return Ok(true) };
            match (k, v) {
                (_, None) => {
                    let table = match k {
                        "bm" => "bookmarks",
                        "hl" => "highlights",
                        _ => "notes",
                    };
                    conn.execute(&format!("DELETE FROM {table} WHERE book=?1 AND chapter=?2 AND verse=?3"), params![book, ch, verse]).map_err(err)?;
                }
                ("bm", Some(v)) => {
                    conn.execute(
                        "INSERT INTO bookmarks (book, chapter, verse, created_at, tags) VALUES (?1,?2,?3,?4,?5)
                         ON CONFLICT(book, chapter, verse) DO UPDATE SET created_at=?4, tags=?5",
                        params![book, ch, verse, s(v, "created_at"), s(v, "tags")],
                    )
                    .map_err(err)?;
                }
                ("hl", Some(v)) => {
                    conn.execute(
                        "INSERT INTO highlights (book, chapter, verse, color) VALUES (?1,?2,?3,?4) ON CONFLICT(book, chapter, verse) DO UPDATE SET color=?4",
                        params![book, ch, verse, s(v, "color")],
                    )
                    .map_err(err)?;
                }
                (_, Some(v)) => {
                    conn.execute(
                        "INSERT INTO notes (book, chapter, verse, body, verse_end, tags, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)
                         ON CONFLICT(book, chapter, verse) DO UPDATE SET body=?4, verse_end=?5, tags=?6, created_at=?7, updated_at=datetime('now','localtime')",
                        params![book, ch, verse, s(v, "body"), i(v, "verse_end"), s(v, "tags"), s(v, "created_at")],
                    )
                    .map_err(err)?;
                }
            }
        }
        "plan" => match v {
            None => {
                conn.execute("DELETE FROM plans WHERE plan_id = ?1", params![rest(key)]).map_err(err)?;
            }
            Some(v) => {
                conn.execute("INSERT INTO plans (plan_id, started_on) VALUES (?1, ?2) ON CONFLICT(plan_id) DO UPDATE SET started_on=?2", params![rest(key), s(v, "started_on")])
                    .map_err(err)?;
            }
        },
        "pday" => {
            let Some((plan, day)) = rest(key).rsplit_once('|') else { return Ok(true) };
            let day: i64 = day.parse().unwrap_or(0);
            match v {
                None => conn.execute("DELETE FROM plan_days WHERE plan_id=?1 AND day=?2", params![plan, day]),
                Some(v) => conn.execute(
                    "INSERT INTO plan_days (plan_id, day, done_at) VALUES (?1,?2,?3) ON CONFLICT(plan_id, day) DO UPDATE SET done_at=?3",
                    params![plan, day, s(v, "done_at")],
                ),
            }
            .map_err(err)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

/// Just the common records: what the phone keeps.
pub struct CommonStore;

impl Store for CommonStore {
    fn kinds(&self) -> &[&'static str] {
        &COMMON_KINDS
    }
    fn collect(&self, conn: &Connection) -> Result<BTreeMap<String, Value>, String> {
        let mut out = BTreeMap::new();
        common_collect(conn, &mut out)?;
        Ok(out)
    }
    fn apply(&self, conn: &Connection, key: &str, v: Option<&Value>) -> Result<bool, String> {
        common_apply(conn, key, v).map(|_| true)
    }
}

// ---------------------------------------------------------------- the files

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Rec {
    /// key
    pub k: String,
    /// when it last changed (ms)
    pub s: i64,
    /// hash of the value
    pub h: String,
    /// deleted
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub d: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncFile {
    pub format: u32,
    pub device: String,
    /// the device's name as the reader sees it ("Study PC", "Phone")
    pub name: String,
    /// "computer" or "phone"
    pub kind: String,
    /// when the file was written (ms)
    pub written: i64,
    pub records: Vec<Rec>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct DeviceSeen {
    pub name: String,
    pub kind: String,
    /// when its file was last written (ms)
    pub written: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncReport {
    /// when (ms)
    pub at: i64,
    /// records changed here from other devices
    pub received: usize,
    /// records changed here since the last sync, now in this device's file
    pub sent: usize,
    /// what was changed on two devices at once, and what was done
    pub conflicts: Vec<String>,
    /// the other devices whose files were read
    pub devices: Vec<DeviceSeen>,
    /// sync files that couldn't be read (being written, or from a newer version)
    pub skipped: Vec<String>,
    /// sermon pictures, videos and music copied (either way)
    #[serde(default)]
    pub media: usize,
    /// anything else the reader should know ("Your computer wasn't found on this Wi-Fi.")
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Where the sync files are: a folder on this device, or (on the phone) wherever the system
/// lets the app read and write files it was given.
pub trait Folder {
    /// The other devices' files: (file name, contents).
    fn read_all(&self) -> Result<Vec<(String, String)>, String>;
    /// Writes this device's file (whole, replacing it).
    fn write(&self, name: &str, text: &str) -> Result<(), String>;
}

/// A plain folder: `<folder>/Bible Concordance sync/`.
pub struct DirFolder(pub PathBuf);

impl DirFolder {
    pub fn new(chosen: &Path) -> Result<DirFolder, String> {
        // the sync folder itself chosen: used as it is, not another one made inside it
        let dir = if chosen.file_name().is_some_and(|n| n == SUBFOLDER) { chosen.to_path_buf() } else { chosen.join(SUBFOLDER) };
        std::fs::create_dir_all(&dir).map_err(|e| format!("The sync folder can't be used: {e}"))?;
        Ok(DirFolder(dir))
    }
}

impl Folder for DirFolder {
    fn read_all(&self) -> Result<Vec<(String, String)>, String> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(&self.0).map_err(err)?.flatten() {
            let p = e.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if name.ends_with(".json") && !name.starts_with('.') {
                if let Ok(t) = std::fs::read_to_string(&p) {
                    out.push((name, t));
                }
            }
        }
        Ok(out)
    }
    fn write(&self, name: &str, text: &str) -> Result<(), String> {
        // written under a temporary name first, so a half-written file is never read
        let tmp = self.0.join(format!(".{name}.tmp"));
        std::fs::write(&tmp, text).map_err(|e| format!("The sync file couldn't be written: {e}"))?;
        std::fs::rename(&tmp, self.0.join(name)).map_err(|e| format!("The sync file couldn't be written: {e}"))
    }
}

/// Sync files passed by hand rather than kept in a folder: the other devices' files as they
/// were received (over the home Wi-Fi), and this device's file once written, to send back.
#[derive(Default)]
pub struct MemFolder {
    pub others: Vec<(String, String)>,
    pub written: std::cell::RefCell<Option<String>>,
}

impl Folder for MemFolder {
    fn read_all(&self) -> Result<Vec<(String, String)>, String> {
        Ok(self.others.clone())
    }
    fn write(&self, _name: &str, text: &str) -> Result<(), String> {
        *self.written.borrow_mut() = Some(text.to_string());
        Ok(())
    }
}

/// The device id and name a sync file says it is from (None: not a sync file).
pub fn file_device(text: &str) -> Option<(String, String)> {
    serde_json::from_str::<SyncFile>(text).ok().map(|f| (f.device, f.name))
}

fn label(key: &str) -> String {
    match kind(key) {
        "note" => place(key).map(|(b, c, vs)| format!("The note on {b} {c}:{vs}")).unwrap_or_else(|| "A note".into()),
        _ => "An item".into(),
    }
}

/// The two texts of a note changed on two devices at once, both kept.
pub fn both_notes(mine: &str, theirs: &str, from: &str) -> String {
    let (a, b) = (mine.trim(), theirs.trim());
    if a.contains(b) {
        return mine.to_string();
    }
    if b.contains(a) {
        return theirs.to_string();
    }
    format!("{a}\n\n— from {from} —\n{b}")
}

type State = HashMap<String, (String, i64, bool)>;

fn read_state(conn: &Connection) -> Result<State, String> {
    let mut st = conn.prepare("SELECT key, hash, stamp, deleted FROM sync_state").map_err(err)?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)? != 0)))).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

fn put_state(conn: &Connection, k: &str, h: &str, stamp: i64, deleted: bool) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_state (key, hash, stamp, deleted) VALUES (?1,?2,?3,?4) ON CONFLICT(key) DO UPDATE SET hash=?2, stamp=?3, deleted=?4",
        params![k, h, stamp, deleted as i64],
    )
    .map_err(err)?;
    Ok(())
}

/// One record as it is here now, hashed.
fn hash_here(store: &dyn Store, conn: &Connection, key: &str) -> Result<Option<String>, String> {
    // small data: the whole collection is quick, and keeps one way of building values
    Ok(store.collect(conn)?.get(key).map(hash))
}

/// One sync with the folder. `name`/`device_kind` describe this device for the others.
pub fn sync(conn: &mut Connection, store: &dyn Store, folder: &dyn Folder, name: &str, device_kind: &str) -> Result<SyncReport, String> {
    let me = device_id(conn)?;
    let now = now_ms();
    let mut report = SyncReport { at: now, ..Default::default() };
    let mut others: Vec<SyncFile> = Vec::new();
    for (file, text) in folder.read_all()? {
        if file == format!("{me}.json") {
            continue;
        }
        match serde_json::from_str::<SyncFile>(&text) {
            Ok(f) if f.device == me => {}
            Ok(f) if f.format <= FORMAT => others.push(f),
            _ => report.skipped.push(file),
        }
    }
    report.devices = others.iter().map(|f| DeviceSeen { name: f.name.clone(), kind: f.kind.clone(), written: f.written }).collect();
    let kinds = store.kinds();

    // the newest record for each key among the other devices, and whose it is
    let mut theirs: HashMap<String, (Rec, String)> = HashMap::new();
    for f in &others {
        for r in &f.records {
            if !kinds.contains(&kind(&r.k)) {
                continue;
            }
            if theirs.get(&r.k).is_none_or(|(t, _)| r.s > t.s) {
                theirs.insert(r.k.clone(), (r.clone(), f.name.clone()));
            }
        }
    }

    let tx = conn.transaction().map_err(err)?;
    store.prepare(&tx, &theirs)?;
    let state = read_state(&tx)?;

    // 1. what changed here since the last sync
    let local = store.collect(&tx)?;
    // keys changed on both sides: handled below, not simply overwritten
    let mut clash: Vec<String> = Vec::new();
    for (k, v) in &local {
        let h = hash(v);
        match state.get(k) {
            Some((old, _, false)) if *old == h => {}
            prev => {
                let prev_stamp = prev.map(|p| p.1).unwrap_or(i64::MIN);
                if let Some((r, _)) = theirs.get(k) {
                    if r.s > prev_stamp && r.h != h && !r.d {
                        clash.push(k.clone());
                    }
                }
                put_state(&tx, k, &h, now, false)?;
                report.sent += 1;
            }
        }
    }
    for (k, (h, _, deleted)) in &state {
        if !deleted && !local.contains_key(k) && kinds.contains(&kind(k)) {
            put_state(&tx, k, h, now, true)?;
            report.sent += 1;
        }
    }

    // changed on two devices at once: a note keeps both texts; the rest is the app's choice
    for k in &clash {
        let (r, from) = &theirs[k];
        let Some(v) = &r.v else { continue };
        if kind(k) == "note" {
            let mine = local.get(k).map(|m| s(m, "body")).unwrap_or_default();
            let mut merged = v.clone();
            merged["body"] = Value::String(both_notes(&mine, &s(v, "body"), from));
            store.apply(&tx, k, Some(&merged))?;
            let h = hash_here(store, &tx, k)?.unwrap_or_default();
            put_state(&tx, k, &h, now, false)?;
            report.conflicts.push(format!("{} was changed here and on {from}: both texts are kept in it.", label(k)));
        } else if let Some((keys, message)) = store.clash(&tx, k, v, from)? {
            let here = store.collect(&tx)?;
            for key in keys {
                if let Some(v) = here.get(&key) {
                    put_state(&tx, &key, &hash(v), now, false)?;
                }
            }
            report.conflicts.push(message);
        }
    }

    // 2. what changed on the other devices later than here
    let mut incoming: Vec<&(Rec, String)> = theirs.values().filter(|(r, _)| !clash.contains(&r.k)).collect();
    incoming.sort_by_key(|(r, _)| (store.order(&r.k), r.k.clone()));
    let state = read_state(&tx)?;
    let mut applied: Vec<(String, Option<Value>)> = Vec::new();
    let mut pending: Vec<(String, String, i64, bool)> = Vec::new();
    for (r, _) in incoming {
        let here = state.get(&r.k);
        if here.is_some_and(|(_, stamp, _)| r.s <= *stamp) {
            continue;
        }
        let same = here.is_some_and(|(h, _, d)| *h == r.h && *d == r.d);
        if !same {
            let v = if r.d { None } else { r.v.as_ref() };
            if !store.apply(&tx, &r.k, v)? {
                continue;
            }
            report.received += 1;
            applied.push((r.k.clone(), v.cloned()));
        }
        pending.push((r.k.clone(), r.h.clone(), r.s, r.d));
    }
    store.finish(&tx, &applied)?;
    // each record as it is here now (a device may keep fewer fields): its hash, with their time
    let here = store.collect(&tx)?;
    for (k, h, stamp, d) in pending {
        let h = if d { h } else { here.get(&k).map(hash).unwrap_or(h) };
        put_state(&tx, &k, &h, stamp, d)?;
    }

    // 3. this device's file
    let local = store.collect(&tx)?;
    let mut records = Vec::new();
    {
        let mut st = tx.prepare("SELECT key, hash, stamp, deleted FROM sync_state ORDER BY key").map_err(err)?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)? != 0))).map_err(err)?;
        for row in rows {
            let (k, h, stamp, d) = row.map_err(err)?;
            if !kinds.contains(&kind(&k)) {
                continue;
            }
            let v = if d { None } else { local.get(&k).cloned() };
            if !d && v.is_none() {
                continue;
            }
            records.push(Rec { k, s: stamp, h, d, v });
        }
    }
    let file = SyncFile { format: FORMAT, device: me.clone(), name: name.to_string(), kind: device_kind.to_string(), written: now, records };
    folder.write(&format!("{me}.json"), &serde_json::to_string(&file).map_err(err)?)?;
    tx.commit().map_err(err)?;
    Ok(report)
}

/// Files kept beside the data (sermon pictures, videos, music; named by their contents)
/// copied both ways between `local` and `<folder>/<SUBFOLDER>/media`: a file only ever
/// arrives, never changes, so there is nothing to merge. Returns how many were copied.
pub fn sync_media(local: &Path, folder: &Path) -> Result<usize, String> {
    let shared = folder.join(SUBFOLDER).join("media");
    std::fs::create_dir_all(&shared).map_err(err)?;
    std::fs::create_dir_all(local).map_err(err)?;
    let names = |d: &Path| -> Vec<String> {
        std::fs::read_dir(d)
            .map(|it| it.flatten().filter(|e| e.path().is_file()).filter_map(|e| e.file_name().to_str().map(String::from)).filter(|n| !n.starts_with('.')).collect())
            .unwrap_or_default()
    };
    let (here, there) = (names(local), names(&shared));
    let mut n = 0;
    for (from, to, list, other) in [(local, shared.as_path(), &here, &there), (shared.as_path(), local, &there, &here)] {
        for f in list.iter().filter(|f| !other.contains(f)) {
            // copied under a temporary name first, so a half-copied file is never taken for whole
            let tmp = to.join(format!(".{f}.part"));
            if std::fs::copy(from.join(f), &tmp).is_ok() && std::fs::rename(&tmp, to.join(f)).is_ok() {
                n += 1;
            } else {
                let _ = std::fs::remove_file(&tmp);
            }
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The phone's tables, as the phone app makes them.
    fn phone(dir: &Path, name: &str) -> Connection {
        std::fs::create_dir_all(dir).unwrap();
        let conn = Connection::open(dir.join(format!("{name}.db"))).unwrap();
        conn.execute_batch(
            "CREATE TABLE bookmarks (book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), PRIMARY KEY (book, chapter, verse));
             CREATE TABLE highlights (book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), PRIMARY KEY (book, chapter, verse));
             CREATE TABLE notes (book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), verse_end INTEGER, tags TEXT NOT NULL DEFAULT '', PRIMARY KEY (book, chapter, verse));
             CREATE TABLE plans (plan_id TEXT PRIMARY KEY, started_on TEXT NOT NULL);
             CREATE TABLE plan_days (plan_id TEXT NOT NULL, day INTEGER NOT NULL, done_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), PRIMARY KEY (plan_id, day));",
        )
        .unwrap();
        init(&conn).unwrap();
        conn
    }

    #[test]
    fn the_sync_folder_itself_can_be_chosen() {
        let root = std::env::temp_dir().join(format!("bc-core-sub-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let inner = DirFolder::new(&root).unwrap().0;
        assert_eq!(DirFolder::new(&inner).unwrap().0, inner, "not a second one inside");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn two_phones_keep_in_step() {
        let root = std::env::temp_dir().join(format!("bc-core-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let folder = DirFolder::new(&root.join("shared")).unwrap();
        let (mut a, mut b) = (phone(&root, "a"), phone(&root, "b"));
        a.execute("INSERT INTO notes (book, chapter, verse, body) VALUES ('Psalms', 23, 1, 'The Lord is my shepherd')", []).unwrap();
        a.execute("INSERT INTO bookmarks (book, chapter, verse, tags) VALUES ('Psalms', 23, 1, 'Comfort')", []).unwrap();
        assert_eq!(sync(&mut a, &CommonStore, &folder, "Phone A", "phone").unwrap().sent, 2);
        assert_eq!(sync(&mut b, &CommonStore, &folder, "Phone B", "phone").unwrap().received, 2);
        let tags: String = b.query_row("SELECT tags FROM bookmarks", [], |r| r.get(0)).unwrap();
        assert_eq!(tags, "Comfort");
        // records of a kind this device doesn't keep are left alone
        let r = sync(&mut a, &CommonStore, &folder, "Phone A", "phone").unwrap();
        assert_eq!((r.sent, r.received), (0, 0));
        let _ = std::fs::remove_dir_all(&root);
    }
}
