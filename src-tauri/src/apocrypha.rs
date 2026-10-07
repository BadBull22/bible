//! Cross-references that involve the Apocrypha (deuterocanonical books): from an Apocrypha
//! verse to the 66 books, from the 66 books to the Apocrypha, and within the Apocrypha.
//!
//! The app's main cross-reference data covers only the 66 books. These links come from the
//! reference notes printed in public-domain Bibles that include the Apocrypha (see
//! data-pipeline/build_apocrypha_xrefs.py, which builds resources/apocrypha_xrefs.json and
//! checks every verse against real text). Each link carries the Bible(s) it comes from, so
//! the app can present it as "the editors of X noted a connection here" rather than as its
//! own claim -- and the UI always marks the Apocrypha as outside the canon of Scripture.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::library::{refs, LibraryState};

#[derive(Deserialize)]
struct Link {
    from: (String, i64, i64),
    to: (String, i64, Option<i64>, Option<i64>),
    sources: Vec<String>,
}

#[derive(Deserialize)]
struct File {
    sources: HashMap<String, String>,
    links: Vec<Link>,
}

pub struct ApocryphaXrefs {
    sources: HashMap<String, String>,
    links: Vec<Link>,
}

impl ApocryphaXrefs {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let file: File = serde_json::from_str(&std::fs::read_to_string(path)?)?;
        Ok(Self { sources: file.sources, links: file.links })
    }
}

fn is_apocrypha(book: &str) -> bool {
    refs::APOCRYPHA.iter().any(|(_, n)| *n == book)
}

#[derive(Serialize)]
pub struct ApocryphaRef {
    pub book: String,
    pub chapter: i64,
    /// None = the whole chapter
    pub verse: Option<i64>,
    pub verse_end: Option<i64>,
    /// the other verse is in the Apocrypha (outside the canon)
    pub apocrypha: bool,
    /// "out": this verse's note points there; "in": that verse's note points here
    pub direction: &'static str,
    /// the Bible(s) whose printed reference notes make this link
    pub sources: Vec<String>,
    /// text of the passage, when a translation that has it is available
    pub text: String,
    /// the translation `text` is from
    pub version: String,
}

/// The Apocrypha-related cross-references for one verse. `version` is the translation
/// being read (used first for the text of Apocrypha passages, if it has them).
#[tauri::command]
pub fn apocrypha_xrefs(
    data: State<ApocryphaXrefs>,
    db: State<DbState>,
    lib: State<LibraryState>,
    book: String,
    chapter: i64,
    verse: i64,
    version: String,
) -> Result<Vec<ApocryphaRef>, String> {
    let name = |ids: &[String]| ids.iter().map(|s| data.sources.get(s).cloned().unwrap_or_else(|| s.clone())).collect::<Vec<_>>();
    let mut out: Vec<ApocryphaRef> = Vec::new();
    for l in &data.links {
        let (other, direction) = if l.from.0 == book && l.from.1 == chapter && l.from.2 == verse {
            ((l.to.0.clone(), l.to.1, l.to.2, l.to.3), "out")
        } else if l.to.0 == book && l.to.1 == chapter && l.to.2.is_some_and(|v| verse >= v && verse <= l.to.3.unwrap_or(v)) {
            ((l.from.0.clone(), l.from.1, Some(l.from.2), None), "in")
        } else {
            continue;
        };
        // the same passage noted in both directions: keep one entry
        if out.iter().any(|r| r.book == other.0 && r.chapter == other.1 && r.verse == other.2) {
            continue;
        }
        out.push(ApocryphaRef {
            apocrypha: is_apocrypha(&other.0),
            book: other.0,
            chapter: other.1,
            verse: other.2,
            verse_end: other.3,
            direction,
            sources: name(&l.sources),
            text: String::new(),
            version: String::new(),
        });
    }
    if out.is_empty() {
        return Ok(out);
    }

    // --- the text of each passage: the 66 books from the bundled BSB; the Apocrypha from
    //     the Bible being read if it has them, else any installed Bible that does
    {
        let d = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = d
            .prepare(
                "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
                 WHERE ver.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse BETWEEN ?3 AND ?4 ORDER BY v.verse",
            )
            .map_err(|e| e.to_string())?;
        for r in out.iter_mut().filter(|r| !r.apocrypha) {
            let start = r.verse.unwrap_or(1);
            let texts: Vec<String> = stmt
                .query_map(params![r.book, r.chapter, start, r.verse_end.unwrap_or(start)], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            if !texts.is_empty() {
                r.text = texts.join(" ");
                r.version = "BSB".into();
            }
        }
    }
    {
        let l = lib.conn.lock().map_err(|e| e.to_string())?;
        for r in out.iter_mut().filter(|r| r.apocrypha) {
            let start = r.verse.unwrap_or(1);
            let module: Option<String> = l
                .query_row(
                    "SELECT module FROM lib_verses WHERE book = ?1 AND chapter = ?2 AND verse = ?3 ORDER BY module <> ?4, module LIMIT 1",
                    params![r.book, r.chapter, start, version],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let Some(module) = module else { continue };
            let rows = crate::library::verse_range(&l, &module, &r.book, r.chapter, start, r.verse_end.unwrap_or(start))?;
            r.text = rows.into_iter().map(|(_, t)| t).collect::<Vec<_>>().join(" ");
            r.version = module;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_list_is_sound() {
        let data = ApocryphaXrefs::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/apocrypha_xrefs.json")).unwrap();
        assert!(data.links.len() > 2500, "{} links", data.links.len());
        let known = |b: &str| is_apocrypha(b) || refs::resolve_book(b).is_some();
        for l in &data.links {
            assert!(known(&l.from.0) && known(&l.to.0), "unknown book in {} -> {}", l.from.0, l.to.0);
            assert!(is_apocrypha(&l.from.0) || is_apocrypha(&l.to.0), "a link with no Apocrypha side: {} -> {}", l.from.0, l.to.0);
            assert!(!l.sources.is_empty() && l.sources.iter().all(|s| data.sources.contains_key(s)));
        }
        // 2 Maccabees 7 and Hebrews 11:35, noted by the Swedish Bible of 1917
        assert!(data.links.iter().any(|l| l.from.0 == "2 Maccabees" && l.from.1 == 7 && l.to.0 == "Hebrews" && l.to.1 == 11 && l.to.2 == Some(35)));
    }
}
