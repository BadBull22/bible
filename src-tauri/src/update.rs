//! In-app updates (tauri-plugin-updater): checks the `latest.json` published with each
//! GitHub release, and installs a newer version after checking its signature against the
//! public key in tauri.conf.json -- so only installers signed with the project's private
//! key (kept off the repository) are ever run. Checks only happen when the reader asks or,
//! if they leave "check automatically" on in Settings, about once a day; offline, the
//! check just fails quietly.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, waiting for the reader to install it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// Release notes, if the release has any.
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| format!("Couldn't check for updates ({e})."))?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.date.map(|d| d.date().to_string()),
    });
    *pending.0.lock().map_err(|e| e.to_string())? = found;
    Ok(info)
}

#[derive(Serialize, Clone)]
struct Progress {
    /// "downloading" | "installing"
    stage: &'static str,
    done: u64,
    total: Option<u64>,
}

/// Downloads and installs the update found by `update_check`, then restarts the app
/// (on Windows the installer closes the app itself and starts the new version).
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|e| e.to_string())?.take().ok_or("Check for updates first.")?;
    crate::logging::write("info", "update", &format!("installing {} (from {})", update.version, update.current_version));
    let (on_chunk, on_done) = (app.clone(), app.clone());
    let (mut done, mut last_pct) = (0u64, u64::MAX);
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let pct = total.map(|t| done * 100 / t.max(1)).unwrap_or(done >> 20);
                if pct != last_pct {
                    last_pct = pct;
                    let _ = on_chunk.emit("update-progress", Progress { stage: "downloading", done, total });
                }
            },
            move || {
                let _ = on_done.emit("update-progress", Progress { stage: "installing", done: 0, total: None });
                // the installer replaces files the voice may have open
                crate::voice::shutdown(&on_done);
            },
        )
        .await
        .map_err(|e| format!("The update couldn't be installed ({e})."))?;
    app.restart();
}
