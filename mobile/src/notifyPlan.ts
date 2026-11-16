// The daily notifications, planned two weeks ahead so each day says something different (the verse for the day, the Daily Scroll, "How are you today?", a memory
// verse that is due, a prayer to remember). The phone keeps them (PhonePlugin.scheduleNotifications) and the app plans the next two weeks again every time it is
// opened. Pure, so Node tests it (scripts/test_notify_plan.mts).

import { dayNumber } from "./dailyScroll.ts";
import { dueVerses, refOf, dayString, type Learning } from "./memoryVerse.ts";

export type OpenTarget = "scroll" | "memory" | "prayer" | "mood";

export interface Planned {
  /** milliseconds since 1970 */
  at: number;
  id: number;
  title: string;
  body: string;
  open: OpenTarget;
}

export interface PlanInput {
  now: Date;
  /** the time of day the reader chose */
  hour: number;
  minute: number;
  /** how many days ahead (the first is today, if its time has not passed) */
  days?: number;
  /** the verse for a date: its reference and (when it is known) its words */
  verseFor: (date: Date) => { ref: string; text: string } | null;
  memory: Learning[];
  /** the prayers still being prayed for, in the order to remember them */
  prayers: string[];
}

/** One kind of notification for each day of the week's turn; a kind with nothing to say that day is replaced by the Daily Scroll or "How are you today?". */
const RHYTHM = ["verse", "scroll", "mood", "verse", "memory", "prayer", "scroll"] as const;

const SCROLL_LINES = [
  "Twenty new cards today: a verse, a Bible story and more.",
  "Today's Daily Scroll is ready. Swipe up for a verse, a story and a Bible fact.",
  "Take a few quiet minutes with today's Daily Scroll.",
];
const MOOD_LINES = ["Tap to find a word from Scripture for how you feel.", "Tell us how you are today, and read a verse for it.", "A word for how you feel is one tap away."];

function cut(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "").replace(/[\s,;:.]+$/, "") + "…";
}

export function planNotifications(inp: PlanInput): Planned[] {
  const out: Planned[] = [];
  const days = inp.days ?? 14;
  const start = new Date(inp.now.getFullYear(), inp.now.getMonth(), inp.now.getDate());
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, inp.hour, inp.minute, 0, 0);
    if (date.getTime() <= inp.now.getTime() + 30_000) continue; // today's time has passed
    const n = dayNumber(date);
    let kind: (typeof RHYTHM)[number] = RHYTHM[((n % 7) + 7) % 7];
    const dayStr = dayString(date);
    const due = dueVerses(inp.memory, dayStr);
    if (kind === "memory" && due.length === 0) kind = "scroll";
    if (kind === "prayer" && inp.prayers.length === 0) kind = "mood";
    const verse = inp.verseFor(date);
    if (kind === "verse" && !verse) kind = "scroll";
    const id = 5000 + i;
    if (kind === "verse" && verse) {
      out.push({ at: date.getTime(), id, title: "Verse for today", body: verse.text ? `“${cut(verse.text, 150)}” — ${verse.ref}` : `Today's verse is ${verse.ref}. Tap to read it.`, open: "scroll" });
    } else if (kind === "memory") {
      const more = due.length - 1;
      const body = more > 0 ? `${refOf(due[0])} and ${more} more ${more === 1 ? "verse" : "verses"} are ready to practise.` : `${refOf(due[0])} is ready to practise.`;
      out.push({ at: date.getTime(), id, title: "Time to practise", body, open: "memory" });
    } else if (kind === "prayer") {
      const p = inp.prayers[((n % inp.prayers.length) + inp.prayers.length) % inp.prayers.length];
      out.push({ at: date.getTime(), id, title: "A moment to pray", body: `You are praying about: “${cut(p, 110)}”`, open: "prayer" });
    } else if (kind === "mood") {
      out.push({ at: date.getTime(), id, title: "How are you today?", body: MOOD_LINES[((n % MOOD_LINES.length) + MOOD_LINES.length) % MOOD_LINES.length], open: "mood" });
    } else {
      out.push({ at: date.getTime(), id, title: "Daily Scroll", body: SCROLL_LINES[((n % SCROLL_LINES.length) + SCROLL_LINES.length) % SCROLL_LINES.length], open: "scroll" });
    }
  }
  return out;
}
