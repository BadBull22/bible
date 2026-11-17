//! The picture downloads (since 3.0.0): the Bible story pictures (paintings and engravings, with their credits) and the children's pictures
//! (original drawings, and paintings with an outline to colour in for the later pages), each an optional one-time download from the app's GitHub releases, checked by SHA-256 and unpacked into the app's data
//! folder (`packs::install`), made by `mobile/data/build_picture_packs.py`. Without them every Browse page reads as well; the pictures are an addition.
//! The story pictures are shown at a smaller file size (the long side at most 1500 pixels), otherwise unchanged, and say so in their credit.

use std::path::Path;

use base64::Engine;
use serde::Serialize;

pub struct Pack {
    /// "stories" | "kids" (what the page asks for)
    pub kind: &'static str,
    /// the release (and the file in it): `<tag>/<tag>.zip`
    pub tag: &'static str,
    pub folder: &'static str,
    /// a file that is there once the pack is
    pub marker: &'static str,
    pub sha256: &'static str,
    pub size_mb: u32,
    pub max_mb: u64,
}

pub const STORIES: Pack = Pack {
    kind: "stories",
    tag: "story-pictures-v2",
    folder: "story-pictures",
    marker: "credits.json",
    sha256: "2b153640769501dbf635d88c8d5542f1f95ff56688d17f1fc8c0de83529d87a7",
    size_mb: 12,
    max_mb: 40,
};

pub const KIDS: Pack = Pack {
    kind: "kids",
    tag: "kids-pictures-v2",
    folder: "kids-pictures",
    marker: "ready.txt",
    sha256: "d11f91ccc1d40cc05390e2723e8b0a5bea9483c5efd50857c6572960c446ea77",
    size_mb: 7,
    max_mb: 30,
};

pub fn pack(kind: &str) -> Option<&'static Pack> {
    [&STORIES, &KIDS].into_iter().find(|p| p.kind == kind)
}

impl Pack {
    /// Where it is downloaded from. A build made for testing can point somewhere else (`BC_PICTURE_PACKS_BASE=http://host:port/` when it is
    /// compiled, with the zips in that folder); a release build never does.
    pub fn url(&self) -> String {
        match option_env!("BC_PICTURE_PACKS_BASE") {
            Some(base) => format!("{base}{}.zip", self.tag),
            None => format!("https://github.com/BadBull22/bible/releases/download/{0}/{0}.zip", self.tag),
        }
    }
}

/// Whether the current pictures are there: the marker file, and the pack's own name (`pack-version.txt`). An older pack has no such name, so it is offered again.
pub fn installed(data: &Path, p: &Pack) -> bool {
    let dir = data.join(p.folder);
    dir.join(p.marker).exists() && std::fs::read_to_string(dir.join("pack-version.txt")).map(|t| t.trim() == p.tag).unwrap_or(false)
}

pub fn install(data: &Path, p: &Pack, progress: &dyn Fn(u8)) -> Result<(), String> {
    crate::packs::install(data, &p.url(), p.sha256, p.folder, p.max_mb, progress)?;
    if !installed(data, p) {
        return Err("The pictures were downloaded but are not all there. Please try again.".into());
    }
    Ok(())
}

pub fn remove(data: &Path, p: &Pack) -> Result<(), String> {
    crate::packs::remove(data, p.folder)
}

/// A page's name as the files spell it: lower-case letters, digits and hyphens only (nothing that could leave the folder).
fn safe(id: &str) -> bool {
    !id.is_empty() && id.len() < 80 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[derive(Serialize, Debug)]
pub struct StoryPicture {
    /// the picture, as base64 JPEG
    pub image: String,
    /// who made it, where it is from, the licence (the pack's credits.json entry)
    pub credit: serde_json::Value,
}

/// A story's picture with its credit: from the downloaded story pictures when they are there and have one for it, otherwise the picture an additional
/// story brought in its file (`extra_pages::picture`).
pub fn story_picture(data: &Path, id: &str) -> Option<StoryPicture> {
    if !safe(id) {
        return None;
    }
    from_pack(data, id).or_else(|| crate::extra_pages::picture(data, id).map(|(image, credit)| StoryPicture { image, credit }))
}

/// The picture from the downloaded story pictures (not the ones an additional story brings with it).
fn from_pack(data: &Path, id: &str) -> Option<StoryPicture> {
    let dir = data.join(STORIES.folder);
    let bytes = std::fs::read(dir.join(format!("{id}.jpg"))).ok()?;
    let credits: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("credits.json")).ok()?).ok()?;
    let credit = credits.get(id)?.clone();
    Some(StoryPicture { image: base64::engine::general_purpose::STANDARD.encode(bytes), credit })
}

/// A children's page's picture (SVG, as base64), in colour or as an outline to colour in, when the pack is downloaded.
pub fn kid_picture(data: &Path, id: &str, outline: bool) -> Option<String> {
    if !safe(id) {
        return None;
    }
    let name = if outline { format!("{id}-line.svg") } else { format!("{id}.svg") };
    let bytes = std::fs::read(data.join(KIDS.folder).join(name)).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// The picture of an additional children's page, brought in the file the reader fetched (a photograph-style illustration, not the app's own drawings).
#[derive(Serialize, Debug)]
pub struct KidPhoto {
    /// the picture, as base64 JPEG
    pub image: String,
    /// the same picture as black lines on white, to colour in (base64 PNG), when the file has one
    pub outline: Option<String>,
    /// who made it, where it is from, the licence
    pub credit: serde_json::Value,
}

/// A children's page's painting: from the downloaded children's pictures (the pages that came with the app) when they have one, otherwise the picture an
/// additional page brought in its file.
pub fn kid_photo(data: &Path, id: &str) -> Option<KidPhoto> {
    if !safe(id) {
        return None;
    }
    kid_photo_from_pack(data, id).or_else(|| crate::extra_pages::child_picture(data, id).map(|(image, outline, credit)| KidPhoto { image, outline, credit }))
}

fn kid_photo_from_pack(data: &Path, id: &str) -> Option<KidPhoto> {
    let dir = data.join(KIDS.folder);
    let b64 = base64::engine::general_purpose::STANDARD;
    let image = b64.encode(std::fs::read(dir.join(format!("{id}.jpg"))).ok()?);
    let credits: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("credits.json")).ok()?).ok()?;
    let credit = credits.get(id)?.clone();
    let outline = std::fs::read(dir.join(format!("{id}-line.png"))).ok().map(|b| b64.encode(b));
    Some(KidPhoto { image, outline, credit })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_come_from_the_downloaded_folders_and_names_cannot_leave_them() {
        let dir = std::env::temp_dir().join(format!("bc-phone-pics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("story-pictures")).unwrap();
        std::fs::create_dir_all(dir.join("kids-pictures")).unwrap();
        // not downloaded yet
        assert!(!installed(&dir, &STORIES) && !installed(&dir, &KIDS));
        assert!(story_picture(&dir, "david-and-goliath").is_none() && kid_picture(&dir, "david-and-the-giant", false).is_none());
        std::fs::write(dir.join("story-pictures").join("david-and-goliath.jpg"), b"jpeg").unwrap();
        std::fs::write(dir.join("story-pictures").join("credits.json"), r#"{"david-and-goliath":{"title":"David lance sa fronde","artist":"James Tissot"}}"#).unwrap();
        std::fs::write(dir.join("kids-pictures").join("david-and-the-giant.svg"), b"<svg/>").unwrap();
        std::fs::write(dir.join("kids-pictures").join("david-and-the-giant-line.svg"), b"<svg line/>").unwrap();
        std::fs::write(dir.join("kids-pictures").join("ready.txt"), b"x").unwrap();
        // the files are there but the pack does not say which one it is (an older download): offered again
        assert!(!installed(&dir, &STORIES) && !installed(&dir, &KIDS));
        std::fs::write(dir.join("story-pictures").join("pack-version.txt"), format!("{}\n", STORIES.tag)).unwrap();
        std::fs::write(dir.join("kids-pictures").join("pack-version.txt"), format!("{}\n", KIDS.tag)).unwrap();
        assert!(installed(&dir, &STORIES) && installed(&dir, &KIDS));
        let p = story_picture(&dir, "david-and-goliath").unwrap();
        assert_eq!(p.credit["artist"], "James Tissot");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(p.image).unwrap(), b"jpeg");
        assert!(story_picture(&dir, "noah-and-the-flood").is_none(), "no picture or credit for it");
        let svg = kid_picture(&dir, "david-and-the-giant", true).unwrap();
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(svg).unwrap(), b"<svg line/>");
        // a name that tries to leave the folder finds nothing
        for bad in ["../x", "a/b", "A", "", "..", "x.jpg"] {
            assert!(story_picture(&dir, bad).is_none() && kid_picture(&dir, bad, false).is_none(), "{bad}");
        }
        assert!(pack("stories").is_some() && pack("kids").is_some() && pack("nope").is_none());
        // a painting with its outline and credit comes from the children's pictures; without a credit it is not shown
        assert!(kid_photo(&dir, "jonah-for-children").is_none());
        std::fs::write(dir.join("kids-pictures").join("jonah-for-children.jpg"), b"jpeg").unwrap();
        std::fs::write(dir.join("kids-pictures").join("jonah-for-children-line.png"), b"png").unwrap();
        assert!(kid_photo(&dir, "jonah-for-children").is_none(), "no credit, not shown");
        std::fs::write(dir.join("kids-pictures").join("credits.json"), r#"{"jonah-for-children":{"title":"Jonah","artist":"An artist"}}"#).unwrap();
        let k = kid_photo(&dir, "jonah-for-children").unwrap();
        assert_eq!(k.credit["artist"], "An artist");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(k.image).unwrap(), b"jpeg");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(k.outline.unwrap()).unwrap(), b"png");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
