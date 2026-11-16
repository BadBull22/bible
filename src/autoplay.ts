// Slides that move on by themselves (the notices before the service): how long each stays, whether the show starts over at the end,
// and how long the fade between slides lasts. Kept with a saved deck (an older deck has none of it, and loads as "off").
// Pure, so it can be tested under Node (scripts/test_autoplay.mts).

export interface AutoPlay {
  /** seconds each slide stays before the next comes; 0 = the slides wait for a click */
  seconds: number;
  /** at the last slide, go back to the first (otherwise it stops there) */
  loop: boolean;
  /** seconds the fade between two slides lasts; 0 = a cut */
  fade: number;
}

export const NO_AUTO: AutoPlay = { seconds: 0, loop: false, fade: 0.3 };

/** The fades offered: a cut, a short fade (what the screen always did), a slow one. */
export const FADES: { value: number; label: string }[] = [
  { value: 0, label: "None (a cut)" },
  { value: 0.3, label: "Short" },
  { value: 0.8, label: "Slow" },
];

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Whatever was saved (nothing, a half-written object, nonsense) as a usable setting. */
export function parseAuto(raw: unknown): AutoPlay {
  if (!raw || typeof raw !== "object") return { ...NO_AUTO };
  const r = raw as Record<string, unknown>;
  return { seconds: Math.round(num(r.seconds, 0, 3600, 0)), loop: r.loop === true, fade: num(r.fade, 0, 3, NO_AUTO.fade) };
}

/** Is there anything worth saving (so that a deck without timing stays as it was)? */
export const hasAuto = (a: AutoPlay): boolean => a.seconds > 0 || a.loop || a.fade !== NO_AUTO.fade;

/** What goes into a saved deck: nothing when the timing is as it always was (so an old deck is saved as it was), else the setting. */
export const autoForDeck = (a: AutoPlay | null | undefined): { auto?: AutoPlay } => (a && hasAuto(a) ? { auto: a } : {});

/** A slide's own wait ("after", in seconds) or else the show's; 0 = it waits for a click. A video, music or countdown slide
 * waits for a click unless it was given a time of its own. */
export function secondsFor(slide: { kind?: string; after?: number } | undefined, auto: AutoPlay): number {
  if (!slide) return 0;
  if (typeof slide.after === "number" && Number.isFinite(slide.after)) return Math.round(Math.min(3600, Math.max(0, slide.after)));
  if (slide.kind === "link" || slide.kind === "countdown") return 0;
  return auto.seconds;
}

/** Where the timer goes after slide `index` of `total`: the next one, the first (when it loops) or nowhere (null: it stops). */
export function nextAfterTimer(index: number, total: number, loop: boolean): number | null {
  if (total <= 0) return null;
  if (index + 1 < total) return index + 1;
  return loop && total > 1 ? 0 : null;
}

/** Seconds left before the timer moves on, given when the slide came up and what time it is now (never below 0; null when it waits). */
export function secondsLeft(slide: { kind?: string; after?: number } | undefined, auto: AutoPlay, shownAt: number, now: number): number | null {
  const s = secondsFor(slide, auto);
  if (s <= 0) return null;
  return Math.max(0, Math.ceil(s - (now - shownAt) / 1000));
}
