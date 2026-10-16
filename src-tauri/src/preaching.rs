//! Historic preaching for the sermon builder. "How others outlined it": Charles
//! Simeon's Horae Homileticae (1832-33, public domain) -- some 2,000 discourses, each an
//! outline of heads and points on one passage. Built by data-pipeline/build_simeon.py into
//! resources/simeon_outlines.json. They are shown as structures to learn from; the builder
//! never pastes them in as the preacher's own.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OutlineLine {
    /// 1 = a main head (I., II.), 2 = a point under it (1., 2.)
    pub level: u8,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Discourse {
    /// Simeon's number for it (1-2536)
    pub n: u32,
    pub title: String,
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub verse_end: i64,
    /// the sentence announcing the heads ("We shall consider"), when there is one
    #[serde(default)]
    pub announce: String,
    pub outline: Vec<OutlineLine>,
}

pub struct OutlinesState(pub Vec<Discourse>);

impl OutlinesState {
    /// The outlines, or none if the file is missing or unreadable (the builder works without them).
    pub fn load(path: &Path) -> Self {
        let list = std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Vec<Discourse>>(&t).ok()).unwrap_or_default();
        Self(list)
    }

    /// Discourses on a passage: the same chapter, with verses overlapping.
    pub fn on(&self, book: &str, chapter: i64, verse: i64, verse_end: i64) -> Vec<Discourse> {
        let end = verse_end.max(verse);
        let mut out: Vec<Discourse> = self.0.iter().filter(|d| d.book == book && d.chapter == chapter && d.verse <= end && d.verse_end.max(d.verse) >= verse).cloned().collect();
        out.sort_by_key(|d| (d.verse, d.n));
        out
    }

    /// Discourses whose titles have every word of the query ("forgiveness", "love of god").
    pub fn titled(&self, query: &str, limit: usize) -> Vec<Discourse> {
        let words: Vec<String> = query.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 2).map(String::from).collect();
        if words.is_empty() {
            return Vec::new();
        }
        self.0
            .iter()
            .filter(|d| {
                let t = d.title.to_lowercase();
                words.iter().all(|w| t.contains(w.trim_end_matches('s')))
            })
            .take(limit)
            .cloned()
            .collect()
    }
}

// ---------------------------------------------------------------- illustrations and quotations
//
// Stories and sayings from public-domain books (Moody's Anecdotes and Illustrations, Moody's
// Stories, Spurgeon's Gleanings among the Sheaves), built by
// data-pipeline/build_illustrations.py into resources/illustrations.json. Always shown with
// their source.

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Illustration {
    pub id: String,
    /// "illustration" (a story) or "quote" (a saying or short passage)
    pub kind: String,
    pub source: String,
    pub title: String,
    /// the book's own subject for it ("Faith", "Prayer"), when it has one
    #[serde(default)]
    pub subject: String,
    pub text: String,
}

pub struct IllustrationsState(pub Vec<Illustration>);

impl IllustrationsState {
    pub fn load(path: &Path) -> Self {
        Self(std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default())
    }

    /// The pieces on a subject, best first: the book's own subject counts most, then the
    /// title, then how often the words come in the text.
    pub fn search(&self, query: &str, limit: usize) -> Vec<Illustration> {
        let words: Vec<String> = query
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 2 && !["the", "and", "for", "with", "how", "what", "who"].contains(w))
            .map(|w| crate::sermon::stem(w))
            .collect();
        if words.is_empty() {
            return Vec::new();
        }
        let mut scored: Vec<(u32, &Illustration)> = self
            .0
            .iter()
            .map(|i| {
                let subject = i.subject.to_lowercase();
                let title = i.title.to_lowercase();
                let text = i.text.to_lowercase();
                let score: u32 = words
                    .iter()
                    .map(|w| {
                        6 * u32::from(subject.contains(w.as_str())) + 4 * u32::from(title.contains(w.as_str())) + (text.matches(w.as_str()).count() as u32).min(3)
                    })
                    .sum();
                (score, i)
            })
            .filter(|(score, _)| *score >= 3)
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.id.cmp(&b.1.id)));
        scored.into_iter().take(limit).map(|(_, i)| i.clone()).collect()
    }
}

#[tauri::command]
pub fn sermon_illustrations(state: State<IllustrationsState>, query: String, limit: Option<usize>) -> Vec<Illustration> {
    state.search(&query, limit.unwrap_or(12).min(40))
}

#[tauri::command]
pub fn sermon_outlines(state: State<OutlinesState>, book: String, chapter: i64, verse: i64, verse_end: i64) -> Vec<Discourse> {
    state.on(&book, chapter, verse, verse_end)
}

#[tauri::command]
pub fn sermon_outlines_titled(state: State<OutlinesState>, query: String, limit: Option<usize>) -> Vec<Discourse> {
    state.titled(&query, limit.unwrap_or(12).min(40))
}

// ---------------------------------------------------------------- Spurgeon's sermons
//
// Which of C. H. Spurgeon's 3,500 sermons (New Park Street and Metropolitan Tabernacle
// Pulpit, 1855-1917, public domain) were on which text, built by
// data-pipeline/build_spurgeon.py into resources/spurgeon_sermons.json: the number, title,
// date and place, the sermon's opening paragraph, and where to read it at CCEL.

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SpurgeonSermon {
    pub n: u32,
    pub title: String,
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub verse_end: i64,
    /// "1877-01-07", or "" when the heading has no date
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub place: String,
    #[serde(default)]
    pub opening: String,
    pub url: String,
}

pub struct SpurgeonState(pub Vec<SpurgeonSermon>);

impl SpurgeonState {
    pub fn load(path: &Path) -> Self {
        Self(std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default())
    }

    /// Sermons whose text is in a passage (`verse` 0: anywhere in the chapter), the closest
    /// fit first: a text inside the passage before one that only overlaps it, then by verse.
    pub fn on(&self, book: &str, chapter: i64, verse: i64, verse_end: i64) -> Vec<SpurgeonSermon> {
        let (first, last) = if verse > 0 { (verse, verse_end.max(verse)) } else { (1, i64::MAX) };
        let mut out: Vec<&SpurgeonSermon> = self
            .0
            .iter()
            .filter(|s| s.book == book && s.chapter == chapter && (s.verse == 0 || (s.verse <= last && s.verse_end.max(s.verse) >= first)))
            .collect();
        out.sort_by_key(|s| (s.verse == 0, !(s.verse >= first && s.verse_end <= last), s.verse, s.n));
        let mut seen = std::collections::HashSet::new();
        out.into_iter().filter(|s| seen.insert(s.n)).cloned().collect()
    }

    /// Sermons whose titles have every word of the query (in any form: "faith", "faithful").
    pub fn titled(&self, query: &str, limit: usize) -> Vec<SpurgeonSermon> {
        let words: Vec<String> = query
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 2 && !crate::sermon::is_stopword(w))
            .map(crate::sermon::stem)
            .collect();
        if words.is_empty() {
            return Vec::new();
        }
        let mut seen = std::collections::HashSet::new();
        self.0
            .iter()
            .filter(|s| {
                let t = s.title.to_lowercase();
                words.iter().all(|w| t.contains(w.as_str()))
            })
            .filter(|s| seen.insert(s.n))
            .take(limit)
            .cloned()
            .collect()
    }
}

#[tauri::command]
pub fn spurgeon_sermons_on(state: State<SpurgeonState>, book: String, chapter: i64, verse: i64, verse_end: i64) -> Vec<SpurgeonSermon> {
    state.on(&book, chapter, verse, verse_end)
}

#[tauri::command]
pub fn spurgeon_sermons_titled(state: State<SpurgeonState>, query: String, limit: Option<usize>) -> Vec<SpurgeonSermon> {
    state.titled(&query, limit.unwrap_or(12).min(60))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spurgeons_sermons_load_and_are_found_by_text() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/spurgeon_sermons.json");
        let s = SpurgeonState::load(&path);
        assert!(s.0.len() > 3000, "{}", s.0.len());
        assert!(s.0.iter().all(|x| x.n >= 1 && x.n <= 3563 && x.url.starts_with("https://ccel.org/")));
        // No. 1332, "Our Urgent Need of the Holy Spirit", on Romans 15:13
        let rom15 = s.on("Romans", 15, 13, 13);
        assert!(rom15.iter().any(|x| x.n == 1332 && x.date == "1877-01-07"), "{:?}", rom15.iter().map(|x| (x.n, &x.title)).collect::<Vec<_>>());
        // a whole chapter, each sermon once
        let john3 = s.on("John", 3, 0, 0);
        assert!(john3.len() >= 5);
        let ns: std::collections::HashSet<u32> = john3.iter().map(|x| x.n).collect();
        assert_eq!(ns.len(), john3.len());
        assert!(!s.titled("faith", 10).is_empty());
        assert!(s.titled("the and", 10).is_empty());
        assert!(SpurgeonState::load(Path::new("no-such-file.json")).0.is_empty());
    }

    #[test]
    fn simeons_outlines_load_and_are_found() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/simeon_outlines.json");
        let s = OutlinesState::load(&dir);
        assert!(s.0.len() > 1800, "{}", s.0.len());
        assert!(s.0.iter().all(|d| d.outline.len() >= 2));
        // John 3 has discourses on the new birth and the brazen serpent
        let john3 = s.on("John", 3, 1, 36);
        assert!(john3.iter().any(|d| d.title.to_lowercase().contains("regeneration")), "{:?}", john3.iter().map(|d| &d.title).collect::<Vec<_>>());
        assert!(s.on("John", 3, 14, 14).iter().all(|d| d.verse <= 14 && d.verse_end >= 14));
        assert!(!s.titled("faith", 40).is_empty());
        assert!(s.titled("xx", 5).is_empty());
        assert!(OutlinesState::load(Path::new("no-such-file.json")).0.is_empty());
    }

    #[test]
    fn illustrations_load_and_are_found_by_subject() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/illustrations.json");
        let s = IllustrationsState::load(&dir);
        assert!(s.0.len() > 500, "{}", s.0.len());
        let faith = s.search("faith", 10);
        assert!(faith.len() >= 5);
        assert!(faith.iter().take(3).all(|i| i.subject == "Faith" || i.title.to_lowercase().contains("faith") || i.text.to_lowercase().contains("faith")));
        assert!(!s.search("forgiveness", 5).is_empty());
        assert!(s.search("zz qq", 5).is_empty());
    }
}
