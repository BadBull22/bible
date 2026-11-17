// Songs for the worship team: the words kept once as sections (verse, chorus, bridge...) and an
// arrangement (the order they are sung in), turned into slides a verse at a time. Pure, so it can be
// tested under Node (scripts/test_songs.mts).

import type { SlideSpec } from "./sermonOutputs";

export interface SongSection {
  label: string;
  text: string;
}

/** A song as kept: its sections, and the order sung (indexes into the sections, a section may come more than once). */
export interface SongData {
  id: number;
  title: string;
  author: string;
  ccli: string;
  sections: SongSection[];
  arrangement: number[];
}

/** What a section's heading may say on a line of its own: "Verse 1", "[Chorus]", "Pre-Chorus 2:", "V2", "C", "CHORUS(2)", "Chorus (1):". */
const HEADING = /^\s*[\[(]?\s*(verse|chorus|pre[- ]?chorus|bridge|tag|intro|outro|ending|interlude|refrain|instrumental|coda|vamp|turnaround|v|c|b|pc)\s*\(?\s*(\d+)?\s*\)?\s*[\])]?\s*:?\s*$/i;
/** The same without the one-letter names, which are too easily a line of words: used to start a new part in the middle of a block. */
const WORD_HEADING = /^\s*[\[(]?\s*(verse|chorus|pre[- ]?chorus|bridge|tag|intro|outro|ending|interlude|refrain|instrumental|coda|vamp|turnaround)\s*\(?\s*(\d+)?\s*\)?\s*[\])]?\s*:?\s*$/i;
/** A direction that is no part of the words: "(x2)", "x 2", "[repeat]", "repeat 3 times". */
const DIRECTION = /^\s*[\[(]?\s*(?:x\s*\d+|\d+\s*x|repeat(?:\s+\d+\s*(?:x|times))?|rpt|2x|3x)\s*[\])]?\s*$/i;
const SHORT: Record<string, string> = { v: "Verse", c: "Chorus", b: "Bridge", pc: "Pre-Chorus" };

/** A heading as it is shown: "verse 1" -> "Verse 1", "pre chorus" -> "Pre-Chorus", "V2" -> "Verse 2". */
export function tidyLabel(raw: string): string {
  const m = HEADING.exec(raw);
  if (!m) return raw.trim();
  const word = m[1].toLowerCase();
  const name = SHORT[word] ?? (/^pre/.test(word) ? "Pre-Chorus" : word.charAt(0).toUpperCase() + word.slice(1));
  return m[2] ? `${name} ${m[2]}` : name;
}

/** Words compared without capitals, punctuation or spacing ("Oh, I've" and "oh I've" are the same). */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const firstLine = (s: string) => norm(s.split("\n").find((l) => l.trim()) ?? "");

/** Words that came with no blank lines and no headings (a look-up or a page that lost its gaps) cut into parts: the run of
 * lines that comes round again (the chorus) is found and split out wherever it is sung, and what is between is cut into
 * parts of about four lines. A short block is left as it is. */
export function breakUp(lines: string[]): string[][] {
  const n = lines.length;
  if (n <= 10) return [lines];
  const keys = lines.map(norm);
  // the run of two or more lines that covers the most of the song by coming round again (the longer, on a tie)
  let best: { len: number; starts: number[] } | null = null;
  for (let len = Math.min(12, Math.floor(n / 2)); len >= 2; len--) {
    const found = new Map<string, number[]>();
    for (let i = 0; i + len <= n; i++) {
      const k = keys.slice(i, i + len).join("|");
      found.set(k, [...(found.get(k) ?? []), i]);
    }
    for (const starts of found.values()) {
      const picked: number[] = [];
      for (const s of starts) if (picked.length === 0 || s >= picked[picked.length - 1] + len) picked.push(s);
      // a run that is the same line over and over is no chorus
      if (picked.length < 2 || new Set(keys.slice(picked[0], picked[0] + len)).size < 2) continue;
      if (!best || len * picked.length > best.len * best.starts.length) best = { len, starts: picked };
    }
  }
  /** a stretch of lines cut into parts of about four (a short end joins the part before it) */
  const chunks = (from: number, to: number): string[][] => {
    const len = to - from;
    if (len <= 0) return [];
    if (len <= 8) return [lines.slice(from, to)];
    const out: string[][] = [];
    for (let i = from; i < to; i += 4) out.push(lines.slice(i, Math.min(i + 4, to)));
    if (out.length > 1 && out[out.length - 1].length < 3) out[out.length - 2].push(...(out.pop() as string[]));
    return out;
  };
  if (!best) return chunks(0, n);
  const parts: string[][] = [];
  let at = 0;
  for (const s of best.starts) {
    parts.push(...chunks(at, s));
    parts.push(lines.slice(s, s + best.len));
    at = s + best.len;
  }
  parts.push(...chunks(at, n));
  return parts;
}

/**
 * Names for the sections that were not named by the person (`auto` holds their indexes), worked out from how the song goes:
 * - a part that comes round again, word for word or with the same first line, is the Chorus (the one sung most often);
 * - a short part that comes round again and always leads into the chorus is the Pre-Chorus; another that comes round again is a Bridge;
 * - a part sung once, shorter than the verses, between two choruses and after at least two verses, is the Bridge;
 * - a part sung once at the very end, of one or two lines, straight after the third chorus, is a Tag;
 * - everything else is Verse 1, Verse 2... in order.
 * Returns the new label for each index in `auto`. A person can always rename a part by writing its heading.
 */
export function autoLabels(sections: SongSection[], arrangement: number[], auto: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  const order = arrangement.length ? arrangement : sections.map((_, i) => i);
  const plays = (i: number) => order.filter((a) => a === i).length;
  const lineCount = (i: number) => sections[i].text.split("\n").filter((l) => l.trim()).length;
  const groups = new Map<string, number[]>();
  for (const i of auto) {
    const k = firstLine(sections[i].text);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const repeating = [...groups.values()].filter((g) => g.length > 1 || plays(g[0]) > 1).sort((x, y) => x[0] - y[0]);
  const total = (g: number[]) => g.reduce((n, i) => n + plays(i), 0);
  const name = (g: number[], base: string) => g.forEach((i, k) => out.set(i, k === 0 ? base : `${base} ${k + 1}`));
  // the chorus: the repeating part sung most (the longer, then the earlier, on a tie)
  const chorus = [...repeating].sort((x, y) => total(y) - total(x) || lineCount(y[0]) - lineCount(x[0]) || x[0] - y[0])[0];
  if (chorus) name(chorus, "Chorus");
  const isChorus = (i: number) => !!chorus && chorus.includes(i);
  let bridged = false;
  for (const g of repeating) {
    if (g === chorus) continue;
    // always followed by the chorus, and short: a pre-chorus
    const lead = chorus && g.every((i) => order.every((a, p) => a !== i || (p + 1 < order.length && isChorus(order[p + 1])))) && g.every((i) => lineCount(i) <= 4);
    if (lead) name(g, "Pre-Chorus");
    else if (!bridged) (bridged = true), name(g, "Bridge");
    else name(g, "Refrain");
  }
  // parts sung once: a bridge after two verses and two choruses (it is shorter than the verses and leads into the chorus), a tag at the end
  const chorusSeen = (p: number) => order.slice(0, p).filter(isChorus).length;
  const once = [...auto].filter((i) => !out.has(i)).sort((x, y) => x - y);
  const lengths = once.map(lineCount);
  const usual = lengths.length ? [...lengths].sort((x, y) => x - y)[Math.floor(lengths.length / 2)] : 0;
  if (chorus) {
    const last = order.length - 1;
    for (const i of once) {
      const p = order.indexOf(i);
      if (plays(i) === 1 && p === last && p > 0 && isChorus(order[p - 1]) && chorusSeen(p) >= 3 && lineCount(i) <= 2) out.set(i, "Tag");
    }
    if (!bridged)
      for (const i of once) {
        const p = order.indexOf(i);
        const versesBefore = once.filter((j) => !out.has(j) && order.indexOf(j) < p).length;
        if (!out.has(i) && plays(i) === 1 && p + 1 < order.length && isChorus(order[p + 1]) && chorusSeen(p) >= 2 && versesBefore >= 2 && lineCount(i) < usual && lineCount(i) <= 4) {
          out.set(i, "Bridge");
          break;
        }
      }
  }
  // verses count on from any verse the person named
  const named = new Set(sections.filter((_, i) => !auto.has(i)).map((s) => s.label.toLowerCase()));
  let v = 0;
  for (const i of once)
    if (!out.has(i)) {
      while (named.has(`verse ${++v}`));
      out.set(i, `Verse ${v}`);
    }
  return out;
}

/** The words of a song, pasted or typed, as sections and an arrangement. Blocks are separated by a blank line; a
 * block may start with a heading line ("Verse 1", "[Chorus]"). A block with no heading is the next verse. A block
 * that repeats an earlier one, or is only a heading that already exists ("Chorus" on its own), is sung again
 * instead of being kept twice. Where nothing is headed (words copied from a web page), a part that comes round again
 * -- word for word, or beginning with the same line -- is taken to be the chorus, and the parts between are the verses. */
export function parseSong(text: string): { sections: SongSection[]; arrangement: number[] } {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((b) => b.split("\n").map((l) => l.replace(/\s+$/, "")))
    .map((lines) => lines.filter((l, i, a) => (l.trim() || (i > 0 && i < a.length - 1)) && !DIRECTION.test(l)))
    // a heading in the middle of a block (words that lost their gaps) starts a part of its own
    .flatMap((lines) => {
      const parts: string[][] = [];
      for (const l of lines) {
        if (parts.length === 0 || (WORD_HEADING.test(l) && parts[parts.length - 1].some((x) => x.trim()))) parts.push([l]);
        else parts[parts.length - 1].push(l);
      }
      return parts;
    })
    .filter((lines) => lines.some((l) => l.trim()));
  const sections: SongSection[] = [];
  const arrangement: number[] = [];
  /** sections whose name was made up here, not written by the person (they may be renamed below) */
  const auto = new Set<number>();
  let verses = 0;
  // a long block with no heading and no gaps is cut into its parts first
  for (const lines of blocks.flatMap((b) => (HEADING.test(b[0]) ? [b] : breakUp(b)))) {
    let label = "";
    let body = lines;
    if (HEADING.test(lines[0])) {
      label = tidyLabel(lines[0]);
      body = lines.slice(1);
    }
    const words = body.join("\n").trim();
    if (!words) {
      // a heading alone: that section again
      const at = sections.findIndex((s) => s.label.toLowerCase() === label.toLowerCase());
      if (at >= 0) arrangement.push(at);
      else if (label) sections.push({ label, text: "" }), arrangement.push(sections.length - 1);
      continue;
    }
    const same = sections.findIndex((s) => norm(s.text) === norm(words));
    if (same >= 0) {
      arrangement.push(same);
      continue;
    }
    if (!label) {
      label = `Verse ${++verses}`;
      auto.add(sections.length);
    } else {
      if (/^verse\b/i.test(label)) verses = Math.max(verses, Number(/\d+/.exec(label)?.[0] ?? verses + 1));
      // the same name for other words ("Chorus" twice, the second one different): the next free number, so "Chorus" alone still means the first
      const base = label.replace(/\s+\d+$/, "");
      for (let n = 2; sections.some((s) => s.label.toLowerCase() === label.toLowerCase()); n++) label = `${base} ${n}`;
    }
    sections.push({ label, text: words });
    arrangement.push(sections.length - 1);
  }

  // names for the parts nobody named: a part that comes round again is the chorus (or a pre-chorus, or a bridge), the rest are
  // verses unless they are plainly a bridge or a tag
  const names = autoLabels(sections, arrangement, auto);
  for (const [i, name] of names) sections[i].label = name;
  return { sections, arrangement };
}

/** A song from a text file or a paste that may carry more than the words: a title line, the writers, a "CCLI Song #"
 * line and a copyright line (as the files a song service gives out do). The words are what is left. */
export function parseSongFile(text: string, fallbackTitle = ""): Omit<SongData, "id"> {
  const lines = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").split("\n");
  let ccli = "";
  let author = "";
  const kept: string[] = [];
  for (const l of lines) {
    const c = /CCLI\s*(?:Song)?\s*(?:No\.?|Number|#)?\s*[:#]?\s*(\d{4,})/i.exec(l);
    if (c) {
      ccli = ccli || c[1];
      continue;
    }
    if (/^\s*(©|\(c\)|copyright\b|for use solely|ccli licen[cs]e)/i.test(l)) continue;
    const w = /^\s*(?:words|music|words and music|words & music|author|writers?|by)\s*[:\-–]\s*(.+)$/i.exec(l);
    if (w) {
      author = author || w[1].trim();
      continue;
    }
    kept.push(l);
  }
  let body = kept.join("\n").trim();
  let title = fallbackTitle;
  // a first line that is not a heading and is followed by a blank line or a heading is the title
  const first = body.split("\n")[0] ?? "";
  const rest = body.split("\n").slice(1);
  if (first.trim() && !HEADING.test(first) && (rest[0]?.trim() === "" || HEADING.test(rest[0] ?? ""))) {
    title = first.trim();
    body = rest.join("\n").trim();
  }
  const { sections, arrangement } = parseSong(body);
  return { title, author, ccli, sections, arrangement };
}

/** The line for the foot of a song's slides when the church shows its CCLI details: "Amazing Grace · John Newton · CCLI Song #22025".
 * The title always; the writer and the number when they are known. */
export function ccliLine(song: { title: string; author?: string; ccli?: string }): string {
  const num = (song.ccli ?? "").replace(/\D/g, "");
  return [song.title.trim(), (song.author ?? "").trim(), num ? `CCLI Song #${num}` : ""].filter(Boolean).join(" \u00b7 ");
}

/** The slides of one song, in its arrangement, after a title slide with its name if asked. A section of more than
 * `perSlide` lines is split into slides of even length. The slides' `song` and `section` say what they are for, so the
 * show can group them by song. */
export function songSlides(song: Pick<SongData, "title" | "sections" | "arrangement"> & { author?: string; ccli?: string }, perSlide = 4, titleSlide = false): SlideSpec[] {
  const out: SlideSpec[] = [];
  const credit = ccliLine(song);
  // the song's name on a slide of its own first, so each song stands apart (the same song sung twice is two of them)
  if (titleSlide) out.push({ kind: "point", title: song.title, body: song.author?.trim() ?? "", song: song.title, section: "Title", credit });
  const order = song.arrangement.length ? song.arrangement : song.sections.map((_, i) => i);
  for (const at of order) {
    const sec = song.sections[at];
    if (!sec) continue;
    const lines = sec.text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) continue;
    const parts = Math.ceil(lines.length / Math.max(1, perSlide));
    const each = Math.ceil(lines.length / parts);
    for (let p = 0; p < parts; p++) {
      out.push({
        kind: "song",
        title: `${song.title} · ${sec.label}${parts > 1 ? ` (${p + 1}/${parts})` : ""}`,
        body: lines.slice(p * each, (p + 1) * each).join("\n"),
        song: song.title,
        section: sec.label,
        credit,
      });
    }
  }
  return out;
}

/** The sections and the arrangement back as the plain text that makes them (to edit, or copy). */
export function songText(song: Pick<SongData, "sections" | "arrangement">): string {
  const order = song.arrangement.length ? song.arrangement : song.sections.map((_, i) => i);
  const seen = new Set<number>();
  const out: string[] = [];
  for (const at of order) {
    const s = song.sections[at];
    if (!s) continue;
    out.push(seen.has(at) ? s.label : `${s.label}\n${s.text}`);
    seen.add(at);
  }
  return out.join("\n\n");
}
