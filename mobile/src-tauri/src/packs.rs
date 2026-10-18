//! Downloads the app fetches once from its GitHub releases and keeps in its data folder: the
//! nature backgrounds (`backgrounds`) and the Advanced search upgrade (`meaning_pack`). A pack
//! is a zip with a known SHA-256, unpacked beside the old copy and then swapped in.

use std::fs;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Downloads `url` (at most `max_mb`), checks it is the file expected and unpacks it into
/// `data/<folder>`; `progress` is told the percentage downloaded.
pub fn install(data: &Path, url: &str, sha256: &str, folder: &str, max_mb: u64, progress: &dyn Fn(u8)) -> Result<(), String> {
    let response = ureq::get(url)
        .set("User-Agent", "BibleConcordance-Android (https://bible4me.org)")
        .timeout(std::time::Duration::from_secs(600))
        .call()
        .map_err(|_| "Couldn't download it. Check the phone's internet connection and try again.".to_string())?;
    let total: Option<usize> = response.header("Content-Length").and_then(|v| v.parse().ok());
    let mut bytes = Vec::with_capacity(total.unwrap_or(8 << 20));
    let mut reader = response.into_reader().take(max_mb << 20);
    let mut chunk = [0u8; 64 * 1024];
    let mut last = 0u8;
    loop {
        let n = reader.read(&mut chunk).map_err(|_| "The download stopped before it was finished. Please try again.".to_string())?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(t) = total.filter(|&t| t > 0) {
            let pct = ((bytes.len() * 100) / t).min(100) as u8;
            if pct != last {
                last = pct;
                progress(pct);
            }
        }
    }
    let sum = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
    if sum != sha256 {
        return Err("The download didn't arrive whole. Please try again.".into());
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
    let fresh = data.join(format!("{folder}.part"));
    let _ = fs::remove_dir_all(&fresh);
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(err)?;
        let Some(name) = f.enclosed_name() else { continue };
        let out = fresh.join(name);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(err)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(err)?;
        fs::write(&out, buf).map_err(err)?;
    }
    let _ = fs::remove_dir_all(data.join(folder));
    fs::rename(&fresh, data.join(folder)).map_err(err)
}

/// Removes a pack (nothing to do if it isn't there).
pub fn remove(data: &Path, folder: &str) -> Result<(), String> {
    match fs::remove_dir_all(data.join(folder)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}
