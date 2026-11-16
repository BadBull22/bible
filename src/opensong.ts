// Reading a song kept in the OpenSong format (a small XML file: title, author, CCLI number, the order to sing the parts in, and the words with
// part markers such as [V1] [C] [B]) into the church's own song library. Written from the published format description. A file that is
// not a song, or is half-written, gives nothing rather than an error: the caller counts it as skipped. Pure, so it is tested under Node
// (scripts/test_opensong.mts).

import { tidyLabel, type SongData, type SongSection } from "./songs.ts";

/** The text of a tag, as plain text: the first <name>...</name> (a CDATA block or the XML escapes understood); "" when it is not there. */
function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, "i").exec(xml);
  if (!m) return "";
  return unescapeXml(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).replace(/\r\n?/g, "\n");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeChar(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

/** A part marker's code ("V1", "C", "C2", "B", "P", "T", "1"...) as the name it is shown under. */
export function openSongLabel(code: string): string {
  const c = code.trim();
  const m = /^([VCBPT])\s*(\d*)$/i.exec(c);
  if (m) {
    const base = { V: "Verse", C: "Chorus", B: "Bridge", P: "Pre-Chorus", T: "Tag" }[m[1].toUpperCase() as "V"];
    return m[2] ? `${base} ${m[2]}` : base;
  }
  if (/^\d+$/.test(c)) return `Verse ${c}`;
  return tidyLabel(c) || c;
}

/** The words of an OpenSong song: parts by marker, chord lines (they start with a full stop) and comments (a semicolon) left out. */
export function parseOpenSongLyrics(lyrics: string): { code: string; text: string }[] {
  const parts: { code: string; lines: string[] }[] = [];
  for (const raw of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^\s*\[([^\]\n]{1,30})\]\s*$/.exec(raw);
    if (marker) {
      parts.push({ code: marker[1].trim(), lines: [] });
      continue;
    }
    if (raw.startsWith(".") || raw.startsWith(";")) continue; // chords and comments
    if (/^\s*-{3,}\s*$/.test(raw) || raw.trim() === "||") continue; // a break between slides: ours are made by the lines on a slide
    if (parts.length === 0) {
      if (!raw.trim()) continue;
      parts.push({ code: "V", lines: [] }); // words before any marker are a verse
    }
    // a line of words starts with one space; "_" holds a chord over a long syllable and is no part of the words
    const line = raw.replace(/^ /, "").replace(/_/g, "").replace(/\s+$/, "");
    if (line.trim()) parts[parts.length - 1].lines.push(line.replace(/\|/g, " ").replace(/ {2,}/g, " ").trim());
  }
  return parts.filter((p) => p.lines.length > 0).map((p) => ({ code: p.code, text: p.lines.join("\n") }));
}

/** An OpenSong song as a song of the library, or null when the file holds no song (not XML, no words). */
export function parseOpenSong(xml: string, fallbackTitle = ""): Omit<SongData, "id"> | null {
  const text = xml.replace(/^﻿/, "");
  if (!/<song[\s>]/i.test(text) || !/<lyrics[\s>]/i.test(text)) return null;
  const parts = parseOpenSongLyrics(tag(text, "lyrics"));
  if (parts.length === 0) return null;

  // the parts, one for each marker code (a code that comes twice with other words gets a number)
  const sections: SongSection[] = [];
  const byCode = new Map<string, number>();
  for (const p of parts) {
    const key = p.code.toUpperCase();
    let label = openSongLabel(p.code);
    for (let n = 2; sections.some((s) => s.label.toLowerCase() === label.toLowerCase()); n++) label = `${openSongLabel(p.code).replace(/\s+\d+$/, "")} ${n}`;
    if (byCode.has(key)) {
      // the same code again: the same part sung again only if the words are the same
      const at = byCode.get(key)!;
      if (sections[at].text === p.text) continue;
    } else byCode.set(key, sections.length);
    sections.push({ label, text: p.text });
  }
  // the order sung: the presentation line ("V1 C V2 C"), else the parts as written
  const order = tag(text, "presentation").split(/[\s,;]+/).filter(Boolean);
  let arrangement = order.flatMap((c) => (byCode.has(c.toUpperCase()) ? [byCode.get(c.toUpperCase())!] : []));
  if (arrangement.length === 0) arrangement = sections.map((_, i) => i);

  const title = tag(text, "title").trim() || fallbackTitle.trim();
  if (!title) return null;
  const ccli = tag(text, "ccli").replace(/\D/g, "");
  return { title: title.slice(0, 200), author: tag(text, "author").trim().slice(0, 200), ccli, sections, arrangement };
}
