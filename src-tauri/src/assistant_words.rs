//! The Offline Assistant's word insights for a sermon: of the words of a passage, the few whose
//! Hebrew or Greek says more than the English shows. Nothing here is the model's own knowledge:
//!
//! 1. the passage's words come from the app's interlinear (each with its Strong's number);
//! 2. the little words (the, and, of, he...) are left out, and each other word is scored by what
//!    the data itself shows: it is translated many different ways; other original words are
//!    glossed with the same English word (love: agapao, phileo, agape); its dictionary entry
//!    contrasts it with another word; the interlinear's English differs from its lexical sense;
//!    it is rare;
//! 3. the best five are shown as cards of that data (the original word, its Strong's meaning, the
//!    ways it is translated, the other words behind the same English, how often it is used);
//! 4. only then does the model write one or two sentences about each, from that card's text alone;
//!    a sentence that brings in a name, a number or words the card doesn't contain is dropped, and
//!    the card is shown without it.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::DbState;
use crate::offline_ai::{complete, engine, names_in, number_facts, says_no, tidy};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Another original word behind the same English word.
#[derive(Serialize, Clone)]
pub struct OtherWord {
    strongs: String,
    lemma: String,
    gloss: String,
    uses: i64,
    /// this word's dictionary entry, when it compares itself with the word on the card
    note: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct WordInsight {
    pub(crate) verse: i64,
    /// the English the interlinear gives the word in this verse
    pub(crate) english: String,
    pub(crate) original: String,
    pub(crate) translit: String,
    pub(crate) strongs: String,
    pub(crate) lemma_gloss: String,
    /// Strong's definition
    pub(crate) definition: String,
    /// the ways the word is translated (the King James renderings)
    pub(crate) renderings: Vec<String>,
    /// how many times the word is in the Bible's original text
    pub(crate) uses: i64,
    pub(crate) others: Vec<OtherWord>,
    /// why this word was picked (what the data shows)
    pub(crate) reasons: Vec<String>,
    /// one or two sentences from the model, from this card's text alone (None: it had nothing to add)
    pub(crate) explanation: Option<String>,
    pub(crate) score: f64,
}

const WORD_RULES: &str = "You explain Hebrew and Greek words to a preacher. You are given one word with its dictionary entry. \
In one or two short sentences, say what the original word means or implies that the English word alone may not show, using ONLY the \
dictionary text given. Add nothing else: no names, no numbers, no doctrine. If the entry adds nothing beyond the English word, reply only: NO\n\n\
Example\n\
Word: hope (English); original ἐλπίς (elpis)\n\
Dictionary: expectation (abstract or concrete) or confidence. Translated: faith, hope.\n\
Answer: The word means confident expectation, not just wishing.";

/// Words whose grammar marks them as little words: articles, conjunctions, prepositions,
/// pronouns, particles, adverbs.
fn little_word(morph: &str) -> bool {
    let m = morph.to_uppercase();
    ["T-", "CONJ", "PREP", "P-", "PRT", "ADV", "COND", "INJ", "D-", "R-", "K-", "I-", "X-", "C-", "F-"].iter().any(|p| m.starts_with(p))
        || m.starts_with("HC") // Hebrew conjunction prefixes
        || m.starts_with("HR/")
        || m.starts_with("HD/")
}

/// The first whole word of an English gloss ("to love", "(be-)love(-ed)" → "love").
fn key_word(gloss: &str) -> String {
    let g = gloss.to_lowercase();
    let g = g.trim_start_matches("to ").trim_start_matches("be ");
    g.split(|c: char| !c.is_alphabetic()).find(|w| w.len() > 2 && !matches!(*w, "the" | "and" | "that" | "who" | "this")).unwrap_or("").to_string()
}

/// The stem to look for ("loved", "loving" → "lov").
fn stem(word: &str) -> String {
    let w = word.to_lowercase();
    for suf in ["ing", "ed", "es", "s", "e"] {
        if w.len() > suf.len() + 2 && w.ends_with(suf) {
            return w[..w.len() - suf.len()].to_string();
        }
    }
    w
}

fn uses(study: &Connection, strongs: &str) -> i64 {
    study.query_row("SELECT COUNT(*) FROM interlinear WHERE strongs = ?1", params![strongs], |r| r.get(0)).unwrap_or(0)
}

/// The dictionary entry's own words, as plain lists.
fn lexicon(bible: &Connection, strongs: &str) -> (String, Vec<String>) {
    let row: Option<(Option<String>, Option<String>)> =
        bible.query_row("SELECT strongs_def, kjv_def FROM strongs_dict WHERE strongs_number = ?1", params![strongs], |r| Ok((r.get(0)?, r.get(1)?))).ok();
    let (def, kjv) = row.unwrap_or((None, None));
    // split at commas outside brackets ("all (manner of, means)" is one rendering)
    let kjv = kjv.unwrap_or_default();
    let mut renderings: Vec<String> = Vec::new();
    let (mut depth, mut cur) = (0, String::new());
    for c in kjv.chars().chain(std::iter::once(',')) {
        match c {
            '(' => depth += 1,
            ')' => depth = (depth - 1).max(0),
            _ => {}
        }
        if c == ',' && depth == 0 {
            let r = cur.trim().trim_start_matches('X').trim_start_matches('+').trim().trim_end_matches(&['.', ';'][..]).to_string();
            if !r.is_empty() && !renderings.iter().any(|x: &String| x.eq_ignore_ascii_case(&r)) {
                renderings.push(r);
            }
            cur.clear();
        } else {
            cur.push(c);
        }
    }
    (def.unwrap_or_default().trim().to_string(), renderings)
}

/// Everyday verbs and the like: translated many ways because they are used for everything, and
/// worth nothing to a preacher.
const GENERIC: &[&str] = &[
    "give", "have", "be", "come", "go", "say", "speak", "make", "do", "take", "put", "become", "see", "set", "bring", "stand", "send", "get", "find", "leave",
    "all", "any", "every", "many", "much", "other", "same", "one", "two", "man", "thing", "name", "day", "also", "this", "that", "such", "not", "no", "great",
    "call", "go out", "go in", "lay", "hold", "keep", "work", "turn", "sit", "rise", "fall", "pass", "walk", "eat", "drink", "hear", "look",
];

/// Words that carry a sermon: what a preacher stops at (the English stems).
const WEIGHTY: &[&str] = &[
    "love", "know", "believ", "faith", "trust", "word", "life", "world", "truth", "sin", "peac", "spirit", "soul", "righteous", "justif", "sav", "salvat", "grac",
    "merc", "glor", "holy", "sanctif", "repent", "forgiv", "redeem", "redempt", "covenant", "kingdom", "hope", "fear", "worship", "flesh", "heart", "bless", "cleans",
    "eternal", "everlast", "age", "light", "dark", "servant", "slave", "church", "assembl", "gospel", "prayer", "pray", "shepherd", "lamb", "fellowship", "abid",
    "remain", "obey", "wisdom", "power", "faithful", "mind", "repentance", "baptiz", "wrath", "atone", "propitiat", "reconcil", "ransom", "sacrific", "temple",
    "pray", "joy", "rejoic", "patience", "endur", "perish", "destroy", "begotten", "only", "firstborn", "chosen", "elect", "predestin", "adopt", "inherit", "witness",
    "testimon", "comfort", "advocate", "helper", "counsel", "anoint", "christ", "messiah", "lord", "master", "god", "father", "son", "king", "priest", "prophet",
    "apostle", "disciple", "angel", "devil", "satan", "demon", "tempt", "test", "prove", "meek", "humble", "pride", "boast", "bless", "curse", "bless", "rest",
    "sabbath", "feast", "name", "glory", "honor", "shame", "judg", "justice", "law", "commandment", "statute", "precept", "wait", "seek", "call", "calling",
];

/// The best words of a passage (see the module's notes), as data cards.
pub fn insights(bible: &Connection, study: &Connection, book: &str, chapter: i64, from: i64, to: i64) -> Result<Vec<WordInsight>, String> {
    // the passage's words, once each (the first time it appears)
    let mut seen: HashSet<String> = HashSet::new();
    let mut found: Vec<(i64, crate::study::InterlinearWord)> = Vec::new();
    for v in from..=to.min(from + 39) {
        for w in crate::study::interlinear_verse(study, book, chapter, v)? {
            if w.strongs.is_empty() || little_word(&w.morph) || !seen.insert(w.strongs.clone()) {
                continue;
            }
            found.push((v, w));
        }
    }
    // lemma glosses by English key word, for "other words behind the same English"
    let mut by_key: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    {
        let mut st = study.prepare("SELECT key, lemma, gloss FROM lemmas").map_err(err)?;
        for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(err)? {
            let (k, l, g) = r.map_err(err)?;
            let key = key_word(&g);
            // a name (Evil-Merodach is not "evil") is no other word for it
            let name = g.chars().next().is_some_and(char::is_uppercase) && !matches!(key.as_str(), "god" | "lord" | "spirit" | "christ" | "holy" | "jesus" | "messiah");
            if !key.is_empty() && !name {
                by_key.entry(stem(&key)).or_default().push((k, l, g));
            }
        }
    }
    let mut out: Vec<WordInsight> = Vec::new();
    for (verse, w) in found {
        let total = uses(study, &w.strongs);
        let lemma_key = key_word(&w.lemma_gloss);
        let lemma_stem = stem(&lemma_key);
        let weighty = !lemma_stem.is_empty() && WEIGHTY.iter().any(|k| lemma_stem.starts_with(k) || k.starts_with(lemma_stem.as_str()) && lemma_stem.len() >= 4);
        if total == 0 || total > if weighty { 2500 } else { 700 } || GENERIC.contains(&lemma_key.as_str()) {
            continue;
        }
        let (definition, renderings) = lexicon(bible, &w.strongs);
        if definition.is_empty() {
            continue;
        }
        let mut reasons: Vec<String> = Vec::new();
        let mut score = 0.0;

        // a word that carries a sermon
        if weighty {
            score += 3.0;
        }

        // translated many different ways
        let distinct: HashSet<String> = renderings.iter().map(|r| r.to_lowercase()).collect();
        if distinct.len() >= 5 {
            score += 0.3 * distinct.len().min(10) as f64;
            reasons.push(format!("translated {} different ways", distinct.len()));
        }

        // other original words glossed with the same English word
        let mut others: Vec<OtherWord> = Vec::new();
        let greek = w.strongs.starts_with('G');
        for key in [lemma_stem.clone()] {
            if key.is_empty() {
                continue;
            }
            for (k, lemma, gloss) in by_key.get(&key).into_iter().flatten() {
                let number = format!("{}{}", &k[..1], k[1..].trim_start_matches('0').trim_end_matches(|c: char| c.is_ascii_alphabetic()));
                if number == w.strongs || (k.starts_with('G') != greek) || others.iter().any(|o| o.strongs == number) {
                    continue;
                }
                let n = uses(study, &number);
                if n >= 3 {
                    let (their_def, _) = lexicon(bible, &number);
                    let note = regex::Regex::new(&format!(r"(?i)\b{}\b", w.strongs)).ok().filter(|re| re.is_match(&their_def)).map(|_| shorten(&their_def, 700));
                    others.push(OtherWord { strongs: number, lemma: lemma.clone(), gloss: gloss.clone(), uses: n, note });
                }
            }
        }
        others.sort_by_key(|o| (o.note.is_none(), std::cmp::Reverse(o.uses)));
        others.truncate(3);
        if let Some(o) = others.iter().find(|o| o.note.is_some()) {
            score += 2.0;
            reasons.push(format!("the dictionary entry for {} compares it with this word", o.lemma));
        }
        if !others.is_empty() {
            score += 3.0;
            let key = key_word(&w.lemma_gloss);
            reasons.push(format!("other {} words are also glossed “{}”", if greek { "Greek" } else { "Hebrew" }, if key.is_empty() { w.gloss.clone() } else { key }));
        }

        // the dictionary entry itself contrasts it with another word
        let me = w.strongs.to_uppercase();
        let contrast = regex::Regex::new(r"\b[GH]\d{1,4}\b").unwrap().find_iter(&definition).any(|m| m.as_str().to_uppercase() != me);
        if contrast {
            score += 2.0;
            reasons.push("its dictionary entry compares it with another word".to_string());
        }

        // the interlinear's English and the lexical sense share no word
        let a: HashSet<String> = words_of(&w.gloss).iter().map(|x| base_form(x)).collect();
        let b: HashSet<String> = words_of(&w.lemma_gloss).iter().map(|x| base_form(x)).collect();
        if !a.is_empty() && !b.is_empty() && a.is_disjoint(&b) {
            score += 2.0;
            reasons.push(format!("the interlinear says “{}”, its lexical sense is “{}”", clean_gloss(&w.gloss), w.lemma_gloss));
        }

        // rare in the Bible
        if total <= 60 {
            score += 1.0;
            reasons.push(format!("used {total} times in the Bible"));
        }
        // a word that is only a weighty word, with nothing in the data to say about it, is left out
        if score < 3.0 || reasons.is_empty() {
            continue;
        }
        out.push(WordInsight {
            verse,
            english: clean_gloss(&w.gloss),
            original: w.lemma.clone(),
            translit: w.translit.clone(),
            strongs: w.strongs.clone(),
            lemma_gloss: w.lemma_gloss.clone(),
            definition,
            renderings: renderings.into_iter().take(14).collect(),
            uses: total,
            others,
            reasons,
            explanation: None,
            score,
        });
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.verse.cmp(&b.verse)));
    // a longer passage gets more cards; every verse gets its best card before any verse gets a second
    let verses = to.max(from) - from + 1;
    let limit = if verses <= 2 { 6 } else if verses <= 12 { 8 } else { 10 };
    let mut rank_in_verse: HashMap<i64, usize> = HashMap::new();
    let mut ranked: Vec<(usize, WordInsight)> = Vec::new();
    for card in out {
        // (out is best first, so a verse's cards come in their own order)
        let n = rank_in_verse.entry(card.verse).or_default();
        ranked.push((*n, card));
        *n += 1;
    }
    // the verses' best cards first (best of those first), then their second best, and so on
    ranked.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.score.total_cmp(&a.1.score)));
    let mut chosen: Vec<WordInsight> = ranked.into_iter().take(limit).map(|(_, c)| c).collect();
    chosen.sort_by_key(|i| i.verse);
    Ok(chosen)
}

/// A text cut at a word, with an ellipsis, when it is longer than `max` characters.
fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    format!("{}…", cut.rsplit_once(' ').map_or(cut.as_str(), |x| x.0))
}

/// The interlinear's English without its marks: "he guides/ me" is "he guides", "self/ my" is "self",
/// "is] shepherd/ my" is "is shepherd".
fn clean_gloss(g: &str) -> String {
    let marks = g.replace(['[', ']', '<', '>', '{', '}', '(', ')'], "");
    let mut words: Vec<&str> = marks.split(|c: char| c == '/' || c.is_whitespace()).map(|w| w.trim_matches(&[',', '.', ';', ':'][..])).filter(|w| !w.is_empty()).collect();
    while words.len() > 1 && matches!(words[words.len() - 1].to_lowercase().as_str(), "my" | "me" | "his" | "him" | "her" | "your" | "you" | "their" | "them" | "our" | "us" | "its") {
        words.pop();
    }
    words.join(" ")
}

/// An English word's base form, for the few irregular verbs the interlinear's glosses use.
fn base_form(w: &str) -> String {
    const IRREGULAR: &[(&str, &str)] = &[
        ("gave", "giv"), ("said", "say"), ("came", "com"), ("went", "go"), ("saw", "see"), ("took", "tak"), ("made", "mak"), ("knew", "know"), ("bore", "bear"),
        ("begot", "beget"), ("sent", "send"), ("told", "tell"), ("found", "find"), ("kept", "keep"), ("left", "leav"), ("stood", "stand"), ("rose", "ris"),
        ("began", "begin"), ("wrote", "writ"), ("spoke", "speak"), ("heard", "hear"), ("ate", "eat"), ("fell", "fall"), ("lay", "lie"), ("held", "hold"),
    ];
    IRREGULAR.iter().find(|(a, _)| *a == w).map_or_else(|| w.to_string(), |(_, b)| b.to_string())
}

fn words_of(s: &str) -> HashSet<String> {
    s.to_lowercase().split(|c: char| !c.is_alphabetic()).filter(|w| w.len() > 2 && !matches!(*w, "the" | "and" | "who" | "this")).map(stem).collect()
}

/// The card's own text, which is all a sentence about it may be made of.
fn card_text(i: &WordInsight) -> String {
    let others: Vec<String> = i.others.iter().map(|o| format!("{} {} ({}) {}", o.lemma, o.strongs, o.gloss, o.uses)).collect();
    format!("{} {} {} {} {} {} {}", i.english, i.original, i.translit, i.lemma_gloss, i.definition, i.renderings.join(" "), others.join(" "))
}

/// Whether a sentence stays inside the card: no name or number the card hasn't got, and most of its
/// words are the card's own.
pub(crate) fn stays_in_card(sentence: &str, card: &str) -> bool {
    let c = card.to_lowercase();
    // a Strong's number (G5368) is fine when the card has it, and invented when it hasn't
    let strongs = regex::Regex::new(r"(?i)\b[gh]\d{1,4}\b").unwrap();
    if strongs.find_iter(sentence).any(|m| !c.contains(&m.as_str().to_lowercase())) {
        return false;
    }
    let sentence = strongs.replace_all(sentence, "").to_string();
    if names_in(&sentence).iter().any(|n| !c.contains(n.as_str())) {
        return false;
    }
    let have = number_facts(&c);
    if number_facts(&sentence).iter().any(|n| n != "one" && !have.contains(n)) {
        return false;
    }
    let mine = words_of(&sentence);
    let card_words = words_of(card);
    // the plain words of explaining count for nothing either way; the rest must mostly be the card's
    const PLAIN: &[&str] = &[
        "word", "words", "means", "mean", "meaning", "also", "used", "uses", "use", "another", "times", "often", "here", "there", "text", "greek", "hebrew",
        "english", "translated", "translation", "implies", "suggests", "sense", "that", "than", "with", "from", "this", "these", "they", "their", "which",
        "when", "what", "into", "more", "only", "just", "such", "like", "both", "each", "other", "some", "many", "often", "carries", "idea", "ideas", "describes",
        "refers", "stronger", "richer", "deeper", "fuller", "broader", "original", "alone", "simply", "rather", "while", "where", "does", "have", "been",
    ];
    let content: Vec<String> = mine.iter().filter(|w| w.len() > 3 && !PLAIN.contains(&w.as_str())).cloned().collect();
    content.len() < 3 || (content.iter().filter(|w| card_words.contains(*w)).count() as f32) >= 0.5 * content.len() as f32
}

#[derive(Serialize, Clone)]
struct Status {
    chat_id: i64,
    text: String,
}

/// Word insights for a passage (`explain`: also a sentence from the model for each word).
#[tauri::command]
pub async fn ai_word_insights(app: AppHandle, book: String, chapter: i64, verse_start: i64, verse_end: i64, explain: bool) -> Result<Vec<WordInsight>, String> {
    let mut cards = {
        let db = app.state::<DbState>();
        let bible = db.0.lock().map_err(err)?;
        let study = app.state::<crate::study::StudyState>();
        let Some(m) = study.0.as_ref() else { return Err("The Hebrew and Greek word data isn't in this build.".into()) };
        let study = m.lock().map_err(err)?;
        insights(&bible, &study, &book, chapter, verse_start, verse_end.max(verse_start))?
    };
    if explain && !cards.is_empty() {
        let model = engine(&app).await?;
        let total = cards.len();
        for (n, card) in cards.iter_mut().enumerate() {
            let _ = app.emit("ai-status", Status { chat_id: 0, text: format!("Reading the dictionary entry for {} ({} of {total})…", card.translit, n + 1) });
            let text = card_text(card);
            let prompt = format!(
                "Word: {} (English); original {} ({})\nDictionary: {} Translated: {}.\nAnswer:",
                card.english,
                card.original,
                card.translit,
                card.definition,
                card.renderings.join(", ")
            );
            let raw = complete(&model, WORD_RULES, &prompt, 120, 0.0).await.unwrap_or_default();
            if says_no(&raw) {
                continue;
            }
            let answer = tidy(&raw);
            if !answer.is_empty() && stays_in_card(&answer, &text) {
                card.explanation = Some(answer);
            }
        }
    }
    Ok(cards)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn little_words_are_left_out() {
        assert!(little_word("T-NSM"));
        assert!(little_word("CONJ"));
        assert!(little_word("PREP"));
        assert!(little_word("P-GSM"));
        assert!(!little_word("V-AAI-3S"));
        assert!(!little_word("N-ASM"));
    }

    #[test]
    fn the_interlinears_marks_are_cleaned() {
        assert_eq!(clean_gloss("he guides/ me"), "he guides");
        assert_eq!(clean_gloss("self/ my"), "self");
        assert_eq!(clean_gloss("is] shepherd/ my"), "is shepherd");
        assert_eq!(clean_gloss("world,"), "world");
        assert_eq!(clean_gloss("rest<s"), "rests");
        assert_eq!(base_form("gave"), "giv");
    }

    #[test]
    fn english_keys_match_across_forms() {
        assert_eq!(stem(&key_word("to love")), stem(&key_word("loved")));
        assert_eq!(key_word("(be-)love(-ed)"), "love");
        assert_eq!(stem("believing"), "believ");
    }

    #[test]
    fn a_sentence_must_stay_in_the_card() {
        let card = "loved ἀγαπάω ēgapēsen to love to love (in a social or moral sense) (be-)love(-ed) φιλέω G5368 (to be fond of) 25";
        assert!(stays_in_card("The word means love in a social or moral sense.", card));
        // a name or a number the card hasn't got
        assert!(!stays_in_card("The word was used by Plato for love.", card));
        assert!(!stays_in_card("The word is used 500 times for love in a moral sense.", card));
        // the card's own number is fine
        assert!(stays_in_card("Another word, G5368, also means to love and is used 25 times.", card));
    }
}
