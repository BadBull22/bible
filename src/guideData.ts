// The step-by-step builder's data: what each step shows and how it is turned into sermon material.
//
// Everything here is the app's own data (the passage's natural parts, the cross-reference notes,
// the interlinear and Strong's, Simeon's outlines, Spurgeon's sermons, the books of stories). The
// commands are called with their optional flags off, so no optional download is ever needed: a
// part's heading is its verse range, a word has its dictionary entry and no extra sentence, a
// story is listed as found.

import type { ReactNode } from "react";
import { api, BookInfo, Version } from "./api";
import { ai, AiPart, AiStory, AiThread, AiThreadLink, AiWordInsight } from "./offlineAi";
import { Material, Ref, refLabel, SermonItem } from "./sermon";
import { pointOfRef } from "./sermonLayout";

/** One part of the main passage, and whether the preacher is using it as a point. */
export interface GuidePick {
  v1: number;
  v2: number;
  on: boolean;
  /** the start of the part's text, to recognise it by */
  text: string;
}

/** Where the preacher is in the step-by-step builder (kept with the sermon). */
export interface GuideState {
  /** 0-based index into STEPS */
  step: number;
  /** the main passage (null: a topic preached in points, with no single passage) */
  passage: Ref | null;
  /** the passage's parts, for choosing the points */
  picks: GuidePick[];
  /** a topic with no single passage was chosen */
  noPassage: boolean;
  /** the furthest step reached, so the stepper can say which are done */
  reached: number;
  /** the part being written in the Write step (an index into the sermon's parts) */
  part: number;
}

export const EMPTY_GUIDE: GuideState = { step: 0, passage: null, picks: [], noPassage: false, reached: 0, part: 0 };

export interface GuideStep {
  key: string;
  title: string;
  /** one plain sentence: what this step is for */
  why: string;
}

export const STEPS: GuideStep[] = [
  { key: "passage", title: "Passage", why: "Choose what the sermon is about. A passage gives you its parts to preach through; a subject gives you the key passages on it." },
  { key: "story", title: "Storyline", why: "Choose how the sermon will unfold, name your points, and say in one sentence what it is about." },
  { key: "understand", title: "Understand it", why: "What the passage meant, and what its Hebrew and Greek words say. Add what you want to teach from." },
  { key: "connect", title: "Connect", why: "The Bible explains itself: other verses that tie in with your passage, and more Scripture to read with it." },
  { key: "stories", title: "Stories & more", why: "Stories to make it real, what great preachers said on it, and a picture, a song or a link to go with it." },
  { key: "close", title: "Close", why: "Plan how the sermon ends: the call to respond, and a prayer." },
  { key: "write", title: "Write it", why: "Now put it in your own words, one point at a time. Everything you collected is beside you." },
  { key: "finish", title: "Finish", why: "Check it over, then read it, print it, make slides or preach it." },
];

/** What every step may use of the builder. */
export interface GuideContext {
  title: string;
  query: string;
  topics: string[];
  items: SermonItem[];
  gathered: Material[];
  bigIdea: string;
  purpose: string;
  shape: string;
  points: number;
  targetMinutes: number;
  guide: GuideState;
  busy: string | null;
  chosen: Set<string>;
  /** where an added item goes: a point's or section's row id (null: each into its place) */
  target: string | null;
  versionCode: string;
  versions: Version[];
  books: BookInfo[];
  setGuide: (patch: Partial<GuideState>) => void;
  setFields: (patch: { title?: string; query?: string; bigIdea?: string; purpose?: string }) => void;
  gather: (query: string) => void;
  /** adds a piece of material to the sermon (or takes it out again); `home` is the point it belongs to, when the point being worked in is not chosen */
  toggle: (m: Material, home?: string | null) => void;
  /** adds some Scripture parts to the sermon and takes others out, as one change Undo takes back */
  setSections: (add: Material[], removeKeys: string[]) => void;
  /** lays the sermon out in a template with this many points */
  build: (shape: string, points: number) => void;
  setTarget: (id: string | null) => void;
  /** a change to the sermon's items that Undo can take back */
  change: (f: (items: SermonItem[]) => SermonItem[]) => void;
  pickMedia: (slot: string | null) => void;
  usedNote: (m: Material) => ReactNode;
  onJump: (book: string, chapter: number, verse: number) => void;
  // writing
  onText: (id: string, text: string) => void;
  onLabel: (id: string, label: string) => void;
  onMedia: (id: string, patch: Partial<import("./sermonMedia").MediaRef>) => void;
  onMark: (id: string, kind: "bold" | "italic" | "blank" | "bullet") => void;
  renderMaterial: (m: Material) => ReactNode;
  // the end
  goTab: (tab: "review" | "print" | "slides") => void;
  save: () => void;
  preach: () => void;
  useFullBuilder: () => void;
  saved: boolean;
}

// ---------------------------------------------------------------- the passage and its parts

/** A passage's natural parts (cut where the text breaks), each ticked to begin with. */
export async function loadParts(ref: Ref): Promise<GuidePick[]> {
  const parts: AiPart[] = await ai.structure(ref.book, ref.chapter, ref.verse, Math.min(ref.verseEnd, ref.verse + 59), false);
  return parts.map((p) => ({ v1: p.verse_start, v2: p.verse_end, on: true, text: p.text.replace(/\s+/g, " ").trim().slice(0, 220) }));
}

export const partRef = (main: Ref, p: GuidePick): Ref => ({ book: main.book, chapter: main.chapter, verse: p.v1, verseEnd: p.v2 });

/** The text of a part, with verse numbers, as the passage's sections are gathered. */
export async function partText(version: string, ref: Ref): Promise<string> {
  const chapter = await api.getChapter(version, ref.book, ref.chapter).catch(() => []);
  const verses = chapter.length ? chapter : await api.getChapter("BSB", ref.book, ref.chapter).catch(() => []);
  return verses
    .filter((v) => v.verse >= ref.verse && v.verse <= ref.verseEnd)
    .map((v) => `${v.verse} ${v.text}`)
    .join(" ");
}

/** A part of the passage as sermon material: the same key as the gathered sections, so the two never double up. */
export function sectionMaterial(ref: Ref, text: string, version: string, topic: string): Material {
  return { key: `s:${ref.book}|${ref.chapter}|${ref.verse}:${ref.verseEnd}`, kind: "section", title: refLabel(ref), text, source: version, ref, topic };
}

// ---------------------------------------------------------------- what the steps bring

export const threadsOf = (r: Ref) => ai.threads(r.book, r.chapter, r.verse, r.verseEnd);
export const storiesOf = (r: Ref, subjects: string[]) => ai.stories(r.book, r.chapter, r.verse, r.verseEnd, subjects, false);
export const wordsOf = (r: Ref) => ai.wordInsights(r.book, r.chapter, r.verse, r.verseEnd, false);

const dashed = (l: { verse: number; verse_end: number }) => (l.verse_end > l.verse ? `${l.verse}–${l.verse_end}` : `${l.verse}`);

/** A verse another thread ties to the passage, as material: Scripture, with what ties it. */
export function linkMaterial(l: AiThreadLink, th: AiThread, topic: string): Material {
  const ref: Ref = { book: l.book, chapter: l.chapter, verse: l.verse, verseEnd: Math.max(l.verse, l.verse_end) };
  return {
    key: `g:${th.kind === "cross" ? "x" : "v"}:${l.book}|${l.chapter}|${l.verse}`,
    kind: th.kind === "cross" ? "xref" : "verse",
    title: `${l.book} ${l.chapter}:${dashed(l)}`,
    text: l.text,
    source: `BSB · ${th.title}${l.why ? ` (${l.why})` : ""}`,
    ref,
    topic,
  };
}

/** A Hebrew or Greek word as material: the same key as the gathered words, so they don't double up. */
export function wordMaterial(c: AiWordInsight, r: Ref, topic: string): Material {
  const lines = [
    `In ${r.book} ${r.chapter}:${c.verse} the English “${c.english}” is the ${c.strongs.startsWith("G") ? "Greek" : "Hebrew"} ${c.original} (${c.translit}), Strong's ${c.strongs}: ${c.lemma_gloss}.`,
    c.definition ? `Strong's: ${c.definition}` : "",
    c.renderings.length ? `Translated: ${c.renderings.join(", ")}.` : "",
    c.others.length ? `Other words glossed the same: ${c.others.map((o) => `${o.lemma} (${o.strongs})`).join(", ")}.` : "",
    ...c.others.filter((o) => o.note).map((o) => `${o.lemma} (${o.strongs}) — Strong's: ${o.note}`),
  ].filter(Boolean);
  return {
    key: `w:${c.strongs}`,
    kind: "word",
    title: `${c.original} (${c.translit}) ${c.strongs} — “${c.english}”`,
    text: lines.join("\n"),
    source: `Interlinear and Strong's ${c.strongs} · ${r.book} ${r.chapter}:${c.verse}`,
    ref: { book: r.book, chapter: r.chapter, verse: c.verse, verseEnd: c.verse },
    topic,
  };
}

/** A story, or what Simeon or Spurgeon preached on the passage, as material. */
export function storyMaterial(s: AiStory, r: Ref, topic: string): Material {
  // some of Simeon's outlines have no title of their own: the verse they are on names them, and the
  // source (which has its number) keeps two of them from being taken for one
  const name = s.title || s.subject;
  return {
    key: `g:story:${s.kind}:${s.source}:${s.title}`,
    kind: s.kind === "simeon" ? "outline" : s.kind === "spurgeon" ? "sermon" : "illustration",
    title: s.kind === "simeon" ? `Simeon's outline — ${name}` : s.kind === "spurgeon" ? `Spurgeon: ${name}` : name,
    text: s.url ? `${s.text}\n\nRead it in full: ${s.url}` : s.text,
    source: `${s.source}${s.subject ? ` · ${s.subject}` : ""}`,
    ref: s.kind === "illustration" ? undefined : r,
    topic,
  };
}

/** The passage the research is about: the main passage, else the first key passage found. */
export function passageOf(ctx: GuideContext): Ref | null {
  if (ctx.guide.passage) return ctx.guide.passage;
  return ctx.gathered.find((m) => m.kind === "passage" && m.ref)?.ref ?? null;
}

/** The point a cross-reference belongs to: the one whose Scripture holds the verse it is tied to
 * (the cross-reference notes say "..., from verse 3"). Null for anything else. */
export function homeOf(ctx: GuideContext, m: Material): string | null {
  const from = m.kind === "xref" ? /from verse (\d+)/.exec(m.source ?? "")?.[1] : null;
  const p = passageOf(ctx);
  return from && p ? pointOfRef(ctx.items, { book: p.book, chapter: p.chapter, verse: +from, verseEnd: +from }) : null;
}
