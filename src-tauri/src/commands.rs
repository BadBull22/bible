use crate::db::DbState;
use crate::firsts::FirstsEntry;
use crate::genealogy::{LineagePerson, PersonSummary};
use crate::models::*;
use crate::online;
use crate::settings::{self, AppSettings};
use crate::{ConfigDir, EmbedderState, FirstsState, GenealogyState, SettingsState};
use regex::RegexBuilder;
use rusqlite::params;
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

/// Exact whole-word occurrence count (not just verse count) for concordance-style
/// "how many times is X used" queries. FTS5 pre-filters candidate verses; the actual
/// count comes from a case-insensitive word-boundary regex over that smaller set, so
/// the number is exact rather than an FTS relevance approximation.
#[tauri::command]
pub fn word_frequency(state: State<DbState>, version_code: String, word: String) -> Result<WordFrequencyResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let fts_query = format!("\"{}\"", word.replace('"', "\"\""));
    let mut stmt = conn
        .prepare(
            "SELECT ver.code, b.name, v.chapter, v.verse, v.text
             FROM verses_fts f
             JOIN verses v ON v.id = f.rowid
             JOIN versions ver ON v.version_id = ver.id
             JOIN books b ON v.book_id = b.id
             WHERE verses_fts MATCH ?1 AND ver.code = ?2
             ORDER BY b.order_index, v.chapter, v.verse",
        )
        .map_err(|e| e.to_string())?;
    let candidates: Vec<SearchHit> = stmt
        .query_map(params![fts_query, version_code], |r| {
            Ok(SearchHit { version_code: r.get(0)?, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, text: r.get(4)? })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let pattern = format!(r"\b{}\b", regex::escape(&word));
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
    Ok(WordFrequencyResult { total_occurrences: total, verses })
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

#[tauri::command]
pub fn save_api_bible_key(
    config_dir: State<ConfigDir>,
    state: State<SettingsState>,
    key: String,
) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    s.api_bible_key = if key.trim().is_empty() { None } else { Some(key.trim().to_string()) };
    settings::save(&config_dir.0, &s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_online_versions(state: State<SettingsState>) -> Result<Vec<OnlineVersionInfo>, String> {
    let s = state.0.lock().map_err(|e| e.to_string())?;
    let configured = s.api_bible_key.is_some();
    Ok(online::ONLINE_VERSIONS
        .iter()
        .map(|(code, _id, name)| OnlineVersionInfo { code: code.to_string(), name: name.to_string(), configured })
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
    let api_key = {
        let s = state.0.lock().map_err(|e| e.to_string())?;
        s.api_bible_key.clone().ok_or_else(|| "No api.bible key configured in Settings".to_string())?
    };
    let bible_id = online::ONLINE_VERSIONS
        .iter()
        .find(|(code, _, _)| *code == version_code)
        .map(|(_, id, _)| *id)
        .ok_or_else(|| format!("unknown online version: {version_code}"))?;
    let reference = format!("{book} {chapter}:{verse}");
    let (text, copyright) = online::fetch_verse(&api_key, bible_id, &reference).await?;
    Ok(OnlineVerseResult { version_code, book, chapter, verse, text, copyright })
}

fn embedding_to_sql_literal(v: &[f32]) -> String {
    let joined = v.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",");
    format!("[{joined}]")
}

/// Thematic/topical search: embeds the query with the same local model used to index
/// the corpus (BSB only, for now) and finds the nearest verses by meaning rather than
/// exact wording -- this is what lets "sacrifice of bulls" surface "burnt offering of
/// bulls" even though no words match literally.
#[tauri::command]
pub fn semantic_search(
    db_state: State<DbState>,
    embedder_state: State<EmbedderState>,
    query: String,
    limit: i64,
) -> Result<Vec<SearchHit>, String> {
    let vector = embedder_state.0.embed(&query).map_err(|e| e.to_string())?;
    let literal = embedding_to_sql_literal(&vector);

    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

    // Two-step: nearest-neighbor query against the vec0 table alone first (the
    // documented sqlite-vec pattern), then join those rowids back to verse text --
    // avoids relying on undocumented interaction between MATCH/ORDER BY/LIMIT and a
    // JOIN in the same statement.
    let mut knn_stmt = conn
        .prepare("SELECT rowid FROM verse_embeddings WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rowids: Vec<i64> = knn_stmt
        .query_map(params![literal, limit], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut verse_stmt = conn
        .prepare("SELECT v.chapter, v.verse, v.text, b.name FROM verses v JOIN books b ON v.book_id = b.id WHERE v.id = ?1")
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::with_capacity(rowids.len());
    for id in rowids {
        let hit = verse_stmt
            .query_row(params![id], |r| {
                Ok(SearchHit { version_code: "BSB".to_string(), book: r.get(3)?, chapter: r.get(0)?, verse: r.get(1)?, text: r.get(2)? })
            })
            .map_err(|e| e.to_string())?;
        hits.push(hit);
    }
    Ok(hits)
}

#[tauri::command]
pub fn list_genealogy_people(state: State<GenealogyState>) -> Vec<PersonSummary> {
    state.0.list_people()
}

#[tauri::command]
pub fn get_lineage(state: State<GenealogyState>, person_id: String) -> Vec<LineagePerson> {
    state.0.ancestors_of(&person_id)
}

#[tauri::command]
pub fn list_firsts(state: State<FirstsState>) -> Vec<FirstsEntry> {
    state.0.all()
}

#[tauri::command]
pub fn search_firsts(state: State<FirstsState>, query: String) -> Vec<FirstsEntry> {
    state.0.search(&query)
}
