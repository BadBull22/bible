import { Book } from "./api";

// Reading plans, worked out from the list of books so they always fit the text. The plans,
// their ids and the way chapters are shared out over the days are the desktop app's
// (src/readingPlans.ts) -- keep the two alike, so that a plan started on one device is the
// same plan on the other when a backup is restored. Only the start date and the days ticked
// off are stored.

export interface Reading {
  book: string;
  chapter: number;
}

export interface PlanDef {
  id: string;
  name: string;
  description: string;
  days: number;
}

export const PLANS: PlanDef[] = [
  { id: "bible-year", name: "The whole Bible in a year", description: "Genesis to Revelation in order, about 3–4 chapters a day.", days: 365 },
  { id: "nt-90", name: "New Testament in 90 days", description: "Matthew to Revelation, about 3 chapters a day.", days: 90 },
  { id: "gospels-30", name: "The four Gospels in 30 days", description: "Matthew, Mark, Luke and John, about 3 chapters a day.", days: 30 },
  { id: "psalms-proverbs-31", name: "Psalms & Proverbs in a month", description: "One chapter of Proverbs and about five Psalms each day.", days: 31 },
];

function chaptersOf(books: Book[], filter: (b: Book) => boolean): Reading[] {
  const out: Reading[] = [];
  for (const b of books) {
    if (!filter(b)) continue;
    for (let c = 1; c <= b.chapters; c++) out.push({ book: b.name, chapter: c });
  }
  return out;
}

function spread(chapters: Reading[], days: number): Reading[][] {
  const out: Reading[][] = [];
  for (let i = 0; i < days; i++) {
    out.push(chapters.slice(Math.floor((i * chapters.length) / days), Math.floor(((i + 1) * chapters.length) / days)));
  }
  return out;
}

const GOSPELS = new Set(["Matthew", "Mark", "Luke", "John"]);

/** Every day's readings for a plan (index 0 = day 1). */
export function buildPlan(id: string, books: Book[]): Reading[][] {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) return [];
  switch (id) {
    case "bible-year":
      return spread(chaptersOf(books, () => true), plan.days);
    case "nt-90":
      return spread(chaptersOf(books, (b) => b.testament === "NT"), plan.days);
    case "gospels-30":
      return spread(chaptersOf(books, (b) => GOSPELS.has(b.name)), plan.days);
    case "psalms-proverbs-31": {
      const psalms = spread(chaptersOf(books, (b) => b.name === "Psalms"), plan.days);
      const proverbs = books.find((b) => b.name === "Proverbs")?.chapters ?? 31;
      return psalms.map((ps, i) => [...(i < proverbs ? [{ book: "Proverbs", chapter: i + 1 }] : []), ...ps]);
    }
    default:
      return [];
  }
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Which plan day "today" is (1-based), counted from the start date, kept within the plan. */
export function currentDay(startedOn: string, days: number): number {
  const [y, m, d] = startedOn.split(/[- :]/).map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  return Math.min(days, Math.max(1, diff + 1));
}

/** "Genesis 1–3, Exodus 1": consecutive chapters of a book as one range. */
export function describeReadings(readings: Reading[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < readings.length) {
    const start = readings[i];
    let j = i;
    while (j + 1 < readings.length && readings[j + 1].book === start.book && readings[j + 1].chapter === readings[j].chapter + 1) j++;
    parts.push(j > i ? `${start.book} ${start.chapter}–${readings[j].chapter}` : `${start.book} ${start.chapter}`);
    i = j + 1;
  }
  return parts.join(", ");
}
