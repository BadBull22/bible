//! Study sheets (sermon / service preparation): the frontend assembles a sheet as a list
//! of simple blocks -- the same list it renders as the on-screen preview, prints, and
//! copies -- and this turns that list into a Word document.

use docx_rs::{Docx, LineSpacing, Paragraph, Run, RunFonts};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Clone)]
pub struct SheetRun {
    pub text: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// Words of Jesus (red-letter text).
    #[serde(default)]
    pub red: bool,
}

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SheetBlock {
    Title { text: String },
    Subtitle { text: String },
    Heading { text: String },
    Subheading { text: String },
    Para { runs: Vec<SheetRun> },
    /// Scripture text, set off from the surrounding notes.
    Quote { runs: Vec<SheetRun> },
    /// Ruled lines left blank for handwritten notes.
    Lines { count: u32 },
}

const SERIF: &str = "Georgia";
const SANS: &str = "Segoe UI";

fn run(text: &str, font: &str, size: usize) -> Run {
    Run::new().add_text(text).fonts(RunFonts::new().ascii(font).hi_ansi(font).cs(font)).size(size)
}

fn runs_para(runs: &[SheetRun], font: &str, size: usize) -> Paragraph {
    let mut p = Paragraph::new();
    for r in runs {
        let mut x = run(&r.text, font, size);
        if r.bold {
            x = x.bold();
        }
        if r.italic {
            x = x.italic();
        }
        if r.red {
            x = x.color("B0261C");
        }
        p = p.add_run(x);
    }
    p
}

fn spacing(before: u32, after: u32) -> LineSpacing {
    LineSpacing::new().before(before).after(after)
}

pub fn build_docx(blocks: &[SheetBlock]) -> Result<Vec<u8>, String> {
    let mut doc = Docx::new();
    for b in blocks {
        let p = match b {
            // sizes are in half-points (28 = 14pt)
            SheetBlock::Title { text } => Paragraph::new().add_run(run(text, SANS, 36).bold()).line_spacing(spacing(0, 60)),
            SheetBlock::Subtitle { text } => Paragraph::new().add_run(run(text, SANS, 20).color("666666")).line_spacing(spacing(0, 240)),
            SheetBlock::Heading { text } => Paragraph::new().add_run(run(text, SANS, 28).bold().color("1C2440")).line_spacing(spacing(320, 100)),
            SheetBlock::Subheading { text } => Paragraph::new().add_run(run(text, SANS, 22).bold()).line_spacing(spacing(180, 60)),
            SheetBlock::Para { runs } => runs_para(runs, SERIF, 22).line_spacing(spacing(0, 120)),
            SheetBlock::Quote { runs } => runs_para(runs, SERIF, 23)
                .indent(Some(360), None, None, None)
                .line_spacing(spacing(60, 140)),
            SheetBlock::Lines { count } => {
                for _ in 0..*count {
                    doc = doc.add_paragraph(
                        Paragraph::new()
                            .add_run(run(&"_".repeat(78), SANS, 20).color("BBBBBB"))
                            .line_spacing(spacing(160, 0)),
                    );
                }
                continue;
            }
        };
        doc = doc.add_paragraph(p);
    }
    let mut buf = std::io::Cursor::new(Vec::new());
    doc.build().pack(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

/// Characters Windows doesn't allow in file names, replaced so a title like
/// "Romans 8:28-39" can be used as the file name.
pub fn safe_file_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '.' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Study sheet".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// Writes `<dir>/<title>.docx`, adding " (2)", " (3)"... rather than overwriting an
/// existing file (the user may have edited an earlier one in Word).
pub fn write_docx(dir: &Path, title: &str, blocks: &[SheetBlock]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let bytes = build_docx(blocks)?;
    let base = safe_file_name(title);
    let mut path = dir.join(format!("{base}.docx"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} ({n}).docx"));
        n += 1;
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_real_docx_and_never_overwrites() {
        let blocks = vec![
            SheetBlock::Title { text: "Romans 8:28-39".into() },
            SheetBlock::Subtitle { text: "Study sheet".into() },
            SheetBlock::Heading { text: "Passage".into() },
            SheetBlock::Quote { runs: vec![SheetRun { text: "28 ".into(), bold: true, italic: false, red: false }, SheetRun { text: "And we know...".into(), bold: false, italic: false, red: false }] },
            SheetBlock::Para { runs: vec![SheetRun { text: "A note".into(), bold: false, italic: true, red: false }] },
            SheetBlock::Lines { count: 3 },
        ];
        let bytes = build_docx(&blocks).unwrap();
        assert_eq!(&bytes[..2], b"PK", "a .docx is a zip file");
        let dir = std::env::temp_dir().join(format!("bc-sheet-test-{}", std::process::id()));
        let a = write_docx(&dir, "Romans 8:28-39", &blocks).unwrap();
        let b = write_docx(&dir, "Romans 8:28-39", &blocks).unwrap();
        assert_ne!(a, b);
        assert!(a.file_name().unwrap().to_string_lossy().starts_with("Romans 8.28-39"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// `SHEET_SAMPLE_DIR=<dir> cargo test sample -- --ignored` writes a sample to open in Word.
    #[test]
    #[ignore]
    fn sample() {
        let dir = std::env::var("SHEET_SAMPLE_DIR").expect("set SHEET_SAMPLE_DIR");
        let blocks = vec![
            SheetBlock::Title { text: "John 3:16–17".into() },
            SheetBlock::Subtitle { text: "Study sheet · John 3:16–17".into() },
            SheetBlock::Heading { text: "The passage".into() },
            SheetBlock::Quote { runs: vec![SheetRun { text: "16 ".into(), bold: true, italic: false, red: false }, SheetRun { text: "For God so loved the world…".into(), bold: false, italic: false, red: false }] },
            SheetBlock::Heading { text: "Key words in the original".into() },
            SheetBlock::Para { runs: vec![SheetRun { text: "ἀγαπάω".into(), bold: true, italic: false, red: false }, SheetRun { text: " (G25) — to love".into(), bold: false, italic: false, red: false }] },
            SheetBlock::Heading { text: "Notes".into() },
            SheetBlock::Lines { count: 4 },
        ];
        println!("{}", write_docx(Path::new(&dir), "John 3.16", &blocks).unwrap().display());
    }
}
