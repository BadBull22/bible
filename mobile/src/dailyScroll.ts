// The Daily Scroll: how the day's cards are chosen. About a thousand cards are held (verses, "Verses for..." passages, stories, authors, memory verses); each
// day shows 20 of them, the same 20 all day (the deck is made from the date), none of them one that was shown in the last 50 days, in a steady rhythm of kinds
// so a run of verses is broken by a story or an author. "Show me more" adds 10 more. Nothing is learned about the reader: no tracking, no profile.
// Pure, so Node tests it (scripts/test_daily_scroll.mts); the screen (DailyScroll.tsx) does the drawing.

export type CardKind = "verse" | "daily" | "topic" | "story" | "author" | "memory";

export interface Card {
  /** stable: the same card has the same id every day (it is what the history remembers) */
  id: string;
  kind: CardKind;
  /** a Bible reference, "John 3:16" or "Psalms 23:1-3", for the kinds that show Scripture */
  ref?: string;
  /** the big line for a card that is not Scripture (a story's first sentences, an author's note) */
  text?: string;
  /** a small heading over the card ("Verses for fear", "Who wrote Romans") */
  title?: string;
  /** a line under the Scripture (a "Verses for..." note) */
  note?: string;
  /** what Open goes to: a story's, "Verses for..." page's or children's page's id, or an author's name (a verse card opens its passage) */
  open?: string;
}

export interface Sources {
  verseCards: { id: string; ref: string }[];
  /** the daily verses: [book, chapter, first verse, last verse] */
  daily: [string, number, number, number][];
  topics: { id: string; title: string; items: { ref: string; note: string }[] }[];
  stories: { id: string; title: string; summary: string }[];
  authors: { name: string; note: string; books: string[] }[];
  children: { id: string; title: string; memory: { ref: string } }[];
}

/** Every card, in a fixed order. */
export function buildPool(s: Sources): Card[] {
  const pool: Card[] = [];
  for (const c of s.verseCards) pool.push({ id: c.id, kind: "verse", ref: c.ref });
  for (const [book, chapter, v, ve] of s.daily) pool.push({ id: `d:${book}:${chapter}:${v}`, kind: "daily", ref: `${book} ${chapter}:${v}${ve > v ? `-${ve}` : ""}` });
  for (const t of s.topics)
    t.items.forEach((it, i) => pool.push({ id: `t:${t.id}:${i}`, kind: "topic", ref: it.ref, title: `Verses for… ${t.title.replace(/^Verses for…?\s*/i, "")}`, note: it.note, open: t.id }));
  for (const st of s.stories) pool.push({ id: `s:${st.id}`, kind: "story", title: st.title, text: firstSentences(st.summary, 2), open: st.id });
  for (const a of s.authors) pool.push({ id: `a:${a.name}`, kind: "author", title: a.name, text: firstSentences(a.note, 2), open: a.name });
  for (const c of s.children) pool.push({ id: `m:${c.id}`, kind: "memory", ref: c.memory.ref, title: "A verse to remember", open: c.id });
  return pool;
}

/** The first `n` sentences of a text (the whole text when it has fewer). */
export function firstSentences(text: string, n: number): string {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(?:["”’')\]]+)?|[^.!?]+$/g) ?? [text];
  return parts.slice(0, n).map((p) => p.trim()).join(" ").trim();
}

/** days since 1 January 2026 (the local date) */
export function dayNumber(d: Date = new Date()): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86_400_000);
}

/** a small, fast, seedable random number generator (the same seed always gives the same numbers) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** the kinds in a day's 20 cards, in order: Scripture mostly, a story or an author now and then */
export const RHYTHM: CardKind[] = ["verse", "verse", "story", "verse", "topic", "verse", "author", "verse", "daily", "topic", "verse", "story", "verse", "memory", "verse", "topic", "author", "verse", "story", "verse"];
/** when a kind has run out the next best is used, in this order */
const FALLBACK: CardKind[] = ["verse", "topic", "daily", "memory", "story", "author"];
/** how many days a shown card is left out */
export const REST_DAYS = 50;

/** What was shown on which day: the ids. */
export type History = Record<string, string[]>;

/** The ids shown in the last `REST_DAYS` days before `today` (today's own are not counted: the deck of a day is made the same way all day). */
export function recentIds(history: History, today: number): Set<string> {
  const out = new Set<string>();
  for (const [day, ids] of Object.entries(history)) {
    const d = Number(day);
    if (d < today && today - d <= REST_DAYS) ids.forEach((id) => out.add(id));
  }
  return out;
}

/**
 * The cards for a day: `count` of them, in the rhythm, from the cards not shown lately. `skip` are ids already in today's deck (for "Show me more").
 * The same `pool`, `history` and `today` always give the same deck. When fewer than `count` cards are rested (a small pool, or after the cycle), the
 * history is set aside and the cycle starts again in a new order.
 */
export function pickCards(pool: Card[], history: History, today: number, count: number, skip: Set<string> = new Set(), salt = 0): Card[] {
  const rested = recentIds(history, today);
  let available = pool.filter((c) => !rested.has(c.id) && !skip.has(c.id));
  if (available.length < count) available = pool.filter((c) => !skip.has(c.id));
  const rand = mulberry32(today * 7919 + salt * 104729 + 13);
  const byKind = new Map<CardKind, Card[]>();
  for (const k of FALLBACK) byKind.set(k, []);
  for (const c of shuffled(available, rand)) byKind.get(c.kind)!.push(c);
  const out: Card[] = [];
  const take = (kind: CardKind): Card | null => {
    for (const k of [kind, ...FALLBACK]) {
      const next = byKind.get(k)?.shift();
      if (next) return next;
    }
    return null;
  };
  for (let i = 0; i < count; i++) {
    const c = take(RHYTHM[(i + salt * 3) % RHYTHM.length]);
    if (!c) break;
    out.push(c);
  }
  return out;
}

/** Today's deck: 20 cards, and `more` more groups of 10 if the reader asked for them. */
export function buildDeck(pool: Card[], history: History, today: number, more = 0): Card[] {
  const deck = pickCards(pool, history, today, 20);
  for (let i = 1; i <= more; i++) deck.push(...pickCards(pool, history, today, 10, new Set(deck.map((c) => c.id)), i));
  return deck;
}

/** The history with today's deck written in (the oldest days beyond the rest period are forgotten). */
export function remember(history: History, today: number, deck: Card[]): History {
  const out: History = {};
  for (const [day, ids] of Object.entries(history)) if (today - Number(day) <= REST_DAYS * 2) out[day] = ids;
  out[String(today)] = deck.map((c) => c.id);
  return out;
}

/** A number from a card's id (to pick its look or photo: the same card always looks the same). */
export function hashOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/** The small heading over a card. */
export function kindLabel(c: Card): string {
  switch (c.kind) {
    case "story":
      return "Bible story";
    case "author":
      return "Who wrote the Bible";
    case "memory":
      return "A verse to remember";
    case "topic":
      return c.title ?? "Verses for…";
    default:
      return "Scripture";
  }
}

/** At most `max` characters of a long passage, cut at the end of a sentence when one falls late enough, else at a word, with "…" (a card is one screen). */
export function trimWords(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(".” "));
  if (stop >= max * 0.6) return cut.slice(0, stop + 1).trim();
  return cut.replace(/\s+\S*$/, "").replace(/[\s,;:.]+$/, "") + "…";
}
