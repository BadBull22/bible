//! What the Bible app needs from the phone itself, which a web page inside an Android app
//! cannot do: open the share sheet (with text or a picture), speak with the phone's voice
//! (choosing among its voices), and save or open a file where the reader chooses. The work is done in Kotlin (`android/`); these commands pass
//! it on. On a computer (where the app runs only to be tried out) they say so instead.

use serde_json::{json, Value};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

struct Phone<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _runtime: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> Phone<R> {
    #[cfg(target_os = "android")]
    fn run(&self, command: &str, payload: Value) -> Result<Value, String> {
        self.handle.run_mobile_plugin::<Value>(command, payload).map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "android"))]
    fn run(&self, _command: &str, _payload: Value) -> Result<Value, String> {
        Err("This only works on a phone.".into())
    }
}

/// Opens the phone's share sheet with some text.
#[tauri::command(async)]
fn share<R: Runtime>(app: AppHandle<R>, text: String, title: Option<String>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("share", json!({ "text": text, "title": title }))
}

/// Speaks with the phone's voice and returns when it has finished ({ finished: true }) or
/// was stopped ({ finished: false }). `voice` is one of `voices`' names (None: the default).
#[tauri::command(async)]
fn speak<R: Runtime>(app: AppHandle<R>, text: String, rate: Option<f32>, voice: Option<String>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("speak", json!({ "text": text, "rate": rate.unwrap_or(1.0), "voice": voice }))
}

/// The phone's English voices: { voices: [{ name, label, local }] }.
#[tauri::command(async)]
fn voices<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("voices", json!({}))
}

/// Opens the share sheet with a PNG picture (base64).
#[tauri::command(async)]
fn share_image<R: Runtime>(app: AppHandle<R>, name: String, base64: String, text: Option<String>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("shareImage", json!({ "name": name, "base64": base64, "text": text }))
}

/// Asks where to save a PNG picture (base64) and writes it there ({ saved: false } if cancelled).
#[tauri::command(async)]
fn save_image<R: Runtime>(app: AppHandle<R>, name: String, base64: String) -> Result<Value, String> {
    app.state::<Phone<R>>().run("saveImage", json!({ "name": name, "base64": base64 }))
}

/// Hands a downloaded update (an APK in the app's cache, see the app's `update.rs`) to
/// Android's installer, which asks the reader. { started: true }, or { allow: true } when
/// the reader must first let this app install apps (their settings are opened for it).
#[tauri::command(async)]
fn install_update<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Value, String> {
    app.state::<Phone<R>>().run("installUpdate", json!({ "path": path }))
}

#[tauri::command(async)]
fn stop_speaking<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("stopSpeaking", json!({}))
}

/// Asks where to save a file and writes the text there ({ saved: false } if cancelled).
#[tauri::command(async)]
fn save_text<R: Runtime>(app: AppHandle<R>, name: String, text: String) -> Result<Value, String> {
    app.state::<Phone<R>>().run("saveText", json!({ "name": name, "text": text }))
}

/// Asks for a file and returns its text ({ text: null } if cancelled).
#[tauri::command(async)]
fn open_text<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("openText", json!({}))
}

/// Asks for any file and copies it into the app's cache: { path, name }, or { path: null }.
#[tauri::command(async)]
fn open_file<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("openFile", json!({}))
}

/// Asks the reader for a folder to keep in step through (Android's folder picker); the app
/// keeps the right to use it: { uri, name }, or { uri: null } if cancelled.
#[tauri::command(async)]
fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("pickFolder", json!({}))
}

/// Every device's sync file in the chosen folder: (file name, contents).
pub fn sync_read<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Result<Vec<(String, String)>, String> {
    let answer = app.state::<Phone<R>>().run("syncRead", json!({ "uri": uri }))?;
    Ok(answer
        .get("files")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|f| Some((f.get("name")?.as_str()?.to_string(), f.get("text")?.as_str()?.to_string()))).collect())
        .unwrap_or_default())
}

/// Writes this device's sync file into the chosen folder.
pub fn sync_write<R: Runtime>(app: &AppHandle<R>, uri: &str, name: &str, text: &str) -> Result<(), String> {
    app.state::<Phone<R>>().run("syncWrite", json!({ "uri": uri, "name": name, "text": text })).map(|_| ())
}

/// The folder a downloaded update must be put in for `install_update` to hand it to Android's
/// installer: `updates` in the app's cache, as Android itself names that folder (it is the
/// one the plugin's file provider may share). On a computer, where nothing is installed, a
/// folder beside the app's other cached files.
pub fn updates_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        let answer = app.state::<Phone<R>>().run("updatesDir", json!({}))?;
        answer.get("path").and_then(Value::as_str).map(std::path::PathBuf::from).ok_or_else(|| "The phone didn't say where to keep the update.".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        app.path().app_cache_dir().map(|d| d.join("updates")).map_err(|e| e.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("phone")
        .invoke_handler(tauri::generate_handler![share, speak, stop_speaking, save_text, open_text, open_file, pick_folder, voices, share_image, save_image, install_update])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(Phone { handle: _api.register_android_plugin("com.ghostclaw.phone", "PhonePlugin")? });
            #[cfg(not(target_os = "android"))]
            app.manage(Phone::<R> { _runtime: std::marker::PhantomData });
            Ok(())
        })
        .build()
}
