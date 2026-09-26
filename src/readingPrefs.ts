// Reading comfort: text size, line spacing and reading width for the chapter view.
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
}

const KEY = "reading:prefs";
export const DEFAULT_PREFS: ReadingPrefs = { fontScale: 1, lineHeight: 1.75, width: "normal", redLetter: true };

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
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
