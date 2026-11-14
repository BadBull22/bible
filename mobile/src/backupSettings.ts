// The phone's preferences inside a backup file: which ones travel, and how they are checked on the way back. The file is the same as the computer's study
// backup with a `settings` part (the computer ignores it). Only a fixed list of preferences travels (the look, the text, the Bible read, the reminder...): never
// where the reader is in the Bible, what the page happens to remember, or anything a file could use to change how the app works. Pure, so Node tests it
// (scripts/test_backup_settings.mts); the page reads and writes the browser's storage around it.

export const STATE_KEY = "pocket:state";
export const THEME_KEY = "theme:state";

/** the storage the settings live in, as plain text (what localStorage gives) */
export interface RawSettings {
  state: string | null;
  theme: string | null;
}

/** what goes into the file */
export interface BackupSettings {
  state?: Record<string, unknown>;
  theme?: Record<string, unknown>;
}

type Any = Record<string, unknown>;
const isObj = (x: unknown): x is Any => typeof x === "object" && x !== null && !Array.isArray(x);
const parse = (t: string | null): Any | null => {
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
};

const THEMES = ["system", "light", "dark", "sepia"];
const TEXT_COLORS = ["default", "strong", "sepia", "blue"];
const CONTRASTS = ["standard", "high"];
const FONTS = ["serif", "sans"];
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const hex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** The preferences of `pocket:state` that travel, each only when it is a value the app understands. */
export function checkState(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(v)) return out;
  if (text(v.version, 40)) out.version = v.version;
  if (v.second === null || text(v.second, 40)) out.second = v.second ?? null;
  if (num(v.size, 0.7, 2.6)) out.size = v.size;
  if (THEMES.includes(v.theme as string)) out.theme = v.theme;
  if (TEXT_COLORS.includes(v.textColor as string)) out.textColor = v.textColor;
  if (CONTRASTS.includes(v.contrast as string)) out.contrast = v.contrast;
  if (FONTS.includes(v.font as string)) out.font = v.font;
  if (num(v.rate, 0.4, 2.5)) out.rate = v.rate;
  if (v.voice === null || text(v.voice, 200)) out.voice = v.voice ?? null;
  if (v.reminder === null || (typeof v.reminder === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.reminder))) out.reminder = v.reminder ?? null;
  if (typeof v.updates === "boolean") out.updates = v.updates;
  return out;
}

const READING = ["off", "soft", "full"];

/** The theme choices that travel (not the season's own bookkeeping: which seasons were answered or declined). */
export function checkTheme(v: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObj(v)) return out;
  if (text(v.chosen, 60)) out.chosen = v.chosen;
  if (typeof v.seasonal === "boolean") out.seasonal = v.seasonal;
  if (typeof v.keep === "boolean") out.keep = v.keep;
  if (text(v.wordmarkFrom, 60)) out.wordmarkFrom = v.wordmarkFrom;
  if (text(v.backgroundFrom, 60)) out.backgroundFrom = v.backgroundFrom;
  if (READING.includes(v.reading as string)) out.reading = v.reading;
  if (v.appColour === "standard" || hex(v.appColour)) out.appColour = v.appColour;
  return out;
}

/** What to put in a backup, from the phone's storage (nothing when there is nothing to keep). */
export function collectSettings(raw: RawSettings): BackupSettings | null {
  const state = checkState(parse(raw.state));
  const theme = checkTheme(parse(raw.theme));
  const out: BackupSettings = {};
  if (Object.keys(state).length) out.state = state;
  if (Object.keys(theme).length) out.theme = theme;
  return Object.keys(out).length ? out : null;
}

/** The storage after a restore: the file's preferences checked and laid over what is there (the place in the Bible and everything else stay as they are). */
export function mergeSettings(raw: RawSettings, file: unknown): { state: string | null; theme: string | null; applied: string[] } {
  const applied: string[] = [];
  const f = isObj(file) ? file : {};
  const theirState = checkState(f.state);
  const theirTheme = checkTheme(f.theme);
  let state = raw.state;
  let theme = raw.theme;
  if (Object.keys(theirState).length) {
    state = JSON.stringify({ ...(parse(raw.state) ?? {}), ...theirState });
    applied.push("settings");
  }
  if (Object.keys(theirTheme).length) {
    theme = JSON.stringify({ ...(parse(raw.theme) ?? {}), ...theirTheme });
    if (!applied.includes("settings")) applied.push("settings");
  }
  return { state, theme, applied };
}
