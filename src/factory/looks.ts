// Content Factory: the looks. A look is a ready-made combination of background, layout, font and colours; "Make" offers six
// different ones and the reader taps the one they like. Chosen by fixed rules and a seed: the same seed gives the
// same six, "More looks" changes the seed. The colours of the church year come first when it is that season.

import type { OccasionId } from "../themes/themeCalendar";
import { FONTS, LAYOUTS, type ImageBg, type Look } from "./types.ts";

export interface Palette {
  id: string;
  label: string;
  from: string;
  to: string;
  angle: number;
  ink: string;
  accent: string;
  card: string;
  glow?: { x: number; y: number; r: number; color: string };
}

export const PALETTES: Palette[] = [
  { id: "dawn", label: "Dawn", from: "#f7dcae", to: "#e88e68", angle: 160, ink: "#2b1a12", accent: "#8a3b1f", card: "rgba(255,248,235,0.72)", glow: { x: 0.5, y: 0.22, r: 0.7, color: "rgba(255,244,214,0.75)" } },
  { id: "night", label: "Night sky", from: "#0e1c3b", to: "#2f4b8c", angle: 170, ink: "#ffffff", accent: "#f3d27c", card: "rgba(10,20,50,0.55)", glow: { x: 0.5, y: 0.3, r: 0.75, color: "rgba(120,160,255,0.28)" } },
  { id: "forest", label: "Deep green", from: "#10352a", to: "#2f6b4f", angle: 165, ink: "#ffffff", accent: "#e8d28a", card: "rgba(8,30,22,0.55)" },
  { id: "royal", label: "Royal", from: "#2a1a4e", to: "#6a3f9f", angle: 160, ink: "#ffffff", accent: "#f0d58a", card: "rgba(30,15,60,0.55)", glow: { x: 0.5, y: 0.25, r: 0.7, color: "rgba(190,150,255,0.25)" } },
  { id: "linen", label: "Linen", from: "#fbf6ea", to: "#e6d9bd", angle: 170, ink: "#2b2a28", accent: "#8a5a2b", card: "rgba(255,255,255,0.7)" },
  { id: "rose", label: "Rose", from: "#58202d", to: "#b44b5b", angle: 160, ink: "#ffffff", accent: "#ffe0b8", card: "rgba(60,15,25,0.5)" },
  { id: "sea", label: "Sea", from: "#0f3b4a", to: "#2c8a9b", angle: 170, ink: "#ffffff", accent: "#fff1c4", card: "rgba(5,35,45,0.5)", glow: { x: 0.5, y: 0.2, r: 0.8, color: "rgba(200,255,255,0.2)" } },
  { id: "gold", label: "Gold glow", from: "#1c1509", to: "#6c4b14", angle: 165, ink: "#fff4d6", accent: "#ffd978", card: "rgba(20,14,4,0.55)", glow: { x: 0.5, y: 0.35, r: 0.7, color: "rgba(255,200,90,0.3)" } },
  // the church year
  { id: "christmas", label: "Christmas", from: "#6e1420", to: "#123d2b", angle: 150, ink: "#ffffff", accent: "#f5d27a", card: "rgba(20,10,10,0.45)", glow: { x: 0.5, y: 0.25, r: 0.65, color: "rgba(255,220,140,0.28)" } },
  { id: "advent", label: "Advent", from: "#2a1d5c", to: "#4a5fb0", angle: 165, ink: "#ffffff", accent: "#f3d27c", card: "rgba(20,15,60,0.5)", glow: { x: 0.5, y: 0.7, r: 0.5, color: "rgba(255,210,120,0.3)" } },
  { id: "lent", label: "Lent", from: "#3b2a44", to: "#7b6a82", angle: 170, ink: "#ffffff", accent: "#e9dcc0", card: "rgba(30,20,35,0.5)" },
  { id: "resurrection", label: "Resurrection Sunday", from: "#fffbea", to: "#f3d986", angle: 165, ink: "#3a2d10", accent: "#a06a10", card: "rgba(255,255,255,0.65)", glow: { x: 0.5, y: 0.3, r: 0.8, color: "rgba(255,255,255,0.8)" } },
  { id: "pentecost", label: "Pentecost", from: "#7a1c10", to: "#e0662a", angle: 160, ink: "#ffffff", accent: "#ffe8a8", card: "rgba(60,10,5,0.45)", glow: { x: 0.5, y: 0.8, r: 0.6, color: "rgba(255,230,150,0.35)" } },
  { id: "passover", label: "Passover", from: "#0d2a55", to: "#6f95d1", angle: 165, ink: "#ffffff", accent: "#ffffff", card: "rgba(5,20,50,0.5)", glow: { x: 0.5, y: 0.25, r: 0.7, color: "rgba(255,255,255,0.22)" } },
  { id: "harvest", label: "Harvest", from: "#6b4510", to: "#d99a2b", angle: 165, ink: "#ffffff", accent: "#fff0c0", card: "rgba(50,30,5,0.5)" },
];

const SEASON: Partial<Record<OccasionId, string>> = {
  advent: "advent",
  christmas: "christmas",
  lent: "lent",
  palmsunday: "lent",
  goodfriday: "lent",
  easter: "resurrection",
  ascension: "resurrection",
  pentecost: "pentecost",
  passover: "passover",
  harvest: "harvest",
};

export const paletteById = (id: string): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/** the palette of the church year for an occasion, if there is one */
export function seasonPalette(occasion: OccasionId | null | undefined): Palette | null {
  const id = occasion ? SEASON[occasion] : undefined;
  return id ? paletteById(id) : null;
}

/** a small deterministic random number generator */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a picture that can go behind the words */
export interface PictureChoice {
  key: string;
  credit?: string;
  focusX?: number;
  focusY?: number;
}

function pick<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length)];
}

export function lookFromPalette(p: Palette, layout: Look["layout"], fontId: string, label: string, id: string): Look {
  return {
    id,
    label,
    layout,
    fontId,
    bold: fontId === "bold",
    capitals: false,
    ink: p.ink,
    accent: p.accent,
    cardColor: p.card,
    background: { kind: "gradient", from: p.from, to: p.to, angle: p.angle, glow: p.glow },
  };
}

export function lookFromPicture(pic: PictureChoice, layout: Look["layout"], fontId: string, label: string, id: string, darken: number): Look {
  const bg: ImageBg = { kind: "image", key: pic.key, darken, credit: pic.credit, focusX: pic.focusX ?? 0.5, focusY: pic.focusY ?? 0.5 };
  return { id, label, layout, fontId, bold: fontId === "bold", capitals: false, ink: "#ffffff", accent: "#f6dea0", cardColor: "rgba(0,0,0,0.42)", background: bg };
}

/** Six different looks for a verse. The colours of the church year (if it is that season) come first; with pictures to hand,
 * two of the six use one. Different layouts and fonts, so the six really look different. */
export function makeLooks(seed: number, opts: { occasion?: OccasionId | null; pictures?: PictureChoice[]; count?: number } = {}): Look[] {
  const r = rng(seed * 7919 + 13);
  const count = opts.count ?? 6;
  const pics = opts.pictures ?? [];
  const layouts = LAYOUTS.map((l) => l.id);
  // shuffle the layouts
  for (let i = layouts.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [layouts[i], layouts[j]] = [layouts[j], layouts[i]];
  }
  const season = seasonPalette(opts.occasion);
  const everyday = PALETTES.filter((p) => !SEASON_IDS.has(p.id));
  const order = [...everyday];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const fonts = FONTS.map((f) => f.id);
  const looks: Look[] = [];
  const wantPictures = pics.length ? Math.min(2, count - 1) : 0;
  let usedPictures = 0;
  for (let n = 0; n < count; n++) {
    const layout = layouts[n % layouts.length];
    const fontId = pick(r, fonts);
    const id = `look-${seed}-${n}`;
    // the pictures take places 2 and 5 of six
    const usePicture = usedPictures < wantPictures && (n === 1 || n === 4 || n >= count - (wantPictures - usedPictures));
    if (usePicture) {
      usedPictures++;
      looks.push(lookFromPicture(pick(r, pics), layout, fontId, "Picture", id, 0.38 + r() * 0.12));
    } else {
      const p = n === 0 && season ? season : order[(n + (season ? -1 : 0) + order.length) % order.length];
      looks.push(lookFromPalette(p, layout, fontId, p.label, id));
    }
  }
  return looks;
}

const SEASON_IDS = new Set(["christmas", "advent", "lent", "resurrection", "pentecost", "passover", "harvest"]);
