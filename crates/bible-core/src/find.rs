//! Finding a passage from what a reader remembers of it: "where was Daniel's prayer delayed by
//! 21 days" should open Daniel 10, though the Bible says "twenty-one days" and never "delayed".
//!
//! Both apps search the same way:
//! 1. **What the search means** (`understand`): a misspelt word becomes the Bible's nearest
//!    word ("Melchisedek" → melchizedek), a possessive its name ("Daniels" → daniel), a number
//!    the Bible's words for it ("21" → twenty one), and the people and places named in it are
//!    noticed (Daniel).
//! 2. **Ranking** (`rank`): several lists of verses are fused by Reciprocal Rank Fusion --
//!    the exact words (kept on top), all the words, most of the words, the numbers with the word
//!    after them ("twenty one days"), the verses nearest in meaning (the search upgrade on the
//!    phone, always on the desktop), and the key passages of a subject. Verses in chapters
//!    where a named person or place appears count more.
//! 3. **Passages**: verses found close together in a chapter are shown as one passage
//!    (Daniel 10:2–13), since a story is told in several verses, not one.
//!
//! Only the bundled BSB is searched for the lists; the caller shows the found passages in the
//! reader's translation.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// A verse: its book, chapter and verse.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct VerseKey {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
}

/// Words that carry nothing to search for by themselves.
const STOPWORDS: &[&str] = &[
    "the", "a", "an", "of", "in", "on", "and", "or", "to", "is", "was", "were", "that", "this", "for", "with", "his", "her", "my", "me",
    "you", "it", "be", "are", "i", "he", "she", "they", "them", "where", "what", "when", "who", "whom", "how", "why", "which", "by",
    "at", "from", "as", "did", "does", "do", "about", "bible", "verse", "verses", "passage", "story", "find", "says", "say", "said",
    "there", "their", "its", "into", "after", "before", "if", "but", "so", "then", "than", "has", "had", "have", "not", "no",
];

/// Words of today that the Bible says another way: searched for as the Bible's word too
/// ("when did Jesus bleed" -> blood), and still there for the story names.
const ALSO: &[(&str, &str)] = &[("bleed", "blood"), ("bled", "blood"), ("bleeds", "blood")];

/// The books a person wrote, as the Bible and tradition have it (for "what did Paul say about …").
pub fn authored_books(name: &str) -> &'static [&'static str] {
    match name.to_lowercase().as_str() {
        "paul" => &["Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon"],
        "peter" => &["1 Peter", "2 Peter"],
        "john" => &["John", "1 John", "2 John", "3 John", "Revelation"],
        "james" => &["James"],
        "jude" => &["Jude"],
        "moses" => &["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"],
        "solomon" => &["Proverbs", "Ecclesiastes", "Song of Solomon"],
        "david" => &["Psalms"],
        "isaiah" => &["Isaiah"],
        "jeremiah" => &["Jeremiah", "Lamentations"],
        "ezekiel" => &["Ezekiel"],
        "daniel" => &["Daniel"],
        _ => &[],
    }
}

/// Names that are in nearly every chapter: noticing them would favour nothing.
const TOO_COMMON_NAMES: &[&str] = &["god", "lord", "spirit", "father", "son", "christ", "jesus", "israel", "he", "his", "him"];

/// The BSB's rows of the verses table, when they are one block (they are, in both apps'
/// databases): the full-text index is then asked about those rows only, not every translation's.
fn bsb_rows(db: &Connection) -> (i64, i64) {
    db.query_row(
        "SELECT MIN(v.id), MAX(v.id), COUNT(*) FROM verses v JOIN versions ver ON ver.id = v.version_id WHERE ver.code = 'BSB'",
        [],
        |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, i64>(2)?)),
    )
    .ok()
    .and_then(|(lo, hi, n)| match (lo, hi) {
        (Some(lo), Some(hi)) if hi - lo + 1 == n => Some((lo, hi)),
        _ => None,
    })
    .unwrap_or((i64::MIN, i64::MAX))
}

/// Every word of the Bibles' text, and in how many verses it is (empty: no spelling help).
#[derive(Default)]
pub struct Vocab {
    count: HashMap<String, u32>,
    /// how many verses the index has (all translations)
    total: u32,
}

impl Vocab {
    /// Reads the words of the search index (all the bundled translations).
    pub fn load(db: &Connection) -> Result<Self, String> {
        db.execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS temp.bc_vocab USING fts5vocab(main, 'verses_fts', 'row');").map_err(err)?;
        let mut st = db.prepare("SELECT term, doc FROM temp.bc_vocab").map_err(err)?;
        let count = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))
            .map_err(err)?
            .filter_map(Result::ok)
            .filter(|(t, _)| t.chars().all(|c| c.is_ascii_alphabetic() || c == '\''))
            .collect();
        let total = db.query_row("SELECT COUNT(*) FROM verses", [], |r| r.get(0)).unwrap_or(0);
        Ok(Self { count, total })
    }

    /// A word in more than one verse in fifty (days, end, people): it says little by itself,
    /// and ranking all its verses is slow on a phone.
    pub fn common(&self, word: &str) -> bool {
        self.total > 0 && self.count.get(word).is_some_and(|&c| c * 50 > self.total)
    }

    pub fn has(&self, word: &str) -> bool {
        self.count.contains_key(word)
    }

    /// The Bible's word nearest a misspelt one (one or two letters wrong, missing, extra or
    /// swapped), the most used of them if several are as near.
    pub fn nearest(&self, word: &str) -> Option<String> {
        let n = word.chars().count();
        if n < 4 || !word.chars().all(|c| c.is_ascii_alphabetic()) {
            return None;
        }
        // a word that begins a Bible word ("bleed" -> bleeding) is a real word, not a misspelling
        if self.count.keys().any(|w| w.len() > word.len() && w.starts_with(word)) {
            return None;
        }
        let most = if n <= 5 { 1 } else { 2 };
        let first = word.chars().next()?;
        let mut best: Option<(usize, u32, &String)> = None;
        for (w, &c) in &self.count {
            let m = w.chars().count();
            if m.abs_diff(n) > most || m < 3 {
                continue;
            }
            // the first letter is rarely the wrong one; a vowel for a vowel is allowed
            let f = w.chars().next().unwrap_or(' ');
            if f != first && !("aeiou".contains(f) && "aeiou".contains(first)) {
                continue;
            }
            let d = distance(word, w, most);
            if d > most {
                continue;
            }
            if best.map_or(true, |(bd, bc, bw)| d < bd || (d == bd && (c > bc || (c == bc && w < bw)))) {
                best = Some((d, c, w));
            }
        }
        best.map(|b| b.2.clone())
    }
}

/// How many letters differ (missing, extra, changed, or two swapped), or more than `most`.
fn distance(a: &str, b: &str, most: usize) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for j in 0..=m {
        d[0][j] = j;
    }
    for i in 1..=n {
        let mut row_min = usize::MAX;
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (d[i - 1][j] + 1).min(d[i][j - 1] + 1).min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(d[i - 2][j - 2] + 1);
            }
            d[i][j] = v;
            row_min = row_min.min(v);
        }
        if row_min > most {
            return most + 1;
        }
    }
    d[n][m]
}

/// A number as the Bible writes it: 21 → "twenty one" (the search index splits "twenty-one").
pub fn number_words(n: u32) -> Option<String> {
    const ONES: [&str; 20] = [
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
        "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    ];
    const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    let below_100 = |n: u32| -> String {
        if n < 20 {
            ONES[n as usize].to_string()
        } else if n % 10 == 0 {
            TENS[(n / 10) as usize].to_string()
        } else {
            format!("{} {}", TENS[(n / 10) as usize], ONES[(n % 10) as usize])
        }
    };
    match n {
        0..=99 => Some(below_100(n)),
        100..=999 => {
            let rest = n % 100;
            let head = format!("{} hundred", ONES[(n / 100) as usize]);
            Some(if rest == 0 { head } else { format!("{head} {}", below_100(rest)) })
        }
        1000 | 2000 | 3000 | 4000 | 5000 | 6000 | 7000 | 8000 | 9000 | 10000 | 12000 | 40000 => Some(match n {
            10000 => "ten thousand".into(),
            12000 => "twelve thousand".into(),
            40000 => "forty thousand".into(),
            _ => format!("{} thousand", ONES[(n / 1000) as usize]),
        }),
        _ => None,
    }
}

/// What a search means.
#[derive(Debug, Clone, Default)]
pub struct Understood {
    /// the search with its spelling put right, for finding by meaning
    pub text: String,
    /// the words to look for, as the Bible spells them (numbers in words)
    pub words: Vec<String>,
    /// the words that mean something by themselves (no "the", "where", "was"); a number is
    /// one entry in words ("twenty one")
    pub content: Vec<String>,
    /// a number's digits, for the Bibles that write it so ("twenty one" → "21")
    pub digits: HashMap<String, String>,
    /// each number with the word after it, in words ("twenty one days")
    pub numbers: Vec<String>,
    /// the misspelt words and what they were taken for
    pub corrected: Vec<(String, String)>,
    /// the people and places named (as the Bible writes them: "Daniel")
    pub names: Vec<String>,
    /// the words in more than one verse in fifty (see `Vocab::common`)
    pub common: Vec<String>,
}

/// Works out what a search means (see the module's notes).
pub fn understand(db: &Connection, vocab: &Vocab, query: &str) -> Understood {
    let mut u = Understood::default();
    let mut text_words: Vec<String> = Vec::new();
    let raw: Vec<String> = query
        .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '’'))
        .filter(|w| !w.is_empty())
        .map(|w| w.replace('’', "'"))
        .collect();
    let mut i = 0;
    while i < raw.len() {
        let original = &raw[i];
        let mut w = original.to_lowercase();
        // a number: the Bible's words for it, and with the word after it
        if let Ok(n) = w.parse::<u32>() {
            if let Some(words) = number_words(n) {
                let next = raw.get(i + 1).map(|x| x.to_lowercase()).filter(|x| x.parse::<u32>().is_err());
                if let Some(next) = next.filter(|x| vocab.has(x)) {
                    u.numbers.push(format!("{words} {next}"));
                    u.numbers.push(format!("{w} {next}"));
                }
                u.words.extend(words.split(' ').map(str::to_string));
                u.digits.insert(words.clone(), w.clone());
                u.content.push(words);
            }
            text_words.push(original.clone());
            i += 1;
            continue;
        }
        // a possessive: Daniel's, Daniels
        if let Some(stem) = w.strip_suffix("'s").or_else(|| w.strip_suffix('\'')) {
            w = stem.to_string();
        } else if w.len() > 4 && !vocab.has(&w) {
            if let Some(stem) = w.strip_suffix('s').filter(|s| vocab.has(s)) {
                w = stem.to_string();
            }
        }
        // a word of today the Bible says another way
        if let Some((_, bible)) = ALSO.iter().find(|(today, _)| *today == w) {
            u.words.push(w.clone());
            u.words.push(bible.to_string());
            u.content.push(bible.to_string());
            text_words.push(original.clone());
            i += 1;
            continue;
        }
        // a misspelling
        let mut shown = original.clone();
        if !vocab.has(&w) && !STOPWORDS.contains(&w.as_str()) {
            if let Some(fixed) = vocab.nearest(&w) {
                u.corrected.push((original.clone(), fixed.clone()));
                shown = fixed.clone();
                w = fixed;
            }
        }
        text_words.push(shown);
        if !STOPWORDS.contains(&w.as_str()) {
            u.content.push(w.clone());
        }
        u.words.push(w);
        i += 1;
    }
    if u.content.is_empty() {
        u.content = u.words.clone();
    }
    u.common = u.content.iter().filter(|w| vocab.common(w)).cloned().collect();
    u.text = text_words.join(" ");

    // the people and places: words the BSB nearly always writes with a capital
    let rows = bsb_rows(db);
    for w in u.content.iter().filter(|w| w.len() >= 3 && !w.contains(' ') && !TOO_COMMON_NAMES.contains(&w.as_str())) {
        let cap: String = w.chars().take(1).flat_map(char::to_uppercase).chain(w.chars().skip(1)).collect();
        // (sixty of its verses tell)
        let counted = db.query_row(
            "SELECT COUNT(*), COALESCE(SUM(capital), 0) FROM (SELECT instr(v.text, ?2) > 0 AS capital FROM verses_fts
             JOIN verses v ON v.id = verses_fts.rowid WHERE verses_fts MATCH ?1 AND verses_fts.rowid BETWEEN ?3 AND ?4 LIMIT 60)",
            params![format!("\"{w}\""), cap, rows.0, rows.1],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        );
        if let Ok((all, capital)) = counted {
            if all >= 2 && capital * 10 >= all * 9 && !u.names.contains(&cap) {
                u.names.push(cap);
            }
        }
    }
    u
}

/// Where to look.
#[derive(Clone, Copy, Default)]
pub struct Scope<'a> {
    /// "OT" or "NT"
    pub testament: Option<&'a str>,
    pub book: Option<&'a str>,
}

/// A passage found, with the verses in it that were found.
#[derive(Debug, Clone)]
pub struct Found {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub verse_end: i64,
    /// the verses that were found, in order (the others in between belong to the passage)
    pub verses: Vec<i64>,
    /// why: "phrase" (the exact words), "core" (a key passage of the subject), "words",
    /// "meaning", "name"
    pub why: Vec<String>,
    pub score: f64,
}

/// A key passage of a subject, found by the caller (the topical index of key passages).
pub struct Curated {
    pub key: VerseKey,
    pub verse_end: i64,
    pub why: Vec<String>,
}

/// Well-known stories by the names people know them by, which the text itself often doesn't
/// use ("the prodigal son" is a heading, not a verse). A name's words must all be in the search
/// (in any order; "the", "of" and the like left out); each passage is checked against the
/// bundled text by the desktop's tests.
pub const STORIES: &[(&[&str], (&str, i64, i64, i64))] = &[
    (&["prodigal son", "lost son", "prodigal"], ("Luke", 15, 11, 32)),
    (&["good samaritan", "samaritan neighbour", "samaritan neighbor"], ("Luke", 10, 25, 37)),
    (&["lost sheep"], ("Luke", 15, 1, 7)),
    (&["lost coin"], ("Luke", 15, 8, 10)),
    (&["sermon mount"], ("Matthew", 5, 1, 16)),
    (&["beatitudes"], ("Matthew", 5, 1, 12)),
    (&["lord's prayer", "lords prayer", "our father heaven", "teach us pray"], ("Matthew", 6, 9, 13)),
    (&["ten commandments", "10 commandments"], ("Exodus", 20, 1, 17)),
    (&["david goliath"], ("1 Samuel", 17, 32, 51)),
    (&["lions den", "lion's den", "daniel lions"], ("Daniel", 6, 10, 23)),
    (&["fiery furnace", "shadrach meshach abednego", "burning furnace"], ("Daniel", 3, 13, 27)),
    (&["writing wall", "handwriting wall"], ("Daniel", 5, 1, 30)),
    (&["nebuchadnezzar dream", "statue dream", "dream statue"], ("Daniel", 2, 31, 45)),
    (&["prayer delayed", "answer delayed", "prince persia", "daniel twenty one days", "daniel three weeks", "daniel fasting"], ("Daniel", 10, 1, 14)),
    (&["seventy weeks", "70 weeks"], ("Daniel", 9, 20, 27)),
    (&["noah ark", "noahs ark", "flood noah"], ("Genesis", 6, 9, 22)),
    (&["tower babel"], ("Genesis", 11, 1, 9)),
    (&["creation world", "creation"], ("Genesis", 1, 1, 31)),
    (&["fall man", "adam eve serpent", "forbidden fruit"], ("Genesis", 3, 1, 24)),
    (&["cain abel"], ("Genesis", 4, 1, 16)),
    (&["abraham isaac sacrifice", "binding isaac", "abraham offers isaac"], ("Genesis", 22, 1, 19)),
    (&["jacob ladder", "jacobs ladder", "stairway heaven"], ("Genesis", 28, 10, 22)),
    (&["jacob wrestles", "jacob wrestling", "wrestled angel"], ("Genesis", 32, 22, 32)),
    (&["joseph coat", "coat many colours", "coat many colors", "joseph brothers sold"], ("Genesis", 37, 1, 36)),
    (&["burning bush"], ("Exodus", 3, 1, 15)),
    (&["moses died", "death moses", "moses death"], ("Deuteronomy", 34, 1, 12)),
    (&["led moses died", "lead moses died", "moses successor", "joshua moses"], ("Joshua", 1, 1, 9)),
    (&["abraham son isaac", "abraham first son", "abraham ishmael", "hagar ishmael", "ishmael born"], ("Genesis", 16, 1, 16)),
    (&["red sea", "parting sea", "crossing sea"], ("Exodus", 14, 10, 31)),
    (&["walls jericho", "jericho walls"], ("Joshua", 6, 1, 21)),
    (&["samson delilah"], ("Judges", 16, 4, 31)),
    (&["strongest man", "strength samson", "samson strength", "samson strong"], ("Judges", 16, 4, 31)),
    (&["david kill saul", "david killed saul", "david spare saul", "david spared saul", "spared saul", "david saul cave", "david saul chance"], ("1 Samuel", 24, 1, 22)),
    (&["first plague", "plague blood", "water turn blood", "nile blood", "water turned blood"], ("Exodus", 7, 14, 24)),
    (&["abraham father", "abrahams father", "abram father", "father abraham terah", "terah"], ("Genesis", 11, 24, 32)),
    (&["samuel mother", "samuels mother", "mother samuel", "hannah samuel"], ("1 Samuel", 1, 1, 20)),
    (&["disciples cast demon", "disciples couldnt cast", "disciples could not cast", "boy demon disciples", "epileptic boy"], ("Matthew", 17, 14, 20)),
    (&["swallowed ground", "earth swallowed", "ground swallowed", "korah rebellion", "korahs rebellion", "korah", "dathan abiram"], ("Numbers", 16, 20, 35)),
    (&["ruth boaz"], ("Ruth", 2, 1, 23)),
    (&["ruth mother law", "ruths mother law", "ruth naomi"], ("Ruth", 1, 1, 22)),
    (&["elijah carmel", "prophets baal", "fire heaven elijah"], ("1 Kings", 18, 20, 40)),
    (&["still small voice", "gentle whisper"], ("1 Kings", 19, 9, 18)),
    (&["valley dry bones", "dry bones"], ("Ezekiel", 37, 1, 14)),
    (&["jonah whale", "jonah fish"], ("Jonah", 1, 17, 17)),
    (&["such time this", "esther queen"], ("Esther", 4, 12, 17)),
    (&["job suffering", "job trials", "job satan"], ("Job", 1, 6, 22)),
    (&["shepherd psalm", "lord my shepherd"], ("Psalms", 23, 1, 6)),
    (&["water wine", "wedding cana", "first miracle", "first sign"], ("John", 2, 1, 11)),
    (&["nicodemus"], ("John", 3, 1, 21)),
    (&["woman well", "samaritan woman"], ("John", 4, 4, 42)),
    (&["feeding five thousand", "feeding 5000", "five loaves", "loaves fishes", "loaves fish"], ("John", 6, 1, 14)),
    (&["walks water", "walking water", "walked water"], ("Matthew", 14, 22, 33)),
    (&["calming storm", "calms storm", "stilling storm"], ("Mark", 4, 35, 41)),
    (&["raising lazarus", "lazarus raised", "lazarus tomb"], ("John", 11, 1, 44)),
    (&["rich man lazarus"], ("Luke", 16, 19, 31)),
    (&["zacchaeus"], ("Luke", 19, 1, 10)),
    (&["john baptist mother", "john baptists mother", "elizabeth zechariah"], ("Luke", 1, 5, 25)),
    (&["transfiguration"], ("Matthew", 17, 1, 13)),
    (&["jesus bleed", "jesus bled", "sweat blood", "drops blood", "sweat like blood"], ("Luke", 22, 39, 46)),
    (&["jesus bleed", "jesus bled", "jesus flogged", "jesus scourged", "crown thorns"], ("John", 19, 1, 3)),
    (&["jesus bleed", "jesus bled", "pierced side", "blood water"], ("John", 19, 31, 37)),
    (&["last supper", "lord's supper", "lords supper", "communion"], ("Luke", 22, 7, 23)),
    (&["garden gethsemane", "gethsemane"], ("Matthew", 26, 36, 46)),
    (&["road emmaus", "emmaus"], ("Luke", 24, 13, 35)),
    (&["great commission"], ("Matthew", 28, 16, 20)),
    (&["ascension", "jesus up heaven", "taken up heaven", "jesus ascended", "ascended heaven"], ("Acts", 1, 6, 11)),
    (&["thief cross", "thieves cross", "criminal cross", "criminals cross", "paradise today"], ("Luke", 23, 39, 43)),
    (&["day pentecost", "pentecost", "tongues fire"], ("Acts", 2, 1, 21)),
    (&["damascus road", "road damascus", "saul conversion", "paul conversion"], ("Acts", 9, 1, 19)),
    (&["parable sower", "sower seed"], ("Matthew", 13, 1, 23)),
    (&["parable talents"], ("Matthew", 25, 14, 30)),
    (&["ten virgins", "wise foolish virgins"], ("Matthew", 25, 1, 13)),
    (&["widow mite", "widows mite", "widow's mite", "widow offering"], ("Mark", 12, 41, 44)),
    (&["love chapter", "love patient kind"], ("1 Corinthians", 13, 1, 13)),
    (&["fruit spirit"], ("Galatians", 5, 22, 23)),
    (&["armour god", "armor god", "whole armour", "whole armor"], ("Ephesians", 6, 10, 18)),
    (&["faith chapter", "hall faith", "heroes faith"], ("Hebrews", 11, 1, 40)),
];

/// The words of a story's name, as `understand` spells a search's words.
fn name_words(name: &str) -> Vec<String> {
    name.split(' ')
        .map(|w| w.trim_end_matches("'s").trim_end_matches('\''))
        .filter(|w| !STOPWORDS.contains(w))
        .flat_map(|w| match w.parse::<u32>().ok().and_then(number_words) {
            Some(n) => n.split(' ').map(str::to_string).collect::<Vec<_>>(),
            None => vec![w.to_string()],
        })
        .collect()
}

/// The well-known stories a search names (all the words of one of its names are in it).
pub fn stories(u: &Understood) -> Vec<Curated> {
    let have: HashSet<&str> = u.words.iter().map(String::as_str).collect();
    STORIES
        .iter()
        .filter(|(names, _)| names.iter().any(|name| name_words(name).iter().all(|w| have.contains(w.as_str()))))
        .map(|(_, (book, chapter, start, end))| Curated {
            key: VerseKey { book: book.to_string(), chapter: *chapter, verse: *start },
            verse_end: *end,
            why: vec!["story".into()],
        })
        .collect()
}

const RRF_K: f64 = 60.0;
/// The most verses one passage spans, and the widest gap between found verses inside it.
const PASSAGE_SPAN: i64 = 12;
const PASSAGE_GAP: i64 = 6;

/// BSB verses for an FTS5 expression, best first (`rows`: the BSB's, see `bsb_rows`).
fn fts(db: &Connection, expr: &str, scope: Scope, limit: i64, rows: (i64, i64)) -> Vec<VerseKey> {
    let Ok(mut st) = db.prepare(
        "SELECT b.name, v.chapter, v.verse FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid
         JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
         WHERE verses_fts MATCH ?1 AND verses_fts.rowid BETWEEN ?5 AND ?6 AND ver.code = 'BSB'
         AND (?2 IS NULL OR b.testament = ?2) AND (?3 IS NULL OR b.name = ?3)
         ORDER BY bm25(verses_fts) LIMIT ?4",
    ) else {
        return Vec::new();
    };
    let rows = st.query_map(params![expr, scope.testament, scope.book, limit, rows.0, rows.1], |r| {
        Ok(VerseKey { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)? })
    });
    match rows {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

fn quoted(words: &[String]) -> String {
    format!("\"{}\"", words.join(" "))
}

/// One word (or number) to look for, as an FTS5 term: a number in words or in digits.
fn term(u: &Understood, w: &str) -> String {
    match u.digits.get(w) {
        Some(d) => format!("(\"{w}\" OR \"{d}\")"),
        None => format!("\"{w}\""),
    }
}

/// Ranks the passages for a search (see the module's notes). `meaning` is the verses nearest
/// in meaning, nearest first (empty without the search upgrade); `curated` the key passages.
pub fn rank(db: &Connection, u: &Understood, meaning: &[VerseKey], curated: &[Curated], scope: Scope, limit: usize) -> Result<Vec<Found>, String> {
    let testament_of: HashMap<String, String> = db
        .prepare("SELECT name, testament FROM books")
        .map_err(err)?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .filter_map(Result::ok)
        .collect();
    let in_scope = |k: &VerseKey| {
        scope.book.map_or(true, |b| b == k.book) && scope.testament.map_or(true, |t| testament_of.get(&k.book).map(String::as_str) == Some(t))
    };

    let mut score: HashMap<VerseKey, f64> = HashMap::new();
    let mut why: HashMap<VerseKey, HashSet<&'static str>> = HashMap::new();
    let add = |list: &[VerseKey], weight: f64, tag: &'static str, score: &mut HashMap<VerseKey, f64>, why: &mut HashMap<VerseKey, HashSet<&'static str>>| {
        for (rank, k) in list.iter().filter(|k| in_scope(k)).enumerate() {
            *score.entry(k.clone()).or_insert(0.0) += weight / (RRF_K + rank as f64 + 1.0);
            why.entry(k.clone()).or_default().insert(tag);
        }
    };

    let rows = bsb_rows(db);
    // the exact words: on top, in their own order, when the search is a remembered quotation
    // (four words or more); for a subject ("end of days") its key passages come first, since
    // the words alone can mean something else (Young's "at the end of days" is "some time later")
    let phrase_pin = if u.words.len() >= 4 { 10.0 } else { 4.0 };
    let phrase = if u.content.len() >= 2 || (u.content.len() == 1 && meaning.is_empty()) { fts(db, &quoted(&u.content), scope, 50, rows) } else { Vec::new() };
    for (rank, k) in phrase.iter().enumerate() {
        *score.entry(k.clone()).or_insert(0.0) += phrase_pin - rank as f64 * 0.01;
        why.entry(k.clone()).or_default().insert("phrase");
    }
    if u.content.len() >= 2 {
        let all = u.content.iter().map(|w| term(u, w)).collect::<Vec<_>>().join(" AND ");
        add(&fts(db, &all, scope, 60, rows), 1.0, "words", &mut score, &mut why);
        // most of the words: the names left out (a verse naming Daniel isn't about his prayer)
        let named: Vec<String> = u.names.iter().map(|n| n.to_lowercase()).collect();
        let rest: Vec<String> = u.content.iter().filter(|w| !named.contains(w) && !u.common.contains(w)).map(|w| term(u, w)).collect();
        if rest.len() >= 2 {
            add(&fts(db, &rest.join(" OR "), scope, 120, rows), 0.6, "words", &mut score, &mut why);
        }
    } else if let Some(w) = u.content.first().filter(|w| !u.common.contains(w)) {
        add(&fts(db, &term(u, w), scope, 120, rows), 0.8, "words", &mut score, &mut why);
    }
    for n in &u.numbers {
        let words: Vec<String> = n.split(' ').map(str::to_string).collect();
        add(&fts(db, &quoted(&words), scope, 30, rows), 1.2, "words", &mut score, &mut why);
    }
    add(meaning, 1.0, "meaning", &mut score, &mut why);
    // the subject's other finds (its words, the topical Bibles): one more list
    let others: Vec<VerseKey> = curated.iter().filter(|c| !c.why.iter().any(|w| w == "core")).map(|c| c.key.clone()).collect();
    add(&others, 1.0, "words", &mut score, &mut why);

    // a named person or place: the chapters they are in count more
    let mut chapters: HashSet<(String, i64)> = HashSet::new();
    for name in &u.names {
        if let Ok(mut st) = db.prepare(
            "SELECT DISTINCT b.name, v.chapter FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid
             JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
             WHERE verses_fts MATCH ?1 AND verses_fts.rowid BETWEEN ?3 AND ?4 AND ver.code = 'BSB' AND instr(v.text, ?2) > 0",
        ) {
            if let Ok(found) = st.query_map(params![format!("\"{}\"", name.to_lowercase()), name, rows.0, rows.1], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
                chapters.extend(found.filter_map(Result::ok));
            }
        }
    }
    let name_books: HashSet<&String> = u.names.iter().filter(|n| testament_of.contains_key(*n)).collect();
    // a named author counts for the books he wrote ("what did Paul say about love" -> 1 Corinthians 13)
    let authored: Vec<&str> = u.names.iter().flat_map(|n| authored_books(n)).copied().collect();
    let about_names = |k: &VerseKey| chapters.contains(&(k.book.clone(), k.chapter)) || name_books.contains(&k.book) || authored.contains(&k.book.as_str());
    if !u.names.is_empty() {
        for (k, s) in score.iter_mut() {
            if about_names(k) {
                *s *= 3.0;
                why.entry(k.clone()).or_default().insert("name");
            }
        }
    }

    // the key passages of the subject: above the rest, in their order (with a name in the
    // search, only those where the name is: "Daniel's prayer" is not every prayer)
    let core: Vec<&Curated> = curated.iter().filter(|c| c.why.iter().any(|w| w == "core") && in_scope(&c.key)).collect();
    for (rank, c) in core.iter().enumerate() {
        let entry = score.entry(c.key.clone()).or_insert(0.0);
        if u.names.is_empty() || about_names(&c.key) {
            *entry += 5.0 - rank as f64 * 0.01;
        } else {
            *entry += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
        why.entry(c.key.clone()).or_default().insert("core");
    }
    // the exact words in any translation (the caller's own phrase search): on top too
    for (rank, c) in curated.iter().filter(|c| c.why.iter().any(|w| w == "phrase") && in_scope(&c.key)).enumerate() {
        *score.entry(c.key.clone()).or_insert(0.0) += phrase_pin - rank as f64 * 0.01;
        why.entry(c.key.clone()).or_default().insert("phrase");
    }
    // a story named: first of all
    let named = stories(u);
    for (rank, s) in named.iter().filter(|s| in_scope(&s.key)).enumerate() {
        *score.entry(s.key.clone()).or_insert(0.0) += 20.0 - rank as f64 * 0.01;
        why.entry(s.key.clone()).or_default().insert("story");
    }
    let curated: Vec<&Curated> = curated.iter().filter(|c| c.why.iter().any(|w| w == "core")).chain(named.iter()).collect();

    // verses close together in a chapter: one passage
    let mut ranked: Vec<(VerseKey, f64)> = score.into_iter().collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    ranked.truncate(200);
    let ranges: HashMap<VerseKey, i64> = curated.iter().map(|c| (c.key.clone(), c.verse_end.max(c.key.verse))).collect();
    let found_keys: HashSet<&VerseKey> = ranked.iter().map(|(k, _)| k).collect();
    // a verse inside a key passage or story that was found belongs to it
    let owner_of = |k: &VerseKey| -> Option<VerseKey> {
        curated
            .iter()
            .filter(|c| found_keys.contains(&c.key) && c.key.book == k.book && c.key.chapter == k.chapter && c.key.verse < k.verse && k.verse <= c.verse_end)
            .map(|c| c.key.clone())
            .min_by_key(|c| c.verse)
    };
    let mut members: HashMap<VerseKey, Vec<(i64, f64)>> = HashMap::new();
    let mut by_chapter: HashMap<(String, i64), Vec<(i64, f64)>> = HashMap::new();
    for (k, s) in &ranked {
        match owner_of(k) {
            Some(owner) => members.entry(owner).or_default().push((k.verse, *s)),
            None => by_chapter.entry((k.book.clone(), k.chapter)).or_default().push((k.verse, *s)),
        }
    }
    let mut found: Vec<Found> = Vec::new();
    for ((book, chapter), mut verses) in by_chapter {
        verses.sort_by_key(|v| v.0);
        let mut group: Vec<(i64, f64)> = Vec::new();
        let flush = |group: &mut Vec<(i64, f64)>, found: &mut Vec<Found>| {
            if group.is_empty() {
                return;
            }
            // the found verses inside a key passage starting here come with it
            if let Some(more) = members.get(&VerseKey { book: book.clone(), chapter, verse: group[0].0 }) {
                group.extend(more.iter().copied());
                group.sort_by_key(|g| g.0);
            }
            let start = group[0].0;
            let mut end = group[group.len() - 1].0;
            let mut tags: Vec<String> = Vec::new();
            for (v, _) in group.iter() {
                let key = VerseKey { book: book.clone(), chapter, verse: *v };
                if let Some(e) = ranges.get(&key) {
                    end = end.max(*e);
                }
                for t in why.get(&key).into_iter().flatten() {
                    if !tags.iter().any(|x| x == t) {
                        tags.push(t.to_string());
                    }
                }
            }
            let mut scores: Vec<f64> = group.iter().map(|g| g.1).collect();
            scores.sort_by(|a, b| b.total_cmp(a));
            // a passage counts by its best verses, not by how many it has
            let total = scores[0] + 0.3 * scores.get(1).unwrap_or(&0.0) + 0.15 * scores.get(2).unwrap_or(&0.0);
            found.push(Found { book: book.clone(), chapter, verse: start, verse_end: end, verses: group.iter().map(|g| g.0).collect(), why: tags, score: total });
            group.clear();
        };
        for (v, s) in verses {
            if let Some(&(first, _)) = group.first() {
                let last = group[group.len() - 1].0;
                let starts_passage = ranges.contains_key(&VerseKey { book: book.clone(), chapter, verse: v });
                if v - last > PASSAGE_GAP || v - first >= PASSAGE_SPAN || starts_passage {
                    flush(&mut group, &mut found);
                }
            }
            group.push((v, s));
        }
        flush(&mut group, &mut found);
    }
    found.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.book.cmp(&b.book)).then(a.chapter.cmp(&b.chapter)).then(a.verse.cmp(&b.verse)));
    found.truncate(limit);
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_as_the_bible_writes_them() {
        assert_eq!(number_words(21).as_deref(), Some("twenty one"));
        assert_eq!(number_words(40).as_deref(), Some("forty"));
        assert_eq!(number_words(153).as_deref(), Some("one hundred fifty three"));
        assert_eq!(number_words(7).as_deref(), Some("seven"));
    }

    #[test]
    fn spelling_distance() {
        assert_eq!(distance("melchisedek", "melchizedek", 2), 1);
        assert_eq!(distance("habbakuk", "habakkuk", 2), 2);
        assert_eq!(distance("recieve", "receive", 2), 1);
        assert!(distance("prayer", "delayed", 2) > 2);
    }
}
