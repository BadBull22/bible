// The phone's theme backgrounds: every theme is two colours that run into each other (a gradient) behind every page, with the theme's own Gospel
// wordmark on the Search page. No pictures or decorations: the colours are meant to be seen at once, on every page.
//
// One pair for the light pages and one for the dark pages. The light pairs are kept pale enough that the app's text, grey text and links keep a
// readable contrast on both colours (mobile/scripts/test_theme_backgrounds.mts checks every pair against every text colour the app uses).
// Pure (no React, no DOM), so that node can test it. The keys are the theme slugs of src/themes/occasions.ts.

export type Pair = [string, string];
export interface ThemeBackground {
  light: Pair;
  dark: Pair;
}

export const BACKGROUNDS: Record<string, ThemeBackground> = {
  // the church year
  advent: { light: ["#d6cbf3", "#bdd0f2"], dark: ["#2c2268", "#162b58"] },
  christmas: { light: ["#f6c9c3", "#c3e6cd"], dark: ["#521c22", "#10402b"] },
  "new-year": { light: ["#c4d3f6", "#fbe0a0"], dark: ["#1b2b6c", "#52391a"] },
  epiphany: { light: ["#c0cef3", "#f7dd98"], dark: ["#14276f", "#4f3f12"] },
  lent: { light: ["#dac9ea", "#e6dbc3"], dark: ["#38244f", "#3d3326"] },
  "palm-sunday": { light: ["#c9e8b9", "#f6e5a0"], dark: ["#154620", "#473f12"] },
  "good-friday": { light: ["#d2c9de", "#e8e5e9"], dark: ["#2f2442", "#1b1b22"] },
  easter: { light: ["#d9c8f4", "#fbe5a2"], dark: ["#3a2468", "#4d4012"] },
  ascension: { light: ["#b6dbf6", "#f9e5a0"], dark: ["#10406e", "#4d4216"] },
  pentecost: { light: ["#f8c2ae", "#fcdf9a"], dark: ["#601a0e", "#523c0e"] },
  trinity: { light: ["#c2cff2", "#f0dfac"], dark: ["#13246e", "#42360e"] },
  // other occasions
  passover: { light: ["#c6d2f3", "#f0cdd3"], dark: ["#15285f", "#4d1827"] },
  communion: { light: ["#eec4d2", "#f2dfb2"], dark: ["#4f1a2e", "#423512"] },
  harvest: { light: ["#f8d79a", "#cde5ae"], dark: ["#503610", "#1f3d14"] },
  reformation: { light: ["#f1beb8", "#f0dfba"], dark: ["#521a17", "#3c301a"] },
  "bible-sunday": { light: ["#f4dda4", "#e8c79c"], dark: ["#503a10", "#3d2612"] },
  "mothers-day": { light: ["#f9c4d6", "#cfe9cf"], dark: ["#561f36", "#163d28"] },
  "fathers-day": { light: ["#bddaf4", "#d3e8c5"], dark: ["#143760", "#1d3d25"] },
  "childrens-day": { light: ["#bfdbf9", "#fce69c"], dark: ["#12376f", "#4d3f10"] },
  // moods and plain themes
  healing: { light: ["#bde9df", "#d5edbd"], dark: ["#0d423b", "#1c421b"] },
  miracles: { light: ["#cbd0f7", "#f8dfa2"], dark: ["#27236e", "#4c3a10"] },
  "sea-of-galilee": { light: ["#b0d4f4", "#bdeadc"], dark: ["#0c3961", "#0d4147"] },
  "warm-paper": { light: ["#fcefc2", "#eed9a8"], dark: ["#463816", "#281f10"] },
  "night-reading": { light: ["#c8d6f2", "#dde5f4"], dark: ["#142250", "#0c1532"] },
};

/** The angle the two colours run along (corner to corner, a little off the vertical). */
export const ANGLE = "160deg";

export function gradient(pair: Pair): string {
  return `linear-gradient(${ANGLE}, ${pair[0]}, ${pair[1]})`;
}

/**
 * The style rules that put the colours on the app: the two colours of the theme in use are CSS variables on <html> (--ph-a, --ph-b; the dark pair when
 * <html> says data-scheme="dark"), and each theme's chip in the theme list carries its own pair, so the list shows what each theme looks like.
 */
export function backgroundCss(): string {
  const out: string[] = [];
  for (const [slug, b] of Object.entries(BACKGROUNDS)) {
    out.push(`html[data-occasion="${slug}"],.theme-chip[data-chip="${slug}"]{--ph-a:${b.light[0]};--ph-b:${b.light[1]}}`);
    out.push(`html[data-occasion="${slug}"][data-scheme="dark"],html[data-scheme="dark"] .theme-chip[data-chip="${slug}"]{--ph-a:${b.dark[0]};--ph-b:${b.dark[1]}}`);
  }
  return out.join("\n");
}
