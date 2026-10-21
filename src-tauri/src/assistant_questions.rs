//! The Offline Assistant's questions for a small group on a passage: plain questions to ask, from
//! what the passage says (what is said, what it means, what to do about it). A question is a
//! prompt, not a claim, so the check is only that it is a question about this passage: it names
//! nobody and mentions no number the passage doesn't, and it uses the passage's own words.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::DbState;
use crate::offline_ai::{complete, engine, names_in, number_facts, passage_answer};
use crate::sermon::passage_text;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct GroupQuestion {
    /// look | think | do
    kind: &'static str,
    text: String,
}

const QUESTION_RULES: &str = "You help a small-group leader. Given a Bible passage, write five short, plain discussion questions about it, one per line, \
each starting with its number and a full stop: questions 1 and 2 ask what the passage says (who, what, where, what happened), questions 3 and 4 \
ask what it means (why, what does it teach), question 5 asks how to live it (what should we do or change). \
Each question is one sentence of at most fifteen words, in everyday language, and uses words from the passage. \
Never begin with \"What does the passage say\". Do not add names, numbers or facts that are not in the passage. No other text.\n\n\
Example (for Psalm 1:1-2)\n\
1. Who is called blessed in these verses?\n\
2. What does this person not do?\n\
3. Why does delighting in the law of the LORD bring blessing?\n\
4. What does it mean to meditate on it day and night?\n\
5. What advice are we following that we should walk away from?";

fn content_words(s: &str) -> std::collections::HashSet<String> {
    s.to_lowercase().split(|c: char| !c.is_alphabetic()).filter(|w| w.len() > 3).map(|w| w.trim_end_matches(&['s', 'd', 'e'][..]).to_string()).collect()
}

/// Whether a question turns to the group ("How can we…", "What would you change…"): the fifth question
/// is meant to be about living it, and one that is only about the passage is not.
fn is_application(question: &str) -> bool {
    question.to_lowercase().split(|c: char| !c.is_alphabetic()).any(|w| matches!(w, "we" | "us" | "our" | "ourselves" | "you" | "your" | "yourself" | "i" | "my"))
}

/// The number a line of the model's list starts with ("3. Why…" is 3).
fn number_of(line: &str) -> Option<usize> {
    line.trim().split(|c: char| !c.is_ascii_digit()).next().and_then(|d| d.parse().ok())
}

/// A line of the model's list as a question, or None when it isn't one this passage can carry.
fn keep(line: &str, passage: &str) -> Option<String> {
    let text = line.trim().trim_start_matches(|c: char| c.is_ascii_digit() || matches!(c, '.' | ')' | '-' | '•' | '*' | ' ')).trim().to_string();
    if !text.ends_with('?') || text.split_whitespace().count() < 4 || text.split_whitespace().count() > 30 {
        return None;
    }
    let p = passage.to_lowercase();
    // no name or number the passage hasn't got
    if names_in(&format!("x. {text}")).iter().any(|n| !p.contains(n.as_str())) {
        return None;
    }
    let have = number_facts(&p);
    if number_facts(&text).iter().any(|n| n != "one" && !have.contains(n)) {
        return None;
    }
    // it uses the passage's own words
    let (mine, theirs) = (content_words(&text), content_words(passage));
    (mine.iter().filter(|w| theirs.iter().any(|x| x.starts_with(w.as_str()) || w.starts_with(x.as_str()))).count() >= 1).then_some(text)
}

/// Discussion questions for a passage.
#[tauri::command]
pub async fn ai_group_questions(app: AppHandle, book: String, chapter: i64, verse_start: i64, verse_end: i64) -> Result<Vec<GroupQuestion>, String> {
    let to = verse_end.max(verse_start).min(verse_start + 39);
    let passage = {
        let db = app.state::<DbState>();
        let bible = db.0.lock().map_err(err)?;
        passage_text(&bible, &book, chapter, verse_start, to)
    };
    if passage.trim().is_empty() {
        return Ok(Vec::new());
    }
    let shown: String = passage.chars().take(2400).collect();
    let model = engine(&app).await?;
    let _ = app.emit("ai-status", serde_json::json!({ "chat_id": 0, "text": "Writing questions for the group…" }));
    let raw = complete(&model, QUESTION_RULES, &format!("Passage ({book} {chapter}:{verse_start}-{to}):\n{shown}\n\nThe five questions:"), 320, 0.3).await?;
    let mut out: Vec<GroupQuestion> = Vec::new();
    for (i, line) in raw.lines().filter(|l| !l.trim().is_empty()).enumerate() {
        if let Some(q) = keep(line, &passage) {
            if !out.iter().any(|x| x.text.eq_ignore_ascii_case(&q)) {
                let kind = match number_of(line).unwrap_or(i + 1) {
                    0..=2 => "look",
                    3 | 4 => "think",
                    _ => "do",
                };
                out.push(GroupQuestion { kind, text: q });
            }
        }
    }
    out.truncate(5);
    // a question stays only if the assistant's own checked reading can answer it from the passage
    // (so none assumes something the passage doesn't say); an application question is not asked
    // for an answer, it only has to stay with the passage's words
    let lines = {
        let db = app.state::<DbState>();
        let bible = db.0.lock().map_err(err)?;
        let mut v = Vec::new();
        for n in verse_start..=to.min(verse_start + 25) {
            let text = passage_text(&bible, &book, chapter, n, n);
            if !text.trim().is_empty() {
                v.push(format!("[{book} {chapter}:{n}] {text}"));
            }
        }
        v.join("\n")
    };
    let mut fair: Vec<GroupQuestion> = Vec::new();
    for q in out {
        let ok = if q.kind == "do" { is_application(&q.text) } else { passage_answer(&model, &book, chapter, verse_start, to.min(verse_start + 25), &lines, &q.text).await.is_some() };
        if ok {
            fair.push(q);
        }
    }
    Ok(fair)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_question_must_be_about_the_passage() {
        let passage = "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";
        assert!(keep("1. What did God give because He loved the world?", passage).is_some());
        assert!(keep("3. Why do you think belief leads to eternal life?", passage).is_some());
        // a name or a number the passage lacks
        assert!(keep("2. How does this compare with what Abraham did?", passage).is_none());
        assert!(keep("2. What happened in the forty days?", passage).is_none());
        // not a question, or nothing to do with the passage
        assert!(keep("4. God loves the world.", passage).is_none());
        assert!(keep("5. Where would you like to go on holiday?", passage).is_none());
        // an application question turns to the group
        assert!(is_application("How can we show this kind of love?"));
        assert!(!is_application("How does the passage describe the relationship between the sons and the father?"));
    }
}
