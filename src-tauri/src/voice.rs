//! Read-aloud: a natural Kokoro voice, run as a local child process (the "voice sidecar",
//! built from `voice-sidecar/` into `resources/voice/`). Started on first use, not at
//! launch -- it holds a ~170 MB model in memory -- and then kept running until the app
//! exits. The sidecar also watches this process's PID and exits on its own if the app
//! dies without shutting it down.
//!
//! The voice is not part of the installer (it would add ~270 MB to every download and
//! every update): it's downloaded once, on request, into the per-user data folder
//! (`<app data>/voice`) from the release asset described in `resources/voice.json`, and
//! checked against its SHA-256 before it's unpacked. A build that still has
//! `resources/voice` (an older full installer) uses that copy. Until a voice is present
//! the frontend reads with the computer's built-in voices.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

struct Running {
    child: Child,
    port: u16,
}

#[derive(Default)]
pub struct VoiceState {
    running: Mutex<Option<Running>>,
    /// Held while starting, so two quick requests can't start two sidecars.
    starting: Mutex<()>,
    downloading: AtomicBool,
    cancel: AtomicBool,
}

struct VoicePaths {
    exe: PathBuf,
    model: PathBuf,
    voices: PathBuf,
}

const EXE: &str = if cfg!(windows) { "voice-sidecar.exe" } else { "voice-sidecar" };

/// The voice files in `dir`, if they're all there.
fn paths_in(dir: &Path) -> Option<VoicePaths> {
    let p = VoicePaths {
        exe: dir.join("voice-sidecar").join(EXE),
        model: dir.join("kokoro-v1.0.fp16.onnx"),
        voices: dir.join("voices-en.bin"),
    };
    (p.exe.is_file() && p.model.is_file() && p.voices.is_file()).then_some(p)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The downloaded voice, else one shipped inside the app; and which it is.
fn paths(app: &AppHandle) -> Option<(VoicePaths, &'static str)> {
    if let Some(p) = data_dir(app).ok().and_then(|d| paths_in(&d.join("voice"))) {
        return Some((p, "downloaded"));
    }
    let dir = app.path().resolve("resources/voice", tauri::path::BaseDirectory::Resource).ok()?;
    paths_in(&dir).map(|p| (p, "bundled"))
}

/// One platform's voice archive (written by scripts/package_voice.py).
#[derive(Deserialize, Clone)]
struct VoiceDownload {
    url: String,
    sha256: String,
    bytes: u64,
}

#[derive(Deserialize)]
struct VoiceManifest {
    platforms: HashMap<String, VoiceDownload>,
}

/// "windows-x86_64", "darwin-aarch64", ... (the same names Tauri's updater uses).
fn platform_key() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        os => os,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

fn download_info(app: &AppHandle) -> Option<VoiceDownload> {
    let path = app.path().resolve("resources/voice.json", tauri::path::BaseDirectory::Resource).ok()?;
    let manifest: VoiceManifest = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    manifest.platforms.get(&platform_key()).cloned()
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
    let (p, _) = paths(app).ok_or("The natural voice hasn't been downloaded yet (Settings › Read aloud).")?;
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
    /// The natural voice is on this computer.
    pub available: bool,
    /// It is running now (so speaking starts immediately).
    pub running: bool,
    /// "downloaded" or "bundled" (inside the app), when available.
    pub source: Option<&'static str>,
    /// Size of the download, when there is one for this computer.
    pub download_bytes: Option<u64>,
    pub downloading: bool,
}

#[tauri::command]
pub fn voice_status(app: AppHandle, state: State<VoiceState>) -> VoiceStatus {
    let running = state.running.lock().map(|mut r| r.as_mut().is_some_and(|r| matches!(r.child.try_wait(), Ok(None)))).unwrap_or(false);
    let found = paths(&app);
    VoiceStatus {
        available: found.is_some(),
        running,
        source: found.map(|(_, s)| s),
        download_bytes: download_info(&app).map(|d| d.bytes),
        downloading: state.downloading.load(Ordering::SeqCst),
    }
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    /// "downloading" | "installing"
    stage: &'static str,
    done: u64,
    total: u64,
}

/// Downloads the voice (internet needed, once), checks it and unpacks it. Progress is sent
/// as "voice-progress" events; "voice-changed" fires when it's ready.
#[tauri::command]
pub async fn voice_download(app: AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("The voice is already downloading.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = download(&app).await;
    state.downloading.store(false, Ordering::SeqCst);
    if result.is_ok() {
        let _ = app.emit("voice-changed", ());
    }
    result
}

#[tauri::command]
pub fn voice_cancel_download(state: State<VoiceState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Deletes the downloaded voice (stopping it first if it's running).
#[tauri::command]
pub fn voice_remove(app: AppHandle) -> Result<(), String> {
    shutdown(&app);
    let dir = data_dir(&app)?.join("voice");
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Couldn't remove the voice: {e}"))?;
    }
    let _ = app.emit("voice-changed", ());
    Ok(())
}

async fn download(app: &AppHandle) -> Result<(), String> {
    let info = download_info(app).ok_or("There's no voice download for this computer.")?;
    let data = data_dir(app)?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let tmp = data.join("voice.download");
    let emit = |stage: &'static str, done: u64, total: u64| {
        let _ = app.emit("voice-progress", DownloadProgress { stage, done, total });
    };

    let client = reqwest::Client::builder()
        .user_agent(crate::library_commands::USER_AGENT)
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(&info.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't download the voice ({e}). Check the internet connection."))?;
    let total = resp.content_length().unwrap_or(info.bytes);
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let (mut done, mut last) = (0u64, 0u64);
    emit("downloading", 0, total);
    let cancelled = || app.state::<VoiceState>().cancel.load(Ordering::SeqCst);
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = std::fs::remove_file(&tmp);
                return Err(format!("The download was interrupted ({e}). Please try again."));
            }
        };
        if cancelled() {
            drop(file);
            let _ = std::fs::remove_file(&tmp);
            return Err("Download cancelled.".into());
        }
        file.write_all(&chunk).map_err(|e| format!("Couldn't save the voice ({e}). Is the disk full?"))?;
        hash.update(&chunk);
        done += chunk.len() as u64;
        if done - last >= total / 200 + 1 {
            last = done;
            emit("downloading", done, total);
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    let got: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if !got.eq_ignore_ascii_case(&info.sha256) {
        let _ = std::fs::remove_file(&tmp);
        return Err("The download was damaged on the way (its checksum doesn't match). Please try again.".into());
    }
    emit("installing", done, total);
    shutdown(app); // a running voice keeps its files open
    tauri::async_runtime::spawn_blocking(move || install_zip(&tmp, &data)).await.map_err(|e| e.to_string())?
}

/// Unpacks a checked voice archive into `<data>/voice`, replacing an earlier copy.
fn install_zip(zip_path: &Path, data: &Path) -> Result<(), String> {
    let partial = data.join("voice.partial");
    let _ = std::fs::remove_dir_all(&partial);
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("The voice download isn't a valid archive ({e})."))?;
    zip.extract(&partial).map_err(|e| format!("Couldn't unpack the voice ({e}). Is the disk full?"))?;
    drop(zip);
    if paths_in(&partial).is_none() {
        let _ = std::fs::remove_dir_all(&partial);
        return Err("The voice download is missing files.".into());
    }
    let dest = data.join("voice");
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| format!("Couldn't replace the old voice ({e})."))?;
    }
    std::fs::rename(&partial, &dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(zip_path);
    Ok(())
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

    #[test]
    fn installs_a_voice_archive() {
        let data = std::env::temp_dir().join(format!("bc-voice-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&data);
        std::fs::create_dir_all(&data).unwrap();
        let zip_path = data.join("voice.download");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            for name in [format!("voice-sidecar/{EXE}"), "voice-sidecar/_internal/x.dll".into(), "kokoro-v1.0.fp16.onnx".into(), "voices-en.bin".into()] {
                z.start_file(name, opts).unwrap();
                z.write_all(b"x").unwrap();
            }
            z.finish().unwrap();
        }
        install_zip(&zip_path, &data).unwrap();
        assert!(paths_in(&data.join("voice")).is_some());
        assert!(!zip_path.exists() && !data.join("voice.partial").exists());

        // an archive without the model is refused and leaves the installed voice alone
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            z.start_file("voices-en.bin", zip::write::SimpleFileOptions::default()).unwrap();
            z.finish().unwrap();
        }
        assert!(install_zip(&zip_path, &data).is_err());
        assert!(paths_in(&data.join("voice")).is_some());
        let _ = std::fs::remove_dir_all(&data);
        assert!(platform_key().contains('-'));
    }

    /// The real archive made by scripts/package_voice.py unpacks into a working voice
    /// folder (checksum as in voice.json):  cargo test real_voice_archive -- --ignored
    #[test]
    #[ignore]
    fn real_voice_archive() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let manifest: VoiceManifest = serde_json::from_str(&std::fs::read_to_string(root.join("resources/voice.json")).unwrap()).unwrap();
        let info = &manifest.platforms[&platform_key()];
        let name = info.url.rsplit('/').next().unwrap();
        let data = std::env::temp_dir().join(format!("bc-voice-real-{}", std::process::id()));
        std::fs::create_dir_all(&data).unwrap();
        let tmp = data.join("voice.download");
        std::fs::copy(root.join("..").join("installer").join(name), &tmp).unwrap();
        let bytes = std::fs::read(&tmp).unwrap();
        assert_eq!(bytes.len() as u64, info.bytes);
        let got: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(got, info.sha256);
        install_zip(&tmp, &data).unwrap();
        let p = paths_in(&data.join("voice")).expect("voice files");
        let mut r = start_sidecar(&p).expect("sidecar starts from the unpacked copy");
        let _ = r.child.kill();
        let _ = r.child.wait();
        let _ = std::fs::remove_dir_all(&data);
    }

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
