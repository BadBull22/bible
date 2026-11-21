//! The meanings of the Hebrew and Greek words (UBS dictionaries, CC BY-SA 4.0; SIL Semantic Domains, CC BY-SA 4.0), shared by the desktop app and the phone app: the files
//! (`semantic_domains.json`, `semantic_sil.json`), their groups, the meanings of one word, the plain-English cards, and the example verses with a word marked.
//! Nothing here knows about Tauri or either app's database; each app asks its own database and hands the answers in.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct RawFile {
    pub greek: RawLang,
    pub hebrew: RawLang,
}

#[derive(Deserialize)]
pub struct RawLang {
    pub domains: Vec<(String, String)>,
    pub entries: Vec<RawEntry>,
}

#[derive(Deserialize)]
pub struct RawEntry {
    pub s: Vec<String>,
    pub l: String,
    pub m: Vec<RawMeaning>,
}

#[derive(Deserialize)]
pub struct RawMeaning {
    pub d: Vec<String>,
    pub g: Vec<String>,
    pub t: String,
    #[serde(default)]
    pub c: Option<String>,
    pub v: Vec<u32>,
}

pub struct Meaning {
    pub domains: Vec<String>,
    pub glosses: Vec<String>,
    pub definition: String,
    pub ln: Option<String>,
    /// sorted verse numbers (book * 1,000,000 + chapter * 1,000 + verse)
    pub verses: Vec<u32>,
}

pub struct Entry {
    pub strongs: Vec<String>,
    pub lemma: String,
    pub meanings: Vec<Meaning>,
}

pub struct Lang {
    pub names: HashMap<String, String>,
    pub entries: Vec<Entry>,
    pub nodes: Vec<DomainNode>,
}

pub struct Data {
    pub greek: Lang,
    pub hebrew: Lang,
}

/// A group of meanings in the tree, with how many words and verses are inside it (the groups under it included).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DomainNode {
    pub code: String,
    pub name: String,
    /// 1 for a domain, 2 for a sub-domain... (the code's length over three)
    pub level: usize,
    pub words: usize,
    pub verses: usize,
}

/// One meaning of one word, for the list of words inside a group.
#[derive(Serialize, Clone, Debug)]
pub struct MeaningWord {
    pub entry: usize,
    pub meaning: usize,
    pub strongs: Vec<String>,
    pub lemma: String,
    pub glosses: Vec<String>,
    pub definition: String,
    /// the Louw-Nida number of a Greek meaning
    pub ln: Option<String>,
    pub verses: usize,
    /// how the word is written in English letters (Strong's), when its Strong's number is known
    pub translit: Option<String>,
    /// the form to say aloud: a Hebrew word needs its vowel points, so a lemma without them is replaced by Strong's pointed one
    pub speak: String,
}

/// What a word means in a verse, or everywhere it is used when the verse is not known to the dictionary.
#[derive(Serialize, Clone, Debug)]
pub struct WordMeaning {
    pub lemma: String,
    pub glosses: Vec<String>,
    pub definition: String,
    pub ln: Option<String>,
    /// "Attitudes and Emotions > Love, Affection, Compassion" for each group the meaning is in
    pub groups: Vec<String>,
    /// the dictionary lists this verse for this meaning
    pub here: bool,
}

pub fn unpack(packed: &[u32]) -> Vec<u32> {
    let mut at = 0u32;
    packed
        .iter()
        .enumerate()
        .map(|(i, n)| {
            at = if i == 0 { *n } else { at + n };
            at
        })
        .collect()
}

pub fn parent(code: &str) -> &str {
    if code.len() > 3 {
        &code[..code.len() - 3]
    } else {
        ""
    }
}

impl Lang {
    pub fn new(raw: RawLang) -> Lang {
        let names: HashMap<String, String> = raw.domains.into_iter().collect();
        let entries: Vec<Entry> = raw
            .entries
            .into_iter()
            .map(|e| Entry {
                strongs: e.s,
                lemma: e.l,
                meanings: e.m.into_iter().map(|m| Meaning { domains: m.d, glosses: m.g, definition: m.t, ln: m.c, verses: unpack(&m.v) }).collect(),
            })
            .collect();
        // for every group and the groups above it: the words and verses inside
        let mut inside: HashMap<&str, (HashSet<usize>, HashSet<u32>)> = HashMap::new();
        for (ei, e) in entries.iter().enumerate() {
            for m in &e.meanings {
                for code in &m.domains {
                    let mut c: &str = code;
                    while !c.is_empty() {
                        let slot = inside.entry(c).or_default();
                        slot.0.insert(ei);
                        slot.1.extend(m.verses.iter().copied());
                        c = parent(c);
                    }
                }
            }
        }
        let mut nodes: Vec<DomainNode> = names
            .iter()
            .filter_map(|(code, name)| {
                let (w, v) = inside.get(code.as_str())?;
                Some(DomainNode { code: code.clone(), name: name.clone(), level: (code.len() / 3).max(1), words: w.len(), verses: v.len() })
            })
            .collect();
        nodes.sort_by(|a, b| a.code.cmp(&b.code));
        Lang { names, entries, nodes }
    }

    /// "Attitudes and Emotions > Love, Affection, Compassion"
    pub fn path_of(&self, code: &str) -> String {
        let mut parts: Vec<&str> = Vec::new();
        let mut c = code;
        while !c.is_empty() {
            parts.push(self.names.get(c).map(|s| s.as_str()).unwrap_or(c));
            c = parent(c);
        }
        parts.reverse();
        parts.join(" > ")
    }

    /// The verses of a group, or of one word in it, or of one meaning of one word; each with the words that put it there.
    pub fn select(&self, code: &str, entry: Option<usize>, meaning: Option<usize>) -> BTreeMap<u32, Vec<String>> {
        let mut out: BTreeMap<u32, Vec<String>> = BTreeMap::new();
        for (ei, e) in self.entries.iter().enumerate() {
            if entry.is_some_and(|x| x != ei) {
                continue;
            }
            for (mi, m) in e.meanings.iter().enumerate() {
                if meaning.is_some_and(|x| x != mi) {
                    continue;
                }
                if !m.domains.iter().any(|d| d.starts_with(code)) {
                    continue;
                }
                let label = match m.glosses.first() {
                    Some(g) => format!("{} ({})", e.lemma, g),
                    None => e.lemma.clone(),
                };
                for v in &m.verses {
                    let slot = out.entry(*v).or_default();
                    if !slot.contains(&label) {
                        slot.push(label.clone());
                    }
                }
            }
        }
        out
    }
}

impl Data {
    pub fn from_json(text: &str) -> Result<Data, String> {
        let raw: RawFile = serde_json::from_str(text).map_err(|e| format!("The meanings file could not be read: {e}"))?;
        Ok(Data { greek: Lang::new(raw.greek), hebrew: Lang::new(raw.hebrew) })
    }

    pub fn lang(&self, language: &str) -> Result<&Lang, String> {
        match language {
            "greek" => Ok(&self.greek),
            "hebrew" => Ok(&self.hebrew),
            _ => Err("Choose Greek or Hebrew.".into()),
        }
    }
}

pub fn has_hebrew_points(text: &str) -> bool {
    text.chars().any(|c| ('\u{05B0}'..='\u{05C7}').contains(&c) && c != '\u{05BE}')
}

/// A Strong's number as the app writes it ("G0026" and "g26" are "G26"); None for anything that is not one.
pub fn norm_strongs(raw: &str) -> Option<String> {
    let t = raw.trim();
    let mut chars = t.chars();
    let letter = chars.next()?.to_ascii_uppercase();
    if letter != 'G' && letter != 'H' {
        return None;
    }
    let digits: String = chars.take_while(|c| c.is_ascii_digit()).collect();
    let n: u32 = digits.parse().ok()?;
    (n > 0 && n < 100_000).then(|| format!("{letter}{n}"))
}

#[derive(Deserialize)]
pub struct RawSilRelated {
    pub c: String,
    pub n: String,
}

#[derive(Deserialize)]
pub struct RawSilDomain {
    pub n: String,
    pub p: Vec<String>,
    pub d: String,
    pub r: Vec<RawSilRelated>,
    pub w: Vec<String>,
}

/// resources/semantic_sil.json (scripts/build_semantic_sil.mts): which SIL domain goes with a Greek or Hebrew group, and the SIL domains themselves.
#[derive(Deserialize)]
pub struct RawSil {
    pub greek: HashMap<String, String>,
    pub hebrew: HashMap<String, String>,
    pub domains: HashMap<String, RawSilDomain>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SilRelated {
    pub code: String,
    pub name: String,
}

/// What a group of meanings is called in everyday English: the SIL domain beside it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SilCard {
    pub code: String,
    pub name: String,
    /// the domains above it, "Social behavior" first
    pub path: Vec<String>,
    pub description: String,
    pub related: Vec<SilRelated>,
    /// words people use for it
    pub words: Vec<String>,
    /// true for Greek (matched through the Louw-Nida numbers), false for Hebrew (matched by hand, by meaning)
    pub by_louw_nida: bool,
}

impl RawSil {
    pub fn from_json(text: &str) -> Result<RawSil, String> {
        serde_json::from_str(text).map_err(|e| format!("The everyday-English file could not be read: {e}"))
    }

    /// The card for the first of these groups (or the group above it) that has a match.
    pub fn card(&self, hebrew: bool, groups: &[String]) -> Option<SilCard> {
        let map = if hebrew { &self.hebrew } else { &self.greek };
        for g in groups {
            let mut c: &str = g;
            while !c.is_empty() {
                if let Some(code) = map.get(c) {
                    let d = self.domains.get(code)?;
                    return Some(SilCard {
                        code: code.clone(),
                        name: d.n.clone(),
                        path: d.p.clone(),
                        description: d.d.clone(),
                        related: d.r.iter().map(|r| SilRelated { code: r.c.clone(), name: r.n.clone() }).collect(),
                        words: d.w.clone(),
                        by_louw_nida: !hebrew,
                    });
                }
                c = parent(c);
            }
        }
        None
    }
}

/// One meaning of a word, with where it is used.
#[derive(Serialize, Clone, Debug)]
pub struct Sense {
    pub entry: usize,
    pub meaning: usize,
    pub glosses: Vec<String>,
    pub definition: String,
    pub ln: Option<String>,
    /// "Attitudes and Emotions > Love, Affection, Compassion" for each group the meaning is in
    pub groups: Vec<String>,
    /// the codes of those groups (to list the other words in a group)
    pub domains: Vec<String>,
    pub verses: usize,
    /// verses of each of the 66 books (Genesis first)
    pub by_book: Vec<u32>,
    /// the dictionary lists the verse asked about for this meaning
    pub here: bool,
    pub sil: Option<SilCard>,
}

/// The word as Strong's lexicon has it, for the words the UBS dictionaries leave out and as a line under the others.
#[derive(Serialize, Clone, Debug)]
pub struct WordDictionary {
    pub lemma: String,
    pub translit: Option<String>,
    pub definition: String,
    pub kjv: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SenseReport {
    pub strongs: String,
    pub language: String,
    pub lemma: String,
    pub senses: Vec<Sense>,
    pub dictionary: Option<WordDictionary>,
}

/// The meanings of a Strong's number (every entry that carries it), in the dictionary's order.
pub fn senses_of(lang: &Lang, sil: Option<&RawSil>, hebrew: bool, strongs: &str, key: Option<u32>) -> (String, Vec<Sense>) {
    let mut lemma = String::new();
    let mut out = Vec::new();
    for (ei, e) in lang.entries.iter().enumerate().filter(|(_, e)| e.strongs.iter().any(|s| s == strongs)) {
        if lemma.is_empty() {
            lemma = e.lemma.clone();
        }
        for (mi, m) in e.meanings.iter().enumerate() {
            let mut by_book = vec![0u32; 66];
            for v in &m.verses {
                let b = (*v / 1_000_000) as usize;
                if (1..=66).contains(&b) {
                    by_book[b - 1] += 1;
                }
            }
            out.push(Sense {
                entry: ei,
                meaning: mi,
                glosses: m.glosses.clone(),
                definition: m.definition.clone(),
                ln: m.ln.clone(),
                groups: m.domains.iter().map(|d| lang.path_of(d)).collect(),
                domains: m.domains.clone(),
                verses: m.verses.len(),
                by_book,
                here: key.is_some_and(|k| m.verses.binary_search(&k).is_ok()),
                sil: sil.and_then(|s| s.card(hebrew, &m.domains)),
            });
        }
    }
    (lemma, out)
}

// ---- example verses with the word marked

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SamplePart {
    pub text: String,
    pub mark: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Sample {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub parts: Vec<SamplePart>,
}

/// A few verses to show for a meaning: the verse being read first when it is one of them, then the first, the middle and the last.
pub fn pick_sample_keys(verses: &[u32], here: Option<u32>, n: usize) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    if let Some(h) = here.filter(|h| verses.binary_search(h).is_ok()) {
        out.push(h);
    }
    if !verses.is_empty() {
        for i in [0, verses.len() / 2, verses.len() - 1] {
            if out.len() < n && !out.contains(&verses[i]) {
                out.push(verses[i]);
            }
        }
        let mut i = 0;
        while out.len() < n && i < verses.len() {
            if !out.contains(&verses[i]) {
                out.push(verses[i]);
            }
            i += 1;
        }
    }
    out.sort_unstable();
    out
}

/// A verse cut into pieces, the words of the original word's translation marked (the first place each is found).
pub fn mark_parts(text: &str, words: &[String]) -> Vec<SamplePart> {
    let mut spans: Vec<(usize, usize)> = words.iter().map(|w| w.trim()).filter(|w| !w.is_empty()).filter_map(|w| text.find(w).map(|i| (i, i + w.len()))).collect();
    spans.sort_unstable();
    let mut parts = Vec::new();
    let mut at = 0;
    for (s, e) in spans {
        if s < at {
            continue;
        }
        if s > at {
            parts.push(SamplePart { text: text[at..s].to_string(), mark: false });
        }
        parts.push(SamplePart { text: text[s..e].to_string(), mark: true });
        at = e;
    }
    if at < text.len() {
        parts.push(SamplePart { text: text[at..].to_string(), mark: false });
    }
    parts
}

#[derive(Serialize, Clone, Debug)]
pub struct OriginalWord {
    pub strongs: String,
    pub lemma: String,
    pub translit: Option<String>,
    pub definition: String,
    /// how often this English word translates it, in the Bible asked about
    pub times: i64,
}

impl Lang {
    /// The words (and their meanings) inside a group, the most used first (at most 600).
    pub fn words_in(&self, code: &str) -> Vec<MeaningWord> {
        let mut out = Vec::new();
        for (ei, e) in self.entries.iter().enumerate() {
            for (mi, m) in e.meanings.iter().enumerate() {
                if m.domains.iter().any(|d| d.starts_with(code)) {
                    out.push(MeaningWord {
                        entry: ei,
                        meaning: mi,
                        strongs: e.strongs.clone(),
                        lemma: e.lemma.clone(),
                        glosses: m.glosses.clone(),
                        definition: m.definition.clone(),
                        ln: m.ln.clone(),
                        verses: m.verses.len(),
                        translit: None,
                        speak: e.lemma.clone(),
                    });
                }
            }
        }
        out.sort_by(|a, b| b.verses.cmp(&a.verses).then(a.lemma.cmp(&b.lemma)));
        out.truncate(600);
        out
    }

    /// What a word means where it is used: the meanings of a Strong's number, those listed for this verse first and marked "here".
    pub fn word_meanings(&self, strongs: &str, key: Option<u32>) -> Vec<WordMeaning> {
        let mut out = Vec::new();
        for e in self.entries.iter().filter(|e| e.strongs.iter().any(|s| s == strongs)) {
            for m in &e.meanings {
                out.push(WordMeaning {
                    lemma: e.lemma.clone(),
                    glosses: m.glosses.clone(),
                    definition: m.definition.clone(),
                    ln: m.ln.clone(),
                    groups: m.domains.iter().map(|d| self.path_of(d)).collect(),
                    here: key.is_some_and(|k| m.verses.binary_search(&k).is_ok()),
                });
            }
        }
        out.sort_by_key(|m| !m.here);
        out
    }

    /// The verse of one meaning of one word, by the numbers of the entry and the meaning.
    pub fn meaning_verses(&self, entry: usize, meaning: usize) -> Option<&[u32]> {
        self.entries.get(entry).and_then(|e| e.meanings.get(meaning)).map(|m| m.verses.as_slice())
    }
}

impl Data {
    /// The language's meanings for a Strong's number: Greek for G..., Hebrew for H...
    pub fn lang_of_strongs(&self, strongs: &str) -> &Lang {
        if strongs.starts_with('G') {
            &self.greek
        } else {
            &self.hebrew
        }
    }
}

impl RawSil {
    /// The card for a whole group of meanings.
    pub fn group_card(&self, hebrew: bool, code: &str) -> Option<SilCard> {
        self.card(hebrew, &[code.to_string()])
    }
}
