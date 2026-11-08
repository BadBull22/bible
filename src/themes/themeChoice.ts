// Which wordmark and which background the opening screen shows. Pure (no React, no pictures), so that node can test it.
//
// The reader picks a theme (a wordmark and a background that go together) and may then mix and match: the wordmark from one theme, the
// background from another, or either one plain. `wordmarkFrom` and `backgroundFrom` are "theme" (the same as the theme), "none" (plain) or a
// theme's slug. A season may switch the theme near its date, unless the reader has made a selection by hand or has chosen to keep it.

export interface Choice {
  /** the theme the reader picked ("default": none) */
  chosen: string;
  wordmarkFrom: string;
  backgroundFrom: string;
  /** keep this selection as the default and never change it: no seasonal switching at all */
  keep: boolean;
}

/** a selection made by hand: a theme picked, or the wordmark or the background picked on its own */
export const handChosen = (c: Choice): boolean => c.chosen !== "default" || c.wordmarkFrom !== "theme" || c.backgroundFrom !== "theme";

/** the app may switch themes near a season only when nothing is selected by hand and the reader has not chosen to keep the selection */
export const mayAutoSwitch = (c: Choice, seasonal: boolean): boolean => seasonal && !c.keep && !handChosen(c);

export interface Resolved {
  /** the theme itself (picked, or the season's); null for the default theme */
  base: string | null;
  /** the theme whose wordmark picture shows; null: the plain coloured letters */
  wordmark: string | null;
  /** the theme whose background (decorations, colours, verse) shows; null: the plain background */
  background: string | null;
  /** the default theme's slight glow: no theme background, and the reader has not asked for a plain background */
  defaultGlow: boolean;
  /** the wordmark and the background come from different themes, or one is plain beside a theme's other */
  mixed: boolean;
}

/** `season`: the slug of the seasonal theme in force (or null); `known`: whether a slug is a real theme */
export function resolveChoice(c: Choice, season: string | null, known: (slug: string) => boolean): Resolved {
  const picked = c.chosen !== "default" && known(c.chosen) ? c.chosen : null;
  const seasonal = !c.keep && !handChosen(c) && season && known(season) ? season : null;
  const base = picked ?? seasonal;
  const from = (source: string): string | null => (source === "theme" ? base : source === "none" ? null : known(source) ? source : base);
  const wordmark = from(c.wordmarkFrom);
  const background = from(c.backgroundFrom);
  return {
    base,
    wordmark,
    background,
    defaultGlow: background === null && c.backgroundFrom !== "none",
    mixed: c.wordmarkFrom !== "theme" || c.backgroundFrom !== "theme",
  };
}
