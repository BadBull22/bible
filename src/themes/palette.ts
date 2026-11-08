// A colour of the reader's own for the whole app: the page, the raised panels, the bars and the borders of every window take a pale tint of it.
// Pure (no React, no CSS), so that node can test it.
//
// Whatever colour is chosen is softened to a pastel. In the light appearance the surfaces are clearly tinted pastels, and the two small grey text
// colours (labels and hints) are darkened just enough to keep at least 4.5 to 1 on every tinted surface. In the dark appearance each tinted surface is a
// deep, muted shade that is exactly as bright as the standard one it replaces, so every text colour keeps the contrast it has now.

export interface Swatch {
  id: string;
  name: string;
  /** a pastel to start from */
  hex: string;
}

export const PALETTE: Swatch[] = [
  { id: "rose", name: "Rose", hex: "#f3cdd6" },
  { id: "peach", name: "Peach", hex: "#f7d7c2" },
  { id: "butter", name: "Butter", hex: "#f6eab5" },
  { id: "lime", name: "Lime", hex: "#e2eebb" },
  { id: "mint", name: "Mint", hex: "#cdebd8" },
  { id: "aqua", name: "Aqua", hex: "#c6e9e6" },
  { id: "sky", name: "Sky", hex: "#cfe3f6" },
  { id: "periwinkle", name: "Periwinkle", hex: "#d6d9f5" },
  { id: "lavender", name: "Lavender", hex: "#e0d2f1" },
  { id: "orchid", name: "Orchid", hex: "#efd0ec" },
  { id: "sand", name: "Sand", hex: "#eadfcc" },
  { id: "stone", name: "Stone", hex: "#dcdfe3" },
];

/** "standard": no tint (the app's own colours); otherwise #rrggbb */
export const STANDARD = "standard";
const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHexColour = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

export type RGB = [number, number, number];

/** red, green, blue (0 to 255) of #rrggbb; anything else reads as a neutral grey */
export function parseHex(hex: string): RGB {
  return isHexColour(hex) ? ([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB) : [128, 128, 128];
}

export const toHex = ([r, g, b]: RGB): string => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/** hue (0 to 360), saturation and lightness (0 to 1) of an rgb colour */
export function toHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as RGB;
}

/** relative luminance (WCAG), 0 black to 1 white */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const contrast = (a: RGB, b: RGB): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** the colour of this hue and saturation that is as bright as `target` (relative luminance); the lightest or darkest if it cannot get there */
export function atLuminance(h: number, s: number, target: number): RGB {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToRgb(h, s, mid)) < target) lo = mid;
    else hi = mid;
  }
  return hslToRgb(h, s, (lo + hi) / 2);
}

/** the app's own surfaces: what each tinted surface must be as bright as */
export const STANDARD_SURFACES = {
  light: { paper: "#faf7f0", raised: "#ffffff", chrome: "#f2f1ee", border: "#e4e0d6", accent100: "#e4edf9" },
  dark: { paper: "#17181c", raised: "#1f2126", chrome: "#1b1c20", border: "#2e3038", accent100: "#1f2d42" },
};

export type Surfaces = Record<keyof typeof STANDARD_SURFACES.light, string>;

export interface AppTones {
  /** the light appearance also darkens the two small grey text colours (labels, hints) so that they stay readable on the stronger tint */
  light: Surfaces & { muted: string; faint: string };
  dark: Surfaces;
}

/** the app's small grey text colours in the light appearance */
export const STANDARD_TEXT = { muted: "#6b6558", faint: "#756e5f" };

/** `colour` made darker (same hue, same saturation) until it has at least `target` to 1 on every one of `surfaces` */
export function darkenUntil(colour: string, surfaces: string[], target: number): string {
  const [h, s, l] = toHsl(parseHex(colour));
  const rgbs = surfaces.map(parseHex);
  const ok = (x: RGB) => Math.min(...rgbs.map((b) => contrast(x, b))) >= target;
  let at = l;
  let out = parseHex(colour);
  while (!ok(out) && at > 0) {
    at = Math.max(0, at - 0.01);
    out = hslToRgb(h, s, at);
  }
  return toHex(out);
}

/** The surfaces tinted with a colour: clear pastels in the light appearance, deep muted shades in the dark one. */
export function appTones(hex: string): AppTones {
  const [h, s] = toHsl(parseHex(hex));
  const ls = clamp(s, 0, 0.75);
  const ds = clamp(s, 0, 0.35);
  const D = STANDARD_SURFACES.dark;
  const lightAt = (sat: number, l: number) => toHex(hslToRgb(h, sat, l));
  const darkTint = (std: string, sat: number) => toHex(atLuminance(h, sat, luminance(parseHex(std))));
  const paper = lightAt(ls, 0.925);
  const raised = lightAt(ls * 0.5, 0.968);
  const chrome = lightAt(ls, 0.895);
  const accent100 = lightAt(ls, 0.87);
  const carriers = [paper, raised, chrome, accent100];
  return {
    light: {
      paper,
      raised,
      chrome,
      border: lightAt(ls * 0.7, 0.8),
      accent100,
      muted: darkenUntil(STANDARD_TEXT.muted, carriers, 5),
      faint: darkenUntil(STANDARD_TEXT.faint, carriers, 4.6),
    },
    dark: {
      paper: darkTint(D.paper, ds),
      raised: darkTint(D.raised, ds),
      chrome: darkTint(D.chrome, ds),
      border: darkTint(D.border, ds * 0.8),
      accent100: darkTint(D.accent100, ds),
    },
  };
}

/** The CSS variables to put on the page's root element; themes.css turns them into --paper, --paper-raised, --chrome-bg, --border and --accent-100 in both appearances. */
export function appVars(hex: string): Record<string, string> {
  const t = appTones(hex);
  return {
    "--ac-paper": t.light.paper,
    "--ac-raised": t.light.raised,
    "--ac-chrome": t.light.chrome,
    "--ac-border": t.light.border,
    "--ac-accent100": t.light.accent100,
    "--ac-muted": t.light.muted,
    "--ac-faint": t.light.faint,
    "--ac-paper-dark": t.dark.paper,
    "--ac-raised-dark": t.dark.raised,
    "--ac-chrome-dark": t.dark.chrome,
    "--ac-border-dark": t.dark.border,
    "--ac-accent100-dark": t.dark.accent100,
  };
}

export const APP_VAR_NAMES = Object.keys(appVars("#808080"));
