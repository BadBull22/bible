//! Sermon slides as a PowerPoint file (.pptx), from the preacher's own outline and the slides
//! they add: a title slide, the points, the Scripture, pictures, songs and links to videos or
//! music. Written by hand as the smallest set of Open XML parts PowerPoint (and ProPresenter,
//! Keynote, LibreOffice and Google Slides, which all import .pptx) accept: one master, one
//! blank layout, a theme, and the slides as text boxes and pictures on a dark background or a
//! darkened photo. Nothing is generated beyond laying out what the preacher wrote or chose.

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;

#[derive(Deserialize, Debug, Clone, Default)]
pub struct Slide {
    /// "title" (the sermon's title slide), "point" (a heading, maybe a line under it),
    /// "scripture" (a passage and its reference), "text" or "song" (a heading and lines),
    /// "image" (a picture, its title under it) or "link" (a title and a link to click: a
    /// video, music, a web page or a file)
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// a picture for an "image" slide: a file in the sermon's media folder
    #[serde(default)]
    pub image: Option<String>,
    /// a photo behind the slide (darkened so the words stand out): a media file
    #[serde(default)]
    pub background: Option<String>,
    /// a picture beside the words of a heading, words, song or Scripture slide (the words
    /// take the left part of the slide): a media file
    #[serde(default)]
    pub picture: Option<String>,
    /// what a "link" slide opens: a web address, or a file's full path
    #[serde(default)]
    pub link: Option<String>,
}

/// A picture's file type and pixel size, read from its header (PNG, JPEG or GIF).
pub fn picture_info(bytes: &[u8]) -> Option<(&'static str, u32, u32)> {
    if bytes.len() > 24 && bytes.starts_with(b"\x89PNG") {
        let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return Some(("png", w, h));
    }
    if bytes.len() > 10 && bytes.starts_with(b"GIF8") {
        return Some(("gif", u16::from_le_bytes([bytes[6], bytes[7]]) as u32, u16::from_le_bytes([bytes[8], bytes[9]]) as u32));
    }
    if bytes.len() > 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
        // walk the markers to the frame header (SOF0-SOF15, not DHT/JPG/DAC)
        let mut i = 2;
        while i + 9 < bytes.len() {
            if bytes[i] != 0xFF {
                i += 1;
                continue;
            }
            let m = bytes[i + 1];
            let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            if (0xC0..=0xCF).contains(&m) && m != 0xC4 && m != 0xC8 && m != 0xCC {
                let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
                let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
                return Some(("jpeg", w, h));
            }
            i += 2 + len;
        }
    }
    None
}

/// A link's target as PowerPoint wants it: web addresses as they are, a file as file:///.
fn link_target(link: &str) -> String {
    let l = link.trim();
    if l.starts_with("http://") || l.starts_with("https://") || l.starts_with("file:") || l.starts_with("mailto:") {
        return l.to_string();
    }
    let path = l.replace('\\', "/");
    let encoded: String = path.chars().map(|c| if c == ' ' { "%20".to_string() } else { c.to_string() }).collect();
    format!("file:///{}", encoded.trim_start_matches('/'))
}

// 16:9, in EMU (914400 to the inch): 13.333 x 7.5 inches
const W: i64 = 12_192_000;
const H: i64 = 6_858_000;

fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// A text box: each line of `text` a paragraph, centred, in one size and colour.
fn text_box(id: u32, name: &str, x: i64, y: i64, w: i64, h: i64, text: &str, size_pt: u32, color: &str, bold: bool, italic: bool, anchor: &str) -> String {
    linked_box(id, name, x, y, w, h, text, size_pt, color, bold, italic, anchor, None)
}

/// A text box whose words, when `link_rid` is given, open that relationship's link when
/// clicked in the slide show.
#[allow(clippy::too_many_arguments)]
fn linked_box(id: u32, name: &str, x: i64, y: i64, w: i64, h: i64, text: &str, size_pt: u32, color: &str, bold: bool, italic: bool, anchor: &str, link_rid: Option<&str>) -> String {
    let click = link_rid.map(|r| format!(r#"<a:hlinkClick r:id="{r}"/>"#)).unwrap_or_default();
    let paras: String = text
        .split('\n')
        .map(|line| {
            format!(
                r#"<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="{sz}" b="{b}" i="{i}" u="{u}" dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="Georgia"/>{click}</a:rPr><a:t>{t}</a:t></a:r></a:p>"#,
                sz = size_pt * 100,
                b = u8::from(bold),
                i = u8::from(italic),
                u = if link_rid.is_some() { "sng" } else { "none" },
                t = esc(line)
            )
        })
        .collect();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="{anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>{paras}</p:txBody></p:sp>"#
    )
}

/// Font size that keeps a passage on its slide: smaller as it gets longer.
fn body_size(text: &str) -> u32 {
    match text.chars().count() {
        0..=120 => 40,
        121..=220 => 34,
        221..=360 => 28,
        361..=560 => 24,
        _ => 20,
    }
}

/// What a slide refers to besides its text: the relationship ids it uses.
struct SlideRefs<'a> {
    background: Option<(&'a str, u32, u32)>,
    picture: Option<(&'a str, u32, u32)>,
    link: Option<&'a str>,
}

/// A picture fitted inside a box, keeping its shape.
fn picture(id: u32, rid: &str, (bx, by, bw, bh): (i64, i64, i64, i64), pw: u32, ph: u32) -> String {
    let (pw, ph) = (pw.max(1) as f64, ph.max(1) as f64);
    let scale = (bw as f64 / pw).min(bh as f64 / ph);
    let (w, h) = ((pw * scale) as i64, (ph * scale) as i64);
    let (x, y) = (bx + (bw - w) / 2, by + (bh - h) / 2);
    format!(
        r#"<p:pic><p:nvPicPr><p:cNvPr id="{id}" name="Picture"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#
    )
}

/// The slide's background: a photo cropped to fill 16:9 and darkened, or plain navy.
fn background(bg: Option<(&str, u32, u32)>) -> (String, String) {
    let Some((rid, pw, ph)) = bg else {
        return (r#"<p:bg><p:bgPr><a:solidFill><a:srgbClr val="1C2440"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>"#.into(), String::new());
    };
    // crop the longer side so the photo fills the slide without stretching
    let (aspect, slide) = (pw.max(1) as f64 / ph.max(1) as f64, W as f64 / H as f64);
    let crop = if aspect > slide {
        let c = ((1.0 - slide / aspect) / 2.0 * 100_000.0) as i64;
        format!(r#"<a:srcRect l="{c}" r="{c}"/>"#)
    } else {
        let c = ((1.0 - aspect / slide) / 2.0 * 100_000.0) as i64;
        format!(r#"<a:srcRect t="{c}" b="{c}"/>"#)
    };
    let bg = format!(r#"<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"/>{crop}<a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>"#);
    let shade = format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="9" name="Shade"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{W}" cy="{H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="000000"><a:alpha val="52000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>"#
    );
    (bg, shade)
}

fn slide_xml(s: &Slide, refs: &SlideRefs) -> String {
    let (bg, shade) = background(refs.background);
    // with a picture beside them, the words take the left 55% and the picture the rest
    let side = if s.kind == "image" { None } else { refs.picture };
    let tw = |full: i64| if side.is_some() { W * 55 / 100 - 700_000 } else { full };
    let beside = side.map(|(rid, w, h)| picture(5, rid, (W * 55 / 100 + 100_000, 500_000, W * 45 / 100 - 600_000, H - 1_000_000), w, h)).unwrap_or_default();
    let shapes = match s.kind.as_str() {
        "title" => {
            text_box(2, "Title", 600_000, 2_000_000, tw(W - 1_200_000), 1_700_000, &s.title, if side.is_some() { 44 } else { 54 }, "FFFFFF", true, false, "b")
                + &text_box(3, "Subtitle", 600_000, 3_900_000, tw(W - 1_200_000), 1_200_000, &s.body, 26, "C9D6EE", false, false, "t")
        }
        "scripture" => {
            let size = if side.is_some() { body_size(&s.body).saturating_sub(4).max(18) } else { body_size(&s.body) };
            text_box(2, "Passage", 700_000, 700_000, tw(W - 1_400_000), H - 2_300_000, &format!("“{}”", s.body.trim()), size, "FFFFFF", false, false, "ctr")
                + &text_box(3, "Reference", 700_000, H - 1_400_000, tw(W - 1_400_000), 700_000, &s.title, 26, "F2C46D", true, false, "t")
        }
        "text" | "song" => {
            text_box(2, "Heading", 700_000, 350_000, tw(W - 1_400_000), 1_000_000, &s.title, 32, "F2C46D", true, false, "ctr")
                + &text_box(3, "Words", 700_000, 1_400_000, tw(W - 1_400_000), H - 1_900_000, s.body.trim(), body_size(&s.body).min(if side.is_some() { 30 } else { 36 }), "FFFFFF", false, false, "ctr")
        }
        "image" => {
            let pic = refs.picture.map(|(rid, w, h)| picture(4, rid, (500_000, 350_000, W - 1_000_000, H - 1_450_000), w, h)).unwrap_or_default();
            pic + &text_box(2, "Caption", 600_000, H - 1_050_000, W - 1_200_000, 800_000, &s.title, 24, "FFFFFF", false, false, "ctr")
        }
        "link" => {
            let label = if s.body.trim().is_empty() { "▶ Play".to_string() } else { s.body.trim().to_string() };
            text_box(2, "Title", 700_000, 1_500_000, W - 1_400_000, 2_000_000, &s.title, 44, "FFFFFF", true, false, "b")
                + &linked_box(3, "Link", 700_000, 3_800_000, W - 1_400_000, 1_200_000, &label, 28, "F2C46D", false, false, "t", refs.link)
        }
        _ => {
            text_box(2, "Point", 700_000, 1_600_000, tw(W - 1_400_000), 2_200_000, &s.title, if side.is_some() { 40 } else { 48 }, "FFFFFF", true, false, "b")
                + &text_box(3, "Under the point", 700_000, 4_000_000, tw(W - 1_400_000), 2_000_000, &s.body, 28, "C9D6EE", false, true, "t")
        }
    } + &beside;
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld>{bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{shade}{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
    )
}

const THEME: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sermon"><a:themeElements><a:clrScheme name="Sermon"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1C2440"/></a:dk2><a:lt2><a:srgbClr val="FAF7F0"/></a:lt2><a:accent1><a:srgbClr val="4F86CF"/></a:accent1><a:accent2><a:srgbClr val="F2C46D"/></a:accent2><a:accent3><a:srgbClr val="2F7D4F"/></a:accent3><a:accent4><a:srgbClr val="B0261C"/></a:accent4><a:accent5><a:srgbClr val="6B6558"/></a:accent5><a:accent6><a:srgbClr val="C9D6EE"/></a:accent6><a:hlink><a:srgbClr val="F2C46D"/></a:hlink><a:folHlink><a:srgbClr val="E0B060"/></a:folHlink></a:clrScheme><a:fontScheme name="Sermon"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Sermon"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"#;

const MASTER: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>"#;

const LAYOUT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"#;

const REL_TYPE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// The .pptx file's bytes. `media` gives a picture's bytes by its file name (None: not
/// there, and the slide goes without it).
pub fn build_pptx(slides: &[Slide], media: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    if slides.is_empty() {
        return Err("There is nothing to put on slides yet.".into());
    }
    let n = slides.len();
    let mut files: Vec<(String, String)> = Vec::new();
    // each picture once, as ppt/media/mediaN.<ext>: file name -> (part name, type, size)
    let mut pictures: Vec<(String, String, &'static str, u32, u32, Vec<u8>)> = Vec::new();
    for s in slides {
        for f in [s.image.as_deref(), s.background.as_deref(), s.picture.as_deref()].into_iter().flatten() {
            if pictures.iter().any(|p| p.0 == f) {
                continue;
            }
            let Some(bytes) = media(f) else { continue };
            let Some((ext, w, h)) = picture_info(&bytes) else { continue };
            pictures.push((f.to_string(), format!("media{}.{ext}", pictures.len() + 1), ext, w, h, bytes));
        }
    }
    let types: String = ["png", "jpeg", "gif"]
        .iter()
        .filter(|e| pictures.iter().any(|p| p.2 == **e))
        .map(|e| format!(r#"<Default Extension="{e}" ContentType="image/{e}"/>"#))
        .collect();
    let slide_overrides: String = (1..=n)
        .map(|i| format!(r#"<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#))
        .collect();
    files.push((
        "[Content_Types].xml".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{types}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>{slide_overrides}</Types>"#
        ),
    ));
    files.push((
        "_rels/.rels".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_TYPE}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="{REL_TYPE}/extended-properties" Target="docProps/app.xml"/></Relationships>"#
        ),
    ));
    files.push((
        "docProps/core.xml".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{}</dc:title><dc:creator>Bible Concordance</dc:creator></cp:coreProperties>"#,
            esc(&slides[0].title)
        ),
    ));
    files.push((
        "docProps/app.xml".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Bible Concordance</Application><Slides>{n}</Slides></Properties>"#
        ),
    ));
    let slide_ids: String = (1..=n).map(|i| format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 255 + i, i + 1)).collect();
    files.push((
        "ppt/presentation.xml".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx="{W}" cy="{H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>"#
        ),
    ));
    let slide_rels: String = (1..=n).map(|i| format!(r#"<Relationship Id="rId{}" Type="{REL_TYPE}/slide" Target="slides/slide{i}.xml"/>"#, i + 1)).collect();
    files.push((
        "ppt/_rels/presentation.xml.rels".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_TYPE}/slideMaster" Target="slideMasters/slideMaster1.xml"/>{slide_rels}<Relationship Id="rId{}" Type="{REL_TYPE}/theme" Target="theme/theme1.xml"/></Relationships>"#,
            n + 2
        ),
    ));
    files.push(("ppt/theme/theme1.xml".into(), THEME.into()));
    files.push(("ppt/slideMasters/slideMaster1.xml".into(), MASTER.into()));
    files.push((
        "ppt/slideMasters/_rels/slideMaster1.xml.rels".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="{REL_TYPE}/theme" Target="../theme/theme1.xml"/></Relationships>"#
        ),
    ));
    files.push(("ppt/slideLayouts/slideLayout1.xml".into(), LAYOUT.into()));
    files.push((
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels".into(),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_TYPE}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#
        ),
    ));
    let find = |f: Option<&String>| f.and_then(|f| pictures.iter().find(|p| &p.0 == f));
    for (i, s) in slides.iter().enumerate() {
        let mut rels = format!(r#"<Relationship Id="rId1" Type="{REL_TYPE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>"#);
        let bg = find(s.background.as_ref());
        // an "image" slide's picture, or the one beside a slide's words ("link" slides have none)
        let pic = match s.kind.as_str() {
            "image" => find(s.image.as_ref()),
            "link" => None,
            _ => find(s.picture.as_ref()),
        };
        if let Some(p) = bg {
            rels += &format!(r#"<Relationship Id="rId2" Type="{REL_TYPE}/image" Target="../media/{}"/>"#, p.1);
        }
        if let Some(p) = pic {
            rels += &format!(r#"<Relationship Id="rId3" Type="{REL_TYPE}/image" Target="../media/{}"/>"#, p.1);
        }
        let link = s.link.as_deref().map(str::trim).filter(|l| !l.is_empty() && s.kind == "link");
        if let Some(l) = link {
            rels += &format!(r#"<Relationship Id="rId4" Type="{REL_TYPE}/hyperlink" Target="{}" TargetMode="External"/>"#, esc(&link_target(l)));
        }
        let refs = SlideRefs { background: bg.map(|p| ("rId2", p.3, p.4)), picture: pic.map(|p| ("rId3", p.3, p.4)), link: link.map(|_| "rId4") };
        files.push((format!("ppt/slides/slide{}.xml", i + 1), slide_xml(s, &refs)));
        files.push((
            format!("ppt/slides/_rels/slide{}.xml.rels", i + 1),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#
            ),
        ));
    }
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in files {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    // pictures are already compressed
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for p in &pictures {
        zip.start_file(format!("ppt/media/{}", p.1), stored).map_err(|e| e.to_string())?;
        zip.write_all(&p.5).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

/// Writes the slides to `<dir>/<title>.pptx` (never overwriting: "(2)", "(3)", ...).
pub fn write_pptx(dir: &Path, title: &str, slides: &[Slide], media: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let bytes = build_pptx(slides, media)?;
    let base = crate::sheet::safe_file_name(title);
    let mut path = dir.join(format!("{base} - slides.pptx"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} - slides ({n}).pptx"));
        n += 1;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Saves the sermon's slides in Documents\Bible Concordance and shows the file.
#[tauri::command]
pub fn save_sermon_slides(app: AppHandle, title: String, slides: Vec<Slide>) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance");
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let media = |f: &str| crate::sermon_media::path_of(&data, f).ok().and_then(|p| std::fs::read(p).ok());
    let path = write_pptx(&dir, &title, &slides, &media)?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_pptx_with_a_slide_each() {
        let slides = vec![
            Slide { kind: "title".into(), title: "Faith that works".into(), body: "James 2 · 12 October".into(), ..Default::default() },
            Slide { kind: "point".into(), title: "1. Faith hears".into(), body: "Romans 10:17".into(), ..Default::default() },
            Slide { kind: "scripture".into(), title: "James 2:17 (BSB)".into(), body: "So too, faith by itself, if it does not result in action, is dead & <gone>.".into(), ..Default::default() },
        ];
        let bytes = build_pptx(&slides, &|_| None).unwrap();
        assert_eq!(&bytes[..2], b"PK");
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        for name in ["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide3.xml", "ppt/theme/theme1.xml", "ppt/slideLayouts/slideLayout1.xml"] {
            assert!(z.by_name(name).is_ok(), "{name}");
        }
        let mut s3 = String::new();
        std::io::Read::read_to_string(&mut z.by_name("ppt/slides/slide3.xml").unwrap(), &mut s3).unwrap();
        assert!(s3.contains("dead &amp; &lt;gone&gt;"), "escaped");
        assert!(build_pptx(&[], &|_| None).is_err());
    }

    /// A 2x1 PNG, the smallest picture there is to test with.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x7B, 0x40, 0xE8, 0xDD, 0, 0, 0, 12, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x8A, 0x3C, 0x6F, 0x5D, 0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn slides_carry_pictures_backgrounds_and_links() {
        assert_eq!(picture_info(PNG), Some(("png", 2, 1)));
        assert_eq!(picture_info(b"not a picture at all"), None);
        let slides = vec![
            Slide { kind: "title".into(), title: "Faith".into(), background: Some("bg.png".into()), ..Default::default() },
            Slide { kind: "image".into(), title: "The lake".into(), image: Some("bg.png".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "Everyday Angel".into(), link: Some("https://music.youtube.com/watch?v=x&y=1".into()), ..Default::default() },
            Slide { kind: "link".into(), title: "Our video".into(), body: "▶ Play the video".into(), link: Some(r"C:\Users\me\My Videos\clip.mp4".into()), ..Default::default() },
            Slide { kind: "image".into(), title: "Missing".into(), image: Some("gone.png".into()), ..Default::default() },
        ];
        let media = |f: &str| (f == "bg.png").then(|| PNG.to_vec());
        let bytes = build_pptx(&slides, &media).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let read = |z: &mut zip::ZipArchive<Cursor<Vec<u8>>>, n: &str| {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut z.by_name(n).unwrap(), &mut s).unwrap();
            s
        };
        // the picture is stored once, for both slides
        assert!(z.by_name("ppt/media/media1.png").is_ok());
        assert!(z.by_name("ppt/media/media2.png").is_err());
        assert!(read(&mut z, "[Content_Types].xml").contains(r#"Extension="png""#));
        let s1 = read(&mut z, "ppt/slides/slide1.xml");
        assert!(s1.contains(r#"<a:blip r:embed="rId2"/>"#) && s1.contains("Shade"), "background and its shade");
        assert!(read(&mut z, "ppt/slides/_rels/slide1.xml.rels").contains("../media/media1.png"));
        assert!(read(&mut z, "ppt/slides/slide2.xml").contains("<p:pic>"));
        let r3 = read(&mut z, "ppt/slides/_rels/slide3.xml.rels");
        assert!(r3.contains(r#"Target="https://music.youtube.com/watch?v=x&amp;y=1" TargetMode="External""#), "{r3}");
        assert!(read(&mut z, "ppt/slides/slide3.xml").contains(r#"<a:hlinkClick r:id="rId4"/>"#));
        assert!(read(&mut z, "ppt/slides/_rels/slide4.xml.rels").contains("file:///C:/Users/me/My%20Videos/clip.mp4"));
        // a picture that isn't there: the slide is made without it
        assert!(!read(&mut z, "ppt/slides/slide5.xml").contains("<p:pic>"));
    }

    #[test]
    fn a_picture_beside_the_words_and_a_background_per_slide() {
        let slides = vec![
            Slide { kind: "point".into(), title: "Faith hears".into(), picture: Some("p.png".into()), ..Default::default() },
            Slide { kind: "scripture".into(), title: "Romans 10:17".into(), body: "So faith comes from hearing.".into(), picture: Some("p.png".into()), background: Some("p.png".into()), ..Default::default() },
            Slide { kind: "point".into(), title: "Plain".into(), ..Default::default() },
            Slide { kind: "link".into(), title: "A video".into(), link: Some("https://example.com".into()), picture: Some("p.png".into()), ..Default::default() },
        ];
        let bytes = build_pptx(&slides, &|f: &str| (f == "p.png").then(|| PNG.to_vec())).unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let read = |z: &mut zip::ZipArchive<Cursor<Vec<u8>>>, n: &str| {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut z.by_name(n).unwrap(), &mut s).unwrap();
            s
        };
        let s1 = read(&mut z, "ppt/slides/slide1.xml");
        assert!(s1.contains("<p:pic>") && s1.contains(r#"r:embed="rId3""#), "the picture beside the heading");
        assert!(!s1.contains("<a:blip r:embed=\"rId2\"/><a:srcRect"), "no background on this one");
        let s2 = read(&mut z, "ppt/slides/slide2.xml");
        assert!(s2.contains("<p:pic>") && s2.contains("Shade"), "a picture and its own background");
        assert!(!read(&mut z, "ppt/slides/slide3.xml").contains("<p:pic>"));
        assert!(!read(&mut z, "ppt/slides/slide4.xml").contains("<p:pic>"), "link slides keep their own layout");
        assert!(z.by_name("ppt/media/media2.png").is_err(), "one picture, stored once");
    }

    /// Writes a sample to the temp folder, to open in PowerPoint by hand:
    /// `cargo test --lib slides::tests::sample -- --ignored`.
    #[test]
    #[ignore]
    fn sample() {
        let slides = vec![
            Slide { kind: "title".into(), title: "Faith that works".into(), body: "Living faith · 18 October 2026".into(), ..Default::default() },
            Slide { kind: "point".into(), title: "Faith without works is dead".into(), ..Default::default() },
            Slide { kind: "point".into(), title: "1. Faith hears".into(), body: "Romans 10:17".into(), ..Default::default() },
            Slide { kind: "scripture".into(), title: "James 2:14–17 · BSB".into(), body: "What good is it, my brothers, if someone claims to have faith, but has no deeds? Can such faith save him? Suppose a brother or sister is without clothes and daily food. If one of you tells him, “Go in peace; stay warm and well fed,” but does not provide for his physical needs, what good is that? So too, faith by itself, if it does not result in action, is dead.".into(), ..Default::default() },
        ];
        let p = write_pptx(&std::env::temp_dir(), "Sermon slides sample", &slides, &|_| None).unwrap();
        println!("{}", p.display());
    }
}
