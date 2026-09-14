use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Corrects a Theographic record that contradicts the verse this person is cited from.
/// A `None` year means "genuinely uncertain" -- the Timeline marks it with Adams' own
/// `?` convention rather than showing an invented date.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DateOverride {
    pub birth_year: Option<i64>,
    pub death_year: Option<i64>,
    pub reason: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RawPerson {
    id: String,
    name: String,
    #[serde(default)]
    alt_names: Vec<String>,
    father: Option<String>,
    citation: String,
    #[serde(default)]
    note: Option<String>,
    /// Link into the bundled Theographic dataset (commentaries.db `entities`), curated
    /// rather than name-matched -- see the `_readme` in genealogies.json for why.
    #[serde(default)]
    theographic_id: Option<String>,
    #[serde(default)]
    age_at_heir_birth: Option<i64>,
    #[serde(default)]
    age_citation: Option<String>,
    #[serde(default)]
    lifespan: Option<i64>,
    #[serde(default)]
    lifespan_citation: Option<String>,
    #[serde(default)]
    chain_note: Option<String>,
    #[serde(default)]
    date_override: Option<DateOverride>,
}

#[derive(Deserialize)]
struct RawFile {
    people: Vec<RawPerson>,
}

#[derive(Serialize, Clone)]
pub struct PersonSummary {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct LineagePerson {
    pub id: String,
    pub name: String,
    pub alt_names: Vec<String>,
    pub citation: String,
    pub note: Option<String>,
    pub theographic_id: Option<String>,
    /// The father's age when this line's heir was born (Genesis 5 / 11) -- the number
    /// Adams' chart prints beneath its time axis.
    pub age_at_heir_birth: Option<i64>,
    pub age_citation: Option<String>,
    /// Total years lived, where scripture states it. Preferred over the dataset's
    /// birth/death arithmetic when drawing a ribbon, since it is the cited figure.
    pub lifespan: Option<i64>,
    pub lifespan_citation: Option<String>,
    pub chain_note: Option<String>,
    pub date_override: Option<DateOverride>,
}

/// Hand-curated, source-cited genealogy data (see resources/genealogies.json) --
/// deliberately not inferred at runtime, since ancestry claims need to be exactly
/// verifiable against a cited verse, not guessed by a search algorithm. The same
/// reasoning applies to `theographic_id`: matching these names against the Theographic
/// dataset automatically picks the wrong person a dozen times over (two Enochs, two
/// Lamechs, a Noah who is Zelophehad's daughter, ten Josephs), and in several cases the
/// wrong one carries more references than the right one.
pub struct GenealogyData {
    people: HashMap<String, RawPerson>,
}

impl GenealogyData {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)?;
        let raw: RawFile = serde_json::from_str(&contents)?;
        let people = raw.people.into_iter().map(|p| (p.id.clone(), p)).collect();
        Ok(Self { people })
    }

    pub fn list_people(&self) -> Vec<PersonSummary> {
        let mut out: Vec<PersonSummary> =
            self.people.values().map(|p| PersonSummary { id: p.id.clone(), name: p.name.clone() }).collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// Ancestor chain starting at `person_id` and walking up through `father` links to
    /// the root (e.g. Adam), in descendant-to-ancestor order.
    pub fn ancestors_of(&self, person_id: &str) -> Vec<LineagePerson> {
        let mut chain = Vec::new();
        let mut current = self.people.get(person_id);
        let mut guard = 0;
        while let Some(p) = current {
            chain.push(to_lineage(p));
            current = p.father.as_ref().and_then(|f| self.people.get(f));
            guard += 1;
            if guard > 200 {
                break; // safety net against a malformed cyclic dataset
            }
        }
        chain
    }

    /// Every curated person, oldest first, for the Timeline's lifespan ribbons. Unlike
    /// `ancestors_of` this doesn't walk a single line -- the Timeline plots the whole
    /// curated set against the time axis at once.
    pub fn all_people(&self) -> Vec<LineagePerson> {
        let mut roots: Vec<&RawPerson> = self.people.values().filter(|p| p.father.is_none()).collect();
        roots.sort_by(|a, b| a.id.cmp(&b.id));
        let mut out = Vec::new();
        for root in roots {
            self.push_descendants(root, &mut out, 0);
        }
        out
    }

    /// Depth-first walk from a root down through the `father` links, so the output is in
    /// generation order (Adam first) without needing dates -- the undated stretches of
    /// Matthew 1 still land in the right place in the list.
    fn push_descendants(&self, person: &RawPerson, out: &mut Vec<LineagePerson>, depth: usize) {
        if depth > 200 {
            return; // same cyclic-data guard as ancestors_of
        }
        out.push(to_lineage(person));
        let mut children: Vec<&RawPerson> =
            self.people.values().filter(|c| c.father.as_deref() == Some(person.id.as_str())).collect();
        children.sort_by(|a, b| a.id.cmp(&b.id));
        for child in children {
            self.push_descendants(child, out, depth + 1);
        }
    }
}

fn to_lineage(p: &RawPerson) -> LineagePerson {
    LineagePerson {
        id: p.id.clone(),
        name: p.name.clone(),
        alt_names: p.alt_names.clone(),
        citation: p.citation.clone(),
        note: p.note.clone(),
        theographic_id: p.theographic_id.clone(),
        age_at_heir_birth: p.age_at_heir_birth,
        age_citation: p.age_citation.clone(),
        lifespan: p.lifespan,
        lifespan_citation: p.lifespan_citation.clone(),
        chain_note: p.chain_note.clone(),
        date_override: p.date_override.clone(),
    }
}
