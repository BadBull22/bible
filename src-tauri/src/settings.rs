use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// User-entered settings, persisted as plain JSON in the app's own local config
/// directory -- never in source control, never bundled into the app itself. A key
/// entered here belongs to the user's own api.bible account; the app never ships with
/// one baked in, since anything compiled into a distributed binary can be extracted.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub api_bible_key: Option<String>,
    /// Crossway ESV API key (api.esv.org) -- separate provider, separate key.
    #[serde(default)]
    pub esv_api_key: Option<String>,
}

fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load(config_dir: &Path) -> AppSettings {
    let path = settings_path(config_dir);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

pub fn save(config_dir: &Path, settings: &AppSettings) -> std::io::Result<()> {
    fs::create_dir_all(config_dir)?;
    let path = settings_path(config_dir);
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    fs::write(path, json)
}
