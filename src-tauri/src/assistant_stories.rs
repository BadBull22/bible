//! The Offline Assistant's "stories and what others preached" for a sermon: what the app already
//! holds that goes with the passage. Nothing is written by the model.
//!
//! - Simeon's outlines and Spurgeon's sermons on the passage itself (from the app's own lists);
//! - stories and sayings (Moody's, Spurgeon's Gleanings) found by the preacher's subject and by the
//!   passage's own topics and key words;
//! - for those stories only, the model answers YES or NO to "does this story illustrate what the
//!   passage teaches?" (a judgement, not a text it writes), and the stories it says NO to are
//!   marked as weak matches and put last, not hidden.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::DbState;
use crate::offline_ai::{complete, engine};
use crate::sermon::passage_text;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct StoryItem {
    /// simeon | spurgeon | illustration
    kind: &'static str,
    title: String,
    /// where it comes from, as the preacher can quote it
    source: String,
    /// the book's own subject for a story; the passage a sermon or outline is on
    subject: String,
    /// the outline written out, a sermon's opening, or the story
    text: String,
    url: Option<String>,
    /// the model's YES or NO for a story (None: not asked)
    fits: Option<bool>,
    /// what found it (a topic, or a word of the passage)
    found_by: String,
}

const FIT_RULES: &str = "You judge whether a story or saying fits a Bible passage. You are given the passage and the story. \
Answer YES only if the story clearly illustrates what the passage teaches: the same truth, not just a shared word. \
Otherwise answer NO. Reply with YES or NO only.";

fn cut(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let head: String = flat.chars().take(max).collect();
    format!("{}…", head.rsplit_once(' ').map_or(head.as_str(), |x| x.0))
}

fn label(book: &str, chapter: i64, a: i64, b: i64) -> String {
    match (a, b) {
        (0, _) => format!("{book} {chapter}"),
        (a, b) if b > a => format!("{book} {chapter}:{a}–{b}"),
        (a, _) => format!("{book} {chapter}:{a}"),
    }
}

/// Stories and what the old preachers did with the passage.
#[tauri::command]
pub async fn ai_stories(app: AppHandle, book: String, chapter: i64, verse_start: i64, verse_end: i64, topics: Vec<String>, judge: bool) -> Result<Vec<StoryItem>, String> {
    let to = verse_end.max(verse_start).min(verse_start + 39);
    let mut out: Vec<StoryItem> = Vec::new();

    // Simeon's outlines and Spurgeon's sermons on the passage
    for d in app.state::<crate::preaching::OutlinesState>().on(&book, chapter, verse_start, to).into_iter().take(3) {
        let lines: Vec<String> = d
            .outline
            .iter()
            .map(|l| if l.level == 1 { format!("• {}", l.text) } else { format!("    – {}", l.text) })
            .collect();
        out.push(StoryItem {
            kind: "simeon",
            title: d.title.clone(),
            source: format!("Charles Simeon, Horae Homileticae, no. {}", d.n),
            subject: label(&d.book, d.chapter, d.verse, d.verse_end),
            text: if d.announce.is_empty() { lines.join("\n") } else { format!("{}\n{}", d.announce, lines.join("\n")) },
            url: None,
            fits: None,
            found_by: "on this passage".into(),
        });
    }
    for s in app.state::<crate::preaching::SpurgeonState>().on(&book, chapter, verse_start, to).into_iter().take(4) {
        let when = [s.date.as_str(), s.place.as_str()].iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join(", ");
        out.push(StoryItem {
            kind: "spurgeon",
            title: s.title.clone(),
            source: format!("C. H. Spurgeon, sermon no. {}{}", s.n, if when.is_empty() { String::new() } else { format!(" ({when})") }),
            subject: label(&s.book, s.chapter, s.verse, s.verse_end),
            text: cut(&s.opening, 700),
            url: Some(s.url.clone()),
            fits: None,
            found_by: "on this passage".into(),
        });
    }

    // what to look for in the stories: the preacher's subjects, the passage's topical headings, its weighty words
    let mut queries: Vec<String> = topics.iter().filter(|t| !t.trim().is_empty() && crate::sermon::key_stems(t).len() > 0 && !t.chars().any(|c| c.is_ascii_digit())).cloned().collect();
    {
        let study = app.state::<crate::study::StudyState>();
        if let Some(m) = study.0.as_ref() {
            let study = m.lock().map_err(err)?;
            if let Ok(mut st) = study.prepare(
                "SELECT e.headword, COUNT(*) FROM dict_refs r JOIN dict_entries e ON e.id = r.entry_id
                 WHERE e.dict_code IN ('nave', 'torrey') AND r.book = ?1 AND r.chapter = ?2 AND r.verse IS NOT NULL
                   AND r.verse <= ?4 AND COALESCE(r.verse_end, r.verse) >= ?3 AND COALESCE(r.verse_end, r.verse) - r.verse <= 4
                 GROUP BY e.id ORDER BY COUNT(*) DESC LIMIT 12",
            ) {
                let heads: Vec<String> = st
                    .query_map(rusqlite::params![book, chapter, verse_start, to], |r| r.get::<_, String>(0))
                    .map(|r| r.filter_map(Result::ok).collect())
                    .unwrap_or_default();
                // generic headings find everything: "Jesus, the Christ", "God", "Man"
                queries.extend(heads.into_iter().filter(|h| !matches!(h.to_lowercase().as_str(), "jesus, the christ" | "god" | "man" | "christ" | "jesus" | "life" | "righteous")).take(4));
            }
            let bible = app.state::<DbState>();
            let bible = bible.0.lock().map_err(err)?;
            if let Ok(mut cards) = crate::assistant_words::insights(&bible, &study, &book, chapter, verse_start, to) {
                cards.sort_by(|a, b| b.score.total_cmp(&a.score));
                queries.extend(cards.iter().take(3).map(|c| c.lemma_gloss.trim_start_matches("to ").to_string()));
            }
        }
    }
    queries.dedup();
    let mut found: Vec<(crate::preaching::Illustration, String, usize)> = Vec::new();
    {
        let state = app.state::<crate::preaching::IllustrationsState>();
        let mut seen: HashMap<String, usize> = HashMap::new();
        for q in queries.iter().take(10) {
            for i in state.search(q, 4) {
                if i.title.starts_with('[') || i.text.chars().count() < 120 {
                    continue;
                }
                match seen.get(&i.id).copied() {
                    Some(at) => found[at].2 += 1,
                    None => {
                        seen.insert(i.id.clone(), found.len());
                        found.push((i, q.clone(), 1));
                    }
                }
            }
        }
    }
    // those that several of the queries found first, then in the order found
    found.sort_by_key(|(_, _, n)| std::cmp::Reverse(*n));
    found.truncate(8);
    let mut stories: Vec<StoryItem> = found
        .into_iter()
        .map(|(i, q, _)| StoryItem {
            kind: "illustration",
            title: i.title.clone(),
            source: i.source.clone(),
            subject: i.subject.clone(),
            text: cut(&i.text, 3000),
            url: None,
            fits: None,
            found_by: q,
        })
        .collect();

    // the model's YES or NO: it writes nothing
    if judge && !stories.is_empty() {
        let passage = {
            let bible = app.state::<DbState>();
            let bible = bible.0.lock().map_err(err)?;
            cut(&passage_text(&bible, &book, chapter, verse_start, to), 900)
        };
        let model = engine(&app).await?;
        let total = stories.len();
        for (n, s) in stories.iter_mut().enumerate() {
            let _ = app.emit("ai-status", serde_json::json!({ "chat_id": 0, "text": format!("Does “{}” fit the passage? ({} of {total})", s.title, n + 1) }));
            let prompt = format!("Passage: {}\n{passage}\n\nStory: {} — {}\n\nDoes the story illustrate what the passage teaches? Answer YES or NO.", label(&book, chapter, verse_start, to), s.title, cut(&s.text, 600));
            if let Ok(reply) = complete(&model, FIT_RULES, &prompt, 4, 0.0).await {
                s.fits = Some(reply.trim().to_lowercase().starts_with("yes"));
            }
        }
        // the ones it says fit first
        stories.sort_by_key(|s| match s.fits {
            Some(true) => 0,
            None => 1,
            Some(false) => 2,
        });
    }
    out.extend(stories);
    Ok(out)
}
