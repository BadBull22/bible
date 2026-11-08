//! Spelling help for questions: "who betryed jesus" is read as "who betrayed jesus", and the reader is told so ("Showing results for…").
//! The word list is the Bible's own (the BSB and the KJV), the names in the people and places data, and the words of the curated
//! answers, so Bible words and names are never "corrected" and doctrinal words such as "rapture" are known. A word the list does not
//! have is changed only to a word one or two letters away that starts with the same letter, and only when that word is common enough.

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::Connection;

pub struct Vocab {
    freq: HashMap<String, u32>,
    /// the words of the names of people and places (lower case)
    names: std::collections::HashSet<String>,
}

/// Lower-case alphabetic words (apostrophes dropped), at least two letters.
fn words_of(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphabetic() && c != '\'' && c != '’')
        .map(|w| w.replace(['\'', '’'], "").to_lowercase())
        .filter(|w| w.chars().count() >= 2)
}

/// Optimal-string-alignment distance (insert, delete, replace, swap two neighbours), giving up above `max`.
fn distance(a: &[char], b: &[char], max: usize) -> Option<usize> {
    if a.len().abs_diff(b.len()) > max {
        return None;
    }
    let mut prev2: Vec<usize> = vec![0; b.len() + 1];
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        let mut best = cur[0];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut d = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d = d.min(prev2[j - 2] + 1);
            }
            cur[j] = d;
            best = best.min(d);
        }
        if best > max {
            return None;
        }
        prev2 = prev;
        prev = cur;
    }
    (prev[b.len()] <= max).then_some(prev[b.len()])
}

impl Vocab {
    pub fn from_texts<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vocab {
        let mut freq: HashMap<String, u32> = HashMap::new();
        for t in texts {
            for w in words_of(t) {
                *freq.entry(w).or_insert(0) += 1;
            }
        }
        Vocab { freq, names: std::collections::HashSet::new() }
    }

    /// The question with its misspelt words put right; None when nothing needed changing.
    pub fn correct(&self, question: &str) -> Option<String> {
        let mut out = String::new();
        let mut changed = false;
        let mut word = String::new();
        let flush = |word: &mut String, out: &mut String, changed: &mut bool| {
            if word.is_empty() {
                return;
            }
            match self.fix(word) {
                Some(better) => {
                    *changed = true;
                    out.push_str(&better);
                }
                None => out.push_str(word),
            }
            word.clear();
        };
        for c in question.chars() {
            if c.is_alphabetic() {
                word.push(c);
            } else {
                flush(&mut word, &mut out, &mut changed);
                out.push(c);
            }
        }
        flush(&mut word, &mut out, &mut changed);
        changed.then_some(out)
    }

    fn fix(&self, word: &str) -> Option<String> {
        let lower = word.to_lowercase();
        let chars: Vec<char> = lower.chars().collect();
        // short words and words the list has are left alone
        if chars.len() < 5 || self.freq.contains_key(&lower) {
            return None;
        }
        let max = if chars.len() >= 9 { 2 } else { 1 };
        let first = chars[0];
        let mut best: Option<(usize, u32, &String)> = None;
        for (cand, n) in &self.freq {
            if *n < 2 || !cand.starts_with(first) {
                continue;
            }
            let cc: Vec<char> = cand.chars().collect();
            let Some(d) = distance(&chars, &cc, max) else { continue };
            let better = match &best {
                None => true,
                Some((bd, bn, _)) => d < *bd || (d == *bd && *n > *bn),
            };
            if better {
                best = Some((d, *n, cand));
            }
        }
        best.map(|(_, _, cand)| {
            // keep a capital letter at the start
            if word.chars().next().is_some_and(|c| c.is_uppercase()) {
                let mut c = cand.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
            } else {
                cand.clone()
            }
        })
    }
}

static VOCAB: OnceLock<Vocab> = OnceLock::new();

/// The word list, made once: the Bible text (BSB and KJV), the names of people and places, and the words of the curated answers.
pub fn vocab(conn: &Connection, study: Option<&Connection>, curated: &[String]) -> &'static Vocab {
    VOCAB.get_or_init(|| {
        let mut texts: Vec<String> = Vec::new();
        if let Ok(mut st) = conn.prepare("SELECT v.text FROM verses v JOIN versions ver ON v.version_id = ver.id WHERE ver.code IN ('BSB', 'KJV')") {
            if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                texts.extend(rows.flatten());
            }
        }
        if let Some(s) = study {
            if let Ok(mut st) = s.prepare("SELECT name FROM entities WHERE kind IN ('person', 'place')") {
                if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                    for n in rows.flatten() {
                        // a name counts twice, so it is common enough to be a right spelling
                        texts.push(format!("{n} {n}"));
                    }
                }
            }
        }
        // the curated words count twice as well
        texts.extend(curated.iter().map(|t| format!("{t} {t}")));
        let mut v = Vocab::from_texts(texts.iter().map(String::as_str));
        if let Some(s) = study {
            if let Ok(mut st) = s.prepare("SELECT name FROM entities WHERE kind IN ('person', 'place')") {
                if let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) {
                    for n in rows.flatten() {
                        for w in n.split(|c: char| !c.is_alphabetic()) {
                            if w.chars().count() >= 3 && w.chars().next().is_some_and(char::is_uppercase) {
                                v.names.insert(w.to_lowercase());
                            }
                        }
                    }
                }
            }
        }
        v
    })
}

/// Is this word a name of a person or place the app knows ("lazarus")? False until the word list has been made.
pub fn is_name(word: &str) -> bool {
    VOCAB.get().is_some_and(|v| v.names.contains(&word.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab_of(text: &str) -> Vocab {
        // every word twice, so that each is common enough
        Vocab::from_texts([text, text])
    }

    #[test]
    fn misspelt_words_are_put_right_and_right_ones_are_not_touched() {
        let v = vocab_of("who betrayed jesus wilderness revelation methuselah isaac abraham trinity rapture antichrist");
        assert_eq!(v.correct("who betryed jesus").as_deref(), Some("who betrayed jesus"));
        assert_eq!(v.correct("how many days was jesus in the wildernes").as_deref(), Some("how many days was jesus in the wilderness"));
        assert_eq!(v.correct("who wrote the book of revalation").as_deref(), Some("who wrote the book of revelation"));
        assert_eq!(v.correct("how old was Methusela").as_deref(), Some("how old was Methuselah"));
        assert_eq!(v.correct("what is the trinity"), None);
        // a word the list has, a short word, and a word with no near neighbour stay as they are
        assert_eq!(v.correct("who betrayed jesus"), None);
        assert_eq!(v.correct("who was Jesus"), None);
        assert_eq!(v.correct("what about nuclear physics"), None);
    }

    #[test]
    fn a_change_must_start_with_the_same_letter() {
        let v = vocab_of("wilderness");
        assert_eq!(v.correct("ilderness"), None);
    }

    #[test]
    fn the_distance_counts_a_swap_as_one() {
        let d = |a: &str, b: &str, m| distance(&a.chars().collect::<Vec<_>>(), &b.chars().collect::<Vec<_>>(), m);
        assert_eq!(d("betryed", "betrayed", 2), Some(1));
        assert_eq!(d("recieve", "receive", 2), Some(1));
        assert_eq!(d("abc", "xyz", 1), None);
    }
}
