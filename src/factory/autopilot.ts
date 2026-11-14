// Content Factory: the rules behind "Make my week" and the series: what to make, on which day, without repeating what was made
// lately. Fixed rules and a seed. Pure (tested under Node: scripts/test_factory.mts).

import { dayNumber, occasionOn, windowsOf, type OccasionWindow } from "../themes/themeCalendar.ts";

export type RecipeId = "daily" | "season" | "topic" | "story" | "memory" | "fact";

export const RECIPES: { id: RecipeId; label: string; blurb: string }[] = [
  { id: "daily", label: "A verse a day", blurb: "A well-loved verse for each day that has nothing else" },
  { id: "season", label: "The season", blurb: "A set of verses for the time of the church year" },
  { id: "topic", label: "Verses for a need", blurb: "Verses for fear, grief, hope and more, from the Browse pages" },
  { id: "story", label: "A Bible story", blurb: "A short retelling, a picture set with the passage" },
  { id: "memory", label: "A memory verse", blurb: "A verse to learn, from the children's pages" },
  { id: "fact", label: "A Bible fact", blurb: "A question and its answer from Firsts and Milestones" },
];

export const DEFAULT_RECIPES: RecipeId[] = ["daily", "topic", "story", "memory", "fact", "season"];

/** How long a thing, once made, is not made again. */
export const REPEAT_DAYS = 120;
const KEEP_DAYS = 400;

export interface HistoryEntry {
  key: string;
  /** the day number (days since 1970-01-01) it was made */
  day: number;
}

/** what was made recently enough not to be made again */
export function usedKeys(history: HistoryEntry[], today: number, days = REPEAT_DAYS): Set<string> {
  return new Set(history.filter((h) => today - h.day < days).map((h) => h.key));
}

/** adds what was just made, and forgets what is over a year old */
export function remember(history: HistoryEntry[], keys: string[], today: number): HistoryEntry[] {
  const kept = history.filter((h) => today - h.day < KEEP_DAYS && !keys.includes(h.key));
  return [...kept, ...keys.map((key) => ({ key, day: today }))];
}

/** takes things back (a post that was skipped may come round again) */
export function forget(history: HistoryEntry[], keys: string[]): HistoryEntry[] {
  return history.filter((h) => !keys.includes(h.key));
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let a = (seed * 2654435761) | 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `n` things not used lately, in a seeded order. If too few are fresh, the rest come from the ones used longest ago. */
export function pickFresh<T>(items: T[], key: (t: T) => string, used: Set<string>, n: number, seed: number): T[] {
  const mixed = shuffled(items, seed);
  const fresh = mixed.filter((t) => !used.has(key(t)));
  if (fresh.length >= n) return fresh.slice(0, n);
  return [...fresh, ...mixed.filter((t) => used.has(key(t)))].slice(0, n);
}

/** The season now, or the one that starts within `horizon` days (so a Christmas series can be made in good time). */
export function upcomingOccasion(today: number, horizon = 14): OccasionWindow | null {
  const now = occasionOn(today);
  if (now) return now;
  const year = new Date(today * 86_400_000).getUTCFullYear();
  const coming = [...windowsOf(year), ...windowsOf(year + 1)].filter((w) => w.start > today && w.start - today <= horizon).sort((a, b) => a.start - b.start);
  return coming[0] ?? null;
}

/** The week's work: each chosen recipe once, spread over the next seven days (the first on day 0), and "a verse a day" filling the
 * days that have nothing else. `season` is dropped when there is no season to make a series for. */
export function weekPlan(include: RecipeId[], today: number, hasSeason: boolean): { recipe: RecipeId; day: number }[] {
  const specials = DEFAULT_RECIPES.filter((r) => r !== "daily" && include.includes(r) && (r !== "season" || hasSeason));
  const plan: { recipe: RecipeId; day: number }[] = [];
  const taken = new Set<number>();
  specials.forEach((recipe, i) => {
    let off = Math.floor((i * 7) / Math.max(1, specials.length));
    while (taken.has(off) && off < 6) off++;
    taken.add(off);
    plan.push({ recipe, day: today + off });
  });
  if (include.includes("daily")) for (let d = 0; d < 7; d++) if (!taken.has(d)) plan.push({ recipe: "daily", day: today + d });
  return plan.sort((a, b) => a.day - b.day);
}

export const todayDay = (now: Date = new Date()) => dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
