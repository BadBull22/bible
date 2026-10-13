// The daily reading reminder: one notification a day at the time the reader chose, kept by
// Android (the notification plugin) even when the app isn't open. Scheduling works only on
// the phone; on a computer (where the app is only tried out) it is not offered.

import { cancel, isPermissionGranted, requestPermission, Schedule, sendNotification } from "@tauri-apps/plugin-notification";

const REMINDER_ID = 4101;

export const canRemind = /Android/i.test(navigator.userAgent);

/** "07:30" -> { hour: 7, minute: 30 }, or null. */
export function parseTime(time: string | null): { hour: number; minute: number } | null {
  const m = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Schedules the daily reminder at `time` ("HH:MM"), or (null) turns it off. Resolves to
 * false if the reader didn't allow notifications. */
export async function setReminder(time: string | null, body: string): Promise<boolean> {
  if (!canRemind) return false;
  await cancel([REMINDER_ID]).catch(() => undefined);
  const at = parseTime(time);
  if (!at) return true;
  let allowed = await isPermissionGranted();
  if (!allowed) allowed = (await requestPermission()) === "granted";
  if (!allowed) return false;
  sendNotification({ id: REMINDER_ID, title: "Bible Concordance", body, schedule: Schedule.interval({ hour: at.hour, minute: at.minute }, true) });
  return true;
}
