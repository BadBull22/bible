//! What the Bible app needs from the phone itself, which a web page inside an Android app
//! cannot do: open the share sheet, speak with the phone's voice, and save or open a file
//! where the reader chooses. The work is done in Kotlin (`android/`); these commands pass
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
/// was stopped ({ finished: false }).
#[tauri::command(async)]
fn speak<R: Runtime>(app: AppHandle<R>, text: String, rate: Option<f32>) -> Result<Value, String> {
    app.state::<Phone<R>>().run("speak", json!({ "text": text, "rate": rate.unwrap_or(1.0) }))
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

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("phone")
        .invoke_handler(tauri::generate_handler![share, speak, stop_speaking, save_text, open_text])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(Phone { handle: _api.register_android_plugin("com.ghostclaw.phone", "PhonePlugin")? });
            #[cfg(not(target_os = "android"))]
            app.manage(Phone::<R> { _runtime: std::marker::PhantomData });
            Ok(())
        })
        .build()
}
