// Which occasion suits a date. General default dates (not country-specific), the owner's list (2026-11-07):
// the reader can switch seasonal themes off, or choose any theme by hand, so these are only suggestions.
// Pure functions on plain numbers (no DOM, no storage), so they can be tested exactly: scripts/test_theme_calendar.mts.

export type OccasionId =
  | "advent" | "christmas" | "newyear" | "epiphany" | "lent" | "palmsunday" | "goodfriday" | "easter" | "ascension"
  | "pentecost" | "trinity" | "passover" | "communion" | "harvest" | "reformation" | "biblesunday" | "mothersday"
  | "fathersday" | "childrensday";

export interface OccasionWindow {
  id: OccasionId;
  /** first and last day of the window (inclusive), as day numbers (days since 1970-01-01) */
  start: number;
  end: number;
}

/** Day number of a calendar date (month 1 to 12). Works in UTC, so daylight saving never shifts a day. */
export function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Calendar date of a day number. */
export function dateOf(n: number): { y: number; m: number; d: number } {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** "2026-04-05" for a day number (also the stable key of one occurrence of an occasion). */
export function isoOf(n: number): string {
  const { y, m, d } = dateOf(n);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 0 = Sunday .. 6 = Saturday */
export function weekdayOf(n: number): number {
  return (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

/** Easter Sunday of the Western (Gregorian) church, by the anonymous Gregorian algorithm. */
export function easterOf(y: number): number {
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
  return dayNumber(y, month, day);
}

/** The nth (1..) given weekday (0 = Sunday) of a month. */
export function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = dayNumber(y, m, 1);
  const offset = (weekday - weekdayOf(first) + 7) % 7;
  return first + offset + (n - 1) * 7;
}

/** The last given weekday of a month. */
export function lastWeekday(y: number, m: number, weekday: number): number {
  const nextMonth = m === 12 ? dayNumber(y + 1, 1, 1) : dayNumber(y, m + 1, 1);
  const lastDay = nextMonth - 1;
  return lastDay - ((weekdayOf(lastDay) - weekday + 7) % 7);
}

/** First Sunday of Advent: the Sunday nearest 30 November. */
export function adventOf(y: number): number {
  const nov30 = dayNumber(y, 11, 30);
  const w = weekdayOf(nov30);
  return w <= 3 ? nov30 - w : nov30 + (7 - w);
}

/** 15 Nisan (the first day of Passover) in the Gregorian year, from the Hebrew calendar the browser knows; null if it cannot be found. */
export function passoverOf(y: number): number | null {
  try {
    const f = new Intl.DateTimeFormat("en-u-ca-hebrew-nu-latn", { timeZone: "UTC", month: "long", day: "numeric" });
    for (let n = dayNumber(y, 3, 10); n <= dayNumber(y, 5, 10); n++) {
      const parts = f.formatToParts(new Date(n * 86400000 + 43200000));
      const month = parts.find((p) => p.type === "month")?.value;
      const day = parts.find((p) => p.type === "day")?.value;
      if (month === "Nisan" && day === "15") return n;
    }
  } catch {
    /* an engine without the Hebrew calendar: Passover simply has no suggestion */
  }
  return null;
}

/** The three main themes (the owner, 2026-11-08): Resurrection Sunday, Passover and Christmas hold steady. Nothing else ever shows during one
 * of them, and a theme never swaps back and forth: when two of them overlap (Passover and Resurrection Sunday in 2026) the one that starts
 * later takes over from its first day and the earlier one is not shown again. Each starts a day early, and Resurrection Sunday lasts a
 * little longer. The order here settles a tie. */
const MAIN: OccasionId[] = ["easter", "passover", "christmas"];

/** Strength when the other windows overlap: a lower number wins, the shorter window wins between equals. The main themes are handled
 * first (see MAIN); then the holy days; then Ascension and Mother's Day (Mother's Day wins on the Sunday after Ascension, as in 2027);
 * then the rest; the long seasons (Advent, Lent) last. The monthly Communion is the quiet one: it shows on a first Sunday only when
 * nothing else is on, so that a season is never interrupted for one day and then resumed. */
const RANK: Record<OccasionId, number> = {
  passover: 0, easter: 0, christmas: 0,
  goodfriday: 1, palmsunday: 1, pentecost: 1, trinity: 1, newyear: 1,
  ascension: 2, mothersday: 2,
  epiphany: 4, reformation: 4, biblesunday: 4, fathersday: 4, childrensday: 4, harvest: 4,
  advent: 5, lent: 5,
  communion: 6,
};

/** Every window that starts in the given year (Communion has twelve, Passover none if the Hebrew calendar is missing). */
export function windowsOf(y: number): OccasionWindow[] {
  const out: OccasionWindow[] = [];
  const add = (id: OccasionId, start: number, end: number = start) => out.push({ id, start, end });
  const easter = easterOf(y);
  add("advent", adventOf(y), dayNumber(y, 12, 23));
  add("christmas", dayNumber(y, 12, 15), dayNumber(y, 12, 30)); // a day early (the owner, 2026-11-08); New Year follows on 31 December
  add("newyear", dayNumber(y, 12, 31), dayNumber(y + 1, 1, 2));
  add("epiphany", dayNumber(y, 1, 3), dayNumber(y, 1, 8));
  add("lent", easter - 46, easter - 8); // Ash Wednesday to the Saturday before Palm Sunday
  add("palmsunday", easter - 7, easter - 4); // Palm Sunday to the Wednesday
  add("goodfriday", easter - 3, easter - 1); // Thursday to Holy Saturday
  add("easter", easter - 1, easter + 9); // from Holy Saturday, and a little longer after Resurrection Sunday (the owner, 2026-11-08)
  add("ascension", easter + 39, easter + 42); // Ascension Day (a Thursday) to the Sunday after
  add("pentecost", easter + 49, easter + 55);
  add("trinity", easter + 56);
  const passover = passoverOf(y);
  if (passover !== null) add("passover", passover - 1, passover + 7); // from the day before the feast
  for (let m = 1; m <= 12; m++) add("communion", nthWeekday(y, m, 0, 1)); // every first Sunday of the month
  add("harvest", nthWeekday(y, 11, 4, 4) - 4, nthWeekday(y, 11, 4, 4)); // the Sunday before the fourth Thursday of November, to that Thursday
  add("reformation", dayNumber(y, 10, 31));
  add("biblesunday", lastWeekday(y, 10, 0));
  add("mothersday", nthWeekday(y, 5, 0, 2));
  add("fathersday", nthWeekday(y, 6, 0, 3));
  add("childrensday", dayNumber(y, 6, 1));
  return out;
}

/** The occasion that suits a day, or null. Windows that began last year (New Year) are included. */
export function occasionOn(n: number): OccasionWindow | null {
  const y = dateOf(n).y;
  const hits = [...windowsOf(y - 1), ...windowsOf(y)].filter((w) => w.start <= n && n <= w.end);
  if (hits.length === 0) return null;
  const main = hits.filter((w) => MAIN.includes(w.id));
  if (main.length > 0) {
    // Resurrection Sunday itself always shows its own theme, even if Passover starts that day
    const sunday = main.find((w) => w.id === "easter" && w.start + 1 === n); // the window starts on the Saturday
    if (sunday) return sunday;
    // otherwise the one that started last holds: no theme comes back after another has taken over
    main.sort((a, b) => b.start - a.start || MAIN.indexOf(a.id) - MAIN.indexOf(b.id));
    return main[0];
  }
  hits.sort((a, b) => RANK[a.id] - RANK[b.id] || a.end - a.start - (b.end - b.start));
  return hits[0];
}

/** Key of one occurrence of an occasion ("communion:2026-12-06"): the answer to "keep it?" is remembered per occurrence. */
export function occurrenceKey(w: OccasionWindow): string {
  return `${w.id}:${isoOf(w.start)}`;
}

/** Today as a day number, from the local calendar date. */
export function todayNumber(now: Date = new Date()): number {
  return dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
