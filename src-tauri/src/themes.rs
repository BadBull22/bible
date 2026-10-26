//! Looks for the slides: pictures and looping videos kept in a folder (a pack of backgrounds and title graphics, such
//! as the free ones churches use with ProPresenter). The folder is read where it is; a file is copied into the app only
//! when it is chosen (sermon_media::import_file), so a pack of hundreds of megabytes is never copied whole.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const IMAGES: [&str; 5] = ["jpg", "jpeg", "png", "gif", "webp"];
const VIDEOS: [&str; 4] = ["mp4", "m4v", "mov", "webm"];
/// How deep into a pack's folders to look, and how many files to list.
const DEPTH: usize = 3;
const MAX_FILES: usize = 600;
/// The largest picture sent to show as a small picture.
const MAX_THUMB: u64 = 30 << 20;

#[derive(Serialize, Debug, PartialEq)]
pub struct ThemeFile {
    pub path: String,
    /// the file's name, without its folder
    pub name: String,
    /// the folder it is in, relative to the one chosen ("" for the top)
    pub folder: String,
    /// "image" or "video"
    pub kind: String,
    /// "background" (a picture that fills the slide, or a video) or "overlay" (a heading, title graphic or layer with
    /// see-through parts, to lay over a background)
    pub role: String,
    pub size: u64,
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

pub fn kind_of(p: &Path) -> Option<&'static str> {
    let e = ext_of(p);
    if IMAGES.contains(&e.as_str()) {
        Some("image")
    } else if VIDEOS.contains(&e.as_str()) {
        Some("video")
    } else {
        None
    }
}

/// Whether a PNG has a see-through channel (its header says so: colour type 4 grey with alpha, or 6 colour with alpha),
/// read from the first bytes only.
pub fn png_has_alpha(path: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 26];
    let Ok(mut f) = fs::File::open(path) else { return false };
    if f.read_exact(&mut head).is_err() || &head[..8] != b"\x89PNG\r\n\x1a\n" {
        return false;
    }
    matches!(head[25], 4 | 6)
}

/// What a file is for: a PNG with see-through parts (a title graphic, a paint-sweep layer) is laid over a background, and so
/// is anything in a folder called titles, layers, lower thirds or overlays; the rest are backgrounds.
pub fn role_of(path: &Path, folder: &str) -> &'static str {
    let f = folder.to_lowercase();
    let named = ["title", "layer", "lower third", "lowerthird", "overlay", "logo"].iter().any(|w| f.contains(w));
    if kind_of(path) == Some("image") && (named || (ext_of(path) == "png" && png_has_alpha(path))) {
        "overlay"
    } else {
        "background"
    }
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<ThemeFile>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    for e in entries {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            // not a pack's previews of its Photoshop files, and not hidden folders
            let name = e.file_name().to_string_lossy().to_string();
            if depth < DEPTH && !name.starts_with('.') && !name.starts_with("__") {
                walk(root, &path, depth + 1, out);
            }
        } else if let Some(kind) = kind_of(&path) {
            let rel = path.parent().and_then(|p| p.strip_prefix(root).ok()).map(|p| p.display().to_string().replace('\\', "/")).unwrap_or_default();
            let role = role_of(&path, &rel).to_string();
            out.push(ThemeFile { path: path.display().to_string(), name: e.file_name().to_string_lossy().to_string(), folder: rel, kind: kind.into(), role, size: meta.len() });
        }
    }
}

/// The pictures and videos in a folder and the folders inside it.
pub fn list(root: &Path) -> Result<Vec<ThemeFile>, String> {
    if !root.is_dir() {
        return Err("That folder isn't there any more.".into());
    }
    let mut out = Vec::new();
    walk(root, root, 0, &mut out);
    Ok(out)
}

#[tauri::command]
pub async fn theme_list(folder: String) -> Result<Vec<ThemeFile>, String> {
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&folder))).await.map_err(|e| e.to_string())?
}

/// A picture's bytes, to show it small in the list (only a picture, and not an enormous one).
#[tauri::command]
pub async fn theme_thumb(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(path);
    if kind_of(&p) != Some("image") {
        return Err("Not a picture.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
        if meta.len() > MAX_THUMB {
            return Err("That picture is very large.".into());
        }
        fs::read(&p).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Keeps a copy of the chosen picture or video with the app, and says what it is called there.
#[tauri::command]
pub async fn theme_use(app: AppHandle, path: String) -> Result<crate::sermon_media::MediaFile, String> {
    let p = PathBuf::from(path);
    if kind_of(&p).is_none() {
        return Err("Only a picture or a video can be used as a look.".into());
    }
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || crate::sermon_media::import_file(&data, &p)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bc-themes-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_pack_lists_its_pictures_and_loops_and_nothing_else() {
        let root = scratch("list");
        fs::create_dir_all(root.join("Stills")).unwrap();
        fs::create_dir_all(root.join("Motion/loops")).unwrap();
        fs::create_dir_all(root.join(".hidden")).unwrap();
        fs::write(root.join("Stills/a.JPG"), b"x").unwrap();
        fs::write(root.join("Stills/guide.pdf"), b"x").unwrap();
        fs::write(root.join("Stills/template.psd"), b"x").unwrap();
        fs::write(root.join("Motion/loops/b.mp4"), b"xx").unwrap();
        fs::write(root.join("c.png"), b"x").unwrap();
        fs::write(root.join(".hidden/d.png"), b"x").unwrap();
        let got = list(&root).unwrap();
        let names: Vec<_> = got.iter().map(|f| format!("{}|{}|{}", f.folder, f.name, f.kind)).collect();
        assert_eq!(names, vec!["|c.png|image", "Motion/loops|b.mp4|video", "Stills|a.JPG|image"], "{names:?}");
        // (these test files are not real pictures, so none has a see-through channel, and none is in a titles folder)
        assert!(got.iter().all(|f| f.role == "background"));
        assert!(list(&root.join("nope")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    /// A PNG's first bytes: the signature, the IHDR chunk, and its colour type.
    fn png(colour_type: u8) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n".to_vec();
        b.extend_from_slice(&[0, 0, 0, 13]);
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&[0, 0, 7, 128, 0, 0, 4, 56, 8, colour_type, 0, 0, 0]);
        b
    }

    #[test]
    fn a_see_through_heading_is_told_from_a_background() {
        let root = scratch("roles");
        fs::create_dir_all(root.join("Pro Titles")).unwrap();
        fs::create_dir_all(root.join("Pro Layers")).unwrap();
        fs::create_dir_all(root.join("Still Backgrounds")).unwrap();
        fs::write(root.join("Pro Titles/Advent.png"), png(6)).unwrap();
        fs::write(root.join("Pro Layers/Sweep.png"), png(2)).unwrap(); // in a layers folder, whatever its channels
        fs::write(root.join("Still Backgrounds/Wide.png"), png(2)).unwrap(); // a picture with no see-through channel
        fs::write(root.join("Still Backgrounds/Cutout.png"), png(6)).unwrap(); // see-through, wherever it is kept
        fs::write(root.join("Still Backgrounds/Photo.jpg"), b"jpeg").unwrap();
        fs::write(root.join("Pro Titles/Hope.mp4"), b"video").unwrap(); // a video is always a background
        let got = list(&root).unwrap();
        let role = |n: &str| got.iter().find(|f| f.name == n).unwrap().role.clone();
        assert_eq!(role("Advent.png"), "overlay");
        assert_eq!(role("Sweep.png"), "overlay");
        assert_eq!(role("Wide.png"), "background");
        assert_eq!(role("Cutout.png"), "overlay");
        assert_eq!(role("Photo.jpg"), "background");
        assert_eq!(role("Hope.mp4"), "background");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_chosen_file_is_copied_once_whatever_it_is_called() {
        let src = scratch("src");
        let data = scratch("data");
        fs::write(src.join("loop one.MP4"), vec![7u8; 3_000_000]).unwrap();
        fs::write(src.join("same.mp4"), vec![7u8; 3_000_000]).unwrap();
        let a = crate::sermon_media::import_file(&data, &src.join("loop one.MP4")).unwrap();
        let b = crate::sermon_media::import_file(&data, &src.join("same.mp4")).unwrap();
        assert_eq!(a, b, "the same contents are kept once");
        assert!(a.file.ends_with(".mp4") && crate::sermon_media::valid_name(&a.file), "{}", a.file);
        assert_eq!(a.size, 3_000_000);
        assert_eq!(fs::read(crate::sermon_media::path_of(&data, &a.file).unwrap()).unwrap().len(), 3_000_000);
        assert!(fs::read_dir(crate::sermon_media::media_dir(&data)).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")), "no leftover temporary file");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&data);
    }
}
