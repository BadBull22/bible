// How the app looks: the theme (with a sepia page as well as light and dark), the text
// colour, the contrast of the greys, and the font -- the same choices as the desktop app's
// Settings → Appearance. Applied as attributes on <html> that styles.css reads; "system" is
// resolved here to light or dark, and followed when the phone switches.

export type Theme = "system" | "light" | "dark" | "sepia";
export type TextColor = "default" | "strong" | "sepia" | "blue";
export type Contrast = "standard" | "high";
export type Font = "serif" | "sans";

export interface Appearance {
  theme: Theme;
  textColor: TextColor;
  contrast: Contrast;
  font: Font;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", textColor: "default", contrast: "standard", font: "serif" };

const dark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function resolvedTheme(t: Theme): "light" | "dark" | "sepia" {
  return t === "system" ? (dark() ? "dark" : "light") : t;
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(a.theme);
  root.dataset.text = a.textColor;
  root.dataset.contrast = a.contrast;
  root.dataset.font = a.font;
}

/** Calls `onChange` when the phone switches between light and dark; returns the unsubscribe. */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
