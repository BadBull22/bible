use crate::commentaries::{
    self, ChapterEntities, CommentaryChapter, CommentaryHit, CommentaryInfo, CommentaryState, EntityDetail, EntitySummary, MapPlace,
};
use crate::db::DbState;
use crate::firsts::{FirstsData, FirstsEntry};
use crate::genealogy::{LineagePerson, PersonSummary};
use crate::models::*;
use crate::online;
use crate::qa::{QaConfidence, QaEntry};
use crate::qa_parser::{self, ParsedScope};
use crate::settings::{self, AppSettings};
use crate::{ConfigDir, EmbedderState, FirstsState, GenealogyState, QaState, SettingsState};
use regex::RegexBuilder;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use tauri::State;

fn book_id(conn: &rusqlite::Connection, book: &str) -> Result<i64, String> {
    conn.query_row("SELECT id FROM books WHERE name = ?1", params![book], |r| r.get(0))
        .map_err(|_| format!("unknown book: {book}"))
}

const WORDS_SQL: &str =
    "SELECT word_order, surface_text, strongs_number FROM strongs_links WHERE verse_id = ?1 ORDER BY word_order";

/// Groups the flat `strongs_links` rows of one verse into words, merging consecutive
/// rows that share a `word_order` (one surface word carrying several Strong's numbers,
/// e.g. a Hebrew word with an inseparable prefix). `stmt` must be prepared from
/// [`WORDS_SQL`].
fn words_for_verse(stmt: &mut rusqlite::Statement<'_>, verse_id: i64) -> Result<Vec<StrongsWord>, String> {
    let rows = stmt
        .query_map(params![verse_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    let mut words: Vec<StrongsWord> = Vec::new();
    for row in rows {
        let (order, surface, num) = row.map_err(|e| e.to_string())?;
        match words.last_mut() {
            Some(last) if last.word_order == order => last.strongs_numbers.push(num),
            _ => words.push(StrongsWord { word_order: order, surface_text: surface, strongs_numbers: vec![num] }),
        }
    }
    Ok(words)
}

#[tauri::command]
pub fn list_versions(state: State<DbState>) -> Result<Vec<Version>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT code, name, language, is_original_language FROM versions ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Version {
                code: r.get(0)?,
                name: r.get(1)?,
                language: r.get(2)?,
                is_original_language: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_books(state: State<DbState>) -> Result<Vec<BookInfo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name, testament, order_index FROM books ORDER BY order_index")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(BookInfo {
                name: r.get(0)?,
                testament: r.get(1)?,
                order_index: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Chapter count per book, for populating chapter-picker UI. Takes the max chapter
/// number across *any* version rather than pinning to one version, since a book that
/// exists in only one version (e.g. Enoch, which has no KJV translation) would
/// otherwise be silently dropped.
/// Stat tiles for the opening screen. Every number is counted live against the bundled
/// databases rather than hardcoded, so a future data-pipeline change (more cross
/// -references, another commentary) can never leave these silently stale. See
/// `HomeStats` in models.rs for what each field means and why entity counts default to 0.
#[tauri::command]
pub fn home_stats(db_state: State<DbState>, commentary_state: State<CommentaryState>) -> Result<HomeStats, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    let (books, ot_books, nt_books) = {
        let q = |testament: Option<&str>| -> Result<i64, String> {
            match testament {
                None => conn.query_row("SELECT COUNT(*) FROM books WHERE testament != 'Apocrypha'", [], |r| r.get(0)),
                Some(t) => conn.query_row("SELECT COUNT(*) FROM books WHERE testament = ?1", params![t], |r| r.get(0)),
            }
            .map_err(|e| e.to_string())
        };
        (q(None)?, q(Some("OT"))?, q(Some("NT"))?)
    };

    let (chapters, ot_chapters, nt_chapters) = {
        let q = |testament: Option<&str>| -> Result<i64, String> {
            let sql = "SELECT COUNT(*) FROM (SELECT DISTINCT v.book_id, v.chapter FROM verses v
                JOIN books b ON v.book_id = b.id JOIN versions ver ON v.version_id = ver.id
                WHERE ver.code = 'BSB' AND (?1 IS NULL OR b.testament = ?1))";
            conn.query_row(sql, params![testament], |r| r.get(0)).map_err(|e| e.to_string())
        };
        (q(None)?, q(Some("OT"))?, q(Some("NT"))?)
    };

    let verses: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM verses v JOIN versions ver ON v.version_id = ver.id WHERE ver.code = 'KJV'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let cross_references: i64 =
        conn.query_row("SELECT COUNT(*) FROM cross_references", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    let translations: i64 = conn
        .query_row("SELECT COUNT(*) FROM versions WHERE code != 'ENOCH1'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let strongs_hebrew: i64 = conn
        .query_row("SELECT COUNT(*) FROM strongs_dict WHERE language = 'Hebrew'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let strongs_greek: i64 = conn
        .query_row("SELECT COUNT(*) FROM strongs_dict WHERE language = 'Greek'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    drop(conn);

    // Optional: commentaries.db may not be bundled in every build (see commentary_conn).
    // Missing it shouldn't fail the whole tile row, just leave these four at 0.
    let (people, places, events, commentaries) = match commentary_state.0.as_ref() {
        None => (0, 0, 0, 0),
        Some(m) => {
            let conn = m.lock().map_err(|e| e.to_string())?;
            let count_kind = |kind: &str| -> i64 {
                conn.query_row("SELECT COUNT(*) FROM entities WHERE kind = ?1", params![kind], |r| r.get(0)).unwrap_or(0)
            };
            let commentaries: i64 = conn.query_row("SELECT COUNT(*) FROM commentaries", [], |r| r.get(0)).unwrap_or(0);
            (count_kind("person"), count_kind("place"), count_kind("event"), commentaries)
        }
    };

    Ok(HomeStats {
        books,
        ot_books,
        nt_books,
        chapters,
        ot_chapters,
        nt_chapters,
        verses,
        cross_references,
        translations,
        strongs_hebrew,
        strongs_greek,
        people,
        places,
        events,
        commentaries,
    })
}

#[tauri::command]
pub fn chapter_counts(state: State<DbState>) -> Result<Vec<(String, i64)>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT b.name, MAX(v.chapter)
             FROM verses v
             JOIN books b ON v.book_id = b.id
             GROUP BY b.id
             ORDER BY b.order_index",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chapter(state: State<DbState>, version_code: String, book: String, chapter: i64) -> Result<Vec<Verse>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bid = book_id(&conn, &book)?;
    let mut stmt = conn
        .prepare(
            "SELECT b.name, v.chapter, v.verse, v.text
             FROM verses v JOIN versions ver ON v.version_id = ver.id
             JOIN books b ON v.book_id = b.id
             WHERE ver.code = ?1 AND v.book_id = ?2 AND v.chapter = ?3
             ORDER BY v.verse",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![version_code, bid, chapter], |r| {
            Ok(Verse { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, text: r.get(3)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chapter_with_strongs(
    state: State<DbState>,
    version_code: String,
    book: String,
    chapter: i64,
) -> Result<Vec<VerseWithWords>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bid = book_id(&conn, &book)?;
    let mut verse_stmt = conn
        .prepare(
            "SELECT v.id, v.verse, v.text FROM verses v
             JOIN versions ver ON v.version_id = ver.id
             WHERE ver.code = ?1 AND v.book_id = ?2 AND v.chapter = ?3
             ORDER BY v.verse",
        )
        .map_err(|e| e.to_string())?;
    let verse_rows: Vec<(i64, i64, String)> = verse_stmt
        .query_map(params![version_code, bid, chapter], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut word_stmt = conn.prepare(WORDS_SQL).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(verse_rows.len());
    for (verse_id, verse_num, text) in verse_rows {
        let words = words_for_verse(&mut word_stmt, verse_id)?;
        out.push(VerseWithWords { book: book.clone(), chapter, verse: verse_num, text, words });
    }
    Ok(out)
}

#[tauri::command]
pub fn get_parallel_verse(
    state: State<DbState>,
    book: String,
    chapter: i64,
    verse: i64,
    version_codes: Vec<String>,
) -> Result<Vec<SearchHit>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bid = book_id(&conn, &book)?;
    // Returns only versions that actually have this verse, each tagged with its own
    // version_code -- callers must match on that field, not on array position, since a
    // requested version can be missing (e.g. WLC/TR only cover one testament).
    let mut out = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT b.name, v.chapter, v.verse, v.text
             FROM verses v JOIN versions ver ON v.version_id = ver.id
             JOIN books b ON v.book_id = b.id
             WHERE ver.code = ?1 AND v.book_id = ?2 AND v.chapter = ?3 AND v.verse = ?4",
        )
        .map_err(|e| e.to_string())?;
    for code in version_codes {
        let mut rows = stmt
            .query_map(params![code, bid, chapter, verse], |r| {
                Ok(SearchHit { version_code: code.clone(), book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, text: r.get(3)? })
            })
            .map_err(|e| e.to_string())?;
        if let Some(row) = rows.next() {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn get_verse_with_strongs(
    state: State<DbState>,
    version_code: String,
    book: String,
    chapter: i64,
    verse: i64,
) -> Result<VerseWithWords, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bid = book_id(&conn, &book)?;
    let (verse_id, text): (i64, String) = conn
        .query_row(
            "SELECT v.id, v.text FROM verses v JOIN versions ver ON v.version_id = ver.id
             WHERE ver.code = ?1 AND v.book_id = ?2 AND v.chapter = ?3 AND v.verse = ?4",
            params![version_code, bid, chapter, verse],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| format!("verse not found: {book} {chapter}:{verse} ({version_code})"))?;

    let mut stmt = conn.prepare(WORDS_SQL).map_err(|e| e.to_string())?;
    let words = words_for_verse(&mut stmt, verse_id)?;
    Ok(VerseWithWords { book, chapter, verse, text, words })
}

#[tauri::command]
pub fn strongs_lookup(state: State<DbState>, strongs_number: String) -> Result<Option<StrongsEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT strongs_number, language, lemma, xlit, pronunciation, derivation, strongs_def, kjv_def
         FROM strongs_dict WHERE strongs_number = ?1",
        params![strongs_number],
        |r| {
            Ok(StrongsEntry {
                strongs_number: r.get(0)?,
                language: r.get(1)?,
                lemma: r.get(2)?,
                xlit: r.get(3)?,
                pronunciation: r.get(4)?,
                derivation: r.get(5)?,
                strongs_def: r.get(6)?,
                kjv_def: r.get(7)?,
            })
        },
    )
    .map(Some)
    .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e.to_string()) })
}

#[tauri::command]
pub fn strongs_occurrences(
    state: State<DbState>,
    strongs_number: String,
    version_code: String,
) -> Result<Vec<SearchHit>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT ver.code, b.name, v.chapter, v.verse, v.text
             FROM strongs_links sl
             JOIN verses v ON sl.verse_id = v.id
             JOIN versions ver ON v.version_id = ver.id
             JOIN books b ON v.book_id = b.id
             WHERE sl.strongs_number = ?1 AND ver.code = ?2
             ORDER BY b.order_index, v.chapter, v.verse",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![strongs_number, version_code], |r| {
            Ok(SearchHit { version_code: r.get(0)?, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, text: r.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_keyword(
    state: State<DbState>,
    version_code: String,
    query: String,
    limit: i64,
) -> Result<Vec<SearchHit>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
    let mut stmt = conn
        .prepare(
            "SELECT ver.code, b.name, v.chapter, v.verse, v.text
             FROM verses_fts f
             JOIN verses v ON v.id = f.rowid
             JOIN versions ver ON v.version_id = ver.id
             JOIN books b ON v.book_id = b.id
             WHERE verses_fts MATCH ?1 AND ver.code = ?2
             ORDER BY f.rank
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![fts_query, version_code, limit], |r| {
            Ok(SearchHit { version_code: r.get(0)?, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, text: r.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Case-insensitive, unambiguous-prefix book name lookup, mirroring `parseReference`'s
/// existing matching rule in `api.ts` (exact match first, else exactly one prefix match)
/// server-side, so `ask_question`'s scope resolution behaves the same way a typed
/// reference like "gen 1" already does elsewhere in this app. Returns the canonical
/// `books.name` value, or a clear "I don't recognize the book" error rather than
/// silently falling through -- a recognized-but-invalid scope is a different case from
/// an unrecognized question shape.
fn resolve_book_name(conn: &rusqlite::Connection, raw: &str) -> Result<String, String> {
    let needle = raw.trim().to_lowercase();
    let mut stmt = conn.prepare("SELECT name FROM books").map_err(|e| e.to_string())?;
    let names: Vec<String> =
        stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    if let Some(exact) = names.iter().find(|n| n.to_lowercase() == needle) {
        return Ok(exact.clone());
    }
    let candidates: Vec<&String> = names.iter().filter(|n| n.to_lowercase().starts_with(&needle)).collect();
    if candidates.len() == 1 {
        return Ok(candidates[0].clone());
    }
    Err(format!("I don't recognize the book \"{}\".", raw.trim()))
}

fn word_frequency_query(
    conn: &rusqlite::Connection,
    version_code: &str,
    word: &str,
    scope: Option<&FrequencyScope>,
) -> Result<WordFrequencyResult, String> {
    let fts_query = format!("\"{}\"", word.replace('"', "\"\""));
    let (testament_filter, book_filter): (Option<&str>, Option<&str>) = match scope {
        None => (None, None),
        Some(FrequencyScope::Testament { testament }) => (Some(testament.as_str()), None),
        Some(FrequencyScope::Book { book }) => (None, Some(book.as_str())),
    };
    let mut stmt = conn
        .prepare(
            "SELECT ver.code, b.name, v.chapter, v.verse, v.text
             FROM verses_fts f
             JOIN verses v ON v.id = f.rowid
             JOIN versions ver ON v.version_id = ver.id
             JOIN books b ON v.book_id = b.id
             WHERE verses_fts MATCH ?1 AND ver.code = ?2
               AND (?3 IS NULL OR b.testament = ?3)
               AND (?4 IS NULL OR b.name = ?4)
             ORDER BY b.order_index, v.chapter, v.verse",
        )
        .map_err(|e| e.to_string())?;
    let candidates: Vec<SearchHit> = stmt
        .query_map(params![fts_query, version_code, testament_filter, book_filter], |r| {
            Ok(SearchHit { version_code: r.get(0)?, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, text: r.get(4)? })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let pattern = format!(r"\b{}\b", regex::escape(word));
    let re = RegexBuilder::new(&pattern).case_insensitive(true).build().map_err(|e| e.to_string())?;

    let mut total = 0i64;
    let mut verses = Vec::new();
    for hit in candidates {
        let n = re.find_iter(&hit.text).count() as i64;
        if n > 0 {
            total += n;
            verses.push(hit);
        }
    }
    let scope_label = match scope {
        None => None,
        Some(FrequencyScope::Testament { testament }) if testament == "OT" => Some("in the Old Testament".to_string()),
        Some(FrequencyScope::Testament { .. }) => Some("in the New Testament".to_string()),
        Some(FrequencyScope::Book { book }) => Some(format!("in {book}")),
    };
    Ok(WordFrequencyResult { total_occurrences: total, verses, scope_label })
}

/// "how many times is X used" queries. FTS5 pre-filters candidate verses; the actual
/// count comes from a case-insensitive word-boundary regex over that smaller set, so
/// the number is exact rather than an FTS relevance approximation.
#[tauri::command]
pub fn word_frequency(
    state: State<DbState>,
    version_code: String,
    word: String,
    scope: Option<FrequencyScope>,
) -> Result<WordFrequencyResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    word_frequency_query(&conn, &version_code, &word, scope.as_ref())
}

#[tauri::command]
pub fn cross_references_for(state: State<DbState>, book: String, chapter: i64, verse: i64) -> Result<Vec<CrossReference>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bid = book_id(&conn, &book)?;
    let mut stmt = conn
        .prepare(
            "SELECT tb.name, cr.to_chapter, cr.to_verse_start, cr.to_verse_end, cr.votes
             FROM cross_references cr
             JOIN books tb ON cr.to_book_id = tb.id
             WHERE cr.from_book_id = ?1 AND cr.from_chapter = ?2 AND cr.from_verse = ?3
             ORDER BY cr.votes DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![bid, chapter, verse], |r| {
            Ok(CrossReference { to_book: r.get(0)?, to_chapter: r.get(1)?, to_verse_start: r.get(2)?, to_verse_end: r.get(3)?, votes: r.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> Result<AppSettings, String> {
    let s = state.0.lock().map_err(|e| e.to_string())?;
    Ok(s.clone())
}

fn clean_key(key: String) -> Option<String> {
    let k = key.trim();
    if k.is_empty() { None } else { Some(k.to_string()) }
}

#[tauri::command]
pub fn save_api_bible_key(
    config_dir: State<ConfigDir>,
    state: State<SettingsState>,
    key: String,
) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    s.api_bible_key = clean_key(key);
    settings::save(&config_dir.0, &s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_esv_api_key(
    config_dir: State<ConfigDir>,
    state: State<SettingsState>,
    key: String,
) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    s.esv_api_key = clean_key(key);
    settings::save(&config_dir.0, &s).map_err(|e| e.to_string())
}

fn key_for(settings: &AppSettings, provider: online::Provider) -> Option<String> {
    match provider {
        online::Provider::ApiBible { .. } => settings.api_bible_key.clone(),
        online::Provider::Esv => settings.esv_api_key.clone(),
    }
}

#[tauri::command]
pub fn list_online_versions(state: State<SettingsState>) -> Result<Vec<OnlineVersionInfo>, String> {
    let s = state.0.lock().map_err(|e| e.to_string())?;
    Ok(online::ONLINE_VERSIONS
        .iter()
        .map(|v| OnlineVersionInfo {
            code: v.code.to_string(),
            name: v.name.to_string(),
            provider: online::provider_label(v.provider).to_string(),
            configured: key_for(&s, v.provider).is_some(),
        })
        .collect())
}

#[tauri::command]
pub async fn fetch_online_verse(
    state: State<'_, SettingsState>,
    version_code: String,
    book: String,
    chapter: i64,
    verse: i64,
) -> Result<OnlineVerseResult, String> {
    let version = online::ONLINE_VERSIONS
        .iter()
        .find(|v| v.code == version_code)
        .ok_or_else(|| format!("unknown online version: {version_code}"))?;
    let api_key = {
        let s = state.0.lock().map_err(|e| e.to_string())?;
        key_for(&s, version.provider)
            .ok_or_else(|| format!("No {} key configured in Settings", online::provider_label(version.provider)))?
    };
    let reference = format!("{book} {chapter}:{verse}");
    let (text, copyright) = match version.provider {
        online::Provider::ApiBible { bible_id } => online::fetch_api_bible(&api_key, bible_id, &reference).await?,
        online::Provider::Esv => online::fetch_esv(&api_key, &reference).await?,
    };
    Ok(OnlineVerseResult { version_code, book, chapter, verse, text, copyright })
}

fn embedding_to_sql_literal(v: &[f32]) -> String {
    let joined = v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",");
    format!("[{joined}]")
}

/// Connector words carry no retrieval signal of their own, so they're dropped before
/// the lexical half of topical search builds its FTS expressions. That's what lets a
/// connector the reader happened to type still find a literal match: "sacrifice of
/// bulls" matches Hosea 12:11 ("Do they sacrifice bulls in Gilead?") only once "of" is
/// out of the way. A query made of nothing but connectors keeps them all, rather than
/// searching for nothing.
const LEXICAL_STOPWORDS: &[&str] = &[
    "the", "a", "an", "of", "in", "on", "and", "or", "to", "is", "was", "that", "this", "for", "with", "his", "her",
    "my", "me", "you", "it", "be", "are", "i", "he", "she", "they", "them",
];

/// Reduces a free-text query to its lowercase content words. Every character that isn't
/// a letter, digit or apostrophe is discarded, which doubles as FTS5 injection
/// protection: nothing FTS5 would read as query syntax can survive into a MATCH.
fn content_words(query: &str) -> Vec<String> {
    let all: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect();
    let kept: Vec<String> = all.iter().filter(|w| !LEXICAL_STOPWORDS.contains(&w.as_str())).cloned().collect();
    if kept.is_empty() {
        all
    } else {
        kept
    }
}

/// BSB verse ids matching an FTS5 expression, best-scoring first. A malformed
/// expression isn't an error here -- it simply means "no lexical evidence", leaving
/// topical search to fall back on the embedding ranking alone.
fn fts_verse_ids(conn: &rusqlite::Connection, expr: &str, limit: i64) -> Vec<i64> {
    // Per the aliasing gotcha, `verses_fts` is named in full inside MATCH/bm25() even
    // though it's aliased for the join.
    let mut stmt = match conn.prepare(
        "SELECT v.id
         FROM verses_fts f
         JOIN verses v ON v.id = f.rowid
         JOIN versions ver ON v.version_id = ver.id
         WHERE verses_fts MATCH ?1 AND ver.code = 'BSB'
         ORDER BY bm25(verses_fts)
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    // Bound to a local rather than left as the tail expression: the MappedRows temporary
    // borrows `stmt`, and dropping it at the end of the block would outlive `stmt` itself.
    let ids: Vec<i64> = match stmt.query_map(params![expr, limit], |r| r.get::<_, i64>(0)) {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    };
    ids
}

/// How deep into the embedding ranking to reach before fusing. The verse a reader
/// half-remembers can sit far outside the handful of results they'll actually be shown
/// -- "greater things" ranked John 14:12 at #110 -- so the dense side has to offer the
/// fusion many more candidates than the caller asked for.
const DENSE_FUSION_DEPTH: i64 = 500;
/// Both lexical tiers are high-precision and normally tiny (the whole BSB contains two
/// verses with the phrase "greater things"), so a small cap costs nothing.
const LEXICAL_FUSION_CAP: i64 = 50;
/// Standard Reciprocal Rank Fusion damping constant.
const RRF_K: f64 = 60.0;

/// Thematic/topical search over the BSB, combining two independent rankings:
///
/// * **lexical** -- FTS5, as an exact phrase first and then as an all-words match.
/// * **dense** -- nearest neighbours of the query embedding, which is what lets
///   "sacrifice of bulls" surface "burnt offering of bulls" with no shared wording.
///
/// The embedding alone ranks a long verse poorly when the remembered words are only a
/// small part of it: mean-pooling dilutes them, so short verses stuffed with the
/// query's words win instead. Pinning exact-phrase hits on top and fusing the rest by
/// Reciprocal Rank Fusion fixes that without touching genuine paraphrase search -- when
/// neither lexical tier matches (e.g. "the prodigal son", wording that appears nowhere
/// in the BSB) both lists are empty and the output is exactly the embedding ranking it
/// has always been.
#[tauri::command]
pub fn semantic_search(
    db_state: State<DbState>,
    embedder_state: State<EmbedderState>,
    query: String,
    limit: i64,
) -> Result<Vec<SearchHit>, String> {
    let vector = embedder_state.0.embed(&query).map_err(|e| e.to_string())?;
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    semantic_search_query(&conn, &vector, &query, limit)
}

/// Body of [`semantic_search`], taking an already-computed query embedding so callers
/// that need it for more than one purpose in the same request (`ask_question`'s
/// fallback layer reuses the same embedding it already computed for the curated
/// semantic-match step) only pay the `embed()` cost once.
fn semantic_search_query(conn: &rusqlite::Connection, vector: &[f32], query: &str, limit: i64) -> Result<Vec<SearchHit>, String> {
    let literal = embedding_to_sql_literal(vector);

    // Two-step: nearest-neighbor query against the vec0 table alone first (the
    // documented sqlite-vec pattern), then join those rowids back to verse text --
    // avoids relying on undocumented interaction between MATCH/ORDER BY/LIMIT and a
    // JOIN in the same statement.
    let mut knn_stmt = conn
        .prepare("SELECT rowid FROM verse_embeddings WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let dense: Vec<i64> = knn_stmt
        .query_map(params![literal, DENSE_FUSION_DEPTH.max(limit)], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let words = content_words(query);
    let phrase: Vec<i64> = if words.is_empty() {
        Vec::new()
    } else {
        fts_verse_ids(&conn, &format!("\"{}\"", words.join(" ")), LEXICAL_FUSION_CAP)
    };
    let pinned: HashSet<i64> = phrase.iter().copied().collect();
    let all_words: Vec<i64> = if words.len() < 2 {
        Vec::new()
    } else {
        let expr = words.iter().map(|w| format!("\"{w}\"")).collect::<Vec<_>>().join(" AND ");
        fts_verse_ids(&conn, &expr, LEXICAL_FUSION_CAP).into_iter().filter(|id| !pinned.contains(id)).collect()
    };

    // Reciprocal Rank Fusion across the dense and all-words rankings, with exact-phrase
    // hits pinned above the result: nothing should outrank the reader's literal wording.
    let mut score: HashMap<i64, f64> = HashMap::new();
    for list in [&dense, &all_words] {
        for (rank, id) in list.iter().enumerate() {
            *score.entry(*id).or_insert(0.0) += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
    }
    let mut fused: Vec<i64> = score.keys().copied().filter(|id| !pinned.contains(id)).collect();
    // Verse id ascending is a deterministic tie-break, so equal scores can't reorder
    // between identical searches.
    fused.sort_by(|a, b| score[b].partial_cmp(&score[a]).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(b)));

    let ordered: Vec<i64> = phrase.into_iter().chain(fused).take(limit.max(0) as usize).collect();

    let mut verse_stmt = conn
        .prepare(
            "SELECT v.chapter, v.verse, v.text, b.name
             FROM verses v
             JOIN books b ON v.book_id = b.id
             JOIN versions ver ON v.version_id = ver.id
             WHERE v.id = ?1 AND ver.code = 'BSB'",
        )
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::with_capacity(ordered.len());
    for id in ordered {
        let hit = verse_stmt
            .query_row(params![id], |r| {
                Ok(SearchHit { version_code: "BSB".to_string(), book: r.get(3)?, chapter: r.get(0)?, verse: r.get(1)?, text: r.get(2)? })
            })
            .map_err(|e| e.to_string())?;
        hits.push(hit);
    }
    Ok(hits)
}

/// Below this cosine similarity, a semantic match against the curated set is treated as
/// "not actually about this" rather than shown as an answer. Empirically set, not just
/// guessed: a smoke test (`ask_question_smoke_tests` below) turned up a real false
/// positive at 0.45 -- "the prodigal son" matched a Messianic-prophecy entry at 0.478,
/// purely on the shared word "son," not actual topical relevance -- while every genuine
/// paraphrase match found so far scores 0.84 or higher. 0.6 sits with real margin on
/// both sides of that gap, but it's still evidence from one seed set on one embedding
/// model, not a permanently tuned value -- revisit if real usage turns up a bad match on
/// either side of it.
const ASK_SIMILARITY_THRESHOLD: f32 = 0.6;
/// For a short who/what question with a dictionary entry for its exact subject, a
/// semantic curated match must be at least this close to win over the dictionary entry.
/// Genuine paraphrases of curated questions score 0.84+ (see the smoke test), while a
/// merely-related curated answer ("what does the Bible say about prayer" -> "Can our
/// prayers change God's mind?") scored below this.
const ASK_DICTIONARY_OVERRIDE: f32 = 0.8;

/// Resolves one of `qa.json`'s recognized `computed_from` tags to a live number,
/// re-querying directly rather than routing through the `home_stats` command so
/// `ask_question` doesn't need `CommentaryState` just to answer a books/verses/chapters
/// question. Mirrors the exact queries `home_stats` uses for the tags they share, so the
/// two can't silently disagree.
fn resolve_computed(conn: &rusqlite::Connection, firsts: &FirstsData, tag: &str) -> Result<i64, String> {
    let count = |sql: &str| -> Result<i64, String> { conn.query_row(sql, [], |r| r.get(0)).map_err(|e| e.to_string()) };
    match tag {
        "books" => count("SELECT COUNT(*) FROM books WHERE testament != 'Apocrypha'"),
        "ot_books" => count("SELECT COUNT(*) FROM books WHERE testament = 'OT'"),
        "nt_books" => count("SELECT COUNT(*) FROM books WHERE testament = 'NT'"),
        "chapters" => count(
            "SELECT COUNT(*) FROM (SELECT DISTINCT v.book_id, v.chapter FROM verses v
             JOIN versions ver ON v.version_id = ver.id WHERE ver.code = 'BSB')",
        ),
        "verses" => count("SELECT COUNT(*) FROM verses v JOIN versions ver ON v.version_id = ver.id WHERE ver.code = 'KJV'"),
        "cross_references" => count("SELECT COUNT(*) FROM cross_references"),
        "translations" => count("SELECT COUNT(*) FROM versions WHERE code != 'ENOCH1'"),
        "strongs_hebrew" => count("SELECT COUNT(*) FROM strongs_dict WHERE language = 'Hebrew'"),
        "strongs_greek" => count("SELECT COUNT(*) FROM strongs_dict WHERE language = 'Greek'"),
        "prophecy_count" => Ok(firsts.all().iter().filter(|e| e.category == "prophecy").count() as i64),
        other => Err(format!("unknown computed_from tag: {other}")),
    }
}

/// Builds the UI-facing answer from a `qa.json` entry, splicing a live number into its
/// `{{n}}` token when the entry names a `computed_from` tag.
fn build_curated_entry(entry: &QaEntry, conn: &rusqlite::Connection, firsts: &FirstsData) -> Result<AskCuratedEntry, String> {
    let answer = match &entry.computed_from {
        Some(tag) => {
            let n = resolve_computed(conn, firsts, tag)?;
            entry.answer.replace("{{n}}", &n.to_string())
        }
        None => entry.answer.clone(),
    };
    Ok(AskCuratedEntry {
        question: entry.question.clone(),
        confidence: entry.confidence.clone(),
        answer,
        citations: entry.citations.iter().map(|c| AskCitation { reference: c.reference.clone(), role: c.role.clone() }).collect(),
        note: entry.note.clone(),
    })
}

/// Builds the UI-facing answer from an existing Firsts/Prophecies entry matched by the
/// semantic layer. Prophecy entries carry an intentionally empty `answer` (the Facts UI
/// renders their foretold/fulfilled pair as a two-column card instead), so this
/// synthesizes prose from `citations` + `fulfillment` rather than surfacing a blank
/// answer -- the one data quirk this reuse has to account for.
fn build_curated_entry_from_firsts(entry: &FirstsEntry) -> AskCuratedEntry {
    if entry.category == "prophecy" {
        let foretold = entry.citations.join("; ");
        let fulfilled = entry.fulfillment.join("; ");
        let mut citations: Vec<AskCitation> =
            entry.citations.iter().map(|c| AskCitation { reference: c.clone(), role: "foretold".to_string() }).collect();
        citations.extend(entry.fulfillment.iter().map(|c| AskCitation { reference: c.clone(), role: "fulfilled".to_string() }));
        AskCuratedEntry {
            question: entry.question.clone(),
            confidence: QaConfidence::Stated,
            answer: format!("Foretold in {foretold} -- fulfilled in {fulfilled}."),
            citations,
            note: entry.note.clone(),
        }
    } else {
        AskCuratedEntry {
            question: entry.question.clone(),
            confidence: QaConfidence::Stated,
            answer: entry.answer.clone(),
            citations: entry.citations.iter().map(|c| AskCitation { reference: c.clone(), role: "supporting".to_string() }).collect(),
            note: entry.note.clone(),
        }
    }
}

/// Orchestrates the three "Ask a question" layers in a fixed order, stopping at the
/// first hit: (1) the strict `qa_parser` grammar for exact word-occurrence counts,
/// (2) an exact-text then semantic match against the curated `qa.json` set (plus the
/// app's existing Firsts/Prophecies entries, embedded into the same index), and
/// (3) a labeled best-effort fallback reusing `semantic_search` + commentary search.
/// Every layer after the free exact-text check shares one `embed()` call rather than
/// re-embedding the query for each layer that might need it.
///
/// Takes already-unwrapped dependencies rather than Tauri `State`, so it can also be
/// driven directly by a test against the real bundled data with no running Tauri app.
fn ask_question_query(
    conn: &rusqlite::Connection,
    embedder: &crate::embeddings::Embedder,
    commentary_conn: Option<&rusqlite::Connection>,
    study_conn: Option<&rusqlite::Connection>,
    firsts: &FirstsData,
    qa: &crate::qa::QaRuntime,
    query: &str,
    fallback_limit: i64,
) -> Result<AskAnswer, String> {
    // Layer 1: structured/computable -- an exact, deterministic word-occurrence count.
    if let Some(parsed) = qa_parser::parse_frequency_question(query) {
        let scope = match parsed.scope {
            ParsedScope::WholeBible => None,
            ParsedScope::Testament(t) => Some(FrequencyScope::Testament { testament: t }),
            ParsedScope::Book(raw) => {
                let canonical = resolve_book_name(conn, &raw)?;
                Some(FrequencyScope::Book { book: canonical })
            }
        };
        let result = word_frequency_query(conn, "BSB", &parsed.word, scope.as_ref())?;
        return Ok(AskAnswer::Computed { word: parsed.word, result });
    }

    // Layer 2a: exact match against the curated set -- free, no embed() call needed.
    if let Some(entry) = qa.data.find_exact(query) {
        let curated = build_curated_entry(entry, conn, firsts)?;
        return Ok(AskAnswer::Curated { entry: curated, matched_by: "exact".to_string(), similarity: None });
    }

    // Everything from here needs the query embedded -- computed once, reused by both
    // the semantic curated-match step and the fallback if it comes to that.
    let vector = embedder.embed(query).map_err(|e| e.to_string())?;

    // A short who/what question names its subject outright ("what does the Bible say
    // about prayer"), so a dictionary entry for exactly that subject beats a curated answer
    // that only *resembles* the question ("Can our prayers change God's mind?") -- unless
    // the resemblance is very close. Exact curated matches were already returned above.
    let dictionary_hit = || -> Result<Option<AskAnswer>, String> {
        let (Some(study), Some((term, prefer))) = (study_conn, dictionary_term(query)) else {
            return Ok(None);
        };
        let mut candidates = vec![term.clone()];
        if let Some(s) = term.strip_suffix("es").filter(|s| s.len() > 2) {
            candidates.push(s.to_string());
        }
        if let Some(s) = term.strip_suffix('s').filter(|s| s.len() > 2) {
            candidates.push(s.to_string());
        }
        for c in candidates {
            if let Some(entry) = crate::study::lookup_headword(study, &c, prefer)? {
                return Ok(Some(AskAnswer::Dictionary { entry, term: c }));
            }
        }
        Ok(None)
    };

    // Layer 2b: semantic match, across qa.json AND the existing Firsts/Prophecies data.
    if let Some((source, id, similarity)) = qa.best_match(&vector) {
        // Never let a dictionary override one of the house-lens answers (scripture first,
        // then the Pentecostal reading -- see the "doctrinal lens" rule in HANDOVER.md).
        let is_house_view =
            source == "qa" && qa.data.get(&id).is_some_and(|e| e.confidence == crate::qa::QaConfidence::DoctrinalView);
        if similarity >= ASK_SIMILARITY_THRESHOLD && similarity < ASK_DICTIONARY_OVERRIDE && !is_house_view {
            if let Some(answer) = dictionary_hit()? {
                return Ok(answer);
            }
        }
        if similarity >= ASK_SIMILARITY_THRESHOLD {
            if source == "qa" {
                if let Some(entry) = qa.data.get(&id) {
                    let curated = build_curated_entry(entry, conn, firsts)?;
                    return Ok(AskAnswer::Curated { entry: curated, matched_by: "semantic".to_string(), similarity: Some(similarity) });
                }
            } else if let Some(entry) = firsts.all().into_iter().find(|e| e.id == id) {
                let curated = build_curated_entry_from_firsts(&entry);
                return Ok(AskAnswer::Curated { entry: curated, matched_by: "semantic".to_string(), similarity: Some(similarity) });
            }
        }
    }

    // Layer 2c: a who/what question about a person, place or subject with no curated
    // answer -- look the term up in the bundled Bible dictionaries.
    if let Some(answer) = dictionary_hit()? {
        return Ok(answer);
    }

    // Layer 3: labeled best-effort fallback -- no confident answer on file.
    let hits = semantic_search_query(conn, &vector, query, fallback_limit)?;
    let commentary_hits =
        commentary_conn.map(|c| commentaries::search(c, query, None, fallback_limit).unwrap_or_default()).unwrap_or_default();
    Ok(AskAnswer::Fallback { hits, commentary_hits })
}

const DICT_GENERAL: &[&str] = &["easton", "smith", "nave", "torrey"];
const DICT_TOPICAL: &[&str] = &["nave", "torrey", "easton", "smith"];

/// The subject of a short who/what question, and which dictionaries to try first:
/// "who was Aaron?" -> ("aaron", general); "what does the bible say about prayer" ->
/// ("prayer", topical first). Deliberately narrow -- a long question isn't a headword.
fn dictionary_term(query: &str) -> Option<(String, &'static [&'static str])> {
    static PATTERNS: std::sync::OnceLock<Vec<(regex::Regex, &'static [&'static str])>> = std::sync::OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            (r"(?i)^what\s+does\s+(?:the\s+bible|scripture|god's\s+word)\s+(?:say|teach)\s+(?:about|on|regarding)\s+(.+)$", DICT_TOPICAL),
            (r"(?i)^what\s+does\s+(.+?)\s+mean$", DICT_GENERAL),
            (r"(?i)^(?:who|what|where)\s+(?:is|was|were|are)\s+(.+)$", DICT_GENERAL),
            (r"(?i)^(?:tell\s+me\s+about|define|definition\s+of|meaning\s+of|what\s+is\s+meant\s+by)\s+(.+)$", DICT_GENERAL),
        ]
        .into_iter()
        .map(|(p, pref)| (regex::Regex::new(p).unwrap(), pref))
        .collect()
    });
    let q = query.trim().trim_end_matches(['?', '.', '!']).trim();
    let (raw, prefer) = patterns.iter().find_map(|(re, pref)| re.captures(q).map(|c| (c[1].to_string(), *pref)))?;
    let mut t = raw.to_lowercase();
    for suffix in [" in the bible", " in scripture", " in the old testament", " in the new testament", " biblically"] {
        if let Some(s) = t.strip_suffix(suffix) {
            t = s.to_string();
        }
    }
    for prefix in ["the ", "a ", "an "] {
        if let Some(s) = t.strip_prefix(prefix) {
            t = s.to_string();
        }
    }
    let t = t.trim().to_string();
    if t.is_empty() || t.split_whitespace().count() > 4 {
        return None;
    }
    Some((t, prefer))
}

#[tauri::command]
pub fn ask_question(
    db_state: State<DbState>,
    embedder_state: State<EmbedderState>,
    commentary_state: State<CommentaryState>,
    firsts_state: State<FirstsState>,
    qa_state: State<QaState>,
    study_state: State<crate::study::StudyState>,
    query: String,
    fallback_limit: i64,
) -> Result<AskAnswer, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let commentary_guard = commentary_conn(&commentary_state).ok();
    let study_guard = study_state.0.as_ref().and_then(|m| m.lock().ok());
    ask_question_query(
        &conn,
        &embedder_state.0,
        commentary_guard.as_deref(),
        study_guard.as_deref(),
        &firsts_state.0,
        &qa_state.0,
        &query,
        fallback_limit,
    )
}

#[tauri::command]
pub fn list_genealogy_people(state: State<GenealogyState>) -> Vec<PersonSummary> {
    state.0.list_people()
}

#[tauri::command]
pub fn get_lineage(state: State<GenealogyState>, person_id: String) -> Vec<LineagePerson> {
    state.0.ancestors_of(&person_id)
}

// ---------- offline commentaries + people/places/events (commentaries.db) ----------

fn commentary_conn(state: &CommentaryState) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    let m = state
        .0
        .as_ref()
        .ok_or_else(|| "Commentaries are not bundled in this build (resources/commentaries.db is missing).".to_string())?;
    m.lock().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_commentaries(state: State<CommentaryState>) -> Result<Vec<CommentaryInfo>, String> {
    let conn = commentary_conn(&state)?;
    commentaries::list(&conn)
}

#[tauri::command]
pub fn get_commentary_chapter(
    state: State<CommentaryState>,
    commentary_id: String,
    book: String,
    chapter: i64,
) -> Result<CommentaryChapter, String> {
    let conn = commentary_conn(&state)?;
    commentaries::chapter(&conn, &commentary_id, &book, chapter)
}

#[tauri::command]
pub fn search_commentaries(
    state: State<CommentaryState>,
    query: String,
    commentary_id: Option<String>,
    limit: i64,
) -> Result<Vec<CommentaryHit>, String> {
    let conn = commentary_conn(&state)?;
    commentaries::search(&conn, &query, commentary_id.as_deref(), limit)
}

#[tauri::command]
pub fn chapter_entities(state: State<CommentaryState>, book: String, chapter: i64) -> Result<ChapterEntities, String> {
    let conn = commentary_conn(&state)?;
    commentaries::chapter_entities(&conn, &book, chapter)
}

#[tauri::command]
pub fn get_entity(state: State<CommentaryState>, kind: String, id: String) -> Result<Option<EntityDetail>, String> {
    let conn = commentary_conn(&state)?;
    commentaries::entity(&conn, &kind, &id)
}

#[tauri::command]
pub fn search_entities(state: State<CommentaryState>, query: String, limit: i64) -> Result<Vec<EntitySummary>, String> {
    let conn = commentary_conn(&state)?;
    commentaries::search_entities(&conn, &query, limit)
}

#[tauri::command]
pub fn map_places(state: State<CommentaryState>) -> Result<Vec<MapPlace>, String> {
    let conn = commentary_conn(&state)?;
    commentaries::map_places(&conn)
}

/// Everything the Timeline panel plots: a lifespan ribbon per curated genealogy person,
/// plus every dated event with the first verse recording it.
///
/// Dates resolve in a fixed order of trust. A `dateOverride` in genealogies.json wins,
/// since it exists only where the dataset contradicts the verse the person is cited from
/// (Seth's record implies a 1182-year life against Genesis 5:8's 912; Jehoram's has him
/// dying 42 years before he was born). Otherwise Theographic's own years are used. The
/// ribbon's END then prefers the lifespan scripture actually states over the dataset's
/// arithmetic -- that is what makes Abraham's ribbon 175 years per Genesis 25:7 rather
/// than the 176 the dataset's inclusive counting implies.
#[tauri::command]
pub fn timeline_data(
    commentary_state: State<CommentaryState>,
    genealogy_state: State<GenealogyState>,
) -> Result<TimelineData, String> {
    let conn = commentary_conn(&commentary_state)?;
    let events = commentaries::dated_events(&conn)?;
    let dates = commentaries::person_dates(&conn)?;

    let mut ribbons = Vec::new();
    for p in genealogy_state.0.all_people() {
        let over = p.date_override.as_ref();
        let dataset = p.theographic_id.as_ref().and_then(|id| dates.get(id)).copied().unwrap_or((None, None));
        let birth = match over {
            Some(o) => o.birth_year,
            None => dataset.0,
        };
        let mut death = match over {
            Some(o) => o.death_year,
            None => dataset.1,
        };
        let mut date_source = if over.is_some() { "corrected" } else { "dataset" };
        if let (Some(b), Some(span)) = (birth, p.lifespan) {
            death = Some(b + span);
            if over.is_none() {
                date_source = "scripture";
            }
        }
        if birth.is_none() {
            date_source = "uncertain";
        }
        ribbons.push(TimelineRibbon {
            id: p.id,
            name: p.name,
            citation: p.citation,
            birth_year: birth,
            death_year: death,
            lifespan: p.lifespan,
            lifespan_citation: p.lifespan_citation,
            age_at_heir_birth: p.age_at_heir_birth,
            age_citation: p.age_citation,
            date_source: date_source.to_string(),
            note: p.note,
            date_note: over.map(|o| o.reason.clone()).or(p.chain_note),
        });
    }
    Ok(TimelineData { ribbons, events })
}

/// Closes the app for real. The frontend's close-button handler normally calls
/// `Window::destroy()` directly; this is the fallback for the rare case that permission
/// is somehow missing (see the `onCloseRequested` handler in App.tsx).
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    crate::voice::shutdown(&app);
    app.exit(0);
}

#[tauri::command]
pub fn list_firsts(state: State<FirstsState>) -> Vec<FirstsEntry> {
    state.0.all()
}

#[tauri::command]
pub fn search_firsts(state: State<FirstsState>, query: String) -> Vec<FirstsEntry> {
    state.0.search(&query)
}

/// Not a correctness test (there's no fixed expected output to assert against -- the
/// whole point is eyeballing real answers from the real bundled data, since this app has
/// no browser-automation tooling to drive the actual UI). Run with:
///   cargo test --release --quiet ask_question_smoke -- --nocapture
/// Verifies: layer 1 fires for the user's own literal (typo'd) word-count phrasing but
/// NOT for the 4 non-word-count examples; the 40-days, prophecy-count, and Joseph's-age
/// questions all get their intended curated answer; a genuine paraphrase with no shared
/// keywords still finds its curated match by meaning; and a wholly unrelated question
/// gets a labeled fallback rather than a false curated hit.
#[cfg(test)]
mod ask_question_smoke_tests {
    use super::*;
    use crate::embeddings::Embedder;
    use crate::firsts::FirstsData;
    use crate::qa::QaRuntime;
    use std::path::PathBuf;

    #[test]
    fn ask_question_smoke() {
        crate::register_sqlite_vec();
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let conn = rusqlite::Connection::open(dir.join("resources/bible.db")).expect("open bible.db");
        let embedder = Embedder::load(&dir.join("resources/model")).expect("load embedder");
        let firsts = FirstsData::load(&dir.join("resources/firsts.json")).expect("load firsts.json");
        let qa = QaRuntime::load(&dir.join("resources/qa.json"), &dir.join("resources/qa_index.json")).expect("load qa runtime");
        let commentary_conn = rusqlite::Connection::open(dir.join("resources/commentaries.db")).ok();
        let study_conn = rusqlite::Connection::open(dir.join("resources/study.db")).ok();

        let questions = [
            "how many time is love mentioned in the bible",
            "how many time is it mentione in the new testamanet",
            "How many times did Jesus appear after His resurrection?",
            "How many days was He still on earth after His resurrection?",
            "How many prophecies were fulfilled with the birth, life, and resurrection of Christ?",
            "How old was Joseph the father of Jesus when he died?",
            "How many books are in the Bible?",
            "who was the oldest person in the bible",
            "how long did jesus stay on earth before he went up to heaven",
            "what is the meaning of life",
            // Home screen's own pre-existing "Try:" example chips -- now routed through
            // ask_question instead of plain semantic_search, so these must still behave
            // as ordinary topic searches (Fallback), not get intercepted by a false
            // curated match.
            "the prodigal son",
            "the parting of the Red Sea",
            "the creation of light",
            "how many time is the word gold is used",
            // User's second batch of questions (verbatim, typos included).
            "How many times did the isralites rebel?",
            "How many years did they wander int he wilderness",
            "how many days was Jona in the whales stomach?",
            "how many miricles happended in the old testamanet?",
            "how many time does God talk loudly to his people?",
            "how many prophets were there in the old testament?",
            "who was moses?",
            "what is the purpose of being saved?",
            "how do you become saved?",
            "what is eternal life?",
            "how do you get eternal life?",
            "what are the ten commandments?",
            "what is the new covenant?",
            // False-positive sweep: near-neighbor topics that share vocabulary with the
            // new entries but are NOT the same question, to check for new collisions
            // like the earlier "the prodigal son" -> prophecy-entry false match.
            "who was Aaron?",
            "what is grace?",
            "what is the old covenant?",
            "how do you pray?",
            "what is baptism?",
            "who wrote the ten commandments on stone the second time?",
            // Spot-check across the 100-question FAQ import, one per category, exact
            // wording as it appears in the source FAQ.
            "Is Jesus God?",
            "How can there be one God, yet three Persons (the Trinity)?",
            "Is the Bible completely true and without error?",
            "What must I do to be saved?", // should map to the EXISTING how_to_be_saved entry, not a new duplicate
            "Can a Christian lose their salvation?",
            "What happens to a Christian immediately when they die?",
            "What is the Rapture?",
            "What does the Bible say about homosexuality?",
            "Does the Bible support evolution?",
            "Can women serve as pastors or elders?",
            "Can a Christian see a secular therapist or psychiatrist?",
            // Deliberate close-neighbor collision sweep within the tightly-clustered
            // end-times block (Rapture/Antichrist/Tribulation/Millennium/Armageddon all
            // share heavy vocabulary) and the salvation block -- each MUST resolve to
            // its own distinct entry, not a neighboring one.
            "what is the antichrist",
            "what is the tribulation",
            "what is the millennial kingdom",
            "what is armageddon",
            "what is the great white throne judgment",
            "what is the mark of the beast",
            "can you lose your salvation",
            "is baptism required to be saved",
            "what is predestination",
            "is purgatory real",
            "what is transubstantiation",
            "is masturbation a sin",
            "is gambling a sin",
            "is drinking alcohol a sin",
            // Pentecostal-lens revision sweep: the new tongues/Spirit-baptism phrasings must
            // land on the tongues entry, NOT the water-baptism one, and the rapture/
            // tribulation/millennium cluster must still resolve to distinct entries.
            "what is the baptism in the holy spirit",
            "is speaking in tongues the evidence of the holy spirit",
            "what is water baptism",
            "will christians go through the tribulation",
            "will the rapture happen before the tribulation",
            "does god still heal today",
            "how do i become born again",
            "what does it mean to be born again",
            "is the blood of jesus enough to save me",
            "what is the difference between the rapture and the second coming",
            "what is the judgment seat of christ",
            // Dictionary layer (v2.2): who/what questions with no curated answer should be
            // answered from Easton's/Smith's/Nave's -- while ones that DO have a curated
            // answer ("who was moses?") must still get the curated one.
            "who was Aaron?",
            "what is grace?",
            "who were the Pharisees?",
            "tell me about Nineveh",
            "what does the bible say about prayer?",
            "what does selah mean?",
            "who was Melchizedek",
            "what is the meaning of life",
            // Round after the user set their positions: conditional security, women in
            // ministry, Trinity, and the new blood-of-Jesus entry.
            "what does the blood of jesus do",
            "what does it mean to be washed in the blood",
            "what does blood bought mean",
            "why did jesus have to shed his blood",
            "what is the trinity",
            "is god one or three",
            "can women be elders",
            "can a born again christian go back to sin and still be saved",
            "is salvation a get out of jail free card",
            "can a christian sin and still go to heaven",
        ];

        for q in questions {
            let result = ask_question_query(&conn, &embedder, commentary_conn.as_ref(), study_conn.as_ref(), &firsts, &qa, q, 5);
            println!("\n=== {q} ===");
            match result {
                Ok(answer) => println!("{}", serde_json::to_string_pretty(&answer).unwrap()),
                Err(e) => println!("ERROR: {e}"),
            }
        }
    }
}
