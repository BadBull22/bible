// Looking up the words of a song online, for the song library: a search by title (and who sang it), then the words of
// the one chosen. They come from lyrics.ovh, a free service that needs no key. The words are copyrighted by their
// writers: they are fetched on request into the song editor, to be checked and kept by the church, which shows them
// under its own licence (CCLI). Nothing is fetched until the preacher asks.

use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const SERVICE: &str = "https://api.lyrics.ovh";
const MAX_WORDS: usize = 20_000;

#[derive(Serialize, Debug, PartialEq)]
pub struct LyricHit {
    pub title: String,
    pub artist: String,
}

#[derive(Deserialize)]
struct Suggest {
    #[serde(default)]
    data: Vec<Found>,
}

#[derive(Deserialize)]
struct Found {
    title: String,
    artist: Artist,
}

#[derive(Deserialize)]
struct Artist {
    name: String,
}

#[derive(Deserialize)]
struct Words {
    #[serde(default)]
    lyrics: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(25)).user_agent("BibleConcordance").build().map_err(|e| e.to_string())
}

/// `base/<first>/<second>` with each part encoded as one path segment (a "/" or "?" in a title stays in it).
fn url(parts: &[&str]) -> Result<Url, String> {
    let mut u = Url::parse(SERVICE).map_err(|e| e.to_string())?;
    u.path_segments_mut().map_err(|_| "bad address".to_string())?.extend(parts);
    Ok(u)
}

/// The songs found for what was typed (a title, perhaps with the artist), without repeats.
fn hits(found: Vec<Found>) -> Vec<LyricHit> {
    let mut out: Vec<LyricHit> = Vec::new();
    for f in found {
        let h = LyricHit { title: f.title.trim().to_string(), artist: f.artist.name.trim().to_string() };
        if h.title.is_empty() || out.iter().any(|o| o.title.eq_ignore_ascii_case(&h.title) && o.artist.eq_ignore_ascii_case(&h.artist)) {
            continue;
        }
        out.push(h);
        if out.len() >= 12 {
            break;
        }
    }
    out
}

/// The words as plain lines: the service's own heading line ("Paroles de la chanson ...") and odd line ends removed.
fn tidy(words: &str) -> String {
    let text = words.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.first().map(|l| l.trim_start().to_lowercase().starts_with("paroles de la chanson")).unwrap_or(false) {
        lines.remove(0);
    }
    let joined = lines.join("\n");
    let mut out = String::new();
    let mut blank = 0;
    for l in joined.trim().lines() {
        if l.trim().is_empty() {
            blank += 1;
            if blank == 1 {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(l.trim_end());
            out.push('\n');
        }
    }
    out.trim_end().chars().take(MAX_WORDS).collect()
}

#[tauri::command]
pub async fn lyrics_search(query: String) -> Result<Vec<LyricHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let resp = client()?.get(url(&["suggest", q])?).send().await.map_err(|e| format!("couldn't reach the lyrics service (is the internet on?): {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("the lyrics service answered {}", resp.status()));
    }
    let found: Suggest = resp.json().await.map_err(|e| format!("unexpected answer from the lyrics service: {e}"))?;
    Ok(hits(found.data))
}

#[tauri::command]
pub async fn lyrics_get(artist: String, title: String) -> Result<String, String> {
    let resp = client()?.get(url(&["v1", artist.trim(), title.trim()])?).send().await.map_err(|e| format!("couldn't reach the lyrics service (is the internet on?): {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("The service has no words for that one. Try another version of the song in the list, or paste them in.".into());
    }
    if !resp.status().is_success() {
        return Err(format!("the lyrics service answered {}", resp.status()));
    }
    let w: Words = resp.json().await.map_err(|e| format!("unexpected answer from the lyrics service: {e}"))?;
    let words = tidy(&w.lyrics);
    if words.is_empty() {
        return Err("The service had no words for that one. Try another version in the list, or paste them in.".into());
    }
    Ok(words)
}

// ---- the chart: which worship songs are being sung now (names and artists only; no words)

const CHART_API: &str = "https://www.praisecharts.com/api/v3/elastic/song-list/top-100-worship-songs-of-";

#[derive(Serialize, Debug, PartialEq)]
pub struct ChartSong {
    pub title: String,
    pub artists: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Chart {
    /// the year of the list that was found
    pub year: i32,
    /// when PraiseCharts last changed it ("2026-10-25 21:31:43")
    pub updated: String,
    pub songs: Vec<ChartSong>,
}

/// The songs of the chart's answer, in order: the title and the artists, nothing else is read.
fn chart_songs(body: &str) -> Result<(String, Vec<ChartSong>), String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("unexpected answer from the chart: {e}"))?;
    let updated = v["song_list"]["updated_at"].as_str().unwrap_or("").to_string();
    let list = v["songs"].as_array().ok_or("the chart's answer has no songs in it")?;
    let songs: Vec<ChartSong> = list
        .iter()
        .filter_map(|s| {
            let title = s["title"].as_str()?.trim().to_string();
            if title.is_empty() {
                return None;
            }
            let artists = s["details"]["item"]["artists"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x["name"].as_str()).map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).collect())
                .unwrap_or_default();
            Some(ChartSong { title, artists })
        })
        .collect();
    if songs.is_empty() {
        return Err("the chart's answer had no songs in it".into());
    }
    Ok((updated, songs))
}

/// The Top 100 worship songs of this year on PraiseCharts (of last year, early in the year before there is a new list),
/// for the song library's "Update the list". Only the page's own list is read, once, when asked.
#[tauri::command]
pub async fn chart_top_songs(year: i32) -> Result<Chart, String> {
    let mut last_error = String::new();
    for y in [year, year - 1] {
        let resp = match client()?.get(format!("{CHART_API}{y}")).header("Accept", "application/json").send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("couldn't reach the chart (is the internet on?): {e}")),
        };
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            last_error = format!("there is no Top 100 list for {y} yet");
            continue;
        }
        if !resp.status().is_success() {
            return Err(format!("the chart answered {}", resp.status()));
        }
        let body = resp.text().await.map_err(|e| e.to_string())?;
        let (updated, songs) = chart_songs(&body)?;
        return Ok(Chart { year: y, updated, songs });
    }
    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_stays_in_its_place_in_the_address() {
        assert_eq!(url(&["v1", "Bethel Music", "Raise a Hallelujah"]).unwrap().as_str(), "https://api.lyrics.ovh/v1/Bethel%20Music/Raise%20a%20Hallelujah");
        let tricky = url(&["v1", "AC/DC", "Why? Not #1"]).unwrap();
        assert_eq!(tricky.path(), "/v1/AC%2FDC/Why%3F%20Not%20%231", "a slash, a question mark and a hash stay inside their part");
        assert_eq!(tricky.query(), None);
    }

    #[test]
    fn the_same_song_twice_is_one_hit() {
        let f = |t: &str, a: &str| Found { title: t.into(), artist: Artist { name: a.into() } };
        let got = hits(vec![f("Raise a Hallelujah", "Bethel Music"), f("raise a hallelujah ", "bethel music"), f("Raise a Hallelujah", "Anthony Evans"), f("", "Nobody")]);
        assert_eq!(got, vec![LyricHit { title: "Raise a Hallelujah".into(), artist: "Bethel Music".into() }, LyricHit { title: "Raise a Hallelujah".into(), artist: "Anthony Evans".into() }]);
    }

    #[test]
    fn the_words_come_back_as_clean_blocks() {
        let got = tidy("Paroles de la chanson X par Y\r\nOh I sing  \r\nLouder\r\n\r\n\r\n\r\nChorus line\r\n");
        assert_eq!(got, "Oh I sing\nLouder\n\nChorus line");
        assert_eq!(tidy("   \n\n"), "");
    }

    #[test]
    fn the_chart_gives_titles_and_artists_only() {
        let body = r#"{"song_list":{"updated_at":"2026-10-25 21:31:43"},"songs":[
            {"title":"First Song","details":{"item":{"artists":[{"name":"Band A"},{"name":" Singer B "}],"keys":"C, D"}}},
            {"title":"","details":{}},
            {"title":"Second Song","details":{"item":{"artists":[]}}},
            {"title":"No Details"}]}"#;
        let (updated, songs) = chart_songs(body).unwrap();
        assert_eq!(updated, "2026-10-25 21:31:43");
        assert_eq!(
            songs,
            vec![
                ChartSong { title: "First Song".into(), artists: vec!["Band A".into(), "Singer B".into()] },
                ChartSong { title: "Second Song".into(), artists: vec![] },
                ChartSong { title: "No Details".into(), artists: vec![] },
            ]
        );
        assert!(chart_songs("{\"songs\":[]}").is_err());
        assert!(chart_songs("not json").is_err());
    }
}
