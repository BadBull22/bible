//! Offline AI (beta): an optional assistant that answers from this app's own texts, on this PC.
//!
//! Off by default and not shown until it is unlocked. Nothing is in the installer: once unlocked,
//! one download fetches Microsoft's Foundry Local runtime (from nuget.org) and a small model (from
//! Microsoft's catalog), into the app's data folder. After that it works offline.
//!
//! How it answers, in order:
//! 1. a hand-checked answer (qa.json) -- shown word for word, never reworded by the model;
//! 2. the app searches its Bibles and commentaries for the passages that matter;
//! 3. nothing relevant found: "The texts here don't answer that." (the model isn't asked);
//! 4. the model answers ONLY from those passages, citing them;
//! 5. every reference and quotation in its answer is checked against the passages, and anything
//!    not found there is marked as not supported.
//!
//! Chats and the things the reader asks it to remember are kept in the study database
//! (userdata.db), so they last across restarts.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::DbState;
use crate::settings;
use crate::userdata::UserDataState;
use crate::{ConfigDir, EmbedderState, FirstsState, QaState, SettingsState};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// The SHA-256 of the unlock code (the code itself is not kept in the source).
const UNLOCK: &str = "f21a9ee02dfb476ba82244a601fda547e32fe0834c6b84fbfb6878e0ddd06ebb";

/// The model, as Microsoft's Foundry Local catalog names it.
const MODEL: &str = "phi-4-mini";

/// The model's catalog name: Phi-4-mini, or (for testing another model) the name in the
/// environment variable BC_AI_MODEL.
fn model_alias() -> String {
    std::env::var("BC_AI_MODEL").ok().filter(|m| !m.trim().is_empty()).unwrap_or_else(|| MODEL.to_string())
}

/// A reply without the model's "thinking" (`<think>…</think>`, which some models write first).
fn without_thinking(text: &str) -> String {
    let mut t = text.to_string();
    while let (Some(a), Some(b)) = (t.find("<think>"), t.find("</think>")) {
        if b < a {
            break;
        }
        t.replace_range(a..b + "</think>".len(), "");
    }
    // a reply that ends inside its thinking has no answer
    if let Some(a) = t.find("<think>") {
        t.truncate(a);
    }
    if let Some(b) = t.find("</think>") {
        t = t[b + "</think>".len()..].to_string();
    }
    t.trim().to_string()
}

/// The runtime: Microsoft's packages on nuget.org (their win-x64 DLLs are what is needed).
const RUNTIME: &[(&str, &str)] = &[
    ("microsoft.ai.foundry.local.runtime", "2.1.0"),
    ("microsoft.ml.onnxruntime", "1.30.0"),
    ("microsoft.ml.onnxruntimegenai.foundry", "0.17.1"),
];

/// The rules every answer is held to.
/// What the model is told when it reads one passage (small models follow examples best).
const RULES: &str = "You are a Bible study helper inside an offline Bible app. You are given ONE passage and a question. \
The passage may use different words from the question (for example \"blood\" where the question says \"bleed\"); if it \
describes what the question asks about, it answers it. If the passage answers the question, answer in at most two short \
sentences using only the passage, saying the answer first, and put the reference of the verse in square brackets at the \
end, for example [Ruth 1:16]. Only if the passage clearly says nothing about what is asked, reply only: NO. Do not add \
facts, dates, reasons or doctrines that are not in the passage.\n\n\
Example\n\
Passage:\n\
[Ruth 1:16] But Ruth replied: \"Do not urge me to leave you or to turn back from following you. For wherever you go, I will go, and wherever you stay, I will stay. Your people will be my people, and your God will be my God.\"\n\
Question: What did Ruth say to Naomi?\n\
Answer: Ruth told Naomi that her people would be Ruth's people and Naomi's God her God. [Ruth 1:16]";

/// The strict second reading of an answer the checks passed: does the passage itself say it,
/// and does it answer exactly what was asked? (Small models follow examples best.)
const VERIFY_RULES: &str = "You check answers for a Bible app. You are given a passage, a question and an answer. Reply YES only if \
(1) the passage itself clearly says what the answer says, and (2) the answer is exactly what the question asks, including every specific \
detail in it (a person, a time, a meal, a colour, a measure, a reason). A related but different fact is NO. If the question asks why, \
reply YES only if the passage itself states that reason, not merely what happened before or after. Reply with one word: YES or NO.\n\n\
Passage: [John 11:35] Jesus wept. [John 11:36] So the Jews said, \"See how He loved him!\"\n\
Question: Why did Jesus weep?\nAnswer: Because He loved Lazarus.\nReply: YES\n\n\
Passage: [John 6:9] \"Here is a boy with five barley loaves and two fish.\"\n\
Question: What did the boy have for breakfast?\nAnswer: Five barley loaves and two fish.\nReply: NO\n\n\
Passage: [Genesis 12:1] The LORD said to Abram, \"Go from your country, your kindred, and your father's house to the land I will show you.\"\n\
Question: Why did the LORD call Abram?\nAnswer: Because Abram was righteous.\nReply: NO\n\n\
Passage: [Luke 22:34] Jesus said, \"Peter, before the rooster crows today, you will deny three times that you know Me.\"\n\
Question: Why did Peter deny Jesus?\nAnswer: Because Jesus predicted it.\nReply: NO\n\n\
Passage: [Genesis 7:12] And the rain fell on the earth forty days and forty nights.\n\
Question: How long was Noah in the ark after the rain stopped?\nAnswer: Forty days and forty nights.\nReply: NO";

/// The rules for a question that asks why: find the reason the passage itself states.
const WHY_RULES: &str = "You are a Bible study helper inside an offline Bible app. You are given ONE passage and a question that asks WHY. \
Look in the passage for the reason it states: words such as because, so that, for, since, in order that, or a reason given by God or \
a person in what they say. If the passage states the reason, answer in one or two short sentences beginning \"Because\" and use the \
passage's own words, then put the reference of the verse in square brackets at the end, for example [John 11:36]. If the passage only \
tells what happened and does not state why, reply only: NO. Never make up a reason. Do not give a reason that is only a guess.\n\n\
Example\nPassage:\n[John 11:35] Jesus wept. [John 11:36] So the Jews said, \"See how He loved him!\"\n\
Question: Why did Jesus weep?\nAnswer: Because He loved Lazarus. [John 11:36]";

/// What the model is told when it turns a question into search words (retrieval only: the
/// answer still comes from the passages).
const SEARCH_RULES: &str = "Turn the question into a short Bible search: the names, places and key words that would be in the verses that answer it (at most eight words). Reply with the words only.\n\n\
Question: Who was swallowed by a big fish?\nWords: Jonah swallowed great fish\n\
Question: Who was Moses's brother?\nWords: Aaron brother of Moses\n\
Question: Who sold Joseph into Egypt?\nWords: Joseph sold brothers Midianites Egypt";

/// The second reading, when every passage said NO: what the passage does say about the question.
const RETRY_RULES: &str = "You are a Bible study helper. Read the passage and the question. If the passage says something that helps answer the question, even in part, state in one or two short sentences what the passage says about it, using only the passage and its own words. Reply only NO if the passage says nothing at all about what is asked. Never add names, numbers, reasons or facts that are not in the passage.";

/// How many passages are read (each gives at most one possible answer), and how many verses of
/// each: the verses that matched, with their neighbours.
const PASSAGES: usize = 6;
const MAX_VERSES: usize = 12;
/// A found passage this long or shorter (a story) is read whole (2026-10-20 experiment: Genesis
/// 16 cut to 16:1-3 lost Ishmael's birth in verse 15).
const WHOLE_VERSES: usize = 20;
/// How many verses past a whole passage's end are read too (those that exist).
const AFTER_STORY: i64 = 3;
const NOTES: usize = 1;
/// At most this many possible answers are listed.
const MAX_ANSWERS: usize = 3;

#[derive(Default)]
pub struct OfflineAiState {
    engine: tokio::sync::Mutex<Option<Engine>>,
    downloading: AtomicBool,
}

struct Engine {
    _manager: Arc<foundry_local_sdk::FoundryLocalManager>,
    model: Arc<foundry_local_sdk::Model>,
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("offline-ai"))
}

fn runtime_ready(dir: &Path) -> bool {
    ["foundry_local.dll", "onnxruntime.dll", "onnxruntime-genai.dll"].iter().all(|f| dir.join(f).exists())
}

/// The tables of the chats and of what the reader asked it to remember.
pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_chats (id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
         CREATE TABLE IF NOT EXISTS ai_messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
            sources TEXT NOT NULL DEFAULT '[]', unsupported TEXT NOT NULL DEFAULT '[]', kind TEXT NOT NULL DEFAULT 'model',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
         CREATE INDEX IF NOT EXISTS ai_messages_chat ON ai_messages(chat_id, id);
         CREATE TABLE IF NOT EXISTS ai_memory (id INTEGER PRIMARY KEY, fact TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));",
    )
    .map_err(err)?;
    // the same uid on every computer (folder sync: sync.rs)
    for t in ["ai_chats", "ai_messages", "ai_memory"] {
        bible_core::sync::add_column(conn, t, "uid", "TEXT")?;
        conn.execute(&format!("UPDATE {t} SET uid = lower(hex(randomblob(12))) WHERE uid IS NULL OR uid = ''"), []).map_err(err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- unlocking, status, the download

/// What was typed in the search bar: the unlock code turns the beta on (returns true).
#[tauri::command]
pub fn ai_try_unlock(config_dir: State<ConfigDir>, state: State<SettingsState>, text: String) -> Result<bool, String> {
    let sum = Sha256::digest(text.trim().as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>();
    if sum != UNLOCK {
        return Ok(false);
    }
    let mut s = state.0.lock().map_err(err)?;
    s.offline_ai = true;
    settings::save(&config_dir.0, &s).map_err(err)?;
    Ok(true)
}

/// Turns the beta off (the download is kept until removed).
#[tauri::command]
pub fn ai_turn_off(config_dir: State<ConfigDir>, state: State<SettingsState>) -> Result<(), String> {
    let mut s = state.0.lock().map_err(err)?;
    s.offline_ai = false;
    settings::save(&config_dir.0, &s).map_err(err)
}

#[derive(Serialize)]
pub struct AiStatus {
    enabled: bool,
    runtime: bool,
    model: bool,
    /// "generic-gpu" | "generic-cpu" once known
    variant: Option<String>,
    downloading: bool,
    loaded: bool,
}

#[tauri::command]
pub async fn ai_status(app: AppHandle) -> Result<AiStatus, String> {
    let enabled = app.state::<SettingsState>().0.lock().map_err(err)?.offline_ai;
    let dir = folder(&app)?;
    let runtime = runtime_ready(&dir.join("runtime"));
    let variant = std::fs::read_to_string(dir.join("variant.txt")).ok().map(|v| v.trim().to_string());
    let model = dir.join("model-ready").exists();
    let state = app.state::<OfflineAiState>();
    let loaded = state.engine.lock().await.is_some();
    Ok(AiStatus { enabled, runtime, model, variant, downloading: state.downloading.load(Ordering::SeqCst), loaded })
}

#[derive(Serialize, Clone)]
struct Progress {
    /// "runtime" | "accelerator" | "model"
    stage: &'static str,
    percent: f64,
}

/// Downloads the runtime and the model (progress: "ai-progress" events).
#[tauri::command]
pub async fn ai_install(app: AppHandle) -> Result<(), String> {
    let state = app.state::<OfflineAiState>();
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("It is already downloading.".into());
    }
    let result = install(&app).await;
    app.state::<OfflineAiState>().downloading.store(false, Ordering::SeqCst);
    result
}

async fn install(app: &AppHandle) -> Result<(), String> {
    let dir = folder(app)?;
    let runtime = dir.join("runtime");
    std::fs::create_dir_all(&runtime).map_err(err)?;
    if !runtime_ready(&runtime) {
        let client = reqwest::Client::builder()
            .user_agent(crate::library_commands::USER_AGENT)
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(err)?;
        for (i, (name, version)) in RUNTIME.iter().enumerate() {
            let url = format!("https://api.nuget.org/v3-flatcontainer/{name}/{version}/{name}.{version}.nupkg");
            let bytes = client
                .get(&url)
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("Couldn't download the AI runtime ({e}). Check the internet connection."))?
                .bytes()
                .await
                .map_err(err)?;
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
            for j in 0..zip.len() {
                let mut f = zip.by_index(j).map_err(err)?;
                let n = f.name().to_string();
                if n.starts_with("runtimes/win-x64/") && n.to_lowercase().ends_with(".dll") {
                    let file = n.rsplit('/').next().unwrap_or(&n).to_string();
                    let mut out = std::fs::File::create(runtime.join(file)).map_err(err)?;
                    std::io::copy(&mut f, &mut out).map_err(err)?;
                }
            }
            let _ = app.emit("ai-progress", Progress { stage: "runtime", percent: ((i + 1) * 100 / RUNTIME.len()) as f64 });
        }
    }
    let (manager, gpu) = manager(app, true).await?;
    let model = manager.catalog().get_model(&model_alias()).await.map_err(err)?;
    let variant = choose_variant(&model, gpu)?;
    std::fs::write(dir.join("variant.txt"), &variant).map_err(err)?;
    if !model.is_cached().await.map_err(err)? {
        let app2 = app.clone();
        model
            .download(Some(move |p: f64| {
                let _ = app2.emit("ai-progress", Progress { stage: "model", percent: p });
            }))
            .await
            .map_err(|e| format!("Couldn't download the model ({e}). Check the internet connection and the free disk space."))?;
    }
    std::fs::write(dir.join("model-ready"), b"ok").map_err(err)?;
    Ok(())
}

/// Foundry Local, with the graphics card when it can use one (WebGPU, any make; never CUDA,
/// which needs NVIDIA's own toolkit), otherwise the processor. Returns whether a GPU is in use.
async fn manager(app: &AppHandle, show_progress: bool) -> Result<(Arc<foundry_local_sdk::FoundryLocalManager>, bool), String> {
    let dir = folder(app)?;
    let runtime = dir.join("runtime");
    if !runtime_ready(&runtime) {
        return Err("The Offline Assistant isn't downloaded yet.".into());
    }
    let config = foundry_local_sdk::FoundryLocalConfig::new("bible_concordance")
        .library_path(runtime.to_string_lossy().to_string())
        .app_data_dir(dir.join("data").to_string_lossy().to_string())
        .model_cache_dir(dir.join("models").to_string_lossy().to_string())
        .logs_dir(dir.join("logs").to_string_lossy().to_string());
    let manager = foundry_local_sdk::FoundryLocalManager::create(config).map_err(err)?;
    let app2 = app.clone();
    let webgpu: [&str; 1] = ["WebGpuExecutionProvider"];
    let gpu = manager
        .download_and_register_eps_with_progress(Some(&webgpu), move |_ep: &str, p: f64| {
            if show_progress {
                let _ = app2.emit("ai-progress", Progress { stage: "accelerator", percent: p });
            }
        })
        .await
        .map(|r| r.registered_eps.iter().any(|e| e.contains("WebGpu")))
        .unwrap_or(false);
    Ok((manager, gpu))
}

fn choose_variant(model: &foundry_local_sdk::Model, gpu: bool) -> Result<String, String> {
    // (for testing: BC_AI_CPU=1 uses the processor version even when there is a graphics card)
    let gpu = gpu && std::env::var("BC_AI_CPU").map_or(true, |v| v != "1");
    let want = if gpu { "generic-gpu" } else { "generic-cpu" };
    let variants = model.variants();
    let v = variants
        .iter()
        .find(|v| v.id().contains(want))
        .or_else(|| variants.iter().find(|v| v.id().contains("generic-cpu")))
        .ok_or("This model has no version for this computer.")?;
    model.select_variant(v).map_err(err)?;
    Ok(if v.id().contains("generic-gpu") { "generic-gpu".into() } else { "generic-cpu".into() })
}

/// Deletes the download (runtime and model).
#[tauri::command]
pub async fn ai_remove(app: AppHandle) -> Result<(), String> {
    let state = app.state::<OfflineAiState>();
    if let Some(e) = state.engine.lock().await.take() {
        let _ = e.model.unload().await;
    }
    let dir = folder(&app)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Couldn't remove it ({e}). Close the app and try again."))?;
    }
    Ok(())
}

pub(crate) async fn engine(app: &AppHandle) -> Result<Arc<foundry_local_sdk::Model>, String> {
    let state = app.state::<OfflineAiState>();
    let mut guard = state.engine.lock().await;
    if let Some(e) = guard.as_ref() {
        return Ok(e.model.clone());
    }
    let (manager, gpu) = manager(app, false).await?;
    let model = manager.catalog().get_model(&model_alias()).await.map_err(err)?;
    choose_variant(&model, gpu)?;
    if !model.is_cached().await.map_err(err)? {
        return Err("The model isn't downloaded yet (Study → Offline Assistant → Settings).".into());
    }
    model.load().await.map_err(err)?;
    *guard = Some(Engine { _manager: manager, model: model.clone() });
    Ok(model)
}

// ---------------------------------------------------------------- chats and memory

#[derive(Serialize)]
pub struct AiChat {
    id: i64,
    title: String,
    created_at: String,
}

#[derive(Serialize, Clone, serde::Deserialize)]
pub struct AiSource {
    /// "S1", "S2", ...
    tag: String,
    /// "Daniel 10:1-14", "Matthew Henry on Daniel 10:2"
    label: String,
    book: String,
    chapter: i64,
    verse: i64,
    verse_end: i64,
    text: String,
    /// the verses around the passage (10 either side), lower case, for checking names and
    /// verses against (not shown, not kept)
    #[serde(skip, default)]
    chapter_text: String,
}

#[derive(Serialize)]
pub struct AiMessage {
    id: i64,
    role: String,
    content: String,
    sources: Vec<AiSource>,
    /// references or quotations in the answer that the sources don't support
    unsupported: Vec<String>,
    /// "model" | "curated" | "none" | "memory"
    kind: String,
    created_at: String,
}

#[tauri::command]
pub fn ai_chats(user: State<UserDataState>) -> Result<Vec<AiChat>, String> {
    let c = user.0.lock().map_err(err)?;
    let mut st = c.prepare("SELECT id, title, created_at FROM ai_chats ORDER BY id DESC").map_err(err)?;
    let rows = st.query_map([], |r| Ok(AiChat { id: r.get(0)?, title: r.get(1)?, created_at: r.get(2)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn ai_messages(user: State<UserDataState>, chat_id: i64) -> Result<Vec<AiMessage>, String> {
    let c = user.0.lock().map_err(err)?;
    messages(&c, chat_id)
}

fn messages(c: &Connection, chat_id: i64) -> Result<Vec<AiMessage>, String> {
    let mut st = c
        .prepare("SELECT id, role, content, sources, unsupported, kind, created_at FROM ai_messages WHERE chat_id = ?1 ORDER BY id")
        .map_err(err)?;
    let rows = st
        .query_map(params![chat_id], |r| {
            Ok(AiMessage {
                id: r.get(0)?,
                role: r.get(1)?,
                content: r.get(2)?,
                sources: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
                unsupported: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
                kind: r.get(5)?,
                created_at: r.get(6)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn ai_delete_chat(user: State<UserDataState>, chat_id: i64) -> Result<(), String> {
    let c = user.0.lock().map_err(err)?;
    c.execute("DELETE FROM ai_messages WHERE chat_id = ?1", params![chat_id]).map_err(err)?;
    c.execute("DELETE FROM ai_chats WHERE id = ?1", params![chat_id]).map_err(err)?;
    Ok(())
}

#[derive(Serialize)]
pub struct AiMemory {
    id: i64,
    fact: String,
}

#[tauri::command]
pub fn ai_memory(user: State<UserDataState>) -> Result<Vec<AiMemory>, String> {
    let c = user.0.lock().map_err(err)?;
    memory(&c)
}

fn memory(c: &Connection) -> Result<Vec<AiMemory>, String> {
    let mut st = c.prepare("SELECT id, fact FROM ai_memory ORDER BY id").map_err(err)?;
    let rows = st.query_map([], |r| Ok(AiMemory { id: r.get(0)?, fact: r.get(1)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[tauri::command]
pub fn ai_forget(user: State<UserDataState>, id: i64) -> Result<(), String> {
    user.0.lock().map_err(err)?.execute("DELETE FROM ai_memory WHERE id = ?1", params![id]).map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- asking

#[derive(Serialize, Clone)]
struct Status {
    chat_id: i64,
    text: String,
}

fn save(c: &Connection, chat_id: i64, role: &str, content: &str, sources: &[AiSource], unsupported: &[String], kind: &str) -> Result<(), String> {
    c.execute(
        "INSERT INTO ai_messages (chat_id, role, content, sources, unsupported, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![chat_id, role, content, serde_json::to_string(sources).map_err(err)?, serde_json::to_string(unsupported).map_err(err)?, kind],
    )
    .map_err(err)?;
    Ok(())
}

fn verse_text(conn: &Connection, book: &str, chapter: i64, verse: i64) -> String {
    conn.query_row(
        "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
         WHERE ver.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse = ?3",
        params![book, chapter, verse],
        |r| r.get(0),
    )
    .unwrap_or_default()
}

/// How far around a passage a name may be and still count as what the passage is about.
const NEARBY: i64 = 10;

/// Verses `from`..=`to` of a chapter of the BSB, lower case, separated by newlines.
fn nearby_text(conn: &Connection, book: &str, chapter: i64, from: i64, to: i64) -> String {
    let Ok(mut stmt) = conn.prepare(
        "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
         WHERE ver.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse BETWEEN ?3 AND ?4 ORDER BY v.verse",
    ) else {
        return String::new();
    };
    let rows = stmt.query_map(params![book, chapter, from, to], |r| r.get::<_, String>(0));
    rows.map(|r| r.flatten().collect::<Vec<_>>().join("\n").to_lowercase().replace('’', "'")).unwrap_or_default()
}

/// The verses of a found passage that matter: the ones that matched, and their neighbours,
/// at most `MAX_VERSES` (a small model loses the answer in a long passage).
fn window(conn: &Connection, f: &bible_core::find::Found) -> Option<AiSource> {
    let found: Vec<i64> = if f.verses.is_empty() { vec![f.verse] } else { f.verses.clone() };
    let mut picked: Vec<i64> = Vec::new();
    // a short passage (a story, a key passage) is read whole, up to WHOLE_VERSES
    let whole = f.verse_end > f.verse && ((f.verse_end - f.verse + 1) as usize) <= WHOLE_VERSES;
    if whole {
        // and a few verses past its end: a story's answer is often just after (John 11:1-32
        // stops three verses before "Jesus wept")
        picked.extend(f.verse..=f.verse_end + AFTER_STORY);
    }
    for &v in &found {
        if !picked.contains(&v) {
            picked.push(v);
        }
    }
    for &v in &found {
        for n in [v - 1, v + 1, v + 2, v - 2] {
            if n >= 1 && !picked.contains(&n) {
                picked.push(n);
            }
        }
    }
    picked.truncate(if whole { WHOLE_VERSES + AFTER_STORY as usize } else { MAX_VERSES });
    picked.sort_unstable();
    let mut lines = Vec::new();
    let mut shown = Vec::new();
    for v in picked {
        let t = verse_text(conn, &f.book, f.chapter, v);
        if !t.is_empty() {
            lines.push(format!("[{} {}:{}] {}", f.book, f.chapter, v, t));
            shown.push(v);
        }
    }
    let (first, last) = (*shown.first()?, *shown.last()?);
    let label = if first == last { format!("{} {}:{}", f.book, f.chapter, first) } else { format!("{} {}:{}-{}", f.book, f.chapter, first, last) };
    let chapter_text = nearby_text(conn, &f.book, f.chapter, first - NEARBY, last + NEARBY);
    Some(AiSource { tag: String::new(), label, book: f.book.clone(), chapter: f.chapter, verse: first, verse_end: last, text: lines.join("\n"), chapter_text })
}

/// The people and places named in a question, as the search recognises them (words the BSB
/// nearly always capitalises).
/// The same person under another name in the Bible (Abram and Abraham, Saul and Paul…).
fn other_names(name: &str) -> &'static [&'static str] {
    match name {
        "abraham" => &["abram"],
        "abram" => &["abraham"],
        "sarah" => &["sarai"],
        "sarai" => &["sarah"],
        "paul" => &["saul"],
        "saul" => &["paul"],
        "peter" => &["simon", "cephas"],
        "israel" => &["jacob"],
        "jacob" => &["israel"],
        "thomas" => &["didymus"],
        "matthew" => &["levi"],
        "levi" => &["matthew"],
        _ => &[],
    }
}

fn question_names(app: &AppHandle, question: &str) -> Vec<String> {
    let db = app.state::<DbState>();
    let Ok(conn) = db.0.lock() else { return Vec::new() };
    bible_core::find::understand(&conn, crate::commands::search_vocab(&conn), &without_possessives(question)).names
}

/// A question with its possessives taken off, so the names in it are found: "Abraham's
/// donkey" → "Abraham donkey", and "noahs wife" also tried as "noah" ("noahs noah wife").
fn without_possessives(question: &str) -> String {
    question
        .split_whitespace()
        .map(|w| {
            let w = w.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '’');
            let base = w.trim_end_matches("'s").trim_end_matches("’s").trim_end_matches(['\'', '’']);
            if base.len() > 4 && base.ends_with('s') && !base.ends_with("ss") {
                format!("{base} {}", &base[..base.len() - 1])
            } else {
                base.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// What a name in the Bible is, by the app's People & Places data.
enum Who {
    Man,
    Woman,
    Place,
    Unknown,
}

fn who_is(app: &AppHandle, name: &str) -> Who {
    let state = app.state::<crate::commentaries::CommentaryState>();
    let Ok(c) = crate::commands::commentary_conn(&state) else { return Who::Unknown };
    let n = name.to_lowercase();
    let Ok(mut st) = c.prepare(
        "SELECT kind, COALESCE(gender, ''), COUNT(*) FROM entities
         WHERE (lower(name) = ?1 OR lower(name) LIKE ?1 || ' %' OR lower(name) LIKE ?1 || ',%') AND kind IN ('person', 'place') GROUP BY kind, gender",
    ) else {
        return Who::Unknown;
    };
    let rows: Vec<(String, String, i64)> = st
        .query_map([&n], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default();
    let count = |kind: &str, gender: &str| rows.iter().filter(|(k, g, _)| k == kind && (gender.is_empty() || g == gender)).map(|r| r.2).sum::<i64>();
    let (men, women, places) = (count("person", "Male"), count("person", "Female"), count("place", ""));
    if men + women > 0 && men + women >= places {
        if women > men { Who::Woman } else { Who::Man }
    } else if places > 0 {
        Who::Place
    } else {
        Who::Unknown
    }
}

/// The people in some text (a question, or an answer without its verse labels), in the order they come.
fn names_of(app: &AppHandle, text: &str) -> Vec<String> {
    let refs = regex::Regex::new(r"\[[^\]]*\]|(?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)? \d{1,3}(?::\d{1,3})?(?:\s*[-–]\s*\d{1,3})?:?").unwrap();
    let clean = refs.replace_all(text, " ");
    question_names(app, &clean)
}

/// The questions to try for what was typed. A follow-up ("who was his father?") is first asked
/// about the person the last answer named ("David killed Goliath"), then about the person the last
/// question named; with no person to put in, it is searched with the question before it.
fn follow_up_candidates(app: &AppHandle, question: &str, last_question: Option<&str>, last_answer: Option<&str>) -> Vec<String> {
    let Some(last_q) = last_question else { return vec![question.to_string()] };
    if !is_follow_up(question) {
        return vec![question.to_string()];
    }
    let lower = question.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).collect();
    let female = words.iter().any(|w| matches!(*w, "she" | "her" | "hers"));
    let male = words.iter().any(|w| matches!(*w, "he" | "his" | "him"));
    // "he" is a man and "she" a woman, never a place (the app's People & Places data says which a name is)
    let fits = |n: &String| match who_is(app, n) {
        Who::Place => !female && !male,
        Who::Man => !female,
        Who::Woman => !male,
        Who::Unknown => {
            if female {
                WOMEN.contains(&n.as_str())
            } else if male {
                !WOMEN.contains(&n.as_str())
            } else {
                true
            }
        }
    };
    let in_question = names_of(app, last_q);
    let mut subjects: Vec<String> = Vec::new();
    if let Some(a) = last_answer.filter(|a| !a.starts_with("The texts here")) {
        subjects.extend(names_of(app, a).into_iter().filter(|n| !in_question.contains(n) && fits(n)).take(1));
    }
    subjects.extend(in_question.iter().filter(|n| fits(n)).take(1).cloned());
    let mut out: Vec<String> = Vec::new();
    for s in subjects {
        let cap: String = s.chars().take(1).flat_map(char::to_uppercase).chain(s.chars().skip(1)).collect();
        let named = name_the_pronouns(question, &cap).or_else(|| {
            let rest = lower.trim_start_matches("and ").trim_start_matches("what about ").trim_start_matches("how about ");
            (rest.len() < lower.len()).then(|| format!("{cap}, {rest}"))
        });
        if let Some(q) = named {
            if !out.contains(&q) {
                out.push(q);
            }
        }
    }
    if out.is_empty() {
        out.push(with_context(question, Some(last_q)));
    }
    out
}

/// The passages (and a commentary note) for a question, searched with each of `queries`.
fn retrieve(app: &AppHandle, queries: &[String]) -> Result<Vec<AiSource>, String> {
    let db = app.state::<DbState>();
    let conn = db.0.lock().map_err(err)?;
    let embedder = app.state::<EmbedderState>();
    let study = app.state::<crate::study::StudyState>();
    let study_guard = study.0.as_ref().and_then(|m| m.lock().ok());
    let mut lists: Vec<Vec<bible_core::find::Found>> = Vec::new();
    for q in queries {
        let understood = bible_core::find::understand(&conn, crate::commands::search_vocab(&conn), q);
        let vector = embedder.0.embed(&understood.text).map_err(err)?;
        lists.push(crate::commands::semantic_found(&conn, &vector, q, PASSAGES as i64, study_guard.as_deref())?);
    }
    drop(study_guard);
    // the lists in turn, best first, without the same passage twice
    let mut out: Vec<AiSource> = Vec::new();
    let mut kept: Vec<(String, i64, i64, i64)> = Vec::new();
    for rank in 0..PASSAGES {
        for list in &lists {
            let Some(f) = list.get(rank) else { continue };
            if out.len() >= PASSAGES {
                break;
            }
            let overlaps = kept.iter().any(|(b, c, v, e)| *b == f.book && *c == f.chapter && f.verse <= *e && *v <= f.verse_end);
            if overlaps {
                continue;
            }
            if let Some(src) = window(&conn, f) {
                kept.push((f.book.clone(), f.chapter, f.verse, f.verse_end));
                out.push(src);
            }
        }
    }
    drop(conn);
    if let (Some(q), Ok(c)) = (queries.first(), crate::commands::commentary_conn(&app.state::<crate::commentaries::CommentaryState>())) {
        for h in crate::commentaries::search(&c, q, None, NOTES as i64).unwrap_or_default() {
            out.push(AiSource {
                tag: String::new(),
                label: format!("{} on {} {}:{}", h.commentary_name.replace(" Bible Commentary", ""), h.book, h.chapter, h.verse_start),
                book: h.book,
                chapter: h.chapter,
                verse: h.verse_start,
                verse_end: h.verse_start,
                text: h.snippet,
                chapter_text: String::new(),
            });
        }
    }
    for (i, s) in out.iter_mut().enumerate() {
        s.tag = format!("S{}", i + 1);
    }
    Ok(out)
}

/// Words that say nothing about whether an answer is in a passage.
const COMMON: &[&str] = &[
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "from", "as", "is", "was", "were", "be", "been",
    "are", "it", "its", "this", "that", "these", "those", "he", "she", "they", "them", "his", "her", "their", "him", "i", "you", "we", "us",
    "my", "your", "our", "me", "so", "because", "which", "who", "what", "when", "where", "why", "how", "not", "no", "had", "has", "have",
    "did", "do", "does", "will", "would", "could", "should", "also", "then", "there", "into", "about", "after", "before", "said", "says",
    "text", "texts", "source", "sources", "passage", "verse", "according", "answer",
];

fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2 && !COMMON.contains(w))
        .map(|w| w.trim_end_matches('s').to_string())
        .collect()
}

/// Whether the model's reply means "this passage doesn't answer".
pub(crate) fn says_no(text: &str) -> bool {
    let t = text.trim().trim_end_matches('.').to_lowercase();
    t.is_empty()
        || t == "no"
        || t.starts_with("no.")
        || t.starts_with("no,")
        || t.starts_with("no ")
        || t.ends_with(" no")
        || t.starts_with("the texts here")
        || [
            "does not provide", "doesn't provide", "does not mention", "doesn't mention", "does not say", "doesn't say", "not mentioned", "no information",
            "does not answer", "doesn't answer", "not specified", "does not state", "is not stated", "says nothing", "nothing about", "does not discuss",
            "doesn't discuss", "not discussed", "does not talk", "doesn't talk", "does not address", "doesn't address", "no mention", "does not refer",
            "doesn't refer", "does not speak", "doesn't speak",
        ]
            .iter()
            .any(|p| t.contains(p))
}

/// A reply without its repeated sentences (small models loop), and at most four sentences.
pub(crate) fn tidy(text: &str) -> String {
    let text = text.trim().trim_start_matches("Answer:").trim();
    let mut seen: Vec<String> = Vec::new();
    let mut out = String::new();
    let mut cur = String::new();
    let flush = |cur: &mut String, out: &mut String, seen: &mut Vec<String>| {
        let s = cur.trim().to_string();
        cur.clear();
        if s.is_empty() {
            return;
        }
        let key: String = s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
        if !seen.contains(&key) && seen.len() < 4 {
            seen.push(key);
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(&s);
        }
    };
    let chars: Vec<char> = text.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        cur.push(c);
        if matches!(c, '.' | '!' | '?') && chars.get(i + 1).map_or(true, |n| n.is_whitespace()) && !chars.get(i + 2).is_some_and(|n| *n == '[') {
            flush(&mut cur, &mut out, &mut seen);
        }
    }
    flush(&mut cur, &mut out, &mut seen);
    out
}

/// Number words that carry a fact ("one" is mostly a pronoun, so it isn't counted).
const NUMBER_WORDS: &[&str] = &[
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand",
];

/// Words of a text that are numbers: digits, and number words; digits also as words.
pub(crate) fn number_facts(text: &str) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    for w in text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
        if let Ok(n) = w.parse::<u32>() {
            out.insert(w.to_string());
            if let Some(words) = bible_core::find::number_words(n) {
                out.extend(words.split(' ').map(str::to_string));
            }
        } else if NUMBER_WORDS.contains(&w) || w == "one" {
            out.insert(w.to_string());
        }
    }
    out
}

/// Names the answer uses (capitalised words not at the start of a sentence).
pub(crate) fn names_in(answer: &str) -> Vec<String> {
    const SKIP: &[&str] = &[
        "bible", "scripture", "scriptures", "testament", "christian", "christians", "gospel", "gospels", "god", "lord", "spirit", "holy", "old", "new",
        "passage", "answer", "yes", "jews", "jewish", "israelites", "israelite",
    ];
    let mut out = Vec::new();
    let mut start = true;
    let mut word = String::new();
    let flush = |word: &mut String, start: &mut bool, out: &mut Vec<String>| {
        if word.is_empty() {
            return;
        }
        let w = std::mem::take(word);
        let first_upper = w.chars().next().is_some_and(|c| c.is_uppercase());
        let bare = w.trim_end_matches("'s").trim_end_matches("’s").trim_end_matches('\'').to_lowercase();
        if first_upper && !*start && bare.len() > 2 && !SKIP.contains(&bare.as_str()) {
            out.push(bare);
        }
        *start = false;
    };
    for c in answer.chars() {
        if c.is_alphabetic() || ((c == '\'' || c == '’') && !word.is_empty()) {
            word.push(c);
        } else {
            flush(&mut word, &mut start, &mut out);
            if matches!(c, '.' | '!' | '?' | ':') {
                start = true;
            }
        }
    }
    flush(&mut word, &mut start, &mut out);
    out
}

/// What the passage doesn't support in an answer: `hard` (an invented name or number, a verse
/// outside the passage, a quotation that isn't there: the answer isn't offered) and `soft`
/// (wording that differs a lot from the passage: offered with a "check this" label).
fn check_answer(answer: &str, source: &AiSource, question: &str, asked_names: &[String]) -> (Vec<String>, Vec<String>) {
    let (mut hard, mut soft) = (Vec::new(), Vec::new());
    let strip = regex::Regex::new(r"\[[^\]]*\]").unwrap();
    let refs = regex::Regex::new(r"(?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)? \d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?").unwrap();
    let clean = refs.replace_all(&strip.replace_all(answer, ""), "").to_string();
    let hay = strip.replace_all(&source.text, "").to_lowercase().replace('’', "'");
    let q = question.to_lowercase().replace('’', "'");
    let book = source.book.to_lowercase();

    for n in names_in(&clean) {
        if !(hay.contains(&n) || q.contains(&n) || book.contains(&n) || source.label.to_lowercase().contains(&n)) {
            hard.push(format!("the name “{n}” isn't in the passage"));
        }
    }
    // the subject of the question must be in the passage: a passage that never mentions
    // Abraham doesn't tell the name of Abraham's donkey. Only the people and places the search
    // recognised in the question count ("Great Commission" names no one).
    let hay_words: Vec<&str> = hay.split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 2).collect();
    for n in asked_names.iter().map(|n| n.to_lowercase()) {
        // Jesus is in every Gospel passage; a title ("the Baptist") is not a name
        if matches!(n.as_str(), "jesus" | "christ" | "baptist" | "apostle" | "prophet" | "king" | "queen") {
            continue;
        }
        let known_as = other_names(&n).iter().any(|a| hay.contains(a) || source.chapter_text.contains(a));
        let authored = bible_core::find::authored_books(&n).iter().any(|b| b.eq_ignore_ascii_case(&source.book));
        // (the search gives names as the Bible spells them, so a misspelling is already put right)
        let typo = n.len() >= 6 && hay_words.iter().any(|w| w.chars().next() == n.chars().next() && w.len().abs_diff(n.len()) <= 1 && edit_distance(&n, w) <= 1);
        if !(hay.contains(&n) || authored || known_as || typo || book.contains(&n) || source.chapter_text.contains(&n)) {
            hard.push(format!("the passage never mentions {n}"));
        }
    }
    let have = number_facts(&format!("{hay} {q} {} {}", source.label, source.chapter));
    for w in clean.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
        let ok = match w.parse::<u32>() {
            // a digit is supported by the digit, or by all the words for it
            Ok(n) => have.contains(w) || bible_core::find::number_words(n).is_some_and(|ws| ws.split(' ').all(|x| have.contains(x))),
            Err(_) => !NUMBER_WORDS.contains(&w) || have.contains(w),
        };
        if !ok {
            hard.push(format!("the number “{w}” isn't in the passage"));
        }
    }
    // a verse the answer names must be one of the passage's
    if !source.label.contains(" on ") {
        let marker = regex::Regex::new(r"\[((?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)?) (\d+):(\d+)\]").unwrap();
        let have_verses: Vec<(String, i64, i64)> = marker.captures_iter(&source.text).map(|c| (c[1].to_string(), c[2].parse().unwrap_or(0), c[3].parse().unwrap_or(0))).collect();
        let reference = regex::Regex::new(r"((?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)?) (\d{1,3}):(\d{1,3})").unwrap();
        for c in reference.captures_iter(answer) {
            let (b, ch, v) = (c[1].to_string(), c[2].parse::<i64>().unwrap_or(0), c[3].parse::<i64>().unwrap_or(0));
            if !have_verses.iter().any(|(hb, hc, hv)| (hb.eq_ignore_ascii_case(&b) || (b == "Psalm" && hb == "Psalms")) && *hc == ch && *hv == v) {
                let same_chapter = (b.eq_ignore_ascii_case(&source.book) || (b == "Psalm" && source.book == "Psalms")) && ch == source.chapter && !source.chapter_text.is_empty();
                if same_chapter {
                    soft.push(format!("{} is in the chapter but wasn't among the verses read", &c[0]));
                } else {
                    hard.push(format!("{} isn't in the passage", &c[0]));
                }
            }
        }
    }
    // a quotation must be in the passage, word for word (ignoring punctuation and case)
    let norm = |s: &str| s.to_lowercase().replace('’', "'").split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    let all = norm(&hay);
    let quote = regex::Regex::new(r#"["“]([^"”]{20,})["”]"#).unwrap();
    for c in quote.captures_iter(&clean) {
        if !all.contains(&norm(&c[1])) {
            hard.push(format!("a quotation isn't in the passage: “{}”", c[1].trim()));
        }
    }
    // wording far from the passage's: a soft warning
    let asked: std::collections::HashSet<String> = words(question).into_iter().collect();
    let content: Vec<String> = words(&clean).into_iter().filter(|w| !asked.contains(w)).collect();
    if content.len() >= 4 {
        let in_text: std::collections::HashSet<String> = words(&hay).into_iter().collect();
        if (content.iter().filter(|w| in_text.contains(*w)).count() as f32) < 0.4 * content.len() as f32 {
            soft.push("the wording differs a lot from the passage".to_string());
        }
    }
    (hard, soft)
}

fn edit_distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let cur = row[j];
            row[j] = (row[j] + 1).min(row[j - 1] + 1).min(prev + usize::from(a[i - 1] != b[j - 1]));
            prev = cur;
        }
    }
    row[b.len()]
}

/// A follow-up ("what about his children?") is searched with the question before it; a question
/// that stands on its own isn't (the earlier topic would pull the search away).
/// The words of a text, lower case, without verse tags and punctuation.
fn plain_words(text: &str) -> Vec<String> {
    let strip = regex::Regex::new(r"\[[^\]]*\]").unwrap();
    strip
        .replace_all(text, " ")
        .to_lowercase()
        .replace('’', "'")
        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Words that carry meaning (not the small words, and not ones the question already used).
fn content_words(text: &str, question: &str) -> std::collections::HashSet<String> {
    const SMALL: &[&str] = &[
        "the", "and", "that", "was", "were", "his", "her", "him", "she", "they", "them", "their", "for", "with", "from", "this", "these", "those", "who", "whom",
        "which", "what", "when", "where", "not", "are", "had", "has", "have", "been", "will", "would", "also", "into", "unto", "then", "than", "but", "you", "your",
    ];
    let asked: std::collections::HashSet<String> = plain_words(question).into_iter().collect();
    plain_words(text).into_iter().filter(|w| w.len() > 3 && !SMALL.contains(&w.as_str()) && !asked.contains(w)).collect()
}

/// The verse(s) of the passage that prove an answer, with the Bible's own words: the verses the
/// answer cites, or (with no citation) the verse sharing the most meaning-words with it -- at
/// least one -- as `("Genesis 37:28", "text")`. Empty when no verse supports the answer.
fn proof_verses(answer: &str, source: &AiSource, question: &str) -> Vec<(String, String)> {
    let line = regex::Regex::new(r"^\[((?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)?) (\d+):(\d+)\]\s*(.*)$").unwrap();
    let verses: Vec<(String, i64, i64, String)> =
        source.text.lines().filter_map(|l| line.captures(l).map(|c| (c[1].to_string(), c[2].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[4].to_string()))).collect();
    let cite = regex::Regex::new(r"\[((?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)?) (\d+):(\d+)\]").unwrap();
    let mut out: Vec<(String, String)> = Vec::new();
    for c in cite.captures_iter(answer) {
        let (b, ch, v) = (c[1].to_string(), c[2].parse::<i64>().unwrap_or(0), c[3].parse::<i64>().unwrap_or(0));
        if let Some((vb, vc, vv, text)) = verses.iter().find(|(vb, vc, vv, _)| *vb == b && *vc == ch && *vv == v) {
            let r = format!("{vb} {vc}:{vv}");
            if !out.iter().any(|(x, _)| *x == r) {
                out.push((r, text.clone()));
            }
        }
        if out.len() >= 2 {
            return out;
        }
    }
    if !out.is_empty() {
        return out;
    }
    let mine = content_words(answer, question);
    let best = verses.iter().map(|(b, c, v, t)| (content_words(t, "").intersection(&mine).count(), b, c, v, t)).max_by_key(|x| x.0);
    match best {
        Some((n, b, c, v, t)) if n >= 1 => vec![(format!("{b} {c}:{v}"), t.clone())],
        _ => Vec::new(),
    }
}

/// A detail the question asks for that the passage never speaks of: a meal, a colour, a
/// measure in metres. ("What did Adam eat for dinner?" is not answered by a verse about eating.)
fn missing_detail(question: &str, passage: &str) -> Option<String> {
    const DETAILS: &[&str] = &[
        "dinner", "breakfast", "lunch", "supper", "colour", "color", "metres", "meters", "centimetres", "centimeters", "kilometres", "kilometers", "kilograms",
        "inches", "feet", "tall", "heavy", "weigh", "weight", "height",
    ];
    let have: std::collections::HashSet<String> = plain_words(passage).into_iter().collect();
    plain_words(question).into_iter().find(|w| DETAILS.contains(&w.as_str()) && !have.contains(w))
}

/// The reason a why-answer gives: what follows "because" / "so that" up to a verse tag.
fn reason_clause(answer: &str) -> Option<String> {
    let lower = answer.to_lowercase();
    let start = ["because", "so that", "in order that", "in order to", "since ", "lest"].iter().filter_map(|m| lower.find(m).map(|i| (i, m.len()))).min_by_key(|x| x.0)?;
    let rest = &answer[start.0 + start.1..];
    let rest = rest.split('[').next().unwrap_or(rest);
    Some(rest.trim().to_string())
}

/// How many of a reason's meaning-words are not in the passage it was given, and how many it
/// has (words matched by their first four letters, so "crowed" meets "crows"). The reason must
/// come from the passage, not from outside it: a reason with more than a third of its words
/// absent from the whole passage is the model's own ("because Jesus predicted it").
fn reason_not_in_passage(answer: &str, passage: &str, question: &str) -> Option<(usize, usize)> {
    let clause = reason_clause(answer)?;
    let stem = |w: &str| w.chars().take(4).collect::<String>();
    let mine: std::collections::HashSet<String> = content_words(&clause, question).iter().map(|w| stem(w)).collect();
    if mine.is_empty() {
        return None;
    }
    let verse: std::collections::HashSet<String> = plain_words(passage).into_iter().map(|w| stem(&w)).collect();
    let missing = mine.iter().filter(|w| !verse.contains(*w)).count();
    // a one-word reason must be the verse's; a two-word one may miss one; longer ones a third (less one)
    let allowed = match mine.len() {
        1 => 0,
        2 => 1,
        n => (n - 1) / 3,
    };
    (missing > allowed).then_some((missing, mine.len()))
}

/// Whether a question asks why.
fn is_why(question: &str) -> bool {
    let q = question.to_lowercase();
    q.split(|c: char| !c.is_alphanumeric()).any(|w| w == "why") || q.contains("how come") || q.contains("what reason") || q.contains("what made ")
}

/// Whether an answer states a reason (a why-answer must).
/// A "why" answer must rest on a verse that itself gives a cause (because, for, so that…), and, when
/// the question names someone, on a verse that names them: a prediction ("Jesus told him he would
/// deny Him") or a verse about someone else ("you are to name Him Jesus, because…") is no reason.
fn why_not_grounded(answer: &str, proof: &[(String, String)], asked_names: &[String]) -> Option<String> {
    // only a "reason" that is really a prediction or something still to come ("told him", "would give
    // birth") is held to this: true reasons often have no word of cause in their verse
    let a = format!(" {} ", answer.to_lowercase());
    if !["would", "will", "told", "predicted", "foretold", "prophesied", "promised"].iter().any(|w| a.contains(&format!(" {w} "))) {
        return None;
    }
    const CAUSE: &[&str] = &["because", "for", "so that", "in order", "since", "lest", "therefore", "that is why", "for this reason", "so as"];
    let padded = |t: &str| format!(" {} ", t.to_lowercase().split(|c: char| !c.is_alphanumeric() && c != '\'').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    let cause = proof.iter().any(|(_, text)| {
        let p = padded(text);
        CAUSE.iter().any(|c| p.contains(&format!(" {c} ")))
    });
    if !cause {
        return Some("the verse it rests on doesn't give a cause".to_string());
    }
    if !asked_names.is_empty() {
        let named = proof.iter().any(|(_, text)| {
            let l = text.to_lowercase();
            asked_names.iter().any(|n| l.contains(&n.to_lowercase()))
        });
        if !named {
            return Some(format!("the verse it rests on never names {}", asked_names.join(" or ")));
        }
    }
    None
}

/// Family words in a question, and the Bible's own ways of saying each ("who was Samuel's mother":
/// "Hannah conceived and bore a son"). Sons and daughters are left out: a list of children comes
/// from several verses, and "the prodigal son" is no family question.
const RELATIONS: &[(&[&str], &[&str])] = &[
    (&["brother", "brothers"], &["brother", "brothers"]),
    (&["sister", "sisters"], &["sister", "sisters"]),
    (&["father", "fathers", "dad"], &["father", "fathers", "begot", "fathered", "became the father", "begat"]),
    (&["mother", "mothers", "mom"], &["mother", "mothers", "bore", "bear", "gave birth", "conceived", "womb"]),
    (&["wife", "wives"], &["wife", "wives", "married", "marry", "took a wife", "took as a wife"]),
    (&["husband", "husbands"], &["husband", "husbands", "married", "marry"]),
    (&["nephew", "nephews"], &["nephew", "nephews", "brother's son", "brother’s son"]),
    (&["uncle", "uncles"], &["uncle", "uncles", "father's brother", "father’s brother"]),
    (&["cousin", "cousins"], &["cousin", "cousins", "relative", "kinsman", "kinswoman"]),
    (&["grandfather", "grandson", "grandchildren", "grandmother", "grandsons"], &["grandfather", "grandson", "grandsons", "grandchildren", "grandmother", "son of", "sons of", "father of"]),
];

/// A question about a relation ("who was Adam's brother") must be backed by a verse of the passage
/// that speaks of that relation, names the person asked about, and names the person given as the
/// answer: "Adam had a son Cain" is no evidence of a brother of Adam's, and "Cain's brother Abel" is
/// about Cain.
fn relation_not_in_passage(question: &str, answer: &str, source: &AiSource, asked_names: &[String]) -> Option<String> {
    if source.label.contains(" on ") {
        return None;
    }
    let q = question.to_lowercase();
    let words: Vec<&str> = q.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let norm = |s: &str| s.to_lowercase().replace('’', "'");
    let verses: Vec<String> = source.text.lines().map(|l| norm(l.split_once("] ").map_or(l, |x| x.1))).collect();
    // the people the answer names (not the one asked about)
    let skip = ["the", "this", "that", "yes", "because", "god", "lord", "israel"];
    let given: Vec<String> = answer
        .split(|c: char| !c.is_alphabetic() && c != '\'')
        .filter(|w| w.chars().next().is_some_and(char::is_uppercase) && w.len() > 2)
        .map(|w| norm(w.trim_end_matches("'s")))
        .filter(|w| !skip.contains(&w.as_str()) && !asked_names.iter().any(|n| norm(n) == *w))
        .collect();
    // only "Adam's brother" or "the brother of Mary" is held to this; "mother-in-law" is not
    let possessed = regex::Regex::new(r"\w['’]s (?:own )?(\w+)|\b(\w+) of (?:the )?[a-z]").unwrap();
    let asked_relation: Vec<String> = possessed.captures_iter(&q).flat_map(|c| [c.get(1), c.get(2)]).flatten().map(|m| m.as_str().to_string()).collect();
    if q.contains("in law") || q.contains("in-law") || q.contains("how many") {
        return None;
    }
    for (asked, said) in RELATIONS {
        if !words.iter().any(|w| asked.contains(w)) || !asked_relation.iter().any(|w| asked.contains(&w.as_str())) {
            continue;
        }
        // "Samuel's mother" is answered with a person, not with a sentence about Samuel that has "mother" in it
        if given.is_empty() && !asked_names.is_empty() {
            return Some(format!("the answer names no one as the {}", asked[0]));
        }
        let backed = verses.iter().any(|l| {
            let plain = l.split(|c: char| !c.is_alphanumeric() && c != '\'').collect::<Vec<_>>().join(" ");
            let relation = said.iter().any(|s| plain.contains(&norm(s)));
            let person = asked_names.is_empty()
                || asked_names.iter().any(|n| {
                    let n = norm(n);
                    l.contains(&n) || other_names(&n).iter().any(|a| l.contains(a))
                });
            let named = given.is_empty() || given.iter().any(|g| l.contains(g));
            relation && person && named
        });
        if !backed {
            return Some(format!("no verse of the passage says that about a {}", asked[0]));
        }
    }
    None
}

fn states_reason(answer: &str) -> bool {
    let a = answer.to_lowercase();
    ["because", "so that", "in order", "since ", "lest", "therefore", "for this reason", "that is why", "by faith", "as a result", "so he ", "so they ", "so i "]
        .iter()
        .any(|m| a.contains(m))
}

/// Whether a short question leans on the one before it ("what about his brother?", "who anointed him?").
fn is_follow_up(question: &str) -> bool {
    let q = question.to_lowercase();
    let ws: Vec<&str> = q.split(|c: char| !c.is_alphanumeric() && c != '\'').filter(|w| !w.is_empty()).collect();
    const CUES: &[&str] = &["he", "she", "his", "her", "hers", "him", "they", "them", "their", "it", "its", "that", "this", "those", "these", "there", "also", "too"];
    ws.len() <= 9 && (ws.iter().any(|w| CUES.contains(w)) || q.starts_with("what about") || q.starts_with("how about") || q.starts_with("and "))
}

/// The women of the Bible most often asked about (a follow-up with "she" or "her" is about one of them).
const WOMEN: &[&str] = &[
    "eve", "sarah", "sarai", "hagar", "rebekah", "rachel", "leah", "dinah", "tamar", "miriam", "zipporah", "rahab", "deborah", "jael", "delilah", "ruth",
    "naomi", "orpah", "hannah", "bathsheba", "abigail", "michal", "jezebel", "athaliah", "esther", "vashti", "mary", "martha", "elizabeth", "anna",
    "salome", "joanna", "lydia", "priscilla", "dorcas", "tabitha", "phoebe", "sapphira", "herodias", "keturah", "huldah", "eunice", "lois", "susanna",
];

/// "his"/"he"/"him" and "her"/"she" in a follow-up, with whom they mean ("who was his father" →
/// "who was David's father"); None when the question has no pronoun to replace.
fn name_the_pronouns(question: &str, subject: &str) -> Option<String> {
    let mut changed = false;
    let words: Vec<&str> = question.split_whitespace().collect();
    let out: Vec<String> = words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let core = w.trim_matches(|c: char| !c.is_alphanumeric());
            let tail: String = w.chars().rev().take_while(|c| !c.is_alphanumeric()).collect::<String>().chars().rev().collect();
            let l = core.to_lowercase();
            let last_word = i + 1 == words.len();
            let new = match l.as_str() {
                "he" | "she" | "him" => Some(subject.to_string()),
                "his" => Some(format!("{subject}'s")),
                "her" if last_word => Some(subject.to_string()),
                "her" => Some(format!("{subject}'s")),
                _ => None,
            };
            match new {
                Some(n) => {
                    changed = true;
                    format!("{n}{tail}")
                }
                None => (*w).to_string(),
            }
        })
        .collect();
    changed.then(|| out.join(" "))
}

fn with_context(question: &str, last: Option<&str>) -> String {
    let Some(last) = last else { return question.to_string() };
    if is_follow_up(question) { format!("{last} {question}") } else { question.to_string() }
}

struct Step {
    source: AiSource,
    raw: String,
    no: bool,
    answer: String,
    /// the Bible's own words that show the answer: ("Genesis 37:28", "text")
    proof: Vec<(String, String)>,
    hard: Vec<String>,
    soft: Vec<String>,
}

struct Run {
    /// the question as it was finally asked (a follow-up with its pronouns named)
    asked: String,
    queries: Vec<String>,
    steps: Vec<Step>,
    sources: usize,
}

/// The engine writes one reply at a time: two at once (a question while thread notes are being
/// written, or two runs of the test harness) are the likely cause of its rare crashes.
static GENERATING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// One reply of the model.
#[allow(deprecated)]
pub(crate) async fn complete(model: &foundry_local_sdk::Model, system: &str, user: &str, max_tokens: u32, temperature: f64) -> Result<String, String> {
    use tokio_stream::StreamExt;
    let _one_at_a_time = GENERATING.lock().await;
    let msgs: Vec<foundry_local_sdk::ChatCompletionRequestMessage> = vec![
        foundry_local_sdk::ChatCompletionRequestSystemMessage::from(system).into(),
        foundry_local_sdk::ChatCompletionRequestUserMessage::from(user).into(),
    ];
    let client = model.create_chat_client().temperature(temperature).max_tokens(max_tokens);
    let mut stream = client.complete_streaming_chat(&msgs, None).await.map_err(err)?;
    let mut text = String::new();
    while let Some(chunk) = stream.next().await {
        if let Some(p) = chunk.map_err(err)?.choices.first().and_then(|c| c.delta.content.clone()) {
            text.push_str(&p);
        }
    }
    Ok(without_thinking(&text))
}

/// Whether a passage answers a question, by the Q&A's own reading with all its checks (names,
/// numbers, verses, the Bible's own words as proof, the strict second reading): the answer, or
/// None. `lines` are the passage's verses as ("[John 3:16] text").
pub(crate) async fn passage_answer(model: &foundry_local_sdk::Model, book: &str, chapter: i64, first: i64, last: i64, lines: &str, question: &str) -> Option<String> {
    let source = AiSource {
        tag: String::new(),
        label: format!("{book} {chapter}:{first}-{last}"),
        book: book.to_string(),
        chapter,
        verse: first,
        verse_end: last,
        text: lines.to_string(),
        chapter_text: lines.to_lowercase(),
    };
    let system = if is_why(question) { WHY_RULES } else { RULES };
    let step = read_passage(model, system, &source, question, &[]).await.ok()?;
    (!step.no && step.hard.is_empty() && !step.answer.trim().is_empty()).then_some(step.answer)
}

/// One passage read with the model, and its answer judged: no answer is offered unless it
/// passes the checks (names, numbers, verses), quotes the passage's own words, and a second,
/// strict reading agrees the passage itself says it.
async fn read_passage(model: &foundry_local_sdk::Model, system: &str, source: &AiSource, question: &str, asked_names: &[String]) -> Result<Step, String> {
    let passage = if source.label.contains(" on ") { format!("[{}] {}", source.label, source.text) } else { source.text.clone() };
    let raw = complete(model, system, &format!("Passage:\n{passage}\n\nQuestion: {question}\nAnswer:"), 160, 0.2).await?;
    let no = says_no(&raw);
    let answer = tidy(&raw);
    if no {
        return Ok(Step { source: source.clone(), raw, no, answer, proof: Vec::new(), hard: Vec::new(), soft: Vec::new() });
    }
    let (mut hard, soft) = check_answer(&answer, source, question, asked_names);
    if is_why(question) && !states_reason(&answer) {
        hard.push("it doesn't give a reason".to_string());
    }
    if let Some(d) = missing_detail(question, &source.text) {
        hard.push(format!("the passage doesn't speak of “{d}”"));
    }
    let proof = proof_verses(&answer, source, question);
    if proof.is_empty() {
        hard.push("no verse of the passage backs it up".to_string());
    } else if let Some(why) = relation_not_in_passage(question, &answer, source, asked_names) {
        hard.push(why);
    }
    if is_why(question) && !proof.is_empty() {
        if let Some(why) = why_not_grounded(&answer, &proof, asked_names) {
            hard.push(why);
        }
    }
    if is_why(question) {
        if let Some((missing, total)) = reason_not_in_passage(&answer, &source.text, question) {
            hard.push(format!("the reason it gives isn't in the passage ({missing} of its {total} key words are missing)"));
        }
    }
    if hard.is_empty() {
        let verdict = complete(model, VERIFY_RULES, &format!("Passage:\n{passage}\n\nQuestion: {question}\nAnswer: {answer}\n\nDoes the passage itself say this?"), 4, 0.0).await?;
        if !verdict.trim().to_uppercase().starts_with("YES") {
            hard.push("checked again: the passage itself doesn't say this".to_string());
        }
    }
    Ok(Step { source: source.clone(), raw, no, answer, proof, hard, soft })
}

/// Searches for the passages and reads each with the model; used by the chat and the test command.
async fn run_question(app: &AppHandle, chat_id: i64, question: &str, last_question: Option<&str>, last_answer: Option<&str>, facts: &[String]) -> Result<Run, String> {
    let candidates = follow_up_candidates(app, question, last_question, last_answer);
    let mut best: Option<Run> = None;
    for c in &candidates {
        let run = run_one(app, chat_id, c, facts).await?;
        let answered = run.steps.iter().any(|s| !s.no && s.hard.is_empty());
        if answered {
            return Ok(run);
        }
        if best.is_none() {
            best = Some(run);
        }
    }
    best.ok_or_else(|| "Type a question.".to_string())
}

/// One question: the passages are searched for it and each is read with it.
async fn run_one(app: &AppHandle, chat_id: i64, question: &str, facts: &[String]) -> Result<Run, String> {
    let status = |text: String| {
        let _ = app.emit("ai-status", Status { chat_id, text });
    };
    let full = question.to_string();
    status("Looking in the texts…".into());
    let model = engine(app).await?;
    // search words for the question (the model's help is for finding passages only)
    let words = complete(&model, SEARCH_RULES, &format!("Question: {full}\nWords:"), 24, 0.2).await.unwrap_or_default();
    let words = words.lines().next().unwrap_or("").trim().trim_matches(|c: char| !c.is_alphanumeric()).to_string();
    let mut queries = vec![full.clone()];
    if words.split_whitespace().count() >= 2 && words.len() < 100 && words.to_lowercase() != full.to_lowercase() {
        queries.push(words);
    }
    let sources = retrieve(app, &queries)?;
    let asked_names = question_names(app, question);
    let mut system = if is_why(question) { WHY_RULES.to_string() } else { RULES.to_string() };
    if !facts.is_empty() {
        system.push_str("\n\nThe reader asked you to remember: ");
        system.push_str(&facts.join("; "));
    }
    let mut steps = Vec::new();
    let total = sources.len();
    for (i, source) in sources.iter().enumerate() {
        status(format!("Reading {} ({} of {total})…", source.label, i + 1));
        steps.push(read_passage(&model, &system, source, question, &asked_names).await?);
    }
    // every passage said NO: the best three are read again, asked for what they do say about it
    if steps.iter().all(|s| s.no) {
        for step in steps.iter_mut().take(3) {
            let again = read_passage(&model, RETRY_RULES, &step.source, question, &asked_names).await?;
            if again.no {
                continue;
            }
            let first = std::mem::take(&mut step.raw);
            *step = again;
            step.raw = format!("{first} [second reading: {}]", step.raw);
            step.soft.push("a partial answer: the passage doesn't say it outright".to_string());
        }
    }
    Ok(Run { queries, steps, sources: total, asked: question.to_string() })
}

#[derive(Serialize)]
pub struct AiReply {
    chat_id: i64,
    messages: Vec<AiMessage>,
}

/// Asks in a chat (a new one when `chat_id` is None); progress arrives as "ai-status" events,
/// and the reply is the chat's messages once it is finished.
#[tauri::command]
pub async fn ai_ask(app: AppHandle, chat_id: Option<i64>, question: String) -> Result<AiReply, String> {
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err("Type a question.".into());
    }
    // the chat
    let (chat_id, history, facts) = {
        let user = app.state::<UserDataState>();
        let c = user.0.lock().map_err(err)?;
        let id = match chat_id {
            Some(id) => id,
            None => {
                let title: String = question.chars().take(60).collect();
                c.execute("INSERT INTO ai_chats (title) VALUES (?1)", params![title]).map_err(err)?;
                c.last_insert_rowid()
            }
        };
        let history = messages(&c, id)?;
        let facts: Vec<String> = memory(&c)?.into_iter().map(|m| m.fact).collect();
        save(&c, id, "user", &question, &[], &[], "question")?;
        (id, history, facts)
    };
    let finish = |content: &str, sources: &[AiSource], unsupported: &[String], kind: &str| -> Result<AiReply, String> {
        let user = app.state::<UserDataState>();
        let c = user.0.lock().map_err(err)?;
        save(&c, chat_id, "assistant", content, sources, unsupported, kind)?;
        Ok(AiReply { chat_id, messages: messages(&c, chat_id)? })
    };

    // "remember ..." -- kept for every chat
    let lower = question.to_lowercase();
    if let Some(fact) = ["remember that ", "remember: ", "remember "].iter().find_map(|p| lower.starts_with(p).then(|| question[p.len()..].trim().to_string())) {
        if !fact.is_empty() {
            app.state::<UserDataState>().0.lock().map_err(err)?.execute("INSERT INTO ai_memory (fact) VALUES (?1)", params![fact]).map_err(err)?;
            return finish(&format!("I'll remember that: {fact}"), &[], &[], "memory");
        }
    }

    // a hand-checked answer: word for word
    if let Some(text) = curated_answer(&app, &question)? {
        return finish(&text, &[], &[], "curated");
    }

    let last_question = history.iter().rev().find(|m| m.role == "user").map(|m| m.content.clone());
    let last_answer = history.iter().rev().find(|m| m.role == "assistant").map(|m| m.content.clone());
    let run = run_question(&app, chat_id, &question, last_question.as_deref(), last_answer.as_deref(), &facts).await?;
    if run.sources == 0 {
        return finish("The texts here don't answer that.", &[], &[], "none");
    }
    let good: Vec<&Step> = run.steps.iter().filter(|s| !s.no && s.hard.is_empty()).collect();
    let doubtful = run.steps.iter().filter(|s| !s.no && !s.hard.is_empty()).count();
    if good.is_empty() {
        let note = if doubtful > 0 { "The texts here don't answer that clearly enough to give an answer." } else { "The texts here don't answer that." };
        let used: Vec<AiSource> = run.steps.iter().map(|s| s.source.clone()).take(4).collect();
        return finish(note, &used, &[], "no_answer");
    }
    let shown: Vec<&Step> = good.into_iter().take(MAX_ANSWERS).collect();
    let quoted = |s: &Step| s.proof.iter().map(|(r, t)| format!("\n“{t}” — {r}")).collect::<String>();
    let mut content = if shown.len() == 1 {
        format!("{}: {}{}", shown[0].source.label, shown[0].answer, quoted(shown[0]))
    } else {
        let list: Vec<String> = shown.iter().enumerate().map(|(i, s)| format!("{}. {}: {}{}", i + 1, s.source.label, s.answer, quoted(s))).collect();
        format!("Possible answers from the texts:\n\n{}", list.join("\n\n"))
    };
    if doubtful > 0 {
        content.push_str(&format!("\n\n({doubtful} other passage{} may touch on this, but not clearly enough to quote.)", if doubtful == 1 { "" } else { "s" }));
    }
    let warnings: Vec<String> = shown.iter().flat_map(|s| s.soft.iter().map(move |x| format!("{}: {x}", s.source.label))).collect();
    let used: Vec<AiSource> = shown.iter().map(|s| s.source.clone()).collect();
    finish(&content, &used, &warnings, "model")
}

/// The hand-checked answer (qa.json) for a question, word for word, if there is one.
fn curated_answer(app: &AppHandle, question: &str) -> Result<Option<String>, String> {
    let db = app.state::<DbState>();
    let conn = db.0.lock().map_err(err)?;
    let qa = &app.state::<QaState>().0;
    let firsts = &app.state::<FirstsState>().0;
    let entry = match qa.data.find_exact(question) {
        Some(e) => Some(crate::commands::build_curated_entry(e, &conn, firsts)?),
        None => {
            let v = app.state::<EmbedderState>().0.embed(question).map_err(err)?;
            match qa.best_match(&v) {
                Some((source, id, sim)) if sim >= 0.75 && source == "qa" => qa.data.get(&id).map(|e| crate::commands::build_curated_entry(e, &conn, firsts)).transpose()?,
                _ => None,
            }
        }
    };
    Ok(entry.map(|entry| {
        let mut text = entry.answer.clone();
        if let Some(n) = &entry.note {
            text.push_str("\n\n");
            text.push_str(n);
        }
        if !entry.citations.is_empty() {
            text.push_str("\n\nSee: ");
            text.push_str(&entry.citations.iter().map(|c| c.reference.clone()).collect::<Vec<_>>().join("; "));
        }
        text
    }))
}

#[derive(Serialize)]
pub struct ProbeStep {
    label: String,
    passage: String,
    raw: String,
    says_no: bool,
    answer: String,
    /// the Bible's own words shown under the answer
    proof: Vec<String>,
    /// what makes the answer unusable (the answer isn't offered)
    unsupported: Vec<String>,
    /// what makes it doubtful (offered with a label)
    soft: Vec<String>,
}

#[derive(Serialize)]
pub struct Probe {
    curated: Option<String>,
    query: String,
    queries: Vec<String>,
    steps: Vec<ProbeStep>,
}

/// For testing: exactly what a chat would do for a question, with every step shown. Nothing is
/// saved. (`history_question`: the question before it, for a follow-up.)
#[tauri::command]
pub async fn ai_probe(app: AppHandle, question: String, history_question: Option<String>, history_answer: Option<String>) -> Result<Probe, String> {
    let question = question.trim().to_string();
    let curated = curated_answer(&app, &question)?;
    let run = run_question(&app, 0, &question, history_question.as_deref(), history_answer.as_deref(), &[]).await?;
    let steps = run
        .steps
        .into_iter()
        .map(|s| ProbeStep { label: s.source.label.clone(), passage: s.source.text.chars().take(400).collect(), raw: s.raw, says_no: s.no, answer: s.answer, proof: s.proof.into_iter().map(|(r, t)| format!("{r}: {t}")).collect(), unsupported: s.hard, soft: s.soft })
        .collect();
    Ok(Probe { curated, query: run.asked, queries: run.queries, steps })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(label: &str, text: &str) -> AiSource {
        let book = label.rsplit_once(' ').map(|(b, _)| b).unwrap_or(label).to_string();
        let (b, rest) = label.rsplit_once(' ').unwrap();
        let chapter = rest.split(':').next().unwrap().parse().unwrap();
        AiSource { tag: "S1".into(), label: label.into(), book: b.to_string().max(book), chapter, verse: 1, verse_end: 99, text: text.into(), chapter_text: String::new() }
    }

    fn noah_src() -> AiSource {
        src("Genesis 9:13-13", "[Genesis 9:13] I have set My bow in the clouds, and it will be the sign of the covenant between Me and the earth.")
    }

    #[test]
    fn a_prediction_is_no_reason_for_a_why_answer() {
        let v = |r: &str, t: &str| vec![(r.to_string(), t.to_string())];
        // Peter's denial: Jesus' prediction is no reason
        let peter = v("Luke 22:61", "The Lord turned and looked at Peter. Then Peter remembered the word of the Lord, who had said, “Before the rooster crows today, you will deny Me three times.”");
        assert!(why_not_grounded("Because the Lord told him that before the rooster crowed Peter would deny Him.", &peter, &["peter".into()]).is_some());
        // the flood and Lot's wife: real reasons, no prediction, no cause word needed
        assert!(why_not_grounded("Because the earth was full of violence.", &v("Genesis 6:13", "for through them the earth is full of violence."), &[]).is_none());
        assert!(why_not_grounded("Because she looked back.", &v("Genesis 19:26", "But Lot’s wife looked back, and she became a pillar of salt."), &["lot".into()]).is_none());
        // the naming of Jesus is not the choosing of Mary; and a promise of what she would bear is no reason
        let jesus = v("Matthew 1:21", "She will bear a Son, and you are to name Him Jesus, because He will save His people from their sins.");
        assert!(why_not_grounded("Because she would give birth to Jesus, who would save His people.", &jesus, &["mary".into()]).is_some());
        let luke = v("Luke 1:31", "You will conceive in your womb and bear a Son, and you are to name Him Jesus.");
        assert!(why_not_grounded("Because she was favoured and would give birth to Jesus.", &luke, &["mary".into()]).is_some());
        assert!(why_not_grounded("Because she was favoured and would give birth to Jesus.", &v("Luke 1:30", "“Do not be afraid, Mary, for you have found favor with God."), &["mary".into()]).is_none());
    }

    #[test]
    fn a_person_under_another_name_is_still_the_person() {
        let gen13 = src("Genesis 13:10-12", "[Genesis 13:10] Lot looked up and saw that the whole plain of the Jordan was well watered. [Genesis 13:12] Abram lived in the land of Canaan, but Lot settled among the cities of the plain and pitched his tent toward Sodom.");
        assert!(check_answer("Lot.", &gen13, "Who was Abraham's nephew who chose to live near Sodom?", &["abraham".to_string()]).0.is_empty());
        let acts = src("Acts 13:9-9", "[Acts 13:9] Then Saul, who was also called Paul, filled with the Holy Spirit, looked straight at him.");
        assert!(check_answer("Saul.", &acts, "what was pauls name before", &["paul".to_string(), "baptist".to_string()]).0.is_empty());
    }

    #[test]
    fn thinking_is_taken_out_of_a_reply() {
        assert_eq!(without_thinking("<think>Let me see.</think>
Sarah."), "Sarah.");
        assert_eq!(without_thinking("Let me see.</think>Sarah."), "Sarah.");
        assert_eq!(without_thinking("<think>still thinking"), "");
        assert_eq!(without_thinking("NO"), "NO");
    }

    #[test]
    fn pronouns_are_named() {
        assert_eq!(name_the_pronouns("who was his father", "David").as_deref(), Some("who was David's father"));
        assert_eq!(name_the_pronouns("how did he die", "John").as_deref(), Some("how did John die"));
        assert_eq!(name_the_pronouns("who anointed him?", "Saul").as_deref(), Some("who anointed Saul?"));
        assert_eq!(name_the_pronouns("what was her name", "Rebekah").as_deref(), Some("what was Rebekah's name"));
        assert_eq!(name_the_pronouns("who married her", "Ruth").as_deref(), Some("who married Ruth"));
        assert_eq!(name_the_pronouns("what about his brother", "Moses").as_deref(), Some("what about Moses's brother"));
        assert_eq!(name_the_pronouns("who was Adam's brother", "Cain"), None);
        assert!(is_follow_up("who anointed him"));
        assert!(!is_follow_up("who was abraham's wife"));
    }

    #[test]
    fn a_relation_needs_a_verse_that_speaks_of_it() {
        let names = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // Adam had no brother: his sons are not his brothers, and "Cain's brother Abel" is Cain's
        let gen4 = src("Genesis 4:1-3", "[Genesis 4:1] Adam had relations with his wife Eve, and she conceived and gave birth to Cain.\n[Genesis 4:2] Later she gave birth to his brother Abel. Now Cain was a tiller of the soil.");
        assert!(relation_not_in_passage("who was adam's brother", "Adam's brother is Cain. [Genesis 4:1]", &gen4, &names(&["adam"])).is_some());
        let gen5 = src("Genesis 5:3-3", "[Genesis 5:3] When Adam was 130 years old, he had a son in his own likeness, and he named him Seth.");
        assert!(relation_not_in_passage("who was adam's brother", "Seth.", &gen5, &names(&["adam"])).is_some());
        // the Bible's own words for a relation are enough, in a verse that names both people
        let sam = src("1 Samuel 1:19-20", "[1 Samuel 1:19] Elkanah knew his wife Hannah.\n[1 Samuel 1:20] Hannah conceived and bore a son, and she named him Samuel.");
        assert!(relation_not_in_passage("who was samuel's mother", "Hannah was Samuel's mother.", &sam, &names(&["samuel"])).is_none());
        let lot = src("Genesis 14:12-12", "[Genesis 14:12] They also carried off Abram's nephew Lot and his possessions.");
        assert!(relation_not_in_passage("who was abraham's nephew", "Lot.", &lot, &names(&["abraham"])).is_none());
        let laz = src("John 11:1-2", "[John 11:2] Mary, whose brother Lazarus was sick.");
        assert!(relation_not_in_passage("who was the brother of mary and martha", "Lazarus.", &laz, &names(&["mary", "martha"])).is_none());
        // "the prodigal son", "how many sons" and "mother-in-law" are no questions about one relation
        assert!(relation_not_in_passage("what is the parable of the prodigal son about", "A son who left.", &gen5, &names(&[])).is_none());
        assert!(relation_not_in_passage("who was ruth's mother in law", "Naomi.", &gen5, &names(&["ruth"])).is_none());
        assert!(relation_not_in_passage("how many brothers did joseph have", "Eleven.", &gen5, &names(&["joseph"])).is_none());
        // an answer that names no one as the relation ("Samuel's mother will be childless") is no answer
        let agag = src("1 Samuel 15:32-34", "[1 Samuel 15:33] Samuel said, As your sword has made women childless, so your mother will be childless among women. And Samuel hewed Agag to pieces.");
        assert!(relation_not_in_passage("and samuel's mother", "Samuel's mother will be childless among women.", &agag, &names(&["samuel"])).is_some());
        // a question with no relation in it is not held to this
        assert!(relation_not_in_passage("who killed goliath", "David.", &gen5, &names(&["goliath"])).is_none());
    }

    #[test]
    fn unlock_code_is_hashed() {
        assert_eq!(UNLOCK.len(), 64);
    }

    #[test]
    fn a_no_in_other_words() {
        assert!(says_no("NO"));
        assert!(says_no("The passage does not provide information regarding Daniel's age at the time of his death. NO."));
        assert!(!says_no("The prince of the kingdom of Persia opposed him for twenty-one days [Daniel 10:13]."));
        // the other ways a small model says no (seen in the 2026-10-20 run)
        assert!(says_no("The Bible says nothing about nuclear weapons."));
        assert!(says_no("The passage does not discuss Jesus' father or his death."));
        assert!(!says_no("Jesus said, “Go and make disciples of all nations” [Matthew 28:19]."));
    }

    #[test]
    fn a_reason_must_come_from_the_passage_it_was_given() {
        let john11 = "[John 11:33] When Jesus saw her weeping, He was deeply moved. [John 11:35] Jesus wept. [John 11:36] So the Jews said, “See how He loved him!”";
        assert_eq!(reason_not_in_passage("Because He loved Lazarus. [John 11:36]", john11, "why did jesus weep"), None);
        let fig = "[Matthew 21:19] He went up to it but found nothing on it except leaves. Then He said, “May no fruit ever come from you again!”";
        assert_eq!(reason_not_in_passage("Because the fig tree had no fruit. [Matthew 21:19]", fig, "why did jesus curse the fig tree"), None);
        let ex14 = "[Exodus 14:4] And I will harden Pharaoh’s heart so that he will pursue them. But I will gain glory over Pharaoh and all his army.";
        assert_eq!(reason_not_in_passage("God hardened his heart so that he would pursue the Israelites. [Exodus 14:4]", ex14, "why did god harden pharaohs heart"), None);
        // a reason whose words are in another verse of the same passage is the passage's (the model often cites a neighbour)
        let flood = "[Genesis 6:5] The LORD saw that the wickedness of man was great. [Genesis 6:13] I am going to destroy them. The earth is filled with violence because of them.";
        assert_eq!(reason_not_in_passage("Because the earth was filled with violence and the wickedness of man was great. [Genesis 6:13]", flood, "why did god flood the earth"), None);
        // a reason from outside the passage is not
        let peter = "[Mark 14:30] “Truly I tell you,” Jesus replied, “this very night, before the rooster crows twice, you yourself will disown Me three times.” [Mark 14:31] But Peter insisted, “Even if I have to die with You, I will never disown You.”";
        assert!(reason_not_in_passage("Because Jesus predicted it would happen before the rooster crowed twice. [Mark 14:30]", peter, "why did peter deny jesus three times").is_some());
        assert!(reason_not_in_passage("Because Mary was the most righteous woman in all Israel. [Luke 1:28]", "[Luke 1:28] “Greetings, you who are highly favored! The Lord is with you.”", "why did god choose mary").is_some());
        // an answer with no reason isn't judged here (is_why / states_reason does that)
        assert_eq!(reason_clause("He spit on the ground."), None);
    }

    #[test]
    fn a_detail_the_passage_never_speaks_of_is_caught() {
        let gen3 = "[Genesis 3:18] Both thorns and thistles it will yield for you, and you will eat the plants of the field.";
        assert_eq!(missing_detail("what did adam eat for dinner", gen3).as_deref(), Some("dinner"));
        assert_eq!(missing_detail("how tall was goliath in metres", "[1 Samuel 17:4] a champion named Goliath, whose height was six cubits").as_deref(), Some("tall"));
        // a detail the passage does give is fine
        assert_eq!(missing_detail("how tall was goliath", "[1 Samuel 17:4] he was tall, six cubits and a span"), None);
        assert_eq!(missing_detail("what did jesus have for breakfast", "[John 21:12] Jesus said, Come and have breakfast."), None);
        assert_eq!(missing_detail("who was moses brother", gen3), None);
    }

    #[test]
    fn why_questions_must_get_a_reason() {
        assert!(is_why("Why did Jacob wrestle with God?"));
        assert!(is_why("why didnt david kill saul"));
        assert!(is_why("how come the sea parted"));
        assert!(!is_why("who walked on water"));
        assert!(!is_why("what is the whys and wherefores"));
        assert!(states_reason("Because He loved Lazarus."));
        assert!(states_reason("God hardened it so that he would pursue them."));
        assert!(!states_reason("He spit on the ground and made mud."));
    }

    #[test]
    fn the_proof_is_the_bibles_own_words() {
        let gen37 = src(
            "Genesis 37:26-28",
            "[Genesis 37:26] Then Judah said to his brothers, “What profit is there if we kill our brother and conceal his blood?\n[Genesis 37:28] So when the Midianite traders passed by, his brothers pulled Joseph up from the cistern and sold him for twenty shekels of silver to the Ishmaelites, who took him to Egypt.",
        );
        // the verse the answer cites, with its own text
        let p = proof_verses("The Midianites sold Joseph to Egypt. [Genesis 37:28]", &gen37, "who sold joseph to egypt");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].0, "Genesis 37:28");
        assert!(p[0].1.starts_with("So when the Midianite traders"));
        // a verse not in the passage is not proof
        assert!(proof_verses("It was Judah. [Genesis 38:1]", &gen37, "who sold joseph").iter().all(|(r, _)| r != "Genesis 38:1"));
        // no citation: the verse that shares the answer's words
        let p = proof_verses("His brothers sold him for twenty shekels of silver.", &gen37, "who sold joseph");
        assert_eq!(p[0].0, "Genesis 37:28");
        // nothing in the passage backs it up
        assert!(proof_verses("Zebulun.", &gen37, "what was the name of abrahams donkey").is_empty());
    }

    #[test]
    fn possessives_come_off_before_looking_for_names() {
        assert_eq!(without_possessives("What was the name of Abraham's donkey?"), "What was the name of Abraham donkey");
        assert_eq!(without_possessives("what was the name of noahs wife"), "what was the name of noahs noah wife");
        assert_eq!(without_possessives("who was moses brother"), "who was moses mose brother");
    }

    #[test]
    fn names_are_the_peoples_and_checked_in_the_whole_chapter() {
        // "the Great Commission" names no one: a right answer isn't refused for lack of "Great"
        let mt28 = src("Matthew 28:18-20", "[Matthew 28:19] Therefore go and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit, [Matthew 28:20] and teaching them to obey all that I have commanded you.");
        assert!(check_answer("The Great Commission is to make disciples of all nations.", &mt28, "What is the Great Commission?", &[]).0.is_empty());
        // Goliath isn't named in the verses read, but is in their chapter
        let mut sam = src("1 Samuel 17:48-50", "[1 Samuel 17:49] David reached into his bag, took out a stone, and slung it, striking the Philistine on the forehead. [1 Samuel 17:50] Thus David prevailed over the Philistine.");
        sam.chapter_text = "and a champion named goliath, who was from gath, came out of the philistine camp. david reached into his bag".into();
        assert!(check_answer("David killed him with a sling and a stone.", &sam, "Who killed Goliath?", &["goliath".to_string()]).0.is_empty());
        // a verse of that chapter that wasn't read is a doubt, not a reason to hide the answer
        let (hard, soft) = check_answer("David struck the Philistine [1 Samuel 17:4].", &sam, "Who killed Goliath?", &["goliath".to_string()]);
        assert!(hard.is_empty() && soft.iter().any(|s| s.contains("17:4")), "{hard:?} {soft:?}");
        // a passage that never mentions Noah, not even in its chapter, can't name his wife
        let gen17 = src("Genesis 17:15-15", "[Genesis 17:15] Then God said to Abraham, “As for Sarai your wife, do not call her Sarai, for her name is to be Sarah.”");
        assert!(!check_answer("Sarai.", &gen17, "what was the name of noahs wife", &["noah".to_string()]).0.is_empty());
        // the psalm's own number is known
        let ps23 = src("Psalms 23:1-6", "[Psalms 23:1] The LORD is my shepherd; I shall not want.");
        assert!(check_answer("It is Psalm 23.", &ps23, "the lord is my shepherd which psalm", &[]).0.is_empty());
    }

    #[test]
    fn a_good_answer_passes_and_an_invented_one_does_not() {
        let gen20 = src("Genesis 20:1-3", "[Genesis 20:1] Now Abraham journeyed from there. [Genesis 20:2] And Abraham said of his wife Sarah, “She is my sister.” [Genesis 20:3] But God came to Abimelech.");
        // the model's plain answers, with no verse tags, and a paraphrase
        assert!(check_answer("Sarah was Abraham's wife.", &gen20, "who was abraham/s wife?", &["abraham".to_string()]).0.is_empty());
        assert!(check_answer("Abraham called Sarah his sister [Genesis 20:2].", &gen20, "who was abraham/s wife?", &["abraham".to_string()]).0.is_empty());
        // an invented name, an invented number, a verse that isn't in the passage
        assert_eq!(check_answer("Abraham's wife was Keturah.", &gen20, "who was abraham/s wife?", &["abraham".to_string()]).0.len(), 1);
        let flood = src("Genesis 7:1-4", "[Genesis 7:4] For in seven days I will send rain on the earth for forty days and forty nights.");
        assert!(check_answer("It rained for forty days.", &flood, "how long did it rain", &[]).0.is_empty());
        assert_eq!(check_answer("It rained for thirty days.", &flood, "how long did it rain", &[]).0.len(), 1);
        assert!(check_answer("It rained for 40 days.", &flood, "how long did it rain", &[]).0.is_empty());
        assert!(check_answer("It rained for forty days [Genesis 9:9].", &flood, "how long did it rain", &[]).0.iter().any(|b| b.contains("Genesis 9:9")));
        // twenty-one days, written either way
        let dan = src("Daniel 10:13-13", "[Daniel 10:13] However, the prince of the kingdom of Persia opposed me for twenty-one days.");
        assert!(check_answer("The prince of Persia opposed him for 21 days.", &dan, "why was it delayed", &[]).0.is_empty());
        // the subject of the question must be in the passage
        let tribes = src("Genesis 49:13-16", "[Genesis 49:13] Zebulun will dwell by the seashore. [Genesis 49:14] Issachar is a rawboned donkey.");
        assert!(check_answer("Zebulun.", &tribes, "What was the name of Abraham's donkey?", &["abraham".to_string()]).0.iter().any(|b| b.contains("abraham")));
        assert!(check_answer("Issachar is likened to a donkey.", &tribes, "which tribe is a donkey", &[]).0.is_empty());
        // a typo in the question's name is allowed; an author counts for his own letters
        let exo = src("Exodus 10:7-8", "[Exodus 10:7] Pharaoh’s officials said to him, “How long will this man be a snare to us?”");
        assert!(check_answer("Pharaoh.", &exo, "who was Pharos during the time of Moses", &["moses".to_string()]).0.iter().all(|b| !b.contains("pharos")));
        let cor = src("1 Corinthians 13:4-5", "[1 Corinthians 13:4] Love is patient, love is kind.");
        assert!(check_answer("Love is patient and kind.", &cor, "What did Paul say about love?", &["paul".to_string()]).0.is_empty());
        // a verse reference in the answer's own sentence is not a number to check
        assert!(check_answer("Yes, it is in Genesis 9:13.", &noah_src(), "is the rainbow in the bible", &[]).0.is_empty());
        // "rainbow" for the text's "bow" is a paraphrase, not an invention
        let noah = src("Genesis 9:13-13", "[Genesis 9:13] I have set My bow in the clouds, and it will be the sign of the covenant between Me and the earth.");
        let mut noah = noah;
        noah.chapter_text = "then god said to noah and his sons with him".into();
        assert!(check_answer("The sign was the rainbow.", &noah, "what sign did God give noah", &["noah".to_string()]).0.is_empty());
    }

    #[test]
    fn loops_are_cut() {
        assert_eq!(tidy("Faith is the assurance. Faith is the assurance. Faith is the assurance."), "Faith is the assurance.");
        assert_eq!(tidy("Answer: Esau and Jacob. [Genesis 25:25]"), "Esau and Jacob. [Genesis 25:25]");
    }

    #[test]
    fn follow_ups_only() {
        assert_eq!(with_context("who was adam's brother", Some("was Joseph considered Jesus father")), "who was adam's brother");
        assert_eq!(with_context("what about his children, how many did he have", Some("who was adam's brother")), "who was adam's brother what about his children, how many did he have");
        assert_eq!(with_context("who was abraham/s wife?", Some("how many animals were on the ark of Noah")), "who was abraham/s wife?");
    }
}
