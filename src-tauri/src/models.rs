use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct Version {
    pub code: String,
    pub name: String,
    pub language: String,
    pub is_original_language: bool,
}

#[derive(Serialize, Clone)]
pub struct BookInfo {
    pub name: String,
    pub testament: String,
    pub order_index: i64,
}

#[derive(Serialize, Clone)]
pub struct Verse {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct StrongsWord {
    pub word_order: i64,
    pub surface_text: String,
    pub strongs_numbers: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct VerseWithWords {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
    pub words: Vec<StrongsWord>,
}

#[derive(Serialize, Clone)]
pub struct StrongsEntry {
    pub strongs_number: String,
    pub language: String,
    pub lemma: Option<String>,
    pub xlit: Option<String>,
    pub pronunciation: Option<String>,
    pub derivation: Option<String>,
    pub strongs_def: Option<String>,
    pub kjv_def: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SearchHit {
    pub version_code: String,
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct CrossReference {
    pub to_book: String,
    pub to_chapter: i64,
    pub to_verse_start: i64,
    pub to_verse_end: i64,
    pub votes: i64,
}

#[derive(Serialize, Clone)]
pub struct WordFrequencyResult {
    pub total_occurrences: i64,
    pub verses: Vec<SearchHit>,
}

#[derive(Serialize, Clone)]
pub struct OnlineVersionInfo {
    pub code: String,
    pub name: String,
    /// Human-readable provider name ("api.bible", "api.esv.org") for the UI's "online" tag.
    pub provider: String,
    pub configured: bool,
}

#[derive(Serialize, Clone)]
pub struct OnlineVerseResult {
    pub version_code: String,
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
    pub copyright: String,
}
