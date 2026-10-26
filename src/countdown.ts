// The countdown slide ("The service starts in 5:00"): what its words mean, when it reaches zero, and how it reads.
// Pure, so it can be tested under Node (scripts/test_countdown.mts).

/** What a countdown slide's words say: minutes to count ("5", "7.5", "1:30" for one minute thirty) or a time of day
 * ("at 10:30" or "10:30am"). null for anything else. */
export type Countdown = { seconds: number } | { clock: { h: number; m: number } };

export function parseCountdown(body: string): Countdown | null {
  const t = body.trim().toLowerCase();
  const at = /^(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?$/.exec(t);
  // "10:30am" or "at 10:30" is a time of day; a bare "1:30" is a length
  if (at && (t.startsWith("at ") || at[3])) {
    let h = Number(at[1]);
    if (at[3] === "pm" && h < 12) h += 12;
    if (at[3] === "am" && h === 12) h = 0;
    if (h > 23 || Number(at[2]) > 59) return null;
    return { clock: { h, m: Number(at[2]) } };
  }
  const length = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (length) return { seconds: Number(length[1]) * 60 + Number(length[2]) };
  const minutes = /^(\d{1,3}(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?$/.exec(t);
  if (minutes) return { seconds: Math.round(Number(minutes[1]) * 60) };
  return null;
}

/** The moment (ms since 1970) it reaches zero, counting from `now`; a time of day already past is today's, if it is
 * not yet, or else none (it is over). */
export function targetOf(body: string, now: number): number | null {
  const c = parseCountdown(body);
  if (!c) return null;
  if ("seconds" in c) return now + c.seconds * 1000;
  const d = new Date(now);
  d.setHours(c.clock.h, c.clock.m, 0, 0);
  return d.getTime();
}

const two = (n: number) => String(n).padStart(2, "0");

/** Time left as "4:59", or "1:02:03" over an hour; never below 0:00. */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** What the slide shows before it is counting (in the list, in the editor): the length, or the time of day. */
export function startText(body: string): string {
  const c = parseCountdown(body);
  if (!c) return "0:00";
  if ("seconds" in c) return leftText(c.seconds * 1000);
  return `${c.clock.h}:${two(c.clock.m)}`;
}
