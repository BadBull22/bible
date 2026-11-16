// Memory verse practice: a verse (or a few verses in a row) the reader is learning, brought back after longer and longer gaps (spaced practice, in seven
// boxes). Pure, so Node tests it (scripts/test_memory_verse.mts); MemoryPractice.tsx does the screens and the Rust side only keeps the numbers.

/** Days to wait after a verse is known, by the box it moves into: box 0 is "new or forgotten" (practised again soon), box 6 is learned well (practised every two months). */
export const INTERVALS = [0, 1, 3, 7, 14, 30, 60] as const;
export const TOP_BOX = INTERVALS.length - 1;

export interface Learning {
  book: string;
  chapter: number;
  verse: number;
  verse_end: number;
  added_on: string;
  box: number;
  due_on: string;
  last_on: string | null;
}

/** "YYYY-MM-DD" for a date, in the phone's own time (not UTC). */
export function dayString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day `n` days after `day` (n may be negative). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayString(new Date(y, m - 1, d + n, 12));
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Where a verse goes after practice: "knew it" moves it up a box and waits longer; "not yet" sends it back to the start, to come round again tomorrow. */
export function afterPractice(box: number, knewIt: boolean, today: string): { box: number; due_on: string } {
  if (!knewIt) return { box: 0, due_on: addDays(today, 1) };
  const next = Math.min(TOP_BOX, Math.max(0, box) + 1);
  return { box: next, due_on: addDays(today, INTERVALS[next]) };
}

/** The verses due on or before `today` (those furthest overdue first). */
export function dueVerses<T extends { due_on: string }>(list: T[], today: string): T[] {
  return list.filter((v) => v.due_on <= today).sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : 0));
}

/** A word for how well a verse is known. */
export function stageName(box: number): string {
  if (box <= 0) return "New";
  if (box <= 2) return "Learning";
  if (box <= 4) return "Getting there";
  if (box < TOP_BOX) return "Strong";
  return "Learned";
}

/** "Psalms 23:1", "John 3:16-17". */
export function refOf(v: { book: string; chapter: number; verse: number; verse_end: number }): string {
  return `${v.book} ${v.chapter}:${v.verse}${v.verse_end > v.verse ? `-${v.verse_end}` : ""}`;
}

/** The words with some replaced by blanks to fill in from memory: more of them the further along the box ("level" 0 to 4 hides about 0, 25, 50, 75 and 100 percent of the words, which one is
 *  always the same for the same verse so it does not change when the screen is redrawn). Level 0 shows everything. */
export function blankWords(text: string, level: number, seed: string): { parts: { word: string; hidden: boolean }[]; hiddenCount: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const share = [0, 0.25, 0.5, 0.75, 1][Math.max(0, Math.min(4, Math.round(level)))];
  const want = Math.round(words.length * share);
  // a stable order from the seed: the words with the smallest hash are hidden
  const order = words.map((w, i) => ({ i, h: hash(`${seed}:${i}:${w}`) })).sort((a, b) => a.h - b.h);
  const hide = new Set(order.slice(0, want).map((o) => o.i));
  return { parts: words.map((word, i) => ({ word, hidden: hide.has(i) })), hiddenCount: hide.size };
}

/** "For God so loved" -> "F G s l": the first letter of each word, as a prompt. */
export function firstLetters(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const letter = w.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0);
      return letter || w.charAt(0);
    })
    .join(" ");
}

/** How much to hide for a verse in this box: new verses are shown whole at first, then more and more is taken away. */
export function levelForBox(box: number): number {
  return Math.max(0, Math.min(4, box - 0));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Verses to suggest when the reader has none yet: the well-loved ones. [book, chapter, first, last] */
export const SUGGESTED: [string, number, number, number][] = [
  ["John", 3, 16, 16],
  ["Psalms", 23, 1, 1],
  ["Philippians", 4, 13, 13],
  ["Proverbs", 3, 5, 6],
  ["Romans", 8, 28, 28],
  ["Isaiah", 41, 10, 10],
  ["Joshua", 1, 9, 9],
  ["Jeremiah", 29, 11, 11],
  ["Matthew", 6, 33, 33],
  ["Psalms", 119, 11, 11],
];
