//! The picture downloads (since 3.0.0): the Bible story pictures (31 paintings and engravings, with their credits) and the children's pictures
//! (original artwork), each an optional one-time download from the app's GitHub releases, checked by SHA-256 and unpacked into the app's data
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
    tag: "story-pictures-v1",
    folder: "story-pictures",
    marker: "credits.json",
    sha256: "ccb6de7bd2047dfe466c1ad6689a982d801b624f300fb5f50d10edecdf38e129",
    size_mb: 7,
    max_mb: 20,
};

pub const KIDS: Pack = Pack {
    kind: "kids",
    tag: "kids-pictures-v1",
    folder: "kids-pictures",
    marker: "ready.txt",
    sha256: "41f9bb93da0465c5ce0932511357f6c77cc75ef698d4798a1a9d77e760f13d74",
    size_mb: 1,
    max_mb: 10,
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

pub fn installed(data: &Path, p: &Pack) -> bool {
    data.join(p.folder).join(p.marker).exists()
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

pub fn kid_photo(data: &Path, id: &str) -> Option<KidPhoto> {
    if !safe(id) {
        return None;
    }
    crate::extra_pages::child_picture(data, id).map(|(image, outline, credit)| KidPhoto { image, outline, credit })
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
        let _ = std::fs::remove_dir_all(&dir);
    }
}
