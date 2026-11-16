// The daily notification and the home-screen widget. The reader chooses a time; each day the phone then says something different (the verse for the day, the Daily
// Scroll, "How are you today?", a memory verse that is due, a prayer to remember, today's reading in a plan). The page plans the next two weeks (notifyPlan.ts) and hands
// the plan to the phone (PhonePlugin.scheduleNotifications), which keeps it even when the app is closed and after a restart; the plan is made again each time the app is
// opened. The widget shows the verse for the day, from the same two weeks of verses. Works only on the phone.

import { cancel, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { api, phone } from "./api";
import { dayString } from "./memoryVerse";
import { planNotifications } from "./notifyPlan";
import { verseForToday } from "./votd";

/** the single repeating reminder the first versions scheduled with the notification plugin: taken away once */
const OLD_REMINDER_ID = 4101;

export const canRemind = /Android/i.test(navigator.userAgent);

/** "07:30" -> { hour: 7, minute: 30 }, or null. */
export function parseTime(time: string | null): { hour: number; minute: number } | null {
  const m = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Are notifications allowed? With `ask`, asks the reader if they have not been asked. */
async function allowed(ask: boolean): Promise<boolean> {
  let ok = await isPermissionGranted().catch(() => false);
  if (!ok && ask) ok = (await requestPermission().catch(() => "denied")) === "granted";
  return ok;
}

/** The verse for each of the next `days` days, with its words in the reader's Bible (the BSB when theirs lacks it). */
async function versesAhead(version: string, days: number): Promise<{ date: Date; ref: string; text: string }[]> {
  const out: { date: Date; ref: string; text: string }[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12);
    const v = verseForToday(date);
    const ref = `${v.book} ${v.chapter}:${v.verse}${v.verseEnd > v.verse ? `-${v.verseEnd}` : ""}`;
    let text = "";
    try {
      const end = v.verseEnd > v.verse ? v.verseEnd : null;
      text = (await api.passage(version, v.book, v.chapter, v.verse, end)).trim();
      if (!text && version !== "BSB") text = (await api.passage("BSB", v.book, v.chapter, v.verse, end)).trim();
    } catch {
      /* the notification then names the verse without its words */
    }
    out.push({ date, ref, text });
  }
  return out;
}

export interface DailyOptions {
  version: string;
  /** the time the reader chose ("07:30"), or null when notifications are off */
  reminder: string | null;
  /** the name of a reading plan being followed, or null */
  plan: string | null;
  /** ask for permission to show notifications if it has not been given (only when the reader has just chosen a time) */
  ask?: boolean;
}

/**
 * Makes the phone's plan again: the notifications (when a time is chosen) and the widget's verses. Resolves to false when the reader wants notifications but did not allow them.
 */
export async function refreshDaily(o: DailyOptions): Promise<boolean> {
  if (!canRemind) return false;
  await cancel([OLD_REMINDER_ID]).catch(() => undefined);
  const verses = await versesAhead(o.version, 14);
  await phone.setWidgetData(JSON.stringify(verses.map((v) => ({ day: dayString(v.date), ref: v.ref, text: v.text })))).catch(() => undefined);
  const at = parseTime(o.reminder);
  if (!at) {
    await phone.cancelNotifications().catch(() => undefined);
    return true;
  }
  if (!(await allowed(!!o.ask))) return false;
  const [memory, prayers] = await Promise.all([api.memoryVerses().catch(() => []), api.prayers().catch(() => [])]);
  const byDay = new Map(verses.map((v) => [dayString(v.date), v]));
  const plan = planNotifications({
    now: new Date(),
    hour: at.hour,
    minute: at.minute,
    verseFor: (d) => byDay.get(dayString(d)) ?? null,
    memory,
    prayers: prayers.filter((p) => !p.answered_at).map((p) => p.body),
    plan: o.plan,
  });
  await phone.scheduleNotifications(JSON.stringify(plan));
  return true;
}

/** A notification at once, to see how it looks and that they reach this phone. */
export async function testReminder(): Promise<boolean> {
  if (!canRemind) return false;
  if (!(await allowed(true))) return false;
  const v = verseForToday();
  const ref = `${v.book} ${v.chapter}:${v.verse}`;
  await phone.notifyNow(JSON.stringify({ id: 5900, title: "Verse for today", body: `This is how your daily notification will look. Today's verse is ${ref}.`, open: "scroll" }));
  return true;
}
