// The Sunday and holy-day lectionary of the 1979 Book of Common Prayer (not under copyright):
// a three-year cycle, Years A, B and C, beginning each Advent. lectionary.json holds the
// readings and collect for each day (data-pipeline/build_lectionary.py); this works out
// which day of the church year a date is.

import DAYS from "./lectionary.json";

export interface LectionaryDay {
  key: string;
  /** "A" | "B" | "C", or "" for the same in every year */
  year: string;
  season: string;
  name: string;
  title: string;
  readings: string[];
  psalm: string;
  collect: string;
}

/** A day with something appointed: its date and what is read. */
export interface Appointed {
  date: Date;
  /** the year of the cycle, "A" | "B" | "C" */
  year: string;
  day: LectionaryDay;
  /** a Sunday, rather than a weekday feast or holy day */
  sunday: boolean;
}

const BY_KEY = new Map((DAYS as LectionaryDay[]).map((d) => [d.key, d]));

const DAY_MS = 86_400_000;
const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);
const addDays = (d: Date, n: number) => noon(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Easter Day (Gregorian calendar). */
export function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return noon(y, month - 1, day);
}

/** The First Sunday of Advent in calendar year `y`: the fourth Sunday before Christmas. */
export function advent1(y: number): Date {
  const christmas = noon(y, 11, 25);
  return addDays(christmas, -(christmas.getDay() || 7) - 21);
}

/** The church year a date belongs to, named by the calendar year it mostly falls in (Advent
 * 2025 begins 2026), and its letter: A, B or C. */
export function churchYear(date: Date): { year: number; letter: string } {
  const y = date.getFullYear();
  const year = date >= advent1(y) ? y + 1 : y;
  return { year, letter: ["C", "A", "B"][year % 3] };
}

// the holy days kept on the same date every year: key -> [month (0-11), day]
const FIXED: Record<string, [number, number]> = {
  Andrew: [10, 30],
  Thomas: [11, 21],
  Stephen: [11, 26],
  John: [11, 27],
  HolyInno: [11, 28],
  HolyName: [0, 1],
  Epiph: [0, 6],
  ConfPetr: [0, 18],
  ConvPaul: [0, 25],
  Present: [1, 2],
  Matthias: [1, 24],
  Joseph: [2, 19],
  Annunc: [2, 25],
  Mark: [3, 25],
  PhilJames: [4, 1],
  Visit: [4, 31],
  Barnabas: [5, 11],
  NatJohn: [5, 24],
  PetPaul: [5, 29],
  Indepen: [6, 4],
  MaryMag: [6, 22],
  James: [6, 25],
  Transfig: [7, 6],
  MaryVirg: [7, 15],
  Barth: [7, 24],
  HolyCros: [8, 14],
  Matthew: [8, 21],
  Michael: [8, 29],
  Luke: [9, 18],
  JamesJer: [9, 23],
  SimnJude: [9, 28],
  SaintsI: [10, 1],
};

/** The key of what is appointed for a Sunday. */
function sundayKey(d: Date): string | null {
  const y = d.getFullYear();
  const { year, letter: L } = churchYear(d);
  const adv = advent1(y);
  if (d >= adv && d < noon(y, 11, 25)) return `${L}Adv${daysBetween(adv, d) / 7 + 1}`;
  if (d.getMonth() === 11 && d.getDate() >= 26) return "Christmas1";
  if (d.getMonth() === 0 && d.getDate() >= 2 && d.getDate() <= 5) return "Christmas2";
  const e = easter(year);
  const ash = addDays(e, -46);
  if (d.getMonth() === 0 && d.getDate() <= 6) return null; // the Holy Name or the Epiphany itself
  if (d < ash) {
    const jan6 = noon(year, 0, 6);
    const first = addDays(jan6, 7 - jan6.getDay());
    if (sameDay(d, addDays(ash, -3))) return `${L}EpiLast`;
    return `${L}Epi${daysBetween(first, d) / 7 + 1}`;
  }
  const fromEaster = daysBetween(e, d);
  if (fromEaster < -7) return `${L}Lent${(fromEaster + 42) / 7 + 1}`;
  if (fromEaster === -7) return `${L}PalmSun`;
  if (fromEaster === 0) return `${L}EasterPrin`;
  if (fromEaster > 0 && fromEaster < 49) return `${L}Easter${fromEaster / 7 + 1}`;
  if (fromEaster === 49) return `${L}PentDay`;
  if (fromEaster === 56) return `${L}Trinity`;
  // after Trinity Sunday: Proper 1 is the Sunday closest to 11 May, Proper 29 to 23 November
  const n = Math.floor(daysBetween(noon(d.getFullYear(), 4, 8), d) / 7) + 1;
  return n >= 1 && n <= 29 ? `${L}Prop${n}` : null;
}

/** What is appointed on a date: its Sunday, a feast that falls on it, or nothing. */
export function appointedOn(date: Date): Appointed[] {
  const d = noon(date.getFullYear(), date.getMonth(), date.getDate());
  const { letter } = churchYear(d);
  const out: Appointed[] = [];
  const push = (key: string | null, sunday: boolean) => {
    const day = key ? BY_KEY.get(key) : undefined;
    if (day && !out.some((o) => o.day.key === day.key)) out.push({ date: d, year: letter, day, sunday });
  };
  if (d.getDay() === 0) push(sundayKey(d), true);
  if (d.getMonth() === 11 && d.getDate() === 25) push("ChrsDay1", false);
  for (const [key, [m, day]] of Object.entries(FIXED)) if (d.getMonth() === m && d.getDate() === day) push(key, false);
  const fromEaster = daysBetween(easter(churchYear(d).year), d);
  const movable: Record<number, string> = { [-46]: "AshWed", [-3]: "MaundyTh", [-2]: "GoodFri", 39: `${letter}Ascension` };
  if (movable[fromEaster]) push(movable[fromEaster], false);
  // Thanksgiving Day (US): the fourth Thursday of November
  if (d.getMonth() === 10 && d.getDay() === 4 && d.getDate() >= 22 && d.getDate() <= 28) push("Thanks", false);
  return out;
}

/** The Sundays and feasts from `from` on, `count` of them. */
export function upcoming(from: Date, count: number): Appointed[] {
  const out: Appointed[] = [];
  let d = noon(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 400 && out.length < count; i++, d = addDays(d, 1)) out.push(...appointedOn(d));
  return out.slice(0, count);
}

/** A day's name for a list: "Proper 19: Sunday Closest to September 14" -> "Proper 19". */
export function dayName(day: LectionaryDay): string {
  const t = day.title.replace(/\s*:\s*/, ": ");
  return /^Proper \d+/.test(t) ? t.replace(/:.*$/, "") : t;
}

/** A citation as Gather takes it: the first part of "Galatians 3:23-25; 4:4-7", without the
 * optional verses in brackets ("Luke 2:1-14(15-20)"). */
export function gatherable(cite: string): string {
  return cite
    .replace(/^or\s+/, "")
    .split(";")[0]
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+or\s+.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
