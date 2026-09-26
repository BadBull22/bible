//! Read-aloud: a natural Kokoro voice, run as a local child process (the "voice sidecar",
//! built from `voice-sidecar/` into `resources/voice/`). Started on first use, not at
//! launch -- it holds a ~170 MB model in memory -- and then kept running until the app
//! exits. The sidecar also watches this process's PID and exits on its own if the app
//! dies without shutting it down.
//!
//! The frontend falls back to Windows' built-in voices if this build has no voice folder.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

struct Running {
    child: Child,
    port: u16,
}

#[derive(Default)]
pub struct VoiceState {
    running: Mutex<Option<Running>>,
    /// Held while starting, so two quick requests can't start two sidecars.
    starting: Mutex<()>,
}

struct VoicePaths {
    exe: PathBuf,
    model: PathBuf,
    voices: PathBuf,
}

fn paths(app: &AppHandle) -> Option<VoicePaths> {
    let dir = app.path().resolve("resources/voice", tauri::path::BaseDirectory::Resource).ok()?;
    let p = VoicePaths {
        exe: dir.join("voice-sidecar").join("voice-sidecar.exe"),
        model: dir.join("kokoro-v1.0.fp16.onnx"),
        voices: dir.join("voices-en.bin"),
    };
    (p.exe.is_file() && p.model.is_file() && p.voices.is_file()).then_some(p)
}

/// The running sidecar's port, starting it first if needed (blocking: up to a minute on
/// a first-ever start while Windows checks the new files; a few seconds normally).
fn ensure_started(app: &AppHandle, state: &VoiceState) -> Result<u16, String> {
    let _guard = state.starting.lock().map_err(|e| e.to_string())?;
    {
        let mut running = state.running.lock().map_err(|e| e.to_string())?;
        if let Some(r) = running.as_mut() {
            if matches!(r.child.try_wait(), Ok(None)) {
                return Ok(r.port);
            }
            *running = None; // it exited; start a new one
        }
    }
    let p = paths(app).ok_or("The natural voice isn't included in this build.")?;
    let running = start_sidecar(&p)?;
    let port = running.port;
    *state.running.lock().map_err(|e| e.to_string())? = Some(running);
    Ok(port)
}

/// Starts the sidecar and waits for its "ready <port>" line.
fn start_sidecar(p: &VoicePaths) -> Result<Running, String> {
    let mut cmd = Command::new(&p.exe);
    cmd.arg("--model")
        .arg(&p.model)
        .arg("--voices")
        .arg(&p.voices)
        .arg("--parent-pid")
        .arg(std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start the voice: {e}"))?;

    // It prints "ready <port>" once the model is loaded and warmed up.
    let stdout = child.stdout.take().ok_or("no stdout from the voice process")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let _ = BufReader::new(stdout).read_line(&mut line);
        let _ = tx.send(line);
    });
    let line = match rx.recv_timeout(Duration::from_secs(90)) {
        Ok(l) => l,
        Err(_) => {
            let _ = child.kill();
            return Err("The voice took too long to start.".into());
        }
    };
    let port = line
        .trim()
        .strip_prefix("ready ")
        .and_then(|p| p.parse::<u16>().ok())
        .ok_or_else(|| {
            let _ = child.kill();
            "The voice didn't start properly.".to_string()
        })?;
    Ok(Running { child, port })
}

/// Stops the sidecar (called when the app exits).
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<VoiceState>() {
        if let Ok(mut running) = state.running.lock() {
            if let Some(mut r) = running.take() {
                let _ = r.child.kill();
                let _ = r.child.wait();
            }
        }
    }
}

#[derive(Serialize)]
pub struct VoiceStatus {
    /// This build includes the natural voice.
    pub available: bool,
    /// It is running now (so speaking starts immediately).
    pub running: bool,
}

#[tauri::command]
pub fn voice_status(app: AppHandle, state: State<VoiceState>) -> VoiceStatus {
    let running = state.running.lock().map(|mut r| r.as_mut().is_some_and(|r| matches!(r.child.try_wait(), Ok(None)))).unwrap_or(false);
    VoiceStatus { available: paths(&app).is_some(), running }
}

/// Starts the voice ahead of the first sentence (the reader shows "Preparing the voice…").
#[tauri::command]
pub async fn voice_start(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<VoiceState>();
        ensure_started(&app, &state).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Speaks `text`; returns WAV audio (delivered to the page as an ArrayBuffer).
#[tauri::command]
pub async fn voice_speak(app: AppHandle, text: String, voice: String, speed: f32) -> Result<tauri::ipc::Response, String> {
    let app2 = app.clone();
    let port = tauri::async_runtime::spawn_blocking(move || {
        let state = app2.state::<VoiceState>();
        ensure_started(&app2, &state)
    })
    .await
    .map_err(|e| e.to_string())??;
    let resp = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/speak"))
        .json(&serde_json::json!({ "text": text, "voice": voice, "speed": speed }))
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("The voice didn't answer: {e}"))?;
    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("The voice couldn't read that: {msg}"));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}


#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end: start the real voice sidecar from `resources/voice` (built by
    /// voice-sidecar\build.ps1), speak a verse, check a WAV comes back. Ignored by default
    /// (needs the 274 MB voice folder):  cargo test voice -- --ignored --nocapture
    #[test]
    #[ignore]
    fn sidecar_speaks() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("voice");
        let p = VoicePaths {
            exe: dir.join("voice-sidecar").join("voice-sidecar.exe"),
            model: dir.join("kokoro-v1.0.fp16.onnx"),
            voices: dir.join("voices-en.bin"),
        };
        let t = std::time::Instant::now();
        let mut r = start_sidecar(&p).expect("sidecar starts");
        println!("ready on port {} after {:.1?}", r.port, t.elapsed());
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let t = std::time::Instant::now();
        let bytes = rt
            .block_on(async {
                reqwest::Client::new()
                    .post(format!("http://127.0.0.1:{}/speak", r.port))
                    .json(&serde_json::json!({ "text": "The Lord is my shepherd; I shall not want.", "voice": "af_sarah", "speed": 1.0 }))
                    .send()
                    .await?
                    .bytes()
                    .await
            })
            .expect("speak");
        println!("spoke in {:.2?}: {} bytes", t.elapsed(), bytes.len());
        assert_eq!(&bytes[..4], b"RIFF");
        assert!(bytes.len() > 50_000, "a few seconds of audio");
        let _ = r.child.kill();
    }
}
