// When the phone makes its automatic backup copies, and the words about them. Pure, so Node tests it (scripts/test_backup_plan.mts).
// A copy is made only when something worth keeping changed (a highlight, bookmark or note, or a preference), never on a timer alone: after a short quiet
// while, or at once when the app goes to the background. One file for each day, so the newest three copies are the last three days with changes.

/** how long after the last change the copy is made while the app stays open (ms) */
export const QUIET_MS = 2 * 60 * 1000;

/** "Bible Concordance backup 2026-11-14.json" */
export const backupFileName = (day: string) => `Bible Concordance backup ${day}.json`;

export interface Facts {
  /** something changed since the last copy */
  dirty: boolean;
  /** when it last changed (ms), 0 if never */
  changedAt: number;
  now: number;
  /** the app is going to the background */
  leaving: boolean;
}

/** Is it time to make the copy? */
export function timeForCopy(f: Facts): boolean {
  if (!f.dirty) return false;
  return f.leaving || f.now - f.changedAt >= QUIET_MS;
}

/** A small checksum of the preferences text, to notice a change in them without keeping a second copy. */
export function hashOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** "today at 14:02", "yesterday at 09:30", "12 Nov at 09:30", or "never" */
export function lastText(ms: number, now: Date): string {
  if (!ms) return "never";
  const d = new Date(ms);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `today at ${clock}`;
  if (diff === 1) return `yesterday at ${clock}`;
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} at ${clock}`;
}

/** Nothing worth a copy yet: no notes, highlights, bookmarks or plans, and no added Bible. */
export function isEmpty(c: { bookmarks: number; highlights: number; notes: number; plans: number }, bible: string | null): boolean {
  return c.bookmarks + c.highlights + c.notes + c.plans === 0 && !bible;
}
