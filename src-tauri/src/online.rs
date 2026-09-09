use regex::Regex;
use serde::Deserialize;

/// Where a live-only translation is fetched from. Every provider here serves copyrighted
/// text under the user's own key: results are displayed on demand and never written back
/// into bible.db (the licences do not permit bulk offline caching).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// api.scripture.api.bible -- `bible_id` is the platform's id for the translation.
    ApiBible { bible_id: &'static str },
    /// api.esv.org (Crossway). ESV is not offered on api.bible, so it has its own provider.
    Esv,
}

pub struct OnlineVersion {
    pub code: &'static str,
    pub name: &'static str,
    pub provider: Provider,
}

pub const ONLINE_VERSIONS: &[OnlineVersion] = &[
    OnlineVersion { code: "NIV", name: "New International Version", provider: Provider::ApiBible { bible_id: "78a9f6124f344018-01" } },
    OnlineVersion { code: "NKJV", name: "New King James Version", provider: Provider::ApiBible { bible_id: "63097d2a0a2f7db3-01" } },
    OnlineVersion { code: "ESV", name: "English Standard Version", provider: Provider::Esv },
];

pub fn provider_label(p: Provider) -> &'static str {
    match p {
        Provider::ApiBible { .. } => "api.bible",
        Provider::Esv => "api.esv.org",
    }
}

// ---------- api.bible ----------

#[derive(Deserialize)]
struct SearchResponse {
    data: SearchData,
}

#[derive(Deserialize)]
struct SearchData {
    passages: Vec<Passage>,
}

#[derive(Deserialize)]
struct Passage {
    content: String,
    copyright: Option<String>,
}

fn strip_html(input: &str) -> String {
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    let ws_re = Regex::new(r"\s+").unwrap();
    let no_tags = tag_re.replace_all(input, " ");
    ws_re.replace_all(&no_tags, " ").trim().to_string()
}

/// Fetches one reference (e.g. "John 3:16") from api.bible using the user's own key.
pub async fn fetch_api_bible(api_key: &str, bible_id: &str, reference: &str) -> Result<(String, String), String> {
    let url = format!("https://api.scripture.api.bible/v1/bibles/{bible_id}/search");
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("api-key", api_key)
        .query(&[("query", reference)])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("api.bible returned {status} (check your API key in Settings)"));
    }

    let parsed: SearchResponse = resp.json().await.map_err(|e| format!("unexpected response: {e}"))?;
    let passage = parsed
        .data
        .passages
        .into_iter()
        .next()
        .ok_or_else(|| format!("no passage found for {reference}"))?;

    Ok((strip_html(&passage.content), passage.copyright.unwrap_or_default()))
}

// ---------- ESV (Crossway) ----------

#[derive(Deserialize)]
struct EsvResponse {
    passages: Vec<String>,
}

const ESV_COPYRIGHT: &str = "Scripture quotations marked (ESV) are from the ESV® Bible (The Holy Bible, English Standard \
Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.";

/// Fetches one reference as plain text from api.esv.org. Crossway's terms require the
/// "(ESV)" marker or the full notice alongside quoted text, so the short marker is kept in
/// the passage and the full notice is returned as the copyright line.
pub async fn fetch_esv(api_key: &str, reference: &str) -> Result<(String, String), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.esv.org/v3/passage/text/")
        .header("Authorization", format!("Token {api_key}"))
        .query(&[
            ("q", reference),
            ("include-headings", "false"),
            ("include-footnotes", "false"),
            ("include-footnote-body", "false"),
            ("include-verse-numbers", "false"),
            ("include-passage-references", "false"),
            ("include-first-verse-numbers", "false"),
            ("include-short-copyright", "true"),
            ("indent-poetry", "false"),
        ])
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("api.esv.org returned {status} (check your ESV API key in Settings)"));
    }

    let parsed: EsvResponse = resp.json().await.map_err(|e| format!("unexpected response: {e}"))?;
    let passage = parsed.passages.into_iter().next().ok_or_else(|| format!("no passage found for {reference}"))?;
    let ws_re = Regex::new(r"\s+").unwrap();
    Ok((ws_re.replace_all(&passage, " ").trim().to_string(), ESV_COPYRIGHT.to_string()))
}
