//! The gate between "this stored question looks like the one you asked" (a match by meaning) and showing its answer as THE answer.
//! A match by meaning can be a neighbour: "how long did Noah live" is close to "who was the oldest person in the Bible", and
//! "who baptized Jesus" is close to "is water baptism required". The gate checks two things the meaning match does not:
//!   1. the KIND of question agrees (who, how many, when, where, yes or no): "who wrote the most books" does not answer "how many books";
//!   2. the words that carry the question (names, numbers, the subject) are really in the stored question: "Noah" is not in "oldest person".
//! A match that fails the gate is not shown as the answer; the app goes on to the dictionary and the passage search, which are labelled
//! as best-effort. A very close paraphrase (similarity at or above `CLOSE`) passes without the word check.

use std::collections::HashSet;

/// Similarity at or above which a match is trusted as a paraphrase without the word check.
pub const CLOSE: f32 = 0.93;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Who,
    Quantity,
    When,
    Where,
    YesNo,
    Open,
}

fn kind_of(q: &str) -> Kind {
    let q = q.trim().to_lowercase();
    let q = q.trim_start_matches(|c: char| !c.is_alphanumeric());
    let starts = |p: &[&str]| p.iter().any(|w| q == *w || q.starts_with(&format!("{w} ")));
    if starts(&["who", "whom", "whose"]) {
        Kind::Who
    } else if q.starts_with("how many") || q.starts_with("how much") || q.starts_with("how long") || q.starts_with("how old") || q.starts_with("how tall") || q.starts_with("how far") || q.starts_with("how big") {
        Kind::Quantity
    } else if starts(&["when"]) || q.starts_with("what year") || q.starts_with("what day") || q.starts_with("what time") {
        Kind::When
    } else if starts(&["where"]) {
        Kind::Where
    } else if starts(&["is", "are", "was", "were", "does", "do", "did", "can", "could", "should", "will", "would", "has", "have", "must", "may"]) {
        Kind::YesNo
    } else {
        Kind::Open
    }
}

/// Two kinds of question that can never have the same answer.
fn conflict(a: Kind, b: Kind) -> bool {
    a != b && a != Kind::Open && b != Kind::Open
}

const STOP: &[&str] = &[
    "a", "an", "the", "of", "in", "on", "at", "to", "for", "from", "by", "with", "and", "or", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "done", "i", "you", "he", "she",
    "it", "we", "they", "me", "my", "your", "his", "her", "our", "their", "this", "that", "these", "those", "what", "who", "whom", "whose", "which", "when", "where", "why", "how", "can", "could", "should",
    "would", "will", "about", "say", "says", "said", "tell", "me", "please", "there", "any", "some", "bible", "biblical", "scripture", "according", "mean", "means", "meaning", "have", "has", "had",
    "many", "much", "long", "old", "much", "get", "gets", "got", "become", "becomes", "if", "so", "as", "not", "no", "yes", "than", "then", "into", "up", "out",
];

/// Words the Bible and its readers use for the same thing.
const SAME: &[&[&str]] = &[
    &["jesus", "christ"],
    &["save", "saved", "salvation", "saving", "saviour", "savior"],
    &["die", "died", "death", "dead", "dies"],
    &["kill", "killed", "slay", "slain", "murder", "murdered"],
    &["baptize", "baptized", "baptism", "baptise", "baptised", "baptising", "baptizing"],
    &["betray", "betrayed", "betrayal", "betrayer"],
    &["wife", "wives", "married", "marry", "husband", "spouse"],
    &["child", "children", "son", "sons", "daughter", "daughters"],
    &["rapture", "caught", "snatched"],
    &["holy", "spirit", "ghost"],
    &["pray", "prayer", "prayers", "praying"],
    &["heaven", "heavens", "heavenly"],
];

fn stem(w: &str) -> String {
    let mut s = w.to_string();
    for suf in ["ing", "ed", "es", "s", "ly"] {
        if s.len() > suf.len() + 2 && s.ends_with(suf) {
            s.truncate(s.len() - suf.len());
            break;
        }
    }
    s
}

fn tokens(q: &str) -> Vec<String> {
    let stop: HashSet<&str> = STOP.iter().copied().collect();
    q.to_lowercase()
        .replace(['’', '\''], "")
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !stop.contains(w))
        .map(norm)
        .collect()
}

/// A word as the gate compares it: one word of a group of words that mean the same (the first word stands for the group), else its stem.
fn norm(w: &str) -> String {
    SAME.iter().find(|g| g.contains(&w)).map(|g| g[0].to_string()).unwrap_or_else(|| stem(w))
}

/// Do two words stand for the same thing (equal, or long words that share their first five letters: betray/betrayal)?
fn same(a: &str, b: &str) -> bool {
    a == b || (a.len() >= 6 && b.len() >= 6 && a[..5] == b[..5])
}

/// Share of the question's own words that the stored question has: 1.0 when every word is there.
fn coverage(query: &str, stored: &str) -> f32 {
    let q = tokens(query);
    if q.is_empty() {
        return 1.0;
    }
    let s = tokens(stored);
    let found = q.iter().filter(|w| s.iter().any(|x| same(w, x))).count();
    found as f32 / q.len() as f32
}

/// Whether a stored question (with its other phrasings) may be shown as the answer to `query`, matched by meaning at `similarity`.
/// `is_name` says whether a word is a name of a person or place: a name in the question must be in the stored one ("how many days was
/// Lazarus dead" is not answered by "how many days was Jesus dead").
pub fn agrees(query: &str, stored: &[&str], similarity: f32, is_name: &dyn Fn(&str) -> bool) -> bool {
    let qk = kind_of(query);
    // the answer is about the stored question itself (the first one), whatever other ways of asking it are listed
    if stored.first().is_some_and(|canonical| conflict(qk, kind_of(canonical))) {
        return false;
    }
    let names: Vec<String> = query
        .to_lowercase()
        .replace(['’', '\''], "")
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !STOP.contains(w) && is_name(w))
        .map(|w| w.to_string())
        .collect();
    // the best of the phrasings: the one that agrees in kind, has the names asked about, and covers the most of the question's words
    stored
        .iter()
        .filter(|s| !conflict(qk, kind_of(s)))
        .filter(|s| {
            let t = tokens(s);
            names.iter().all(|n| {
                let n = norm(n);
                t.iter().any(|x| same(&n, x))
            })
        })
        .map(|s| coverage(query, s))
        .fold(None, |best: Option<f32>, c| Some(best.map_or(c, |b| b.max(c))))
        .is_some_and(|c| similarity >= CLOSE || c >= 0.6)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighbours_that_are_not_the_answer_are_turned_away() {
        for (q, stored) in [
            ("how long did Noah live", vec!["Who was the oldest person in the Bible?", "oldest person in the bible"]),
            ("how many books are in the New Testament", vec!["Who wrote the most books in the New Testament?"]),
            ("how many books are in the Old Testament", vec!["How many books are in the Bible?", "how many books does the bible have"]),
            ("who betrayed Jesus", vec!["Messiah would be betrayed"]),
            ("who baptized Jesus", vec!["Is water baptism required for salvation?"]),
            ("who was the mother of Jesus", vec!["Did Jesus have brothers and sisters?"]),
        ] {
            assert!(!agrees(q, &stored, 0.78, &|_| false), "{q} should not be answered by {stored:?}");
        }
    }

    #[test]
    fn real_paraphrases_still_pass() {
        for (q, stored) in [
            ("how do you become saved?", vec!["What must I do to be saved?", "how do I get saved"]),
            ("how can i be saved", vec!["What must I do to be saved?"]),
            ("how many times did Jesus appear after he rose", vec!["How many times did Jesus appear after His resurrection?"]),
            ("who was the oldest person in the bible", vec!["Who was the oldest person in the Bible?"]),
            ("what is the rapture", vec!["What is the Rapture?"]),
            ("can a christian lose salvation", vec!["Can a Christian lose their salvation?"]),
            ("do women serve as pastors", vec!["Can women serve as pastors or elders?"]),
            ("how many books in the bible", vec!["How many books are in the Bible?"]),
        ] {
            assert!(agrees(q, &stored, 0.78, &|_| false), "{q} should be answered by {stored:?}");
        }
        // a very close paraphrase passes on similarity alone
        assert!(agrees("tell me what the trinity is", &["How can there be one God, yet three Persons (the Trinity)?"], 0.95, &|_| false));
        // a name asked about must be in the stored question, whatever else matches
        let known = |w: &str| matches!(w, "lazarus" | "jesus" | "noah");
        assert!(!agrees("how many days was lazarus dead", &["how many days was jesus dead"], 0.8, &known));
        assert!(agrees("how many days was jesus dead", &["How many days was Jesus dead?"], 0.8, &known));
    }

    #[test]
    fn the_kinds_of_question() {
        assert_eq!(kind_of("Who was Aaron?"), Kind::Who);
        assert_eq!(kind_of("how many days was Jonah in the fish"), Kind::Quantity);
        assert_eq!(kind_of("How old was Joseph"), Kind::Quantity);
        assert_eq!(kind_of("when was Jesus born"), Kind::When);
        assert_eq!(kind_of("Where was Jesus born"), Kind::Where);
        assert_eq!(kind_of("Is Jesus God?"), Kind::YesNo);
        assert_eq!(kind_of("what is faith"), Kind::Open);
        assert_eq!(kind_of("the prodigal son"), Kind::Open);
    }
}
