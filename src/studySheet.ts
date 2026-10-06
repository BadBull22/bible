// Study sheets: gathering a passage's material into a SheetBlock list, and turning that
// list into HTML (preview, print, rich copy) and plain text. The Word document is built
// from the same list in Rust (src-tauri/src/sheet.rs).
import { api, CrossReference, HIGHLIGHT_COLOR_NAMES, SheetBlock, SheetRun, Version } from "./api";
import { loadPrefs } from "./readingPrefs";
import { chapterRedLetter, loadRedLetter, splitRed } from "./redLetter";
import { tidyPunctuation } from "./verseSegments";

export interface SheetOptions {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  title: string;
  /** 1-3 translation codes, in display order. */
  translations: string[];
  crossRefs: number; // 0 = leave out
  myNotes: boolean;
  commentaries: string[]; // commentary ids
  topics: boolean;
  keyWords: boolean;
  blankLines: number; // 0 = leave out
}

export function passageLabel(book: string, chapter: number, start: number, end: number): string {
  return `${book} ${chapter}:${start}${end > start ? `–${end}` : ""}`;
}

const plainRun = (text: string): SheetRun => ({ text });

/** Greek morph codes start "V-", "N-", "A-"; Hebrew codes are "H"/"A" + segments joined by
 * "/" (prefixes, then the word, then suffixes) -- keep verbs, nouns and adjectives. */
function isContentWord(morph: string, greek: boolean): boolean {
  if (greek) return /^(V|N|A)-/.test(morph);
  return morph.replace(/^[HA]/, "").split("/").some((s) => /^(V|N|A)/.test(s));
}

/** Verses of a chapter overlapping [start, end], from a list of sections that each run
 * from their verse_start up to the next section's start. */
function sectionsInRange<T extends { verse_start: number }>(sections: T[], start: number, end: number): { s: T; to: number | null }[] {
  const out: { s: T; to: number | null }[] = [];
  sections.forEach((s, i) => {
    const next = sections[i + 1]?.verse_start;
    const to = next !== undefined ? next - 1 : null;
    if (s.verse_start <= end && (to === null || to >= start)) out.push({ s, to });
  });
  return out;
}

export async function buildSheet(o: SheetOptions, versions: Version[]): Promise<SheetBlock[]> {
  const { book, chapter } = o;
  const start = Math.min(o.verseStart, o.verseEnd);
  const end = Math.max(o.verseStart, o.verseEnd);
  const verseNums: number[] = [];
  for (let v = start; v <= end; v++) verseNums.push(v);
  const inRange = (v: number) => v >= start && v <= end;
  const nameOf = (code: string) => versions.find((v) => v.code === code)?.name ?? code;

  const blocks: SheetBlock[] = [];
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  blocks.push({ kind: "title", text: o.title.trim() || passageLabel(book, chapter, start, end) });
  blocks.push({ kind: "subtitle", text: `Study sheet · ${passageLabel(book, chapter, start, end)} · ${today}` });

  // --- the passage, in each chosen translation
  const texts = await Promise.all(o.translations.map((code) => api.getChapter(code, book, chapter).catch(() => [])));
  const redData = loadPrefs().redLetter ? await loadRedLetter() : null;
  blocks.push({ kind: "heading", text: "The passage" });
  o.translations.forEach((code, i) => {
    const verses = texts[i].filter((v) => inRange(v.verse));
    if (o.translations.length > 1) blocks.push({ kind: "subheading", text: `${nameOf(code)} (${code})` });
    if (verses.length === 0) {
      blocks.push({ kind: "para", runs: [{ text: `${code} has no text for this passage.`, italic: true }] });
      return;
    }
    const runs: SheetRun[] = [];
    const red = redData ? chapterRedLetter(redData, code, book, chapter) : {};
    verses.forEach((v, j) => {
      runs.push({ text: `${j ? " " : ""}${v.verse} `, bold: true });
      const text = tidyPunctuation(v.text.trim());
      for (const p of splitRed([{ text, word: null }], red[String(v.verse)])[0]) runs.push(p.red ? { text: p.text, red: true } : plainRun(p.text));
    });
    blocks.push({ kind: "quote", runs });
  });
  const reading = versions.find((v) => v.code === o.translations[0] && !v.is_original_language) ? o.translations[0] : "BSB";

  // --- key original-language words
  if (o.keyWords) {
    const perVerse = await Promise.all(verseNums.map((v) => api.interlinearVerse(book, chapter, v).catch(() => [])));
    const seen = new Set<string>();
    const rows: SheetBlock[] = [];
    for (const words of perVerse) {
      for (const w of words) {
        const greek = w.editions.length > 0;
        if (!w.strongs || !w.lemma || seen.has(w.strongs) || !isContentWord(w.morph, greek)) continue;
        if (greek && !w.editions.includes("Tyn") && !w.editions.includes("TR")) continue;
        seen.add(w.strongs);
        const meaning = (w.lemma_gloss || w.gloss).replace(/_/g, " ").replace(/[<>]/g, "").trim();
        rows.push({
          kind: "para",
          runs: [
            { text: w.lemma, bold: true },
            plainRun(` (${w.strongs})`),
            { text: meaning ? ` — ${meaning}` : "", italic: false },
            { text: ` · translated “${w.gloss.replace(/[<>]/g, "").replace(/\//g, " ").trim()}” here`, italic: true },
          ],
        });
        if (rows.length >= 15) break;
      }
      if (rows.length >= 15) break;
    }
    if (rows.length) {
      blocks.push({ kind: "heading", text: "Key words in the original" });
      blocks.push(...rows);
    }
  }

  // --- cross references (strongest first, not pointing back into the passage itself)
  if (o.crossRefs > 0) {
    const all = (await Promise.all(verseNums.map((v) => api.crossReferencesFor(book, chapter, v).catch(() => [] as CrossReference[])))).flat();
    const best = new Map<string, CrossReference>();
    for (const r of all) {
      if (r.to_book === book && r.to_chapter === chapter && inRange(r.to_verse_start)) continue;
      const key = `${r.to_book} ${r.to_chapter}:${r.to_verse_start}-${r.to_verse_end}`;
      const prev = best.get(key);
      if (!prev || prev.votes < r.votes) best.set(key, r);
    }
    const top = [...best.values()].sort((a, b) => b.votes - a.votes).slice(0, o.crossRefs);
    if (top.length) {
      const refTexts = await Promise.all(
        top.map(async (r) => {
          const code = r.to_book === "Enoch" ? "ENOCH1" : reading;
          let t = await api.passageText(code, r.to_book, r.to_chapter, r.to_verse_start, r.to_verse_end).catch(() => "");
          if (!t && code !== "BSB") t = await api.passageText("BSB", r.to_book, r.to_chapter, r.to_verse_start, r.to_verse_end).catch(() => "");
          return t;
        }),
      );
      blocks.push({ kind: "heading", text: "Cross references" });
      top.forEach((r, i) => {
        const label = `${r.to_book} ${r.to_chapter}:${r.to_verse_start}${r.to_verse_end > r.to_verse_start ? `–${r.to_verse_end}` : ""}`;
        blocks.push({ kind: "para", runs: [{ text: label, bold: true }, plainRun(refTexts[i] ? ` — ${refTexts[i]}` : "")] });
      });
    }
  }

  // --- the reader's own notes and highlights
  if (o.myNotes) {
    const marks = await api.chapterMarks(book, chapter).catch(() => null);
    // a note on a range counts when any of its verses is on the sheet
    const notes = (await api.chapterNotes(book, chapter).catch(() => [])).filter((n) => n.verse <= end && n.verse_end >= start);
    const hls = (marks?.highlights ?? []).filter(([v]) => inRange(v));
    if (notes.length || hls.length) {
      blocks.push({ kind: "heading", text: "My notes" });
      notes.forEach((n) => {
        const label = n.verse_end > n.verse ? `Verses ${n.verse}–${n.verse_end}: ` : `Verse ${n.verse}: `;
        const tags = n.tags.length ? ` (${n.tags.join(", ")})` : "";
        if (n.body.trim()) blocks.push({ kind: "para", runs: [{ text: label, bold: true }, plainRun(n.body.trim() + tags)] });
      });
      if (hls.length) {
        blocks.push({
          kind: "para",
          runs: [{ text: "Highlighted: ", bold: true }, plainRun(hls.map(([v, c]) => `v. ${v} (${HIGHLIGHT_COLOR_NAMES[c].toLowerCase()})`).join(", "))],
        });
      }
    }
  }

  // --- topics (Nave's / Torrey's) covering these verses
  if (o.topics) {
    const perVerse = await Promise.all(verseNums.map((v) => api.topicsForVerse(book, chapter, v).catch(() => [])));
    const byDict = new Map<string, Set<string>>();
    for (const hits of perVerse) for (const h of hits) {
      if (!byDict.has(h.dict_name)) byDict.set(h.dict_name, new Set());
      byDict.get(h.dict_name)!.add(h.headword);
    }
    if (byDict.size) {
      blocks.push({ kind: "heading", text: "Topics" });
      for (const [dict, heads] of byDict) {
        const list = [...heads].slice(0, 25);
        blocks.push({ kind: "para", runs: [{ text: `${dict}: `, bold: true }, plainRun(list.join(" · ") + (heads.size > list.length ? " …" : ""))] });
      }
    }
  }

  // --- commentaries
  if (o.commentaries.length) {
    const infos = await api.listCommentaries().catch(() => []);
    const chapters = await Promise.all(o.commentaries.map((id) => api.getCommentaryChapter(id, book, chapter).catch(() => null)));
    const parts: SheetBlock[] = [];
    o.commentaries.forEach((id, i) => {
      const data = chapters[i];
      if (!data) return;
      const secs = sectionsInRange(data.sections, start, end);
      if (!secs.length) return;
      parts.push({ kind: "subheading", text: infos.find((c) => c.id === id)?.name ?? id });
      for (const { s, to } of secs) {
        const paras = s.text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
        const label = to !== null && to > s.verse_start ? `vv. ${s.verse_start}–${to}` : to === null ? `v. ${s.verse_start}ff.` : `v. ${s.verse_start}`;
        paras.forEach((p, j) => parts.push({ kind: "para", runs: j === 0 ? [{ text: `${label}. `, bold: true }, plainRun(p)] : [plainRun(p)] }));
      }
    });
    if (parts.length) {
      blocks.push({ kind: "heading", text: "Commentary" });
      blocks.push({ kind: "para", runs: [{ text: "Commentators' views are their own opinions, not scripture.", italic: true }] });
      blocks.push(...parts);
    }
  }

  if (o.blankLines > 0) {
    blocks.push({ kind: "heading", text: "Notes" });
    blocks.push({ kind: "lines", count: o.blankLines });
  }
  return blocks;
}

// ---------------------------------------------------------------- output formats

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runsHtml(runs: SheetRun[]): string {
  return runs
    .map((r) => {
      let t = esc(r.text);
      if (r.red) t = `<span style="color: #b0261c;">${t}</span>`;
      if (r.italic) t = `<i>${t}</i>`;
      if (r.bold) t = `<b>${t}</b>`;
      return t;
    })
    .join("");
}

/** Self-contained HTML with inline styles, so it looks the same pasted into Word as it
 * does in the preview and on paper. */
export function sheetHtml(blocks: SheetBlock[]): string {
  const serif = "font-family: Georgia, 'Times New Roman', serif;";
  const sans = "font-family: 'Segoe UI', Arial, sans-serif;";
  const out = blocks.map((b) => {
    switch (b.kind) {
      case "title":
        return `<h1 style="${sans} font-size: 20pt; margin: 0 0 2pt;">${esc(b.text)}</h1>`;
      case "subtitle":
        return `<p style="${sans} font-size: 10pt; color: #666; margin: 0 0 12pt;">${esc(b.text)}</p>`;
      case "heading":
        return `<h2 style="${sans} font-size: 14pt; color: #1c2440; margin: 16pt 0 5pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt;">${esc(b.text)}</h2>`;
      case "subheading":
        return `<h3 style="${sans} font-size: 11pt; margin: 9pt 0 3pt;">${esc(b.text)}</h3>`;
      case "para":
        return `<p style="${serif} font-size: 11pt; line-height: 1.45; margin: 0 0 6pt;">${runsHtml(b.runs)}</p>`;
      case "quote":
        return `<p style="${serif} font-size: 11.5pt; line-height: 1.55; margin: 3pt 0 7pt 18pt; padding-left: 8pt; border-left: 3px solid #c8963e;">${runsHtml(b.runs)}</p>`;
      case "lines":
        return Array.from({ length: b.count }, () => `<p style="margin: 0; height: 24pt; border-bottom: 1px solid #bbb;">&nbsp;</p>`).join("");
      case "image":
        return `<figure style="margin: 8pt 0 10pt; text-align: center;"><img src="${b.src}" width="${Math.min(b.width, 560)}" style="max-width: 100%; height: auto;" alt="${esc(b.caption)}"/><figcaption style="${sans} font-size: 9pt; color: #555; margin-top: 3pt;">${esc(b.caption)}</figcaption></figure>`;
    }
  });
  return `<div style="color: #111;">${out.join("\n")}</div>`;
}

export function sheetPlainText(blocks: SheetBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "title":
        out.push(b.text.toUpperCase());
        break;
      case "subtitle":
        out.push(b.text, "");
        break;
      case "heading":
        out.push("", b.text, "-".repeat(b.text.length));
        break;
      case "subheading":
        out.push("", b.text);
        break;
      case "para":
        out.push(b.runs.map((r) => r.text).join(""));
        break;
      case "quote":
        out.push("    " + b.runs.map((r) => r.text).join(""));
        break;
      case "lines":
        for (let i = 0; i < b.count; i++) out.push("_".repeat(60));
        break;
      case "image":
        out.push(`[Picture: ${b.caption}]`);
        break;
    }
  }
  return out.join("\n").trim() + "\n";
}

/** Prints just the sheet: a print-only copy is added to <body>, everything else is hidden
 * by the `printing-sheet` rules in App.css, and it is removed again afterwards. The print
 * dialog also offers "Save as PDF". */
export function printSheet(blocks: SheetBlock[]) {
  document.getElementById("sheet-print-root")?.remove();
  const root = document.createElement("div");
  root.id = "sheet-print-root";
  root.innerHTML = sheetHtml(blocks);
  document.body.appendChild(root);
  document.body.classList.add("printing-sheet");
  const cleanup = () => {
    document.body.classList.remove("printing-sheet");
    root.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // (If afterprint never fires, the leftover copy is harmless: it is hidden on screen, and
  // the next printSheet call replaces it.)
  window.print();
}
