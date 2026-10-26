//! The sermon's slides as a ProPresenter presentation bundle (.probundle): one native ProPresenter
//! presentation (Protocol Buffers, the `rv.data.Presentation` message) and the photos, videos and
//! music the slides use, in one zip file. In ProPresenter it is File > Import (or drag it into a
//! playlist) and the slides are ProPresenter's own: text you can edit, a group for each point, the
//! pictures, videos and music as media cues that play.
//!
//! Written by hand as the small part of the format that matters, from the community's
//! reverse-engineered schema (github.com/greyshirtguy/ProPresenter7-Proto) and its notes on bundles.
//! ProPresenter's own documentation of the format does not exist, so what is here follows what is
//! documented to work: text slides, groups, and picture / video / music cues whose files sit flat in
//! the bundle and are named relative to it (`ROOT_CURRENT_RESOURCE`).
//!
//! What a slide becomes: a title, heading, Scripture or words slide is one text slide (navy, white
//! words, shrinking to fit); a song's verses are a slide each; a picture, video or music is a media
//! cue. A web link cannot be an action in ProPresenter (its file format has none), so it is a slide
//! showing the title and the address, with the address in the slide's notes.

use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;

use crate::slides::{clip_type, picture_info, Slide};

// ---------------------------------------------------------------- Protocol Buffers, the part needed

/// A message being written. proto3 leaves out what is zero, empty or false, so the helpers do too,
/// except `msg`, which is always written (a message that is present but empty still says something).
#[derive(Default, Clone)]
struct Pb(Vec<u8>);

impl Pb {
    fn varint(&mut self, mut v: u64) {
        loop {
            let b = (v & 0x7F) as u8;
            v >>= 7;
            if v == 0 {
                self.0.push(b);
                return;
            }
            self.0.push(b | 0x80);
        }
    }
    fn key(&mut self, field: u32, wire: u8) {
        self.varint(((field as u64) << 3) | wire as u64);
    }
    /// an integer, enum or bool as a varint
    fn u(mut self, field: u32, v: u64) -> Self {
        if v != 0 {
            self.key(field, 0);
            self.varint(v);
        }
        self
    }
    fn flag(self, field: u32, v: bool) -> Self {
        self.u(field, v as u64)
    }
    fn s(mut self, field: u32, v: &str) -> Self {
        if !v.is_empty() {
            self.key(field, 2);
            self.varint(v.len() as u64);
            self.0.extend_from_slice(v.as_bytes());
        }
        self
    }
    fn bytes(mut self, field: u32, v: &[u8]) -> Self {
        if !v.is_empty() {
            self.key(field, 2);
            self.varint(v.len() as u64);
            self.0.extend_from_slice(v);
        }
        self
    }
    fn msg(mut self, field: u32, m: &Pb) -> Self {
        self.key(field, 2);
        self.varint(m.0.len() as u64);
        self.0.extend_from_slice(&m.0);
        self
    }
    fn double(mut self, field: u32, v: f64) -> Self {
        if v != 0.0 {
            self.key(field, 1);
            self.0.extend_from_slice(&v.to_le_bytes());
        }
        self
    }
    fn float(mut self, field: u32, v: f32) -> Self {
        if v != 0.0 {
            self.key(field, 5);
            self.0.extend_from_slice(&v.to_le_bytes());
        }
        self
    }
}

// ---------------------------------------------------------------- the messages used (rv.data.*)

/// `UUID { string = 1 }`
fn uuid(s: &str) -> Pb {
    Pb::default().s(1, s)
}

fn color(r: f32, g: f32, b: f32) -> Pb {
    Pb::default().float(1, r).float(2, g).float(3, b).float(4, 1.0)
}

const NAVY: (f32, f32, f32) = (0.110, 0.141, 0.251); // #1C2440, the slides' own navy

fn size(w: f64, h: f64) -> Pb {
    Pb::default().double(1, w).double(2, h)
}

fn version(major: u64, minor: u64, patch: u64, build: &str) -> Pb {
    Pb::default().u(1, major).u(2, minor).u(3, patch).s(4, build)
}

/// `Graphics.Rect { origin = 1 { x, y }, size = 2 { width, height } }`
fn rect(x: f64, y: f64, w: f64, h: f64) -> Pb {
    Pb::default().msg(1, &Pb::default().double(1, x).double(2, y)).msg(2, &size(w, h))
}

/// The look of a text slide, in ProPresenter's own units (a 1920 x 1080 slide).
const SLIDE_W: f64 = 1920.0;
const SLIDE_H: f64 = 1080.0;

/// One run of words in the RTF that ProPresenter keeps a text's formatting in.
struct Run {
    text: String,
    /// font size in points
    size: u32,
    bold: bool,
    /// 1 white, 2 light blue (a Scripture reference, a heading over words)
    color: u8,
}

fn rtf_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '{' => o.push_str("\\{"),
            '}' => o.push_str("\\}"),
            '\n' => o.push_str("\\\n"), // a soft line break
            '\r' => {}
            c if (c as u32) < 128 && !c.is_control() => o.push(c),
            c if c.is_control() => {}
            c => {
                // everything else as RTF's signed 16-bit \uN? (two for a letter outside the basic plane)
                let mut b = [0u16; 2];
                for u in c.encode_utf16(&mut b) {
                    o.push_str(&format!("\\u{}?", *u as i16));
                }
            }
        }
    }
    o
}

/// Apple CocoaRTF, centred, as ProPresenter writes its text.
fn rtf(runs: &[Run]) -> Vec<u8> {
    let mut o = String::from(
        "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761\n{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}\n{\\colortbl;\\red255\\green255\\blue255;\\red156\\green194\\blue255;}\n{\\*\\expandedcolortbl;;;}\n\\pard\\pardirnatural\\qc\\partightenfactor0\n\n",
    );
    for (i, r) in runs.iter().enumerate() {
        if i == 0 {
            o.push_str(&format!("\\f0{}\\fs{} \\cf{} \\CocoaLigature0 ", if r.bold { "\\b" } else { "" }, r.size * 2, r.color));
        } else {
            o.push_str(&format!("\\\n\\\n\\f0{}\\fs{} \\cf{} ", if r.bold { "\\b" } else { "\\b0" }, r.size * 2, r.color));
        }
        o.push_str(&rtf_escape(&r.text));
    }
    o.push('}');
    o.into_bytes()
}

/// `Slide.Element` holding one text box: `Graphics.Element` with a rectangle path and the text.
fn text_element(ids: &mut Ids, name: &str, bounds: (f64, f64, f64, f64), runs: &[Run], valign: u64) -> Pb {
    let first = runs.first();
    let font = Pb::default()
        .s(1, "Helvetica")
        .double(2, first.map(|r| r.size as f64).unwrap_or(60.0))
        .flag(8, first.map(|r| r.bold).unwrap_or(false))
        .s(9, "Helvetica");
    let attributes = Pb::default()
        .msg(1, &font)
        .msg(3, &color(1.0, 1.0, 1.0)) // text_solid_fill
        .msg(6, &Pb::default().u(1, 2)); // paragraph_style: centred
    let text = Pb::default()
        .msg(3, &attributes)
        .bytes(5, &rtf(runs))
        .u(6, valign) // vertical alignment: middle
        .u(7, 2); // scale behaviour: shrink the font to fit
    // a rectangle: four corners in the unit square, and the shape's type (1 = rectangle)
    let corners = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let mut path = Pb::default().flag(1, true);
    for (x, y) in corners {
        path = path.msg(2, &Pb::default().msg(1, &Pb::default().double(1, x).double(2, y)));
    }
    path = path.msg(3, &Pb::default().u(1, 1));
    let element = Pb::default()
        .msg(1, &uuid(&ids.next()))
        .s(2, name)
        .msg(3, &rect(bounds.0, bounds.1, bounds.2, bounds.3))
        .double(5, 1.0)
        .msg(8, &path)
        .msg(13, &text);
    Pb::default().msg(1, &element)
}

/// A slide action: a navy slide with these text boxes, and notes if there are any.
fn slide_action(ids: &mut Ids, elements: Vec<Pb>, notes: &str) -> Pb {
    let mut base = Pb::default();
    for e in &elements {
        base = base.msg(1, e);
    }
    let base = base.flag(4, true).msg(5, &color(NAVY.0, NAVY.1, NAVY.2)).msg(6, &size(SLIDE_W, SLIDE_H)).msg(7, &uuid(&ids.next()));
    let mut presentation = Pb::default().msg(1, &base);
    if !notes.trim().is_empty() {
        let runs = [Run { text: notes.trim().to_string(), size: 14, bold: false, color: 1 }];
        presentation = presentation.msg(2, &Pb::default().bytes(1, &rtf(&runs)));
    }
    // Action { uuid = 1, isEnabled = 6, type = 9 (11: a presentation slide), slide = 23 { presentation = 2 } }
    Pb::default()
        .msg(1, &uuid(&ids.next()))
        .flag(6, true)
        .u(9, 11)
        .msg(23, &Pb::default().msg(2, &presentation))
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum MediaKind {
    Image { w: u32, h: u32 },
    Video,
    Audio,
}

/// A media action: a picture, a video or music in the bundle, shown over the slide (the foreground) or behind it.
fn media_action(ids: &mut Ids, name: &str, entry: &str, ext: &str, kind: MediaKind, background: bool) -> Pb {
    // the file is flat in the bundle and named relative to it: absolute_string, platform 1 (macOS),
    // and local { root 12 (current resource), path }
    let url = Pb::default().s(1, entry).u(3, 1).msg(4, &Pb::default().u(1, 12).s(2, entry));
    let mut media = Pb::default().msg(1, &uuid(&ids.next())).msg(2, &url).msg(3, &Pb::default().s(5, ext));
    let mut kind_field = Pb::default();
    match kind {
        MediaKind::Image { w, h } => {
            let drawing = Pb::default().msg(5, &size(w as f64, h as f64));
            media = media.msg(5, &Pb::default().msg(1, &drawing));
            kind_field = kind_field.msg(6, &Pb::default());
        }
        MediaKind::Video => {
            media = media.msg(6, &Pb::default());
            kind_field = kind_field.msg(7, &Pb::default());
        }
        MediaKind::Audio => {
            media = media.msg(4, &Pb::default());
            kind_field = kind_field.msg(8, &Pb::default());
        }
    }
    // MediaType { element = 5, layer_type = 10 (1 foreground, 0 background), and which kind it is }
    let mut media_type = Pb::default().msg(5, &media).u(10, if background { 0 } else { 1 });
    media_type.0.extend_from_slice(&kind_field.0);
    // Action { uuid = 1, name = 2, isEnabled = 6, type = 9 (2: media), media = 20 }
    Pb::default().msg(1, &uuid(&ids.next())).s(2, name).flag(6, true).u(9, 2).msg(20, &media_type)
}

/// `Cue { uuid = 1, name = 2, actions = 10, isEnabled = 12 }`
fn cue(id: &str, name: &str, actions: &[Pb]) -> Pb {
    let mut c = Pb::default().msg(1, &uuid(id)).s(2, name);
    for a in actions {
        c = c.msg(10, a);
    }
    c.flag(12, true)
}

// ---------------------------------------------------------------- unique ids

/// UUIDs like ProPresenter's (uppercase, version 4), made from a hash of the title, the time and a count.
struct Ids {
    seed: String,
    n: u64,
}

impl Ids {
    fn new(seed: &str) -> Self {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        Ids { seed: format!("{seed}|{nanos}"), n: 0 }
    }
    fn next(&mut self) -> String {
        self.n += 1;
        let mut h = Sha256::new();
        h.update(self.seed.as_bytes());
        h.update(self.n.to_le_bytes());
        let d = h.finalize();
        let mut b = [0u8; 16];
        b.copy_from_slice(&d[..16]);
        b[6] = (b[6] & 0x0F) | 0x40;
        b[8] = (b[8] & 0x3F) | 0x80;
        let x: Vec<String> = b.iter().map(|v| format!("{v:02X}")).collect();
        format!("{}-{}-{}-{}-{}", x[0..4].concat(), x[4..6].concat(), x[6..8].concat(), x[8..10].concat(), x[10..16].concat())
    }
}

// ---------------------------------------------------------------- the files in the bundle

struct Files<'a> {
    entries: Vec<(String, Vec<u8>)>,
    by_source: HashMap<String, Option<(String, String, MediaKind)>>,
    media: &'a dyn Fn(&str) -> Option<Vec<u8>>,
    warnings: Vec<String>,
}

/// A name that is safe on a Mac and in a zip: letters, digits and a few marks.
fn entry_name(stem: &str, ext: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.' | '(' | ')') { c } else { '_' })
        .collect();
    let stem = cleaned.trim().trim_matches('.').chars().take(60).collect::<String>();
    let stem = if stem.is_empty() { "media".to_string() } else { stem };
    let mut name = format!("{stem}.{ext}");
    let mut n = 2;
    while taken(&name) {
        name = format!("{stem} ({n}).{ext}");
        n += 1;
    }
    name
}

impl<'a> Files<'a> {
    /// Puts a kept file in the bundle once, however many slides use it: its name there, its type, what it is.
    fn add(&mut self, source: &str, hint: &str) -> Option<(String, String, MediaKind)> {
        if let Some(found) = self.by_source.get(source) {
            return found.clone();
        }
        let found = (self.media)(source).and_then(|bytes| {
            let (ext, kind) = if let Some((ext, w, h)) = picture_info(&bytes) {
                (if ext == "jpeg" { "jpg" } else { ext }.to_string(), MediaKind::Image { w, h })
            } else if let Some((ext, _mime, video)) = clip_type(source) {
                (ext.to_string(), if video { MediaKind::Video } else { MediaKind::Audio })
            } else {
                self.warnings.push(format!("“{hint}”: that kind of file can't go in a ProPresenter bundle, so it was left out."));
                return None;
            };
            if matches!(ext.as_str(), "wmv" | "avi" | "wma") {
                self.warnings.push(format!("“{hint}” is a .{ext} file: ProPresenter on a Mac may not play it. An .mp4 or .mov is safest."));
            }
            let taken = |n: &str| self.entries.iter().any(|(e, _)| e.eq_ignore_ascii_case(n));
            let name = entry_name(hint, &ext, &taken);
            self.entries.push((name.clone(), bytes));
            Some((name.clone(), ext, kind))
        });
        if found.is_none() && !self.warnings.iter().any(|w| w.contains(hint)) {
            self.warnings.push(format!("“{hint}”: the file is no longer in the app's folder, so it was left out."));
        }
        self.by_source.insert(source.to_string(), found.clone());
        found
    }
}

// ---------------------------------------------------------------- the presentation

/// Slides of a song or other words: one slide per verse (a blank line between verses in the words).
fn stanzas(body: &str) -> Vec<String> {
    let parts: Vec<String> = body.replace("\r\n", "\n").split("\n\n").map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        vec![String::new()]
    } else {
        parts
    }
}

fn words_bounds() -> (f64, f64, f64, f64) {
    (96.0, 60.0, SLIDE_W - 192.0, SLIDE_H - 120.0)
}

struct GroupPlan {
    name: String,
    cues: Vec<String>,
}

/// The bundle's bytes (a zip of the media and the `.pro` file), and what could not be included.
pub fn build_probundle(title: &str, slides: &[Slide], media: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<(Vec<u8>, Vec<String>), String> {
    if slides.is_empty() {
        return Err("There are no slides to save.".into());
    }
    let mut ids = Ids::new(title);
    let mut files = Files { entries: Vec::new(), by_source: HashMap::new(), media, warnings: Vec::new() };
    let mut cues: Vec<Pb> = Vec::new();
    let mut groups: Vec<GroupPlan> = Vec::new();

    let mut prev_song: Option<&str> = None;
    for s in slides {
        let name = if s.title.trim().is_empty() { "Slide".to_string() } else { s.title.trim().to_string() };
        let body = s.body.trim();
        // the slide's own notes, and a link's address, for whoever runs the slides
        let mut notes = s.notes.clone().unwrap_or_default();
        let background = s.background.as_deref().and_then(|b| files.add(b, &format!("{name} background")));

        // a group for each point and each song; the rest go into the group before them
        // (all the slides of a song from the song library are one group, named for the song)
        let song = s.song.as_deref().filter(|n| !n.trim().is_empty());
        let continues_song = song.is_some() && song == prev_song && s.section.as_deref() != Some("Title");
        prev_song = song;
        let starts_group = (matches!(s.kind.as_str(), "title" | "point" | "song") && !continues_song) || groups.is_empty();
        if starts_group {
            let group_name = if s.kind == "title" { "Title".to_string() } else { song.map(|n| n.trim().to_string()).unwrap_or_else(|| name.clone()) };
            groups.push(GroupPlan { name: group_name, cues: Vec::new() });
        }

        // the cues this slide makes: (cue name, its actions)
        let mut made: Vec<(String, Vec<Pb>)> = Vec::new();
        let words = |ids: &mut Ids, runs: Vec<Run>, notes: &str| -> Vec<Pb> {
            let text = text_element(ids, "Text", words_bounds(), &runs, 1);
            vec![slide_action(ids, vec![text], notes)]
        };
        let with_background = |ids: &mut Ids, mut actions: Vec<Pb>, bg: &Option<(String, String, MediaKind)>| -> Vec<Pb> {
            if let Some((entry, ext, kind)) = bg {
                actions.push(media_action(ids, entry, entry, ext, *kind, true));
            }
            actions
        };
        match s.kind.as_str() {
            "title" | "point" => {
                let mut runs = vec![Run { text: s.title.clone(), size: 66, bold: true, color: 1 }];
                if !body.is_empty() {
                    runs.push(Run { text: body.to_string(), size: 36, bold: false, color: 2 });
                }
                let a = words(&mut ids, runs, &notes);
                made.push((name.clone(), with_background(&mut ids, a, &background)));
            }
            "scripture" => {
                let runs = vec![Run { text: format!("\u{201C}{body}\u{201D}"), size: 44, bold: false, color: 1 }, Run { text: s.title.clone(), size: 30, bold: true, color: 2 }];
                let a = words(&mut ids, runs, &notes);
                made.push((name.clone(), with_background(&mut ids, a, &background)));
            }
            "text" | "song" => {
                for (i, verse) in stanzas(body).into_iter().enumerate() {
                    // a slide of words puts its heading over the words, in a run of its own; a song's verses are just the words
                    let mut runs = Vec::new();
                    if s.kind == "text" && i == 0 {
                        runs.push(Run { text: s.title.clone(), size: 34, bold: true, color: 2 });
                    }
                    runs.push(Run { text: verse, size: 54, bold: false, color: 1 });
                    let label = match (s.kind.as_str(), s.section.as_deref().filter(|x| !x.trim().is_empty())) {
                        ("song", Some(section)) => format!("{section}{}", if i > 0 { format!(" {}", i + 1) } else { String::new() }),
                        ("song", None) => format!("{name} {}", i + 1),
                        _ => name.clone(),
                    };
                    let a = words(&mut ids, runs, if i == 0 { &notes } else { "" });
                    made.push((label, with_background(&mut ids, a, &background)));
                }
            }
            "image" => {
                match s.image.as_deref().and_then(|f| files.add(f, &name)) {
                    Some((entry, ext, kind)) => {
                        // an empty slide, and the picture over it
                        let slide = slide_action(&mut ids, Vec::new(), &notes);
                        made.push((name.clone(), vec![slide, media_action(&mut ids, &entry, &entry, &ext, kind, false)]));
                    }
                    None => {
                        // the picture is gone: a slide with its caption, so the place is kept
                        let a = words(&mut ids, vec![Run { text: s.title.clone(), size: 60, bold: true, color: 1 }], &notes);
                        made.push((name.clone(), a));
                    }
                }
            }
            "link" => {
                let link = s.link.clone().unwrap_or_default();
                let clip = s.video.as_deref().and_then(|f| files.add(f, &name));
                match clip {
                    Some((entry, ext, kind)) => {
                        let slide = slide_action(&mut ids, Vec::new(), &notes);
                        made.push((name.clone(), vec![slide, media_action(&mut ids, &entry, &entry, &ext, kind, false)]));
                    }
                    _ => {
                        // a web page or a file that is not in the bundle: its title and where it is
                        let shown = if link.is_empty() { body.to_string() } else { link.clone() };
                        if !link.is_empty() {
                            if !notes.is_empty() {
                                notes.push_str("\n\n");
                            }
                            notes.push_str(&format!("Open: {link}"));
                        }
                        let mut runs = vec![Run { text: s.title.clone(), size: 60, bold: true, color: 1 }];
                        if !shown.is_empty() {
                            runs.push(Run { text: shown, size: 30, bold: false, color: 2 });
                        }
                        let a = words(&mut ids, runs, &notes);
                        made.push((name.clone(), a));
                    }
                }
            }
            _ => {
                let a = words(&mut ids, vec![Run { text: s.title.clone(), size: 66, bold: true, color: 1 }], &notes);
                made.push((name.clone(), a));
            }
        }
        // a picture beside the words: its own cue after the slide (ProPresenter has no side-by-side without a template)
        if let Some(p) = s.picture.as_deref() {
            if matches!(s.kind.as_str(), "title" | "point" | "scripture" | "text" | "song") {
                if let Some((entry, ext, kind)) = files.add(p, &format!("{name} picture")) {
                    let slide = slide_action(&mut ids, Vec::new(), "");
                    made.push((format!("{name} (picture)"), vec![slide, media_action(&mut ids, &entry, &entry, &ext, kind, false)]));
                }
            }
        }
        for (cue_name, actions) in made {
            let id = ids.next();
            if let Some(g) = groups.last_mut() {
                g.cues.push(id.clone());
            }
            cues.push(cue(&id, &cue_name, &actions));
        }
    }

    // the presentation
    let app = Pb::default().u(1, 1).msg(2, &version(14, 0, 0, "")).u(3, 1).msg(4, &version(7, 16, 0, "0"));
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut p = Pb::default().msg(1, &app).msg(2, &uuid(&ids.next())).s(3, title).msg(5, &Pb::default().u(1, now));
    for g in &groups {
        let group = Pb::default().msg(1, &uuid(&ids.next())).s(2, &g.name);
        let mut cg = Pb::default().msg(1, &group);
        for c in &g.cues {
            cg = cg.msg(2, &uuid(c));
        }
        p = p.msg(12, &cg);
    }
    for c in &cues {
        p = p.msg(13, c);
    }

    // the zip: the media first, then the presentation, as ProPresenter writes its own
    let pro_name = format!("{}.pro", crate::sheet::safe_file_name(title));
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in &files.entries {
        zip.start_file(name.as_str(), opts).map_err(|e| e.to_string())?;
        zip.write_all(bytes).map_err(|e| e.to_string())?;
    }
    zip.start_file(pro_name.as_str(), opts).map_err(|e| e.to_string())?;
    zip.write_all(&p.0).map_err(|e| e.to_string())?;
    let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
    Ok((bytes, files.warnings))
}

/// Writes `<dir>/<title> - ProPresenter.probundle` (never overwriting: "(2)", "(3)", ...).
pub fn write_probundle(dir: &Path, title: &str, slides: &[Slide], media: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<(PathBuf, Vec<String>), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let (bytes, warnings) = build_probundle(title, slides, media)?;
    let base = crate::sheet::safe_file_name(title);
    let mut path = dir.join(format!("{base} - ProPresenter.probundle"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} - ProPresenter ({n}).probundle"));
        n += 1;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok((path, warnings))
}

#[derive(Serialize)]
pub struct Exported {
    pub path: String,
    /// what could not be included, or may not work, in plain words
    pub warnings: Vec<String>,
}

/// Saves the sermon's slides for ProPresenter in Documents\Bible Concordance and shows the file.
#[tauri::command]
pub fn save_sermon_propresenter(app: AppHandle, title: String, slides: Vec<Slide>) -> Result<Exported, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance");
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let media = |f: &str| crate::sermon_media::path_of(&data, f).ok().and_then(|p| std::fs::read(p).ok());
    let (path, warnings) = write_probundle(&dir, &title, &slides, &media)?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(Exported { path: path.display().to_string(), warnings })
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    /// A wire-format reader, to check what was written from the outside: field number -> values.
    #[derive(Debug, Clone)]
    enum V {
        Varint(u64),
        Bytes(Vec<u8>),
        Fixed(Vec<u8>),
    }

    fn parse(mut b: &[u8]) -> Vec<(u32, V)> {
        let mut out = Vec::new();
        let rd = |b: &mut &[u8]| -> u64 {
            let (mut v, mut shift) = (0u64, 0);
            loop {
                let x = b[0];
                *b = &b[1..];
                v |= ((x & 0x7F) as u64) << shift;
                if x & 0x80 == 0 {
                    return v;
                }
                shift += 7;
            }
        };
        while !b.is_empty() {
            let k = rd(&mut b);
            let (f, w) = ((k >> 3) as u32, (k & 7) as u8);
            match w {
                0 => out.push((f, V::Varint(rd(&mut b)))),
                2 => {
                    let n = rd(&mut b) as usize;
                    out.push((f, V::Bytes(b[..n].to_vec())));
                    b = &b[n..];
                }
                1 => {
                    out.push((f, V::Fixed(b[..8].to_vec())));
                    b = &b[8..];
                }
                5 => {
                    out.push((f, V::Fixed(b[..4].to_vec())));
                    b = &b[4..];
                }
                _ => panic!("wire type {w}"),
            }
        }
        out
    }
    fn all<'a>(m: &'a [(u32, V)], f: u32) -> Vec<&'a V> {
        m.iter().filter(|(n, _)| *n == f).map(|(_, v)| v).collect()
    }
    fn sub(m: &[(u32, V)], f: u32) -> Vec<(u32, V)> {
        match all(m, f).first() {
            Some(V::Bytes(b)) => parse(b),
            _ => panic!("no message {f}"),
        }
    }
    fn text(m: &[(u32, V)], f: u32) -> String {
        match all(m, f).first() {
            Some(V::Bytes(b)) => String::from_utf8(b.clone()).unwrap(),
            _ => String::new(),
        }
    }

    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x7B, 0x40, 0xE8, 0xDD, 0, 0, 0, 12, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x8A, 0x3C, 0x6F, 0x5D, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    fn sample_slides() -> Vec<Slide> {
        vec![
            Slide { kind: "title".into(), title: "Faith that works".into(), body: "James 2 · 18 October 2026".into(), ..Default::default() },
            Slide { kind: "point".into(), title: "1. Faith hears".into(), body: "Romans 10:17".into(), notes: Some("Slow here.".into()), ..Default::default() },
            Slide { kind: "scripture".into(), title: "Romans 10:17 · BSB".into(), body: "So faith comes from hearing, and hearing by the word of Christ.".into(), ..Default::default() },
            Slide { kind: "image".into(), title: "The lake".into(), image: Some("lake.png".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "Our video".into(), video: Some("clip.mp4".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "A web video".into(), link: Some("https://www.youtube.com/watch?v=abc".into()), ..Default::default() },
            Slide { kind: "song".into(), title: "Amazing Grace".into(), body: "Amazing grace, how sweet the sound\nThat saved a wretch like me\n\nTwas grace that taught my heart to fear".into(), ..Default::default() },
            Slide { kind: "point".into(), title: "2. Faith acts".into(), picture: Some("lake.png".into()), ..Default::default() },
        ]
    }
    fn media(f: &str) -> Option<Vec<u8>> {
        match f {
            "lake.png" => Some(PNG.to_vec()),
            "clip.mp4" => Some(vec![0, 0, 0, 24, b'f', b't', b'y', b'p']),
            _ => None,
        }
    }

    #[test]
    fn the_wire_format_is_right() {
        // 150 as a varint is 0x96 0x01; field 1 as a string "a"; a double and a float
        let mut p = Pb::default();
        p.varint(150);
        assert_eq!(p.0, vec![0x96, 0x01]);
        assert_eq!(Pb::default().s(1, "a").0, vec![0x0A, 1, b'a']);
        assert_eq!(Pb::default().u(2, 1).0, vec![0x10, 1]);
        assert_eq!(Pb::default().u(2, 0).0, Vec::<u8>::new(), "zero is left out");
        assert_eq!(Pb::default().double(1, 1.0).0, vec![0x09, 0, 0, 0, 0, 0, 0, 0xF0, 0x3F]);
        assert_eq!(Pb::default().float(1, 1.0).0, vec![0x0D, 0, 0, 0x80, 0x3F]);
        assert_eq!(Pb::default().msg(3, &Pb::default()).0, vec![0x1A, 0], "an empty message is still written");
    }

    #[test]
    fn rtf_keeps_every_character() {
        let r = rtf_escape("“Go,” she said — {ok} \\ done\nnext");
        assert!(r.contains("\\u8220?") && r.contains("\\u8221?") && r.contains("\\u8212?"), "{r}");
        assert!(r.contains("\\{ok\\}") && r.contains("\\\\") && r.contains("\\\nnext"), "{r}");
        assert!(r.is_ascii());
        // a letter outside the basic plane is two 16-bit units
        assert_eq!(rtf_escape("😀"), "\\u-10179?\\u-8704?");
        let out = String::from_utf8(rtf(&[Run { text: "Hi".into(), size: 30, bold: true, color: 1 }])).unwrap();
        assert!(out.starts_with("{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761") && out.contains("\\fs60") && out.contains("\\CocoaLigature0 Hi}"), "{out}");
    }

    #[test]
    fn ids_look_like_propresenters() {
        let mut ids = Ids::new("t");
        let (a, b) = (ids.next(), ids.next());
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(a.matches('-').count(), 4);
        assert_eq!(a, a.to_uppercase());
        assert_eq!(&a[14..15], "4", "version 4");
    }

    #[test]
    fn a_bundle_holds_the_presentation_and_its_media_once() {
        let (bytes, warnings) = build_probundle("Faith that works", &sample_slides(), &media).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
        // the picture is in once although two slides use it; the .pro file is last
        assert_eq!(names.iter().filter(|n| n.ends_with(".png")).count(), 1, "{names:?}");
        assert!(names.iter().any(|n| n.ends_with(".mp4")), "{names:?}");
        assert_eq!(names.last().unwrap(), "Faith that works.pro");
        assert!(names.iter().all(|n| !n.contains('/') && !n.contains('\\')), "flat names: {names:?}");
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn the_presentation_is_put_together_right() {
        let (bytes, _) = build_probundle("Faith that works", &sample_slides(), &media).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut pro = Vec::new();
        std::io::Read::read_to_end(&mut z.by_name("Faith that works.pro").unwrap(), &mut pro).unwrap();
        let p = parse(&pro);
        assert_eq!(text(&p, 3), "Faith that works", "its name");
        assert_eq!(text(&sub(&p, 2), 1).len(), 36, "its id");
        let app = sub(&p, 1);
        assert!(matches!(all(&app, 3)[0], V::Varint(1)), "made by ProPresenter (the application)");

        // every slide in the groups is a cue, once; every cue is in a group
        let cue_ids: Vec<String> = all(&p, 13).iter().map(|c| if let V::Bytes(b) = c { text(&sub(&parse(b), 1), 1) } else { unreachable!() }).collect();
        let mut grouped: Vec<String> = Vec::new();
        let mut group_names = Vec::new();
        for g in all(&p, 12) {
            let V::Bytes(gb) = g else { unreachable!() };
            let g = parse(gb);
            group_names.push(text(&sub(&g, 1), 2));
            for id in all(&g, 2) {
                let V::Bytes(ib) = id else { unreachable!() };
                grouped.push(text(&parse(ib), 1));
            }
        }
        assert_eq!(grouped, cue_ids, "the groups hold the cues in order");
        // title, then each point and each song is a group of its own; the Scripture, picture and link slides join the point before
        assert_eq!(group_names, vec!["Title", "1. Faith hears", "Amazing Grace", "2. Faith acts"], "{group_names:?}");
        // 8 slides: the song makes two cues, the second point's picture one more
        assert_eq!(cue_ids.len(), 10);

        // the first slide's text, and what each kind of cue holds
        let cues = all(&p, 13);
        let first = |i: usize| -> Vec<(u32, V)> {
            let V::Bytes(b) = cues[i] else { unreachable!() };
            parse(b)
        };
        let c0 = first(0);
        assert_eq!(text(&c0, 2), "Faith that works");
        let action0 = sub(&c0, 10);
        assert!(matches!(all(&action0, 9)[0], V::Varint(11)), "a slide action");
        let presentation = sub(&sub(&action0, 23), 2);
        let base = sub(&presentation, 1);
        assert!(matches!(all(&base, 4)[0], V::Varint(1)), "draws its background colour");
        let element = sub(&sub(&base, 1), 1);
        let rtf = text(&sub(&element, 13), 5);
        assert!(rtf.contains("Faith that works") && rtf.contains("James 2 \\u183? 18 October 2026"), "{rtf}");
        // the point's notes
        let notes = sub(&sub(&sub(&first(1), 10), 23), 2);
        assert!(text(&sub(&notes, 2), 1).contains("Slow here."), "notes are kept");
        // the picture cue: a slide action, then a media action pointing at the flat file
        let pic = first(3);
        assert_eq!(text(&pic, 2), "The lake");
        let actions = all(&pic, 10);
        assert_eq!(actions.len(), 2);
        let V::Bytes(mb) = actions[1] else { unreachable!() };
        let media_action = parse(mb);
        assert!(matches!(all(&media_action, 9)[0], V::Varint(2)), "a media action");
        let mt = sub(&media_action, 20);
        assert!(matches!(all(&mt, 10)[0], V::Varint(1)), "in front");
        let el = sub(&mt, 5);
        let url = sub(&el, 2);
        assert_eq!(text(&url, 1), "The lake.png");
        assert!(matches!(all(&url, 3)[0], V::Varint(1)), "macOS");
        let local = sub(&url, 4);
        assert!(matches!(all(&local, 1)[0], V::Varint(12)), "relative to the bundle");
        assert_eq!(text(&local, 2), "The lake.png");
        assert_eq!(text(&sub(&el, 3), 5), "png");
        // a web link is words with its address in the notes, not an action
        let web = first(5);
        assert_eq!(text(&web, 2), "A web video");
        assert_eq!(all(&web, 10).len(), 1);
        let wn = sub(&sub(&sub(&web, 10), 23), 2);
        assert!(text(&sub(&wn, 2), 1).contains("Open: https://www.youtube.com/watch?v=abc"));
    }

    #[test]
    fn what_cannot_go_in_is_said() {
        let slides = vec![
            Slide { kind: "image".into(), title: "Gone".into(), image: Some("gone.png".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "Old video".into(), video: Some("old.wmv".into()), ..Default::default() },
        ];
        let m = |f: &str| (f == "old.wmv").then(|| vec![1u8, 2, 3]);
        let (_, warnings) = build_probundle("T", &slides, &m).unwrap();
        assert!(warnings.iter().any(|w| w.contains("Gone") && w.contains("no longer")), "{warnings:?}");
        assert!(warnings.iter().any(|w| w.contains("wmv") && w.contains("Mac")), "{warnings:?}");
        assert!(build_probundle("T", &[], &m).is_err());
    }

    /// A test pack for the church's ProPresenter: every kind of slide once, written to the folder in
    /// SLIDES_OUT (default: the temp folder). SLIDES_PICTURE and SLIDES_CLIP (optional) are real files to put
    /// in it. `cargo test --lib propresenter::tests::sample -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn sample() {
        let picture = std::env::var("SLIDES_PICTURE").ok().and_then(|p| std::fs::read(p).ok());
        let clip = std::env::var("SLIDES_CLIP").ok().and_then(|p| std::fs::read(p).ok());
        let out = std::env::var("SLIDES_OUT").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        let long = "Now there was a man of the Pharisees named Nicodemus, a leader of the Jews. He came to Jesus at night and said, “Rabbi, we know that You are a teacher who has come from God. For no one could perform the signs You are doing if God were not with him.” Jesus replied, “Truly, truly, I tell you, unless one is born again, he cannot see the kingdom of God.” “How can a man be born when he is old?” Nicodemus asked. “Can he enter his mother’s womb a second time to be born?” Jesus answered, “Truly, truly, I tell you, unless one is born of water and the Spirit, he cannot enter the kingdom of God.”";
        let slides = vec![
            Slide { kind: "title".into(), title: "Born again".into(), body: "John 3 · Sunday sermon".into(), background: Some("photo.jpg".into()), ..Default::default() },
            Slide { kind: "point".into(), title: "God loves us first".into(), body: "The big idea".into(), notes: Some("Say it slowly. Then pause.".into()), ..Default::default() },
            Slide { kind: "scripture".into(), title: "John 3:16 · BSB".into(), body: "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.".into(), ..Default::default() },
            Slide { kind: "point".into(), title: "1. A visit at night".into(), body: "John 3:1–8".into(), picture: Some("photo.jpg".into()), ..Default::default() },
            Slide { kind: "scripture".into(), title: "John 3:1–8 · BSB (a long passage: it should shrink to fit)".into(), body: long.into(), ..Default::default() },
            Slide { kind: "image".into(), title: "A photo".into(), image: Some("photo.jpg".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "A video clip".into(), video: Some("clip.mp4".into()), notes: Some("Play from 0:00.".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "A web video".into(), link: Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ".into()), ..Default::default() },
            Slide { kind: "song".into(), title: "Amazing Grace".into(), body: "Amazing grace, how sweet the sound
That saved a wretch like me
I once was lost, but now am found
Was blind but now I see

Twas grace that taught my heart to fear
And grace my fears relieved
How precious did that grace appear
The hour I first believed".into(), ..Default::default() },
            Slide { kind: "text".into(), title: "Pray".into(), body: "Lord, thank You that You love us first.".into(), ..Default::default() },
        ];
        let m = |f: &str| match f {
            "photo.jpg" => picture.clone().or_else(|| Some(PNG.to_vec())),
            "clip.mp4" => clip.clone(),
            _ => None,
        };
        let (path, warnings) = write_probundle(&out, "Born again", &slides, &m).unwrap();
        println!("{}", path.display());
        println!("{warnings:?}");
        // the same slides as a PowerPoint, to compare and as the fallback
        println!("{}", crate::slides::write_pptx(&out, "Born again", &slides, &m).unwrap().display());
    }
}
