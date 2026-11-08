// The reader's choices about the look of the opening screen, and the season logic.
// Per-viewer conveniences, kept in localStorage (wrapped: storage can be unavailable) and shared through a tiny store, so the
// opening screen and Settings always agree without passing props through App.
//
// The rules (owner, 2026-11-07 and 2026-11-08):
//  * Near an occasion's season the app switches to its theme and asks once: keep it, or go back to the default theme.
//    "Keep" holds the theme until the season's window ends; "go back" is remembered for that occurrence and not asked again.
//    A selection made by hand (a theme, or a wordmark or background on its own) is never switched.
//  * "Keep my selection as the default and never change it" stops all switching: whatever is selected stays (it replaces Quiet mode).
//  * The wordmark and the background can be picked separately (mix and match), each from any theme or plain.
//  * The Bible reading font is never touched.

import { useSyncExternalStore } from "react";
import { lookBySlug, lookForCalendar, type Look } from "./occasions";
import { handChosen, mayAutoSwitch, resolveChoice } from "./themeChoice";
import { APP_VAR_NAMES, appVars, isHexColour, STANDARD } from "./palette";
import { occasionOn, occurrenceKey, todayNumber } from "./themeCalendar";

export interface Season {
  /** the occurrence ("communion:2026-12-06") */
  key: string;
  slug: string;
  start: number;
  end: number;
  /** "pending": switched and waiting for the reader's answer; "keep": kept until the window ends */
  answer: "pending" | "keep";
}

export interface ThemeState {
  /** the theme the reader chose by hand ("default": none) */
  chosen: string;
  season: Season | null;
  /** occurrences the reader sent back to the default theme */
  declined: string[];
  /** switch to a seasonal theme near its season (and ask) */
  seasonal: boolean;
  /** keep this selection as the default and never change it (no seasonal switching) */
  keep: boolean;
  /** where the wordmark comes from: "theme" (the chosen theme), "none" (the plain letters) or a theme's slug */
  wordmarkFrom: string;
  /** where the background comes from: "theme", "none" (plain) or a theme's slug */
  backgroundFrom: string;
  /** the theme's background behind the Bible text: "off", "soft" (mostly the reader's paper, a hint of the theme) or "full" */
  reading: "off" | "soft" | "full";
  /** a colour of the reader's own for the whole app ("standard": the app's own colours, otherwise #rrggbb; always softened to a pastel) */
  appColour: string;
}

const KEY = "theme:state";
const DEFAULTS: ThemeState = { chosen: "default", season: null, declined: [], seasonal: true, keep: false, wordmarkFrom: "theme", backgroundFrom: "theme", reading: "off", appColour: STANDARD };

function load(): ThemeState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ThemeState> & { quiet?: boolean; wordmark?: boolean; screen?: boolean };
      const s = p.season;
      const text = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);
      // older versions: Quiet mode meant a plain wordmark, a plain background and no switching, which is "keep" with everything plain;
      // "show the wordmark" and "show the decorations" switched the two parts off, which is "none" for each
      const quiet = p.quiet === true;
      return {
        chosen: quiet ? "default" : text(p.chosen, "default"),
        season:
          !quiet && s && typeof s.key === "string" && typeof s.slug === "string" && typeof s.start === "number" && typeof s.end === "number"
            ? { key: s.key, slug: s.slug, start: s.start, end: s.end, answer: s.answer === "keep" ? "keep" : "pending" }
            : null,
        declined: Array.isArray(p.declined) ? p.declined.filter((x) => typeof x === "string").slice(-60) : [],
        seasonal: p.seasonal !== false,
        keep: quiet || p.keep === true,
        wordmarkFrom: quiet || p.wordmark === false ? "none" : text(p.wordmarkFrom, "theme"),
        backgroundFrom: quiet || p.screen === false ? "none" : text(p.backgroundFrom, "theme"),
        reading: p.reading === "soft" || p.reading === "full" ? p.reading : "off",
        appColour: isHexColour(p.appColour) ? p.appColour : STANDARD,
      };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULTS };
}

let state: ThemeState = load();
const listeners = new Set<() => void>();

/** Puts the reader's colour on the whole app: the page, the raised panels, the bars and the borders of every window take a pale tint of it. */
function applyAppColour(value: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!isHexColour(value)) {
    root.removeAttribute("data-app-colour");
    for (const k of APP_VAR_NAMES) root.style.removeProperty(k);
    return;
  }
  root.setAttribute("data-app-colour", "on");
  for (const [k, v] of Object.entries(appVars(value))) root.style.setProperty(k, v);
}

function commit(next: ThemeState) {
  const colourChanged = next.appColour !== state.appColour;
  state = next;
  if (colourChanged) applyAppColour(state.appColour);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* a per-viewer convenience only */
  }
  listeners.forEach((l) => l());
}

export function getThemeState(): ThemeState {
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Looks at today's date: starts a season (and asks), or ends one whose window has passed. Safe to call as often as you like. */
export function refreshSeason(now: Date = new Date()) {
  const today = todayNumber(now);
  let season = state.season;
  if (season && (today < season.start || today > season.end)) season = null;
  if (season && !mayAutoSwitch(state, state.seasonal)) season = null;
  if (!season && mayAutoSwitch(state, state.seasonal)) {
    const w = occasionOn(today);
    const look = w ? lookForCalendar(w.id) : null;
    if (w && look) {
      const key = occurrenceKey(w);
      if (!state.declined.includes(key)) season = { key, slug: look.slug, start: w.start, end: w.end, answer: "pending" };
    }
  }
  if (season !== state.season) commit({ ...state, season });
}

/** Picking a theme sets its wordmark and its background together (any mixing is cleared). */
export function setChosen(slug: string) {
  commit({ ...state, chosen: lookBySlug(slug) ? slug : "default", wordmarkFrom: "theme", backgroundFrom: "theme", season: null });
}

/** The wordmark from one theme ("theme": the chosen theme's, "none": the plain letters, or a theme's slug). */
export function setWordmarkFrom(source: string) {
  commit({ ...state, wordmarkFrom: source === "theme" || source === "none" || lookBySlug(source) ? source : "theme", season: null });
}

/** The background from one theme ("theme": the chosen theme's, "none": plain, or a theme's slug). */
export function setBackgroundFrom(source: string) {
  commit({ ...state, backgroundFrom: source === "theme" || source === "none" || lookBySlug(source) ? source : "theme", season: null });
}

/** The colour of the whole app: "standard", or a colour (it is softened to a pastel). */
export function setAppColour(value: string) {
  commit({ ...state, appColour: isHexColour(value) ? value : STANDARD });
}

/** Whether the theme's background also shows behind the Bible text, and how strongly. */
export function setReadingBackground(value: "off" | "soft" | "full") {
  commit({ ...state, reading: value });
}

export function setFlag(name: "seasonal" | "keep", value: boolean) {
  const next = { ...state, [name]: value } as ThemeState;
  if (name === "keep" && value) next.season = null;
  if (name === "seasonal" && !value) next.season = null;
  commit(next);
  if ((name === "seasonal" && value) || (name === "keep" && !value)) refreshSeason();
}

/** "Keep it": the seasonal theme stays until the season's window ends. */
export function keepSeason() {
  if (state.season) commit({ ...state, season: { ...state.season, answer: "keep" } });
}

/** "Go back to the default theme": remembered for this occurrence, so the app does not ask again. */
export function declineSeason() {
  if (state.season) commit({ ...state, season: null, declined: [...state.declined, state.season.key].slice(-60) });
}

export interface EffectiveLook {
  /** the theme itself (picked, or the season's) */
  look: Look | null;
  /** the theme whose wordmark shows, and the wordmark picture (inline SVG), if any */
  wordmarkLook: Look | null;
  art: string | null;
  /** the theme whose background shows (decorations, colours, verse of the season) */
  screenLook: Look | null;
  /** the background's decorations are on */
  screenOn: boolean;
  /** the default theme's slight glow */
  defaultGlow: boolean;
  /** the wordmark and the background are not both the theme's own */
  mixed: boolean;
  /** the theme came from the calendar and the reader has not answered yet */
  pending: boolean;
}

/** What the opening screen shows right now. */
export function effectiveLook(s: ThemeState): EffectiveLook {
  const fromSeason = !s.keep && !handChosen(s) && s.season && lookBySlug(s.season.slug) ? s.season : null;
  const r = resolveChoice(s, fromSeason ? fromSeason.slug : null, (slug) => !!lookBySlug(slug));
  const wordmarkLook = lookBySlug(r.wordmark);
  const screenLook = lookBySlug(r.background);
  return {
    look: lookBySlug(r.base),
    wordmarkLook,
    art: wordmarkLook ? wordmarkLook.svg : null,
    screenLook,
    screenOn: !!screenLook,
    defaultGlow: r.defaultGlow,
    mixed: r.mixed,
    pending: !!fromSeason && fromSeason.answer === "pending",
  };
}

export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribe, getThemeState, getThemeState);
}

// the reader's colour is on from the first moment (before anything is drawn)
applyAppColour(state.appColour);

// check the date as the app starts, and again at midnight-ish while it stays open
refreshSeason();
if (typeof window !== "undefined") window.setInterval(() => refreshSeason(), 30 * 60 * 1000);
