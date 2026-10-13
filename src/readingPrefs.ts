// Reading comfort and appearance: text size, line spacing and reading width for the chapter
// view, plus the theme, text colour and contrast for the whole app.
// Per-viewer conveniences, so localStorage (wrapped -- storage can be unavailable), applied
// as CSS custom properties on the document root that App.css's reading styles read.

export interface ReadingPrefs {
  /** Multiplier on the base reading size: 0.85 .. 1.6 */
  fontScale: number;
  /** Line height: 1.5 .. 2.2 */
  lineHeight: number;
  /** "normal" keeps a comfortable measure; "wide" uses the full pane. */
  width: "normal" | "wide";
  /** Words of Jesus in red (applied by CSS, so turning it off costs nothing). */
  redLetter: boolean;
  /** "system" follows Windows' light/dark setting. */
  theme: Theme;
  /** Colour of the text and headings; each choice has a light and a dark version. */
  textColor: TextColor;
  /** "high" darkens (or, in dark mode, lightens) the greys used for labels and headings. */
  contrast: "standard" | "high";
}

export type Theme = "system" | "light" | "dark";
export type TextColor = "default" | "strong" | "sepia" | "blue";
const TEXT_COLORS: TextColor[] = ["default", "strong", "sepia", "blue"];

const KEY = "reading:prefs";
export const DEFAULT_PREFS: ReadingPrefs = {
  fontScale: 1,
  lineHeight: 1.75,
  width: "normal",
  redLetter: true,
  theme: "system",
  textColor: "default",
  contrast: "standard",
};

export function loadPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReadingPrefs>;
      return {
        fontScale: clamp(Number(p.fontScale) || DEFAULT_PREFS.fontScale, 0.85, 1.6),
        lineHeight: clamp(Number(p.lineHeight) || DEFAULT_PREFS.lineHeight, 1.5, 2.2),
        width: p.width === "wide" ? "wide" : "normal",
        redLetter: p.redLetter !== false,
        theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
        textColor: TEXT_COLORS.includes(p.textColor as TextColor) ? (p.textColor as TextColor) : "default",
        contrast: p.contrast === "high" ? "high" : "standard",
      };
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_PREFS;
}

export function savePrefs(p: ReadingPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* per-viewer convenience only */
  }
}

export function applyPrefs(p: ReadingPrefs) {
  const root = document.documentElement;
  root.style.setProperty("--reader-scale", String(p.fontScale));
  root.style.setProperty("--reader-line-height", String(p.lineHeight));
  root.dataset.readingWidth = p.width;
  root.dataset.redLetter = p.redLetter ? "on" : "off";
  root.dataset.theme = resolveTheme(p.theme);
  root.dataset.text = p.textColor;
  root.dataset.contrast = p.contrast;
}

const systemDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** The theme actually shown: "system" becomes Windows' current setting. */
export function resolveTheme(t: Theme): "light" | "dark" {
  return t === "system" ? (systemDark() ? "dark" : "light") : t;
}

/** Calls `onChange` when Windows switches between light and dark; returns the unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
