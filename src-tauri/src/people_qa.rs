//! Questions about a person's family ("who were John the Baptist's parents?", "who was Abraham's wife?", "who were the sons
//! of Jacob?"), answered from the people data the app already holds (`entities.relations_json` in commentaries.db: father,
//! mother, partners, children, siblings). The name can be spelled either way (Elizabeth / Elisabeth, Zechariah / Zacharias):
//! `resources/name_aliases.json` (made by `data-pipeline/build_name_aliases.py` from the BSB and KJV Strong's tagging) pairs them.
//! When the person or the family tie is not in the data, `answer` returns None and the other answer layers go on as before.

use std::sync::OnceLock;

use regex::Regex;
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::models::{AskCitation, AskCuratedEntry};
use crate::qa::QaConfidence;

const ALIASES_JSON: &str = include_str!("../resources/name_aliases.json");

/// People who are known by two names (their name was changed): looked up under both.
const PERSON_ALIASES: &[(&str, &str)] = &[("jacob", "israel"), ("abram", "abraham"), ("sarai", "sarah"), ("simon peter", "peter")];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Relation {
    Parents,
    Father,
    Mother,
    Spouse,
    Children,
    Sons,
    Daughters,
    Siblings,
    Brothers,
    Sisters,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RelationQuestion {
    pub relation: Relation,
    pub name: String,
    /// "how many sons did Jacob have": the answer starts with the count
    pub count: bool,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The question's shape: which family tie, and whose. None when it is not a family question.
pub fn parse_relation_question(question: &str) -> Option<RelationQuestion> {
    static PATTERNS: OnceLock<Vec<(Regex, Relation)>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        let who = r"^(?:who|what)\s+(?:was|were|is|are)\s+";
        let apos = "['’]s?";
        let rel = |words: &str, owner_first: bool, owner_last_with_who: bool| -> Vec<String> {
            let mut v = Vec::new();
            // "who were the <relation> of X"
            v.push(format!(r"(?i){who}(?:the\s+)?(?:{words})\s+of\s+(.+)$"));
            // "who were X's <relation>"
            if owner_first {
                v.push(format!(r"(?i){who}(.+?){apos}\s+(?:{words})$"));
            }
            // "X's <relation>"
            if owner_last_with_who {
                v.push(format!(r"(?i)^(.+?){apos}\s+(?:{words})$"));
            }
            v
        };
        let mut out: Vec<(Regex, Relation)> = Vec::new();
        let mut add = |list: Vec<String>, r: Relation| {
            for p in list {
                out.push((Regex::new(&p).expect("valid pattern"), r));
            }
        };
        add(rel("parents|mother\\s+and\\s+father|father\\s+and\\s+mother", true, true), Relation::Parents);
        add(vec![r"(?i)^(.+?)\s+parents$".to_string()], Relation::Parents);
        add(rel("father|dad", true, true), Relation::Father);
        add(rel("mother|mom|mum", true, true), Relation::Mother);
        add(rel("wife|wives|husband|spouse|spouses", true, true), Relation::Spouse);
        add(
            vec![
                format!(r"(?i){who}(.+?)\s+married\s+to$"),
                r"(?i)^who\s+(?:did|was)\s+(.+?)\s+(?:marry|married(?:\s+to)?)$".to_string(),
            ],
            Relation::Spouse,
        );
        add(rel("sons?", true, true), Relation::Sons);
        add(rel("daughters?", true, true), Relation::Daughters);
        add(rel("children|kids|sons\\s+and\\s+daughters", true, true), Relation::Children);
        add(rel("brothers?", true, true), Relation::Brothers);
        // "who was Moses brother" (no apostrophe)
        add(vec![format!(r"(?i){who}(.+?)\s+brothers?$")], Relation::Brothers);
        add(rel("sisters?", true, true), Relation::Sisters);
        add(vec![format!(r"(?i){who}(.+?)\s+sisters?$")], Relation::Sisters);
        add(rel("siblings|brothers\\s+and\\s+sisters", true, true), Relation::Siblings);
        out
    });
    let q = question.trim().trim_end_matches(['?', '.', '!']).trim();
    static HOW_MANY: OnceLock<Regex> = OnceLock::new();
    let how_many = HOW_MANY.get_or_init(|| Regex::new(r"(?i)^how\s+many\s+(children|kids|sons|daughters|brothers|sisters)\s+did\s+(.+?)\s+have$").expect("valid pattern"));
    if let Some(c) = how_many.captures(q) {
        let relation = match c[1].to_lowercase().as_str() {
            "sons" => Relation::Sons,
            "daughters" => Relation::Daughters,
            "brothers" => Relation::Brothers,
            "sisters" => Relation::Sisters,
            _ => Relation::Children,
        };
        let name = clean_name(&c[2]);
        if !name.is_empty() && name.split_whitespace().count() <= 5 {
            return Some(RelationQuestion { relation, name, count: true });
        }
    }
    for (re, relation) in patterns {
        if let Some(c) = re.captures(q) {
            let name = clean_name(&c[1]);
            if !name.is_empty() && name.split_whitespace().count() <= 5 {
                return Some(RelationQuestion { relation: *relation, name, count: false });
            }
        }
    }
    None
}

fn clean_name(raw: &str) -> String {
    let mut n = raw.trim().trim_matches(|c| c == '"' || c == '“' || c == '”').trim().to_string();
    for prefix in ["the ", "a ", "an "] {
        if n.to_lowercase().starts_with(prefix) {
            n = n[prefix.len()..].to_string();
        }
    }
    n.trim().to_string()
}

/// Every spelling a name goes by, lower case: itself, without a title in front, and its alias group.
fn name_variants(name: &str) -> Vec<String> {
    static GROUPS: OnceLock<Vec<Vec<String>>> = OnceLock::new();
    let groups = GROUPS.get_or_init(|| {
        let v: Value = serde_json::from_str(ALIASES_JSON).unwrap_or(Value::Null);
        v["groups"]
            .as_array()
            .map(|a| a.iter().map(|g| g.as_array().map(|x| x.iter().filter_map(|s| s.as_str()).map(|s| s.to_lowercase()).collect()).unwrap_or_default()).collect())
            .unwrap_or_default()
    });
    let lower = name.trim().to_lowercase();
    let mut bases = vec![lower.clone()];
    // one person known by two names (the people data has the patriarch as Israel)
    for (a, b) in PERSON_ALIASES {
        if lower == *a {
            bases.push(b.to_string());
        } else if lower == *b {
            bases.push(a.to_string());
        }
    }
    for title in ["king ", "queen ", "prophet ", "apostle ", "saint ", "st. ", "st ", "john the baptist's "] {
        if let Some(rest) = lower.strip_prefix(title) {
            bases.push(rest.trim().to_string());
        }
    }
    let mut out: Vec<String> = Vec::new();
    for b in bases {
        if !out.contains(&b) {
            out.push(b.clone());
        }
        for g in groups.iter().filter(|g| g.contains(&b)) {
            for s in g {
                if !out.contains(s) {
                    out.push(s.clone());
                }
            }
        }
    }
    out
}

struct Person {
    id: String,
    name: String,
    gender: String,
    relations: Value,
    references: i64,
}

impl Person {
    fn list(&self, key: &str) -> Vec<(String, String)> {
        self.relations[key]
            .as_array()
            .map(|a| a.iter().filter_map(|x| Some((x["id"].as_str()?.to_string(), x["name"].as_str()?.to_string()))).collect())
            .unwrap_or_default()
    }
}

fn people_named(conn: &Connection, name: &str) -> Result<Vec<Person>, String> {
    let mut found: Vec<Person> = Vec::new();
    let mut stmt = conn
        .prepare("SELECT id, name, COALESCE(gender, ''), COALESCE(relations_json, ''), reference_count FROM entities WHERE kind = 'person' AND (lower(name) = ?1 OR lower(name) LIKE ?2)")
        .map_err(err)?;
    for variant in name_variants(name) {
        // the data names some people with a note: "Jacob (Israel)", "Joseph (son of Jacob)", "Esau (Edom)"
        let like = format!("{variant} (%");
        let rows = stmt
            .query_map(params![variant, like], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?)))
            .map_err(err)?;
        for row in rows {
            let (id, name, gender, json, references) = row.map_err(err)?;
            if found.iter().any(|p| p.id == id) {
                continue;
            }
            found.push(Person { id, name, gender, relations: serde_json::from_str(&json).unwrap_or(Value::Null), references });
        }
    }
    Ok(found)
}

/// One person by id (so that a parent's other children can be found).
fn person_by_id(conn: &Connection, id: &str) -> Option<Person> {
    conn.query_row(
        "SELECT id, name, COALESCE(gender, ''), COALESCE(relations_json, ''), reference_count FROM entities WHERE kind = 'person' AND id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?)),
    )
    .ok()
    .map(|(id, name, gender, json, references)| Person { id, name, gender, relations: serde_json::from_str(&json).unwrap_or(Value::Null), references })
}

/// Brothers and sisters: the ones the data lists for the person, and the other children of the person's father and mother (the data often
/// lists the children under the parent only).
fn siblings_with_parents(conn: &Connection, person: &Person) -> Vec<(String, String)> {
    let mut out = person.list("siblings");
    for (pid, _) in person.list("father").into_iter().chain(person.list("mother")) {
        if let Some(parent) = person_by_id(conn, &pid) {
            out.extend(parent.list("children"));
        }
    }
    out.retain(|(id, _)| *id != person.id);
    let mut seen = std::collections::HashSet::new();
    out.retain(|(id, _)| seen.insert(id.clone()));
    out
}

fn gender_of(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT COALESCE(gender, '') FROM entities WHERE kind = 'person' AND id = ?1", params![id], |r| r.get(0)).unwrap_or_default()
}

fn join_names(names: &[String]) -> String {
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        n => format!("{} and {}", names[..n - 1].join(", "), names[n - 1]),
    }
}

/// "Book C:V" for the places the person is mentioned together with a relative (all of the relatives, in the order of the Bible),
/// else the first places the person is mentioned; at most three.
fn citations(conn: &Connection, person: &str, relatives: &[String]) -> Vec<AskCitation> {
    type Hit = (i64, i64, i64, String);
    let run = |sql: &str, args: &[&str]| -> Vec<Hit> {
        let Ok(mut st) = conn.prepare(sql) else { return Vec::new() };
        let rows = st.query_map(rusqlite::params_from_iter(args.iter()), |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)));
        rows.map(|rows| rows.flatten().collect()).unwrap_or_default()
    };
    let cite = |hits: Vec<Hit>, role: &str| -> Vec<AskCitation> {
        hits.into_iter().map(|(_, c, v, b)| AskCitation { reference: format!("{b} {c}:{v}"), role: role.to_string() }).collect()
    };
    let mut both: Vec<Hit> = Vec::new();
    for rel in relatives {
        both.extend(run(
            "SELECT a.book_order, a.chapter, a.verse, a.book FROM entity_refs a JOIN entity_refs b ON a.book = b.book AND a.chapter = b.chapter AND a.verse = b.verse
             WHERE a.kind = 'person' AND a.entity_id = ?1 AND b.kind = 'person' AND b.entity_id = ?2 GROUP BY a.book, a.chapter, a.verse",
            &[person, rel],
        ));
    }
    both.sort();
    both.dedup();
    both.truncate(3);
    if !both.is_empty() {
        return cite(both, "where they are mentioned together");
    }
    cite(
        run("SELECT book_order, chapter, verse, book FROM entity_refs WHERE kind = 'person' AND entity_id = ?1 ORDER BY book_order, chapter, verse LIMIT 3", &[person]),
        "where he or she is mentioned",
    )
}

/// "Zacharias is also spelled Zechariah": the other spellings of the names in the answer.
fn spelling_note(names: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for n in names {
        let lower = n.to_lowercase();
        let others: Vec<String> = name_variants(n)
            .into_iter()
            .filter(|v| *v != lower && !PERSON_ALIASES.iter().any(|(a, b)| (lower == *a && v == b) || (lower == *b && v == a)))
            .map(|v| v.split(' ').map(|w| w[..1].to_uppercase() + &w[1..]).collect::<Vec<_>>().join(" "))
            .collect();
        if !others.is_empty() {
            parts.push(format!("{n} is also spelled {}", others.join(" or ")));
        }
    }
    parts.join("; ")
}

/// The answer to a family question, when the people data has it.
pub fn answer(conn: &Connection, query: &str) -> Result<Option<AskCuratedEntry>, String> {
    let Some(rq) = parse_relation_question(query) else { return Ok(None) };
    let mut people = people_named(conn, &rq.name)?;
    if people.is_empty() {
        return Ok(None);
    }
    let key_of = |r: Relation| -> &'static [&'static str] {
        match r {
            Relation::Parents => &["father", "mother"],
            Relation::Father => &["father"],
            Relation::Mother => &["mother"],
            Relation::Spouse => &["partners"],
            Relation::Children | Relation::Sons | Relation::Daughters => &["children"],
            Relation::Siblings | Relation::Brothers | Relation::Sisters => &["siblings", "father", "mother"],
        }
    };
    // of several people with one name, the best known that has this tie in the data
    people.retain(|p| key_of(rq.relation).iter().any(|k| !p.list(k).is_empty()));
    people.sort_by(|a, b| b.references.cmp(&a.references));
    let Some(person) = people.first() else { return Ok(None) };
    let others = people.len() - 1;

    let pronoun = match person.gender.as_str() {
        "Male" => "his",
        "Female" => "her",
        _ => "their",
    };
    let possessive = |n: &str| if n.ends_with('s') { format!("{n}'") } else { format!("{n}'s") };
    let owner = possessive(&person.name);
    let want_gender = match rq.relation {
        Relation::Sons | Relation::Brothers => Some("Male"),
        Relation::Daughters | Relation::Sisters => Some("Female"),
        _ => None,
    };
    let pick = |key: &str| -> Vec<(String, String)> {
        person.list(key).into_iter().filter(|(id, _)| want_gender.map_or(true, |g| gender_of(conn, id) == g)).collect()
    };
    let names = |v: &[(String, String)]| v.iter().map(|(_, n)| n.clone()).collect::<Vec<_>>();

    let mut shown: Vec<String> = vec![person.name.clone()];
    let (text, relatives): (String, Vec<String>) = match rq.relation {
        Relation::Parents | Relation::Father | Relation::Mother => {
            let (f, m) = (person.list("father"), person.list("mother"));
            let f_txt = (!f.is_empty()).then(|| format!("{owner} father was {}", join_names(&names(&f))));
            let m_txt = (!m.is_empty()).then(|| format!("{pronoun} mother was {}", join_names(&names(&m))));
            let mut t = match (rq.relation, f_txt, m_txt) {
                (Relation::Mother, _, Some(m)) => format!("{owner} mother was {}", m.trim_start_matches(&format!("{pronoun} mother was "))),
                (Relation::Mother, _, None) => return Ok(None),
                (Relation::Father, Some(f), _) => f,
                (Relation::Father, None, _) => return Ok(None),
                (_, Some(f), Some(m)) => format!("{f} and {m}"),
                (_, Some(f), None) => format!("{f}; {pronoun} mother is not named in the people data"),
                (_, None, Some(m)) => format!("{owner} father is not named in the people data; {m}"),
                (_, None, None) => return Ok(None),
            };
            t.push('.');
            shown.extend(names(&f));
            shown.extend(names(&m));
            (t, f.iter().chain(m.iter()).map(|(id, _)| id.clone()).collect())
        }
        Relation::Spouse => {
            let p = person.list("partners");
            let n = names(&p);
            let word = match (person.gender.as_str(), n.len()) {
                ("Male", 1) => "wife",
                ("Male", _) => "wives",
                ("Female", 1) => "husband",
                ("Female", _) => "husbands",
                (_, 1) => "spouse",
                _ => "spouses",
            };
            shown.extend(n.clone());
            (format!("{owner} {word} {} {}.", if n.len() == 1 { "was" } else { "were" }, join_names(&n)), p.iter().map(|(id, _)| id.clone()).collect())
        }
        Relation::Children | Relation::Sons | Relation::Daughters | Relation::Siblings | Relation::Brothers | Relation::Sisters => {
            let key = if matches!(rq.relation, Relation::Children | Relation::Sons | Relation::Daughters) { "children" } else { "siblings" };
            let v = if key == "siblings" {
                siblings_with_parents(conn, person).into_iter().filter(|(id, _)| want_gender.map_or(true, |g| gender_of(conn, id) == g)).collect()
            } else {
                pick(key)
            };
            if v.is_empty() {
                return Ok(None);
            }
            let n = names(&v);
            let what = match rq.relation {
                Relation::Children => "children",
                Relation::Sons => "sons",
                Relation::Daughters => "daughters",
                Relation::Siblings => "brothers and sisters",
                Relation::Brothers => "brothers",
                _ => "sisters",
            };
            let list = if n.len() > 24 { format!("{}, and {} more", n[..24].join(", "), n.len() - 24) } else { join_names(&n) };
            shown.extend(n.iter().take(24).cloned());
            let text = if rq.count {
                format!("The people data names {} {what} of {}: {list}.", n.len(), person.name)
            } else {
                format!("The {what} of {} named in the people data ({}): {list}.", person.name, n.len())
            };
            (text, v.iter().take(6).map(|(id, _)| id.clone()).collect())
        }
    };

    let mut note = "From the app's people data (the Theographic Bible data and Easton's Bible Dictionary). The verses listed are where the people are mentioned together; read them to see the tie stated.".to_string();
    if others > 0 {
        note.push_str(&format!(" There are {} other people named {} in the Bible; this is the best known one with this tie recorded.", others, person.name));
    }
    let spelling = spelling_note(&shown);
    if !spelling.is_empty() {
        note.push_str(&format!(" Spelling: {spelling}."));
    }
    Ok(Some(AskCuratedEntry {
        question: query.trim().to_string(),
        confidence: QaConfidence::Computed,
        answer: text,
        citations: citations(conn, &person.id, &relatives),
        note: Some(note),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OpenFlags;

    fn study() -> Connection {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/resources/commentaries.db");
        Connection::open_with_flags(p, OpenFlags::SQLITE_OPEN_READ_ONLY).expect("the bundled people data")
    }

    fn q(s: &str) -> Option<(Relation, String)> {
        parse_relation_question(s).map(|r| (r.relation, r.name))
    }

    #[test]
    fn family_questions_are_recognised() {
        use Relation::*;
        for (question, want) in [
            ("Who were John the Baptist's parents?", (Parents, "John the Baptist")),
            ("who was john the baptist’s parents", (Parents, "john the baptist")),
            ("Who are the parents of Jesus", (Parents, "Jesus")),
            ("john the baptist parents", (Parents, "john the baptist")),
            ("who was the father of David?", (Father, "David")),
            ("Who is Isaac's father", (Father, "Isaac")),
            ("who was the mother of Samuel", (Mother, "Samuel")),
            ("Who was Abraham's wife?", (Spouse, "Abraham")),
            ("who was the husband of Ruth", (Spouse, "Ruth")),
            ("who did Boaz marry", (Spouse, "Boaz")),
            ("who was Hosea married to", (Spouse, "Hosea")),
            ("who were the sons of Jacob", (Sons, "Jacob")),
            ("who were Jacob's children?", (Children, "Jacob")),
            ("how many children did Job have", (Children, "Job")),
            ("how many sons did Jacob have", (Sons, "Jacob")),
            ("how many daughters did Job have", (Daughters, "Job")),
            ("Who were the brothers of Joseph?", (Brothers, "Joseph")),
            ("who was Moses' brother", (Brothers, "Moses")),
            ("who was moses brother", (Brothers, "moses")),
            ("who was the sister of Lazarus", (Sisters, "Lazarus")),
            ("who was Isaac's son", (Sons, "Isaac")),
            ("who were Moses' siblings", (Siblings, "Moses")),
        ] {
            assert_eq!(q(question), Some((want.0, want.1.to_string())), "{question}");
        }
        for not in ["who was Jesus", "what is faith", "how many sons did Jacob have in Egypt and why", "who wrote Romans", "where was Jesus born", "honor your father and mother", ""] {
            assert_eq!(q(not), None, "{not}");
        }
    }

    #[test]
    fn names_are_spelled_either_way() {
        let v = name_variants("Elizabeth");
        assert!(v.contains(&"elizabeth".to_string()) && v.contains(&"elisabeth".to_string()), "{v:?}");
        let v = name_variants("King David");
        assert!(v.contains(&"david".to_string()), "{v:?}");
        let v = name_variants("Cainan");
        assert!(v.contains(&"kenan".to_string()), "{v:?}");
        assert_eq!(name_variants("Mary"), vec!["mary".to_string()]);
    }

    #[test]
    fn john_the_baptists_parents_come_from_the_people_data() {
        let conn = study();
        for question in ["Who were John the Baptist's parents?", "who were the parents of John the Baptist", "John the Baptist parents"] {
            let a = answer(&conn, question).unwrap().unwrap_or_else(|| panic!("an answer to {question}"));
            assert!(a.answer.contains("Zacharias") && a.answer.contains("Elisabeth"), "{}", a.answer);
            assert!(a.confidence == QaConfidence::Computed);
            assert!(a.citations.iter().any(|c| c.reference.starts_with("Luke 1:")), "{:?}", a.citations.iter().map(|c| &c.reference).collect::<Vec<_>>());
        }
        let a = answer(&conn, "who was Elizabeth's husband").unwrap().unwrap();
        assert!(a.answer.contains("Zacharias"), "{}", a.answer);
        // the BSB spelling finds the same person
        let a = answer(&conn, "Who was Zechariah's wife?").unwrap().unwrap();
        assert!(a.answer.contains("Elisabeth"), "{}", a.answer);
    }

    /// The questions of the test bench, answered from the real data: `cargo test --lib people_bench -- --nocapture`.
    #[test]
    fn people_bench() {
        let conn = study();
        let mut got = 0;
        let bench = [
            ("who were the parents of John the Baptist", "Zacharias"),
            ("who was the father of John the Baptist", "Zacharias"),
            ("who was the mother of John the Baptist", "Elisabeth"),
            ("who were the sons of Jacob", "Reuben"),
            ("who were the sons of Jacob", "Benjamin"),
            ("who was the father of Isaac", "Abraham"),
            ("who was the mother of Isaac", "Sarah"),
            ("who was the father of Solomon", "David"),
            ("who was Samuel's mother", "Hannah"),
            ("who were the brothers of Moses", "Aaron"),
            ("who was Moses' father", "Amram"),
        ];
        for (question, expect) in bench {
            match answer(&conn, question).unwrap() {
                Some(a) if a.answer.contains(expect) => got += 1,
                Some(a) => println!("  WRONG  {question}: {}", a.answer),
                None => println!("  NONE   {question}"),
            }
        }
        println!("people bench: {got} of {} answered with {:?}", bench.len(), "the expected name");
        assert!(got >= 8, "only {got} of {}", bench.len());
    }
}
