//! The Offline Assistant's structure ideas for a sermon: the passage cut into its natural parts,
//! each with a short heading in the passage's own words.
//!
//! The parts are the passage's own: a long passage is cut at its paragraph-sized breaks (about the
//! same number of verses each), a verse or two at its clauses. The model writes only the short
//! heading of each part, from that part's text, and the heading is kept only if its words are the
//! part's own words (no name or number the part hasn't got); the preacher sees the part's verses
//! beside it either way, and nothing is added to the sermon unless they press Add.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::DbState;
use crate::offline_ai::{complete, engine, names_in, number_facts, says_no, tidy};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct Part {
    verse_start: i64,
    verse_end: i64,
    /// the part, as it is in the Berean Standard Bible
    text: String,
    /// a short heading from the part's own words (None: none passed the check)
    heading: Option<String>,
    /// what the model said before the check (for testing)
    said: String,
}

const HEADING_RULES: &str = "You give a short heading to part of a Bible passage, for a preacher's outline. \
Use at most eight words, and use the words of the passage itself. Do not add names, numbers or ideas that are not in the text. \
Reply with the heading only.\n\n\
Example\n\
Text: Blessed is the man who does not walk in the counsel of the wicked, nor stand in the way of sinners, nor sit in the seat of mockers.\n\
Heading: The blessed man keeps away from the wicked

Example
Text: Then Jesus went with them to a place called Gethsemane, and He said to His disciples, \"Sit here while I go over there and pray.\"
Heading: Jesus goes to pray at Gethsemane";

/// The parts a passage is cut into: (first verse, last verse, text), or for one or two verses its clauses.
fn parts_of(verses: &[(i64, String)]) -> Vec<(i64, i64, String)> {
    let total = verses.len();
    if total == 0 {
        return Vec::new();
    }
    if total <= 2 {
        // clauses: cut at commas, semicolons and colons, keeping each part at four words or more
        let joined: Vec<(i64, String)> = verses.to_vec();
        let mut out: Vec<(i64, i64, String)> = Vec::new();
        for (n, text) in joined {
            let mut cur = String::new();
            let mut pieces: Vec<String> = Vec::new();
            for c in text.chars() {
                cur.push(c);
                if matches!(c, ',' | ';' | ':') && cur.split_whitespace().count() >= 4 {
                    pieces.push(std::mem::take(&mut cur));
                }
            }
            if !cur.trim().is_empty() {
                match pieces.last_mut() {
                    Some(last) if cur.split_whitespace().count() < 4 => last.push_str(&cur),
                    _ => pieces.push(cur),
                }
            }
            out.extend(pieces.into_iter().map(|p| (n, n, p.trim().to_string())));
        }
        // a single clause is no outline
        return if out.len() >= 2 { out } else { Vec::new() };
    }
    // sections of about the same length: three for a short passage, four from fifteen verses, five from thirty
    let n = if total < 15 { 3.min(total) } else if total < 30 { 4 } else { 5 };
    // cut near the even places, at the verse nearby that looks most like the start of a new paragraph
    let radius = (total / (2 * n)).max(1);
    let mut cuts: Vec<usize> = vec![0];
    for i in 1..n {
        let even = i * total / n;
        let lo = (even.saturating_sub(radius)).max(cuts[cuts.len() - 1] + 1);
        let hi = (even + radius).min(total - (n - i));
        let best = (lo..=hi.max(lo)).max_by_key(|&k| (paragraph_start(&verses[k - 1].1, &verses[k].1) * 10 - (k as i32 - even as i32).abs(), std::cmp::Reverse(k))).unwrap_or(even);
        cuts.push(best);
    }
    cuts.push(total);
    cuts.windows(2)
        .map(|w| {
            let slice = &verses[w[0]..w[1]];
            (slice[0].0, slice[slice.len() - 1].0, slice.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join(" "))
        })
        .collect()
}

/// How much a verse looks like the start of a new paragraph, from how it begins and how the verse
/// before it ends: a "Then", "But" or "When" after a finished sentence, not a speech carrying on.
fn paragraph_start(previous: &str, this: &str) -> i32 {
    let this = this.trim_start();
    let first = this.split(|c: char| !c.is_alphabetic()).find(|w| !w.is_empty()).unwrap_or("");
    let mut score = 0;
    if matches!(first, "Then" | "Now" | "But" | "After" | "Later" | "When" | "Once" | "Meanwhile" | "Afterward" | "Soon" | "Therefore" | "So" | "On" | "In") {
        score += 2;
    }
    if previous.trim_end().ends_with(['.', '!', '?', '”', '’']) {
        score += 1;
    }
    // a speech going on, or a sentence going on
    if this.starts_with(['“', '‘', '"']) && this.chars().nth(1).is_some_and(char::is_lowercase) {
        score -= 2;
    }
    if this.chars().next().is_some_and(char::is_lowercase) || !previous.trim_end().ends_with(['.', '!', '?', '”', '’', ':']) {
        score -= 3;
    }
    score
}

/// A heading is kept when it is short, is not a refusal, and has nothing the part lacks.
fn heading_ok(heading: &str, part: &str) -> bool {
    let words = heading.split_whitespace().count();
    if heading.is_empty() || words > 10 || says_no(heading) {
        return false;
    }
    let p = part.to_lowercase();
    if names_in(&format!("x. {heading}")).iter().any(|n| !p.contains(n.as_str())) {
        return false;
    }
    let have = number_facts(&p);
    if number_facts(heading).iter().any(|n| !have.contains(n)) {
        return false;
    }
    // most of the heading's own words are the part's
    let stems = |s: &str| -> std::collections::HashSet<String> { s.to_lowercase().split(|c: char| !c.is_alphabetic()).filter(|w| w.len() > 3).map(|w| w.trim_end_matches(&['s', 'd', 'e'][..]).to_string()).collect() };
    let (h, t) = (stems(heading), stems(part));
    h.is_empty() || h.iter().filter(|w| t.iter().any(|x| x.starts_with(w.as_str()) || w.starts_with(x.as_str()))).count() as f32 >= 0.5 * h.len() as f32
}

/// The passage's parts with a short heading for each.
#[tauri::command]
pub async fn ai_structure(app: AppHandle, book: String, chapter: i64, verse_start: i64, verse_end: i64, headings: bool) -> Result<Vec<Part>, String> {
    let to = verse_end.max(verse_start).min(verse_start + 59);
    let verses: Vec<(i64, String)> = {
        let db = app.state::<DbState>();
        let bible = db.0.lock().map_err(err)?;
        let mut st = bible
            .prepare(
                "SELECT v.verse, v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
                 WHERE ver.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse BETWEEN ?3 AND ?4 ORDER BY v.verse",
            )
            .map_err(err)?;
        let rows = st.query_map(rusqlite::params![book, chapter, verse_start, to], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(err)?;
        rows.filter_map(Result::ok).collect()
    };
    let mut parts: Vec<Part> = parts_of(&verses).into_iter().map(|(a, b, text)| Part { verse_start: a, verse_end: b, text, heading: None, said: String::new() }).collect();
    if headings && !parts.is_empty() {
        let model = engine(&app).await?;
        let total = parts.len();
        for (n, p) in parts.iter_mut().enumerate() {
            let _ = app.emit("ai-status", serde_json::json!({ "chat_id": 0, "text": format!("Giving part {} of {total} a heading…", n + 1) }));
            let prompt = format!("Text: {}\nHeading:", p.text);
            let clean = |raw: String| {
                let h = tidy(&raw).trim().trim_matches(|c| c == '"' || c == '“' || c == '”' || c == '.').trim().to_string();
                h.strip_prefix("Heading:").map_or(h.clone(), |x| x.trim().to_string())
            };
            let first = clean(complete(&model, HEADING_RULES, &prompt, 40, 0.0).await.unwrap_or_default());
            p.said = first.clone();
            if heading_ok(&first, &p.text) {
                p.heading = Some(first);
                continue;
            }
            // once more, told what was wrong with the first
            let again = format!(
                "Text: {}\nYour heading \"{first}\" used words that are not in the text, or was too long. Give another heading of at most six words, using only words that appear in the text above.\nHeading:",
                p.text
            );
            let second = clean(complete(&model, HEADING_RULES, &again, 30, 0.0).await.unwrap_or_default());
            if heading_ok(&second, &p.text) {
                p.said = second.clone();
                p.heading = Some(second);
            }
        }
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(texts: &[&str]) -> Vec<(i64, String)> {
        texts.iter().enumerate().map(|(i, t)| (i as i64 + 1, t.to_string())).collect()
    }

    #[test]
    fn a_long_passage_is_cut_into_even_parts() {
        let verses: Vec<(i64, String)> = (1..=10).map(|i| (i, format!("verse {i}"))).collect();
        let parts = parts_of(&verses);
        assert_eq!(parts.len(), 3);
        assert_eq!((parts[0].0, parts[0].1), (1, 3));
        assert_eq!(parts[2].1, 10);
        // every verse is in exactly one part
        assert_eq!(parts.iter().map(|p| p.1 - p.0 + 1).sum::<i64>(), 10);
    }

    #[test]
    fn the_parts_begin_where_a_paragraph_begins() {
        // the prodigal son, as the Berean text begins its verses
        let v = v(&[
            "Then Jesus said, “There was a man who had two sons.",
            "The younger son said to him, ‘Father, give me my share.’",
            "After a few days, the younger son journeyed to a distant country.",
            "There he squandered his wealth.",
            "He longed to fill his belly with the pods.",
            "Finally he came to his senses.",
            "So he got up and went to his father.",
            "But the father said to his servants, ‘Quick! Bring the best robe.’",
            "Bring the fattened calf and kill it.",
            "Now his older son was in the field.",
            "He became angry and refused to go in.",
            "‘Your brother has returned,’ he said.",
        ]);
        let parts = parts_of(&v);
        assert_eq!(parts.len(), 3);
        // the cuts fall on "But the father" or "Now his older son", not mid-scene
        assert!(parts[1].2.starts_with("So he got up") || parts[1].2.starts_with("But the father") || parts[1].2.starts_with("After"), "{parts:?}");
        assert!(parts[2].2.starts_with("Now his older son") || parts[2].2.starts_with("But the father"), "{parts:?}");
        assert_eq!(parts.iter().map(|p| p.1 - p.0 + 1).sum::<i64>(), 12);
    }

    #[test]
    fn one_verse_is_cut_at_its_clauses() {
        let parts = parts_of(&v(&["For God so loved the world, that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life."]));
        assert_eq!(parts.len(), 3, "{parts:?}");
        assert!(parts[0].2.starts_with("For God so loved"));
        // a short verse with one clause is no outline
        assert!(parts_of(&v(&["Jesus wept."])).is_empty());
    }

    #[test]
    fn a_heading_stays_in_its_part() {
        let part = "For God so loved the world, that He gave His one and only Son";
        assert!(heading_ok("God so loved the world", part));
        assert!(heading_ok("God gave His only Son", part));
        // a name or a number the part hasn't got
        assert!(!heading_ok("Abraham offered his only son", part));
        assert!(!heading_ok("Three gifts of God", part));
        // a refusal
        assert!(!heading_ok("NO", part));
    }
}
