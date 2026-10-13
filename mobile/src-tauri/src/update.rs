//! Looking for a newer version of the app (since 0.3.1), and fetching it.
//!
//! The app is not on the Play Store, so nothing updates it. Instead the website carries a
//! small file saying which version is the newest, where its APK is, and the SHA-256 that
//! file must have. The app reads it (at most once a day, when it is opened, and only if the
//! reader has left this on), and when a newer version is offered it can download the APK
//! and hand it to Android's installer -- which asks the reader, and only installs a file
//! signed with the same key as the app itself.
//!
//! Nothing about the reader or the phone is sent: this is a plain request for a public file.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The file on the website that names the newest version (docs/android/latest.json).
pub const FEED: &str = "https://bible4me.org/android/latest.json";
/// An APK is only ever fetched from the app's own releases.
const RELEASES: &str = "https://github.com/BadBull22/bible/releases/download/";
/// Nothing bigger than this is an update (the APK is about 70 MB).
const LARGEST: u64 = 250 << 20;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Offer {
    pub version: String,
    pub url: String,
    pub sha256: String,
    /// bytes, for the button ("70 MB")
    #[serde(default)]
    pub size: u64,
    /// a line or two on what is new
    #[serde(default)]
    pub notes: String,
}

fn numbers(version: &str) -> Option<Vec<u64>> {
    let parts: Option<Vec<u64>> = version.trim().split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| !p.is_empty() && p.len() <= 4)
}

/// Whether `offered` is a later version than `current` ("0.3.10" is later than "0.3.9").
pub fn newer(offered: &str, current: &str) -> bool {
    match (numbers(offered), numbers(current)) {
        (Some(a), Some(b)) => {
            let n = a.len().max(b.len());
            let pad = |v: Vec<u64>| (0..n).map(|i| v.get(i).copied().unwrap_or(0)).collect::<Vec<_>>();
            pad(a) > pad(b)
        }
        _ => false,
    }
}

/// Reads the website's file, refusing anything that isn't what it should be.
pub fn parse(text: &str) -> Result<Offer, String> {
    let offer: Offer = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "The update information couldn't be read.".to_string())?;
    let hex = offer.sha256.len() == 64 && offer.sha256.chars().all(|c| c.is_ascii_hexdigit());
    let ours = offer.url.starts_with(RELEASES) && offer.url.ends_with(".apk") && !offer.url.contains("..") && !offer.url.contains(['?', '#', ' ']);
    if numbers(&offer.version).is_none() || !hex || !ours || offer.size > LARGEST {
        return Err("The update information couldn't be read.".into());
    }
    Ok(Offer { sha256: offer.sha256.to_lowercase(), notes: offer.notes.chars().take(400).collect(), ..offer })
}

fn agent(seconds: u64) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(seconds)).user_agent(concat!("BibleConcordance-Android/", env!("CARGO_PKG_VERSION"), " (https://bible4me.org)")).build()
}

/// The version on offer, if it is newer than `current`.
pub fn check(current: &str) -> Result<Option<Offer>, String> {
    let text = agent(20)
        .get(FEED)
        .call()
        .map_err(|_| "Couldn't check for a new version. Check the phone's internet connection.".to_string())?
        .into_string()
        .map_err(|_| "The update information couldn't be read.".to_string())?;
    let offer = parse(&text)?;
    Ok(newer(&offer.version, current).then_some(offer))
}

fn file_name(offer: &Offer) -> String {
    format!("BibleConcordance_{}.apk", offer.version)
}

fn sha256_of(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hash = Sha256::new();
    let mut chunk = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        hash.update(&chunk[..n]);
    }
    Some(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Removes downloaded updates (all of them, or all but `keep`): they are only needed until
/// Android has installed them.
pub fn clear(dir: &Path, keep: Option<&str>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if keep != Some(entry.file_name().to_string_lossy().as_ref()) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// Downloads the APK on offer into `dir` and returns its path. The file is kept only if it
/// is exactly the one the website described; `progress` is told the percentage downloaded.
/// A copy already there (downloaded, then the installer was cancelled) is used again.
pub fn download(offer: &Offer, dir: &Path, progress: &dyn Fn(u8)) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let name = file_name(offer);
    let path = dir.join(&name);
    clear(dir, Some(&name));
    if sha256_of(&path).as_deref() == Some(offer.sha256.as_str()) {
        progress(100);
        return Ok(path);
    }
    let stopped = || "The download stopped before it was finished. Please try again.".to_string();
    let response = agent(900).get(&offer.url).call().map_err(|_| "Couldn't download the new version. Check the phone's internet connection and try again.".to_string())?;
    let total: u64 = response.header("Content-Length").and_then(|v| v.parse().ok()).filter(|&t| t > 0).unwrap_or(offer.size);
    let part = dir.join(format!("{name}.part"));
    let mut out = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut reader = response.into_reader().take(LARGEST + 1);
    let mut hash = Sha256::new();
    let mut chunk = vec![0u8; 256 * 1024];
    let (mut done, mut last) = (0u64, 0u8);
    loop {
        let n = reader.read(&mut chunk).map_err(|_| stopped())?;
        if n == 0 {
            break;
        }
        hash.update(&chunk[..n]);
        out.write_all(&chunk[..n]).map_err(|_| "There isn't enough room on the phone for the new version.".to_string())?;
        done += n as u64;
        if total > 0 {
            let pct = ((done * 100) / total).min(99) as u8;
            if pct != last {
                last = pct;
                progress(pct);
            }
        }
    }
    out.sync_all().map_err(|_| stopped())?;
    drop(out);
    let sum: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if done > LARGEST || sum != offer.sha256 {
        let _ = fs::remove_file(&part);
        return Err("The download didn't arrive whole, so it was not kept. Please try again.".into());
    }
    fs::rename(&part, &path).map_err(|e| e.to_string())?;
    progress(100);
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_in_order() {
        assert!(newer("0.3.1", "0.3.0"));
        assert!(newer("0.3.10", "0.3.9"), "by number, not by letter");
        assert!(newer("0.4", "0.3.9") && newer("1.0.0", "0.9.9"));
        assert!(!newer("0.3.0", "0.3.0") && !newer("0.3", "0.3.0") && !newer("0.2.9", "0.3.0"));
        assert!(!newer("latest", "0.3.0") && !newer("", "0.3.0") && !newer("0.3.1-beta", "0.3.0"), "anything odd is not an update");
    }

    #[test]
    fn only_a_proper_offer_is_believed() {
        let sum = "95145d415e09be07f54f682d4a2bcbf4b4b71c2b805500196968a59bf0cae18d";
        let good = format!(r#"{{"version":"0.3.1","url":"{RELEASES}android-v0.3.1/BibleConcordance_Android_0.3.1.apk","sha256":"{}","size":72000000,"notes":"New."}}"#, sum.to_uppercase());
        let offer = parse(&good).unwrap();
        assert_eq!((offer.version.as_str(), offer.sha256.as_str(), offer.size), ("0.3.1", sum, 72_000_000));
        assert_eq!(file_name(&offer), "BibleConcordance_0.3.1.apk");
        // without the optional parts
        parse(&format!(r#"{{"version":"0.4","url":"{RELEASES}android-v0.4/a.apk","sha256":"{sum}"}}"#)).unwrap();
        for bad in [
            "not json".to_string(),
            good.replace(RELEASES, "https://example.com/"),
            good.replace(RELEASES, "http://github.com/BadBull22/bible/releases/download/"),
            good.replace(".apk", ".exe"),
            good.replace("android-v0.3.1/", "../../../other/repo/"),
            good.replace(&sum.to_uppercase(), "abc123"),
            good.replace("\"0.3.1\"", "\"../0.3.1\""),
            good.replace("72000000", "9999999999"),
        ] {
            assert!(parse(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_copy_already_downloaded_is_used_again() {
        let dir = std::env::temp_dir().join(format!("bible-update-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let body = b"pretend this is an APK";
        let sum: String = Sha256::digest(body).iter().map(|b| format!("{b:02x}")).collect();
        // (the address answers nothing: if the copy were not used, this would fail)
        let offer = Offer { version: "9.9.9".into(), url: format!("{RELEASES}none/none.apk"), sha256: sum, size: 0, notes: String::new() };
        fs::write(dir.join(file_name(&offer)), body).unwrap();
        fs::write(dir.join("BibleConcordance_0.0.1.apk"), b"an older download").unwrap();
        let path = download(&offer, &dir, &|_| {}).unwrap();
        assert_eq!(fs::read(&path).unwrap(), body);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "older downloads are cleared away");
        clear(&dir, None);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
