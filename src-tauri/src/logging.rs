//! The app's error log: a plain text file (`bible-concordance.log` in the per-user log
//! folder) that collects Rust panics and the errors the web view reports (uncaught
//! exceptions, rejected promises, console errors/warnings, failed commands), so a problem
//! a reader saw in the installed app -- where there are no developer tools -- can be found
//! afterwards. Settings > Diagnostics opens the folder or copies the recent lines.
//!
//! It never leaves the computer: nothing here sends anything anywhere.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const FILE: &str = "bible-concordance.log";
const OLD_FILE: &str = "bible-concordance.old.log";
/// Past this size at start-up the log is moved to `.old.log` (replacing the previous one).
const MAX_BYTES: u64 = 1024 * 1024;
/// At most this many lines from the web view per minute, so an error repeating in a
/// render loop can't fill the disk.
const MAX_PER_MINUTE: u32 = 120;
const MAX_MESSAGE: usize = 4000;

struct Log {
    path: PathBuf,
    window: Instant,
    in_window: u32,
    dropped: u32,
}

static LOG: OnceLock<Mutex<Log>> = OnceLock::new();

/// Starts the log in `dir` (rotating an oversized one) and routes Rust panics to it.
pub fn init(dir: &Path, version: &str) {
    let _ = std::fs::create_dir_all(dir);
    let path = dir.join(FILE);
    if std::fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join(OLD_FILE));
    }
    let _ = LOG.set(Mutex::new(Log { path, window: Instant::now(), in_window: 0, dropped: 0 }));
    write("info", "app", &format!("Bible Concordance {version} started ({} {})", std::env::consts::OS, std::env::consts::ARCH));

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        let at = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        write("panic", "rust", &format!("{what}{at}"));
        default_hook(info);
    }));
}

pub fn path() -> Option<PathBuf> {
    LOG.get().and_then(|l| l.lock().ok().map(|l| l.path.clone()))
}

/// Appends one line: `2026-10-06 14:03:11Z [error] web: message`.
pub fn write(level: &str, source: &str, message: &str) {
    let Some(log) = LOG.get() else { return };
    let Ok(log) = log.lock() else { return };
    append(&log.path, level, source, message);
}

fn append(path: &Path, level: &str, source: &str, message: &str) {
    let mut message: String = message.chars().take(MAX_MESSAGE).collect();
    // one entry per line keeps the file easy to read and to tail
    message = message.replace("\r\n", "\n").replace('\n', "\n    ");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} [{level}] {source}: {message}", timestamp());
    }
}

/// A line from the web view, rate-limited.
pub fn write_limited(level: &str, source: &str, message: &str) {
    let Some(log) = LOG.get() else { return };
    let Ok(mut log) = log.lock() else { return };
    if log.window.elapsed().as_secs() >= 60 {
        if log.dropped > 0 {
            let note = format!("{} more lines in the last minute were not written", log.dropped);
            append(&log.path, "warn", "log", &note);
        }
        log.window = Instant::now();
        log.in_window = 0;
        log.dropped = 0;
    }
    if log.in_window >= MAX_PER_MINUTE {
        log.dropped += 1;
        return;
    }
    log.in_window += 1;
    append(&log.path, level, source, message);
}

/// The last `lines` lines of the log (and of the previous one, if this one is short).
pub fn recent(lines: usize) -> String {
    let Some(path) = path() else { return String::new() };
    let mut text = std::fs::read_to_string(&path).unwrap_or_default();
    if text.lines().count() < lines {
        if let Some(old) = path.parent().map(|d| d.join(OLD_FILE)).and_then(|p| std::fs::read_to_string(p).ok()) {
            text = old + &text;
        }
    }
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// UTC time as "YYYY-MM-DD HH:MM:SSZ" (no date crate needed: Howard Hinnant's
/// days-to-civil algorithm).
fn timestamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

// ---------------------------------------------------------------- commands

/// A line from the web view (uncaught errors, console errors and warnings).
#[tauri::command]
pub fn log_event(level: String, message: String) {
    let level = match level.as_str() {
        "error" | "warn" | "info" => level,
        _ => "info".into(),
    };
    write_limited(&level, "web", &message);
}

#[tauri::command]
pub fn log_recent(lines: Option<usize>) -> String {
    recent(lines.unwrap_or(200).min(2000))
}

/// Where the log is, for Settings.
#[tauri::command]
pub fn log_path() -> Option<String> {
    path().map(|p| p.display().to_string())
}

/// Shows the log file in Explorer / Finder.
#[tauri::command]
pub fn open_log_folder() -> Result<(), String> {
    let p = path().ok_or("The log hasn't started.")?;
    if !p.exists() {
        append(&p, "info", "app", "log opened");
    }
    tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_shape() {
        let t = timestamp();
        assert_eq!(t.len(), 20, "{t}");
        assert!(t.starts_with("20") && t.ends_with('Z'), "{t}");
    }

    #[test]
    fn writes_rotates_and_reads_back() {
        let dir = std::env::temp_dir().join(format!("bc-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), vec![b'x'; (MAX_BYTES + 10) as usize]).unwrap();
        init(&dir, "test");
        assert!(dir.join(OLD_FILE).exists(), "oversized log rotated");
        write("error", "web", "first line\nsecond line");
        for i in 0..(MAX_PER_MINUTE + 5) {
            write_limited("warn", "web", &format!("spam {i}"));
        }
        let text = std::fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(text.contains("[error] web: first line\n    second line"), "{text}");
        assert!(text.contains(&format!("spam {}", MAX_PER_MINUTE - 1)) && !text.contains(&format!("spam {}", MAX_PER_MINUTE)));
        assert!(recent(3).lines().count() == 3);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
