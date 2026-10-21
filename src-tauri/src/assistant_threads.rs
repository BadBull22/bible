//! The Offline Assistant's threads for a sermon: the other places in the Bible that tie in with
//! the passage, each thread named for what ties it and where that comes from. All of it is the
//! app's own data and none of it is the model's memory:
//!
//! - cross-references: the verses the cross-reference notes (about 430,000 of them, with votes)
//!   tie to the passage, best first;
//! - the same word: where else a rare Hebrew or Greek word of the passage is used (the interlinear);
//! - topics: the headings of Nave's and Torrey's topical Bibles that cite the passage, with the
//!   other verses under the same heading;
//! - people and places: where else the people and places named in the passage appear.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db::DbState;
use crate::sermon::passage_text;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct ThreadLink {
    book: String,
    chapter: i64,
    verse: i64,
    verse_end: i64,
    /// the verse in the Berean Standard Bible
    text: String,
    /// what ties it (votes, the heading, the word)
    why: String,
}

#[derive(Serialize, Clone)]
pub struct Thread {
    /// cross | word | topic | person
    kind: &'static str,
    title: String,
    /// where it comes from, as the preacher can quote it
    source: String,
    links: Vec<ThreadLink>,
}

/// A passage's verses as the sets used to leave itself out of its own threads.
struct Span<'a> {
    book: &'a str,
    chapter: i64,
    from: i64,
    to: i64,
}

impl Span<'_> {
    fn has(&self, book: &str, chapter: i64, a: i64, b: i64) -> bool {
        book == self.book && chapter == self.chapter && a <= self.to && b >= self.from
    }
}

fn link(bible: &Connection, book: &str, chapter: i64, a: i64, b: i64, why: String) -> Option<ThreadLink> {
    // a link shows at most three verses
    let b = b.min(a + 2).max(a);
    let text = passage_text(bible, book, chapter, a, b);
    if text.trim().is_empty() {
        return None;
    }
    Some(ThreadLink { book: book.to_string(), chapter, verse: a, verse_end: b, text, why })
}

fn book_order(bible: &Connection) -> HashMap<String, i64> {
    let Ok(mut st) = bible.prepare("SELECT name, order_index FROM books") else { return HashMap::new() };
    st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default()
}

/// The cross-reference notes' best ties to the passage: each target verse once, the most voted first.
fn cross_thread(bible: &Connection, span: &Span) -> Option<Thread> {
    let mut st = bible
        .prepare(
            "SELECT cr.from_verse, tb.name, cr.to_chapter, cr.to_verse_start, cr.to_verse_end, cr.votes
             FROM cross_references cr
             JOIN books fb ON fb.id = cr.from_book_id
             JOIN books tb ON tb.id = cr.to_book_id
             WHERE fb.name = ?1 AND cr.from_chapter = ?2 AND cr.from_verse BETWEEN ?3 AND ?4 AND cr.votes > 0
             ORDER BY cr.votes DESC LIMIT 600",
        )
        .ok()?;
    let rows: Vec<(i64, String, i64, i64, i64, i64)> = st
        .query_map(params![span.book, span.chapter, span.from, span.to], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))
        .ok()?
        .filter_map(Result::ok)
        .collect();
    let verses = (span.to - span.from + 1).max(1);
    // every verse of the passage gets its best ties before any verse gets more: a passage about a
    // serpent in the wilderness and God's love brings both
    let quota = if verses == 1 { 8 } else { 2 };
    let limit = if verses == 1 { 8 } else { 10 };
    let mut per_verse: HashMap<i64, usize> = HashMap::new();
    let mut chosen: Vec<(i64, String, i64, i64, i64, i64)> = Vec::new();
    let overlaps = |chosen: &Vec<(i64, String, i64, i64, i64, i64)>, b: &str, c: i64, x: i64, y: i64| chosen.iter().any(|(_, tb, tc, ta, te, _)| tb == b && *tc == c && x <= *te && y >= *ta);
    for pass in 0..2 {
        for row in &rows {
            let (from_verse, book, chapter, a, b, _) = row;
            if chosen.len() >= limit {
                break;
            }
            if span.has(book, *chapter, *a, *b) || overlaps(&chosen, book, *chapter, *a, *b) {
                continue;
            }
            let n = per_verse.entry(*from_verse).or_default();
            if pass == 0 && *n >= quota {
                continue;
            }
            *n += 1;
            chosen.push(row.clone());
        }
    }
    chosen.sort_by_key(|(from_verse, _, _, _, _, votes)| (*from_verse, std::cmp::Reverse(*votes)));
    let links: Vec<ThreadLink> = chosen
        .iter()
        .filter_map(|(from_verse, book, chapter, a, b, votes)| {
            let why = if verses > 1 { format!("{votes} votes, from verse {from_verse}") } else { format!("{votes} votes") };
            link(bible, book, *chapter, *a, *b, why)
        })
        .collect();
    if links.is_empty() {
        return None;
    }
    Some(Thread {
        kind: "cross",
        title: "The verses the cross-references tie to this passage".into(),
        source: "Cross-reference notes (Treasury of Scripture Knowledge and others), the most voted of each verse".into(),
        links,
    })
}

/// Where else a rare original word of the passage is used.
fn word_threads(bible: &Connection, study: &Connection, span: &Span, order: &HashMap<String, i64>) -> Vec<Thread> {
    let Ok(cards) = crate::assistant_words::insights(bible, study, span.book, span.chapter, span.from, span.to) else { return Vec::new() };
    let mut words: Vec<_> = cards.iter().filter(|c| c.uses >= 3 && c.uses <= 40).collect();
    words.sort_by_key(|c| c.uses);
    let mut out = Vec::new();
    for c in words.into_iter().take(3) {
        let Ok(mut st) = study.prepare("SELECT DISTINCT book, chapter, verse FROM interlinear WHERE strongs = ?1") else { continue };
        let mut places: Vec<(String, i64, i64)> = st
            .query_map(params![c.strongs], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map(|r| r.filter_map(Result::ok).collect())
            .unwrap_or_default();
        places.retain(|(b, ch, v)| !span.has(b, *ch, *v, *v));
        places.sort_by_key(|(b, ch, v)| (order.get(b).copied().unwrap_or(999), *ch, *v));
        let links: Vec<ThreadLink> = places
            .iter()
            .take(10)
            .filter_map(|(b, ch, v)| link(bible, b, *ch, *v, *v, String::new()))
            .collect();
        if links.is_empty() {
            continue;
        }
        out.push(Thread {
            kind: "word",
            title: format!("Where else {} ({}) is used: “{}”", c.original, c.translit.split('/').next().unwrap_or(""), c.lemma_gloss),
            source: format!("Interlinear, Strong's {}: {} times in all{}", c.strongs, c.uses, if places.len() > 10 { ", the first ten shown" } else { "" }),
            links,
        });
    }
    out
}

/// The topical Bibles' headings that cite the passage, each with the other verses under it.
fn topic_threads(bible: &Connection, study: &Connection, span: &Span, order: &HashMap<String, i64>) -> Vec<Thread> {
    let Ok(mut st) = study.prepare(
        "SELECT r.entry_id, e.dict_code, e.headword, COUNT(*) FROM dict_refs r JOIN dict_entries e ON e.id = r.entry_id
         WHERE e.dict_code IN ('nave', 'torrey') AND r.book = ?1 AND r.chapter = ?2 AND r.verse IS NOT NULL
           AND r.verse <= ?4 AND COALESCE(r.verse_end, r.verse) >= ?3 AND COALESCE(r.verse_end, r.verse) - r.verse <= 4
         GROUP BY r.entry_id",
    ) else {
        return Vec::new();
    };
    let cited: Vec<(i64, String, String, i64)> = st
        .query_map(params![span.book, span.chapter, span.from, span.to], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map(|r| r.filter_map(Result::ok).collect())
        .unwrap_or_default();
    // the headings with a size that makes a thread: not "Jesus, the Christ" (2,000 verses), not one verse
    let mut scored: Vec<(i64, String, String, Vec<(String, i64, i64, i64)>, i64)> = Vec::new();
    for (id, code, head, hits) in cited {
        let Ok(mut all) = study.prepare("SELECT book, chapter, verse, COALESCE(verse_end, verse) FROM dict_refs WHERE entry_id = ?1 AND verse IS NOT NULL") else { continue };
        let refs: Vec<(String, i64, i64, i64)> = all
            .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map(|r| r.filter_map(Result::ok).collect())
            .unwrap_or_default();
        if refs.len() < 6 || refs.len() > 160 {
            continue;
        }
        scored.push((id, code, head, refs.clone(), hits));
    }
    // headings that cite more of the passage, and smaller headings, first; one heading once
    scored.sort_by_key(|(_, _, _, refs, hits)| (std::cmp::Reverse(*hits), refs.len()));
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (_, code, head, mut refs, _) in scored {
        if !seen.insert(head.to_lowercase()) {
            continue;
        }
        refs.retain(|(b, c, v, e)| !span.has(b, *c, *v, *e) && *e - *v <= 6);
        refs.sort_by_key(|(b, c, v, _)| (order.get(b).copied().unwrap_or(999), *c, *v));
        refs.dedup();
        let total = refs.len();
        // spread over the heading when it is long
        let step = (total / 8).max(1);
        let links: Vec<ThreadLink> = refs.iter().step_by(step).take(8).filter_map(|(b, c, v, e)| link(bible, b, *c, *v, *e, String::new())).collect();
        if links.len() < 3 {
            continue;
        }
        out.push(Thread {
            kind: "topic",
            title: format!("{}: {head}", if code == "nave" { "Nave's" } else { "Torrey's" }),
            source: format!("{} topical Bible, the heading “{head}”: {total} other verses, {} shown", if code == "nave" { "Nave's" } else { "Torrey's" }, links.len()),
            links,
        });
        if out.len() >= 4 {
            break;
        }
    }
    out
}

/// Where else the people and places named in the passage are met.
fn person_threads(app: &AppHandle, bible: &Connection, span: &Span, order: &HashMap<String, i64>) -> Vec<Thread> {
    let state = app.state::<crate::commentaries::CommentaryState>();
    let Ok(c) = crate::commands::commentary_conn(&state) else { return Vec::new() };
    let Ok(mut st) = c.prepare(
        "SELECT DISTINCT en.kind, en.id, en.name, en.reference_count, COALESCE(substr(en.description, 1, 160), '')
         FROM entity_refs r JOIN entities en ON en.kind = r.kind AND en.id = r.entity_id
         WHERE r.kind IN ('person', 'place') AND r.book = ?1 AND r.chapter = ?2 AND r.verse BETWEEN ?3 AND ?4
           AND en.reference_count BETWEEN 3 AND 250
         ORDER BY en.reference_count",
    ) else {
        return Vec::new();
    };
    let found: Vec<(String, String, String, i64, String)> = st
        .query_map(params![span.book, span.chapter, span.from, span.to], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .map(|r| r.filter_map(Result::ok).collect())
        .unwrap_or_default();
    let mut out = Vec::new();
    let mut names: HashSet<String> = HashSet::new();
    for (kind, id, name, count, about) in found {
        if !names.insert(name.to_lowercase()) {
            continue;
        }
        let Ok(mut refs_st) = c.prepare("SELECT book, chapter, verse, COALESCE(end_verse, verse) FROM entity_refs WHERE kind = ?1 AND entity_id = ?2") else { continue };
        let mut refs: Vec<(String, i64, i64, i64)> = refs_st
            .query_map(params![kind, id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map(|r| r.filter_map(Result::ok).collect())
            .unwrap_or_default();
        refs.retain(|(b, ch, v, e)| !span.has(b, *ch, *v, *e));
        refs.sort_by_key(|(b, ch, v, _)| (order.get(b).copied().unwrap_or(999), *ch, *v));
        refs.dedup_by_key(|(b, ch, v, _)| (b.clone(), *ch, *v));
        let total = refs.len();
        let step = (total / 8).max(1);
        let links: Vec<ThreadLink> = refs.iter().step_by(step).take(8).filter_map(|(b, ch, v, _)| link(bible, b, *ch, *v, *v, String::new())).collect();
        if links.len() < 2 {
            continue;
        }
        let first = about.split(['.', '\n']).next().unwrap_or("").trim().to_string();
        out.push(Thread {
            kind: "person",
            title: format!("{name}: {} other place{} {}", total, if total == 1 { "" } else { "s" }, if kind == "place" { "it is named" } else { "named" }),
            source: format!("{} in the app's people and places data ({count} mentions){}", name, if first.is_empty() { String::new() } else { format!(": {first}") }),
            links,
        });
        if out.len() >= 3 {
            break;
        }
    }
    out
}

#[derive(serde::Deserialize)]
pub struct LinkRef {
    book: String,
    chapter: i64,
    verse: i64,
    verse_end: i64,
}

const TIE_RULES: &str = "You are shown a Bible passage and another verse that is tied to it. In one short sentence (at most 25 words), \
say what the two have in common, using only the words and ideas of the two texts. Add no names, numbers or doctrine that are not in them. \
If they have nothing clear in common, reply only: NO\n\n\
Example\n\
Passage: The LORD is my shepherd; I shall not want.\n\
Other verse: I am the good shepherd. The good shepherd lays down His life for the sheep.\n\
Answer: Both speak of a shepherd who looks after his sheep.";

fn cut(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let head: String = flat.chars().take(max).collect();
    format!("{}…", head.rsplit_once(' ').map_or(head.as_str(), |x| x.0))
}

/// One sentence for each link, from the passage and that verse alone: what they have in common
/// (None when the model had nothing clear to say, or its sentence brought in something the two
/// texts don't have). The model is not asked to find links, only to say how a found one ties in.
#[tauri::command]
pub async fn ai_thread_notes(app: AppHandle, book: String, chapter: i64, verse_start: i64, verse_end: i64, links: Vec<LinkRef>) -> Result<Vec<Option<String>>, String> {
    let to = verse_end.max(verse_start).min(verse_start + 39);
    let (passage, texts) = {
        let db = app.state::<DbState>();
        let bible = db.0.lock().map_err(err)?;
        let passage = cut(&passage_text(&bible, &book, chapter, verse_start, to), 800);
        let texts: Vec<String> = links.iter().map(|l| cut(&passage_text(&bible, &l.book, l.chapter, l.verse, l.verse_end.max(l.verse)), 500)).collect();
        (passage, texts)
    };
    let model = crate::offline_ai::engine(&app).await?;
    let mut out = Vec::new();
    let total = links.len();
    for (n, (l, other)) in links.iter().zip(texts).enumerate() {
        let _ = tauri::Emitter::emit(&app, "ai-status", serde_json::json!({ "chat_id": 0, "text": format!("How {} {}:{} ties in ({} of {total})…", l.book, l.chapter, l.verse, n + 1) }));
        if other.is_empty() {
            out.push(None);
            continue;
        }
        let prompt = format!("Passage: {passage}\nOther verse: {other}\nAnswer:");
        let both = format!("{passage} {other}");
        let ask = |model: std::sync::Arc<foundry_local_sdk::Model>, prompt: String| async move {
            let raw = crate::offline_ai::complete(&model, TIE_RULES, &prompt, 70, 0.0).await.unwrap_or_default();
            crate::offline_ai::tidy(&raw).trim().to_string()
        };
        let good = |s: &str| !s.is_empty() && !crate::offline_ai::says_no(s) && s.split_whitespace().count() <= 40 && crate::assistant_words::stays_in_card(s, &both);
        let mut sentence = ask(model.clone(), prompt.clone()).await;
        if !good(&sentence) && !crate::offline_ai::says_no(&sentence) && !sentence.is_empty() {
            // once more, told what was wrong with the first
            let again = format!("{prompt} {sentence}\nThat brings in something that is not in the two texts. Say it again in one short sentence, using only words that are in them. If there is nothing clear, reply only: NO\nAnswer:");
            sentence = ask(model.clone(), again).await;
        }
        let keep = good(&sentence);
        out.push(keep.then_some(sentence));
    }
    Ok(out)
}

/// The threads of a passage.
#[tauri::command]
pub async fn ai_threads(app: AppHandle, book: String, chapter: i64, verse_start: i64, verse_end: i64) -> Result<Vec<Thread>, String> {
    let db = app.state::<DbState>();
    let bible = db.0.lock().map_err(err)?;
    let span = Span { book: &book, chapter, from: verse_start, to: verse_end.max(verse_start).min(verse_start + 39) };
    let order = book_order(&bible);
    let mut out: Vec<Thread> = Vec::new();
    out.extend(cross_thread(&bible, &span));
    let study = app.state::<crate::study::StudyState>();
    if let Some(m) = study.0.as_ref() {
        let study = m.lock().map_err(err)?;
        out.extend(word_threads(&bible, &study, &span, &order));
        out.extend(topic_threads(&bible, &study, &span, &order));
    }
    out.extend(person_threads(&app, &bible, &span, &order));
    Ok(out)
}
