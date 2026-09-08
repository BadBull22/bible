use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

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
}

/// Hand-curated, source-cited genealogy data (see resources/genealogies.json) --
/// deliberately not inferred at runtime, since ancestry claims need to be exactly
/// verifiable against a cited verse, not guessed by a search algorithm.
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
            chain.push(LineagePerson {
                id: p.id.clone(),
                name: p.name.clone(),
                alt_names: p.alt_names.clone(),
                citation: p.citation.clone(),
                note: p.note.clone(),
            });
            current = p.father.as_ref().and_then(|f| self.people.get(f));
            guard += 1;
            if guard > 200 {
                break; // safety net against a malformed cyclic dataset
            }
        }
        chain
    }
}
