// Content Factory: what pictures are made FROM. A typed reference ("John 3:16", "Psalm 23:1-3"), today's verse, or the
// week's seven verses; the words come from the app's own Bible (only translations that are free to share), and the
// caption is written from them.

import { api, BookInfo, resolveReference, Verse } from "../api";
import { DAILY_VERSES, verseOfTheDay } from "../dailyVerse";
import { quoted, tidyQuotes } from "./text";
import { FooterSettings, SITE_MARK } from "./types";

/** Translations that are free to put on a picture and post (public domain). Others are never offered here. */
export const FREE_VERSIONS = ["BSB", "KJV", "WEB", "ASV", "YLT"];

export interface Passage {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

/** "Psalms" is cited "Psalm 23:1". */
export const displayBook = (book: string) => (book === "Psalms" ? "Psalm" : book);

export function referenceLabel(p: Passage): string {
  const v = p.verseEnd > p.verseStart ? `${p.verseStart}–${p.verseEnd}` : `${p.verseStart}`;
  return `${displayBook(p.book)} ${p.chapter}:${v}`;
}

/** Reads "John 3:16", "Psalm 23:1-3", "1 Cor 13:4-7". Returns null if it is not a verse (a whole chapter is too long for a picture). */
export function parsePassage(input: string, books: BookInfo[], chapterCounts: Record<string, number>): Passage | null {
  const t = input.trim().replace(/[–—]/g, "-");
  const m = t.match(/^(.*:\s*\d+)\s*-\s*(\d+)$/);
  const ref = resolveReference(m ? m[1] : t, books, chapterCounts);
  if (!ref || ref.verse == null) return null;
  const end = m ? parseInt(m[2], 10) : ref.verse;
  if (end < ref.verse || end - ref.verse > 30) return null;
  return { book: ref.book, chapter: ref.chapter, verseStart: ref.verse, verseEnd: end };
}

export interface CardText {
  text: string;
  reference: string;
}

/** The longest verse text that is kept on one picture; longer passages continue on the next picture. */
export const MAX_CHARS = 260;

/** The words of a passage as one or more picture texts (a long passage is split between verses). */
export async function loadPassage(p: Passage, versionCode: string): Promise<CardText[]> {
  const chapter: Verse[] = await api.getChapter(versionCode, p.book, p.chapter);
  const wanted = chapter.filter((v) => v.verse >= p.verseStart && v.verse <= p.verseEnd);
  if (wanted.length === 0) throw new Error("That passage is not in this translation.");
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const tidy = (vs: Verse[]) => tidyQuotes(vs.map((v) => clean(v.text)).join(" "));
  const out: CardText[] = [];
  let group: Verse[] = [];
  const flush = () => {
    if (!group.length) return;
    const a = group[0].verse;
    const b = group[group.length - 1].verse;
    out.push({ text: tidy(group), reference: referenceLabel({ ...p, verseStart: a, verseEnd: b }) });
    group = [];
  };
  for (const v of wanted) {
    const len = group.reduce((n, g) => n + clean(g.text).length + 1, 0);
    if (group.length && len + clean(v.text).length > MAX_CHARS) flush();
    group.push(v);
  }
  flush();
  return out;
}

/** The week's verses: seven days from `from`, the same rotation as the verse of the day. */
export function weekPassages(from: Date = new Date()): Passage[] {
  const out: Passage[] = [];
  for (let d = 0; d < 7; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    const [book, chapter, verse] = verseOfTheDay(day);
    out.push({ book, chapter, verseStart: verse, verseEnd: verse });
  }
  return out;
}

export const todayPassage = (): Passage => {
  const [book, chapter, verse] = verseOfTheDay();
  return { book, chapter, verseStart: verse, verseEnd: verse };
};

/** A verse chosen by a number (so "Another verse" always gives the same one for the same number). */
export function promisePassage(n: number): Passage {
  const [book, chapter, verse] = DAILY_VERSES[Math.abs(Math.floor(n)) % DAILY_VERSES.length];
  return { book, chapter, verseStart: verse, verseEnd: verse };
}

export const DEFAULT_HASHTAGS = ["#Bible", "#Scripture", "#Faith", "#Jesus", "#BibleVerse"];

/** The artist credit for Southern Cross Music and where to find it. */
export const SOUTHERN_CROSS = { name: "Southern Cross Music", link: "https://music.youtube.com/channel/UCOmYicXYhihT-vUOFE99ETw" };

/** The caption to paste with a picture or video: the words, the reference, hashtags, the site, the credits. */
export function buildCaption(items: { text: string; reference: string; version: string }[], footer: FooterSettings, extra: { credits?: string[]; music?: string | null; hashtags?: string[] } = {}): string {
  const parts: string[] = [];
  for (const it of items) parts.push(`${quoted(it.text)}\n— ${it.reference}${it.version ? ` (${it.version})` : ""}`);
  let caption = parts.join("\n\n");
  const tags = extra.hashtags ?? DEFAULT_HASHTAGS;
  if (tags.length) caption += `\n\n${tags.join(" ")}`;
  const link = footer.mark.kind === "site" ? SITE_MARK : footer.mark.kind === "custom" ? footer.mark.text.trim() : "";
  if (link) caption += `\n\n${link}`;
  for (const c of extra.credits ?? []) if (c.trim()) caption += `\n${c.trim()}`;
  if (extra.music) caption += `\n${extra.music}`;
  return caption;
}

/** "Music: <song> by Southern Cross Music" */
export const musicCredit = (title: string) => `Music: ${title} by ${SOUTHERN_CROSS.name} – ${SOUTHERN_CROSS.link}`;

/** a file name for the pictures made from these cards: "2026-11-13 John 3-16" */
export function fileStem(label: string, date = new Date()): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${iso} ${label.replace(/[:–]/g, "-").replace(/[^\p{L}\p{N} _-]+/gu, "").replace(/\s+/g, " ").trim()}`.trim();
}
