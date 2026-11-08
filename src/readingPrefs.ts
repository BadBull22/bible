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
  /** The font of the app's interface ("default" keeps the standard one). Chosen by hand; no theme changes it. */
  uiFont: string;
  /** The font of the Bible text and other reading text ("default" keeps the standard one). Chosen by hand; no theme or look ever changes it. */
  readingFont: string;
}

export interface FontChoice {
  key: string;
  label: string;
  /** the CSS font stack (null: the app's standard font) */
  stack: string | null;
}

/** Fonts that come with Windows (and most systems): a short list rather than every installed font. */
export const UI_FONTS: FontChoice[] = [
  { key: "default", label: "Standard", stack: null },
  { key: "segoe", label: "Segoe UI", stack: '"Segoe UI", system-ui, sans-serif' },
  { key: "calibri", label: "Calibri", stack: 'Calibri, "Segoe UI", sans-serif' },
  { key: "verdana", label: "Verdana (wide, easy to read)", stack: 'Verdana, "Segoe UI", sans-serif' },
  { key: "tahoma", label: "Tahoma", stack: 'Tahoma, "Segoe UI", sans-serif' },
  { key: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
];
export const READING_FONTS: FontChoice[] = [
  { key: "default", label: "Standard (Iowan Old Style / Palatino)", stack: null },
  { key: "georgia", label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  { key: "cambria", label: "Cambria", stack: "Cambria, Georgia, serif" },
  { key: "palatino", label: "Palatino", stack: '"Palatino Linotype", Palatino, Georgia, serif' },
  { key: "times", label: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { key: "constantia", label: "Constantia", stack: "Constantia, Georgia, serif" },
  { key: "segoe", label: "Segoe UI (sans-serif)", stack: '"Segoe UI", system-ui, sans-serif' },
  { key: "calibri", label: "Calibri (sans-serif)", stack: 'Calibri, "Segoe UI", sans-serif' },
  { key: "verdana", label: "Verdana (sans-serif, wide, easy to read)", stack: 'Verdana, "Segoe UI", sans-serif' },
];
const fontKey = (list: FontChoice[], v: unknown) => (typeof v === "string" && list.some((f) => f.key === v) ? v : "default");

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
  uiFont: "default",
  readingFont: "default",
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
        uiFont: fontKey(UI_FONTS, p.uiFont),
        readingFont: fontKey(READING_FONTS, p.readingFont),
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
  // the fonts are the reader's own choice: "default" removes the override and the standard fonts return
  const ui = UI_FONTS.find((f) => f.key === p.uiFont)?.stack;
  const reading = READING_FONTS.find((f) => f.key === p.readingFont)?.stack;
  if (ui) root.style.setProperty("--sans", ui);
  else root.style.removeProperty("--sans");
  if (reading) root.style.setProperty("--serif", reading);
  else root.style.removeProperty("--serif");
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
