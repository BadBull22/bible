//! Browse review mode (the development app only): the owner marks each Browse page Good, Change or Remove and may leave a comment.
//! The marks are one JSON file in Documents\Bible Concordance\Browse review\browse-review.json, so that they can be read back.
//! The shipped app has no review mode: both commands refuse to do anything unless this is a development build.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn review_file(app: &AppHandle) -> Result<PathBuf, String> {
    if !cfg!(debug_assertions) {
        return Err("The review mode is only in the development app.".to_string());
    }
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance").join("Browse review");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("browse-review.json"))
}

/// The saved marks as text, or an empty string when none have been saved yet.
#[tauri::command]
pub fn browse_review_load(app: AppHandle) -> Result<String, String> {
    let file = review_file(&app)?;
    match fs::read_to_string(&file) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Saves the marks (JSON text). Written to a temporary file first so that a crash cannot leave half a file.
#[tauri::command]
pub fn browse_review_save(app: AppHandle, text: String) -> Result<(), String> {
    // this file only ever holds the marks: refuse anything that is not JSON
    serde_json::from_str::<serde_json::Value>(&text).map_err(|e| format!("The marks are not valid JSON: {e}"))?;
    let file = review_file(&app)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}
