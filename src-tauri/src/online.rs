use regex::Regex;
use serde::Deserialize;

/// api.bible bible IDs for the copyrighted translations available under the user's own
/// key. Verified against the live catalog: this key's plan does not include ESV
/// (Crossway licenses that separately), only NIV and NKJV.
pub const ONLINE_VERSIONS: &[(&str, &str, &str)] = &[
    ("NIV", "78a9f6124f344018-01", "New International Version"),
    ("NKJV", "63097d2a0a2f7db3-01", "New King James Version"),
];

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
/// This is a live, on-demand fetch -- the result is never written back into bible.db,
/// since api.bible's licensing for copyrighted texts like NIV/NKJV does not permit
/// bulk offline caching, only real-time display.
pub async fn fetch_verse(api_key: &str, bible_id: &str, reference: &str) -> Result<(String, String), String> {
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
