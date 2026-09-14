use crate::commentaries::{
    self, ChapterEntities, CommentaryChapter, CommentaryHit, CommentaryInfo, CommentaryState, EntityDetail, EntitySummary, MapPlace,
};
use crate::db::DbState;
use crate::firsts::FirstsEntry;
use crate::genealogy::{LineagePerson, PersonSummary};
use crate::models::*;
use crate::online;
use crate::settings::{self, AppSettings};
use crate::{ConfigDir, EmbedderState, FirstsState, GenealogyState, SettingsState};
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
    let literal = embedding_to_sql_literal(&vector);

    let conn = db_state.0.lock().map_err(|e| e.to_string())?;

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

    let words = content_words(&query);
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

/// Closes the app for real. The window's close button is intercepted in `lib.rs` so the
/// farewell verse can be shown first; the frontend calls this once it has finished.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
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
