// Content Factory: where everything goes on a picture. Pure numbers and text (no canvas), so it can be tested under Node
// (scripts/test_factory.mts); the drawing code gives it a function that measures text.

import { clamp, type BandConfig, type LayoutId } from "./types.ts";

/** width in pixels of `text` at `size` px, in the font the picture uses */
export type Measure = (text: string, size: number) => number;

/** Cuts text into lines no wider than `maxWidth` (greedy, by words). A word too long for a line stands alone. */
export function wrapLines(text: string, maxWidth: number, size: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (line && measure(trial, size) > maxWidth) {
        out.push(line);
        line = w;
      } else line = trial;
    }
    if (line) out.push(line);
  }
  return out;
}

/** The same lines, made more even: the narrowest width that still gives the same number of lines (so no one-word last line). */
export function balanceLines(text: string, maxWidth: number, size: number, measure: Measure): string[] {
  const base = wrapLines(text, maxWidth, size, measure);
  if (base.length < 2) return base;
  let best = base;
  let lo = maxWidth * 0.55;
  let hi = maxWidth;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const trial = wrapLines(text, mid, size, measure);
    if (trial.length <= base.length) {
      best = trial;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

export function ellipsize(text: string, maxWidth: number, size: number, measure: Measure): string {
  if (!text || measure(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}...`, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

/** Is this a tall picture (Story, Reel, Status, TikTok, Shorts)? Those have the apps' own buttons over the bottom. */
export const isTall = (w: number, h: number) => h / w >= 1.6;

/** The height of a header or footer band: text and logos by the size chosen, a picture by its own shape (never more than a fifth of the
 * short side). `imageAspect` is the picture's width over its height. 0 means no band. */
export function bandHeight(w: number, h: number, cfg: Pick<BandConfig, "kind" | "size">, imageAspect = 0): number {
  if (cfg.kind === "none") return 0;
  const short = Math.min(w, h);
  if (cfg.kind === "picture") return imageAspect > 0 ? Math.round(clamp(w / imageAspect, short * 0.05, short * 0.22)) : 0;
  return Math.round(short * (cfg.size === "small" ? 0.07 : cfg.size === "large" ? 0.14 : 0.1));
}

/** where the top edge of a header band is: at the top, or in the tall sizes below the part the apps cover */
export const headerTop = (w: number, h: number, place: "safe" | "edge") => (isTall(w, h) && place === "safe" ? Math.round(h * 0.12) : 0);

/** where the bottom edge of a footer band is: at the bottom, or in the tall sizes above the buttons the apps put there */
export const footerEdge = (w: number, h: number, place: "safe" | "edge") => (isTall(w, h) && place === "safe" ? h - Math.round(h * 0.15) : h);

export interface FooterGeometry {
  fontSize: number;
  /** baseline of the footer row */
  baseline: number;
  leftX: number;
  /** the right edge of the right-hand mark */
  rightX: number;
  leftMaxW: number;
  rightMaxW: number;
  /** baseline of the small credit line above the footer row */
  creditBaseline: number;
  /** the height of the strip the footer sits in (used to pick a readable text colour) */
  stripTop: number;
  stripBottom: number;
}

/** Where the footer row sits. In the tall sizes the "safe" place lifts it above the buttons the apps put over the bottom
 * (the sources disagree on how much: about 200 to 670 px of 1920; 340 is the working figure, to be tuned after real posts)
 * and keeps the right corner clear of the icons that sit about 120 to 150 px from the right edge. */
export function footerGeometry(w: number, h: number, place: "safe" | "edge", bandH = 0): FooterGeometry {
  const short = Math.min(w, h);
  const fontSize = Math.max(18, Math.round(short * 0.024));
  const tallSafe = isTall(w, h) && place === "safe";
  // with a band across the bottom, the name and the mark sit just above it
  const bottom = bandH > 0 ? h - footerEdge(w, h, place) + bandH + Math.round(fontSize * 0.9) : tallSafe ? Math.round(h * 0.177) : Math.round(short * 0.04);
  const left = Math.round(w * (tallSafe ? 0.06 : 0.05));
  const right = Math.round(w * (tallSafe ? 0.14 : 0.05));
  const rowW = w - left - right;
  const baseline = h - bottom;
  return {
    fontSize,
    baseline,
    leftX: left,
    rightX: w - right,
    leftMaxW: Math.round(rowW * 0.6),
    rightMaxW: Math.round(rowW * 0.35),
    creditBaseline: baseline - Math.round(fontSize * 1.9),
    stripTop: baseline - Math.round(fontSize * 2.6),
    stripBottom: baseline + Math.round(fontSize * 0.6),
  };
}

export interface TextLayout {
  fontSize: number;
  refSize: number;
  align: "center" | "left";
  lines: { text: string; x: number; y: number }[];
  ref: { text: string; x: number; y: number } | null;
  /** a see-through card behind the words */
  panel: { x: number; y: number; w: number; h: number; r: number } | null;
  /** a bar behind the reference */
  ribbon: { x: number; y: number; w: number; h: number } | null;
  /** the big opening quote mark */
  quoteMark: { x: number; y: number; size: number } | null;
  /** a thin line between the words and the reference */
  rule: { x1: number; x2: number; y: number } | null;
}

export interface LayoutInput {
  text: string;
  /** the reference line, e.g. "John 3:16 · BSB" (empty = none) */
  reference: string;
  layout: LayoutId;
  w: number;
  h: number;
  place: "safe" | "edge";
  /** is a credit line shown above the footer */
  hasCredit: boolean;
  fontScale: number;
  measure: Measure;
  /** the words start no higher than this (a header band above them) */
  topMin?: number;
  /** the height of a band across the bottom (the words end above it) */
  footerBand?: number;
  /** the words end above this line (the top of the footer bar, or of a banner above it); when given it replaces the working out from `hasCredit` and `footerBand` */
  limit?: number;
}

const LINE = 1.28;

/** Puts the words and the reference where the layout says, as large as fits. */
export function layoutText(i: LayoutInput): TextLayout {
  const { w, h, measure } = i;
  const short = Math.min(w, h);
  const fg = footerGeometry(w, h, i.place, i.footerBand ?? 0);
  const tall = isTall(w, h);
  const top = Math.max(Math.round(h * (tall ? 0.13 : 0.08)), Math.round(i.topMin ?? 0));
  const bottom = i.limit !== undefined ? Math.round(i.limit) : Math.round(fg.baseline - fg.fontSize * (i.hasCredit ? 4.4 : 2.8));
  const areaH = Math.max(60, bottom - top);
  const mx = Math.round(w * (i.layout === "card" ? 0.14 : 0.1));
  const boxW = w - 2 * mx;
  const share = i.layout === "low" || i.layout === "top" ? 0.5 : i.layout === "quote" ? 0.74 : 0.82;
  const maxFs = short * 0.085;
  const minFs = short * 0.03;
  const refSizeFor = (fs: number) => Math.round(Math.max(short * 0.028, fs * 0.5));
  const extra = (fs: number) => (i.reference ? refSizeFor(fs) * 1.2 + fs * 0.55 : 0) + (i.layout === "quote" ? fs * 1.5 : 0);

  let fs = Math.round(maxFs);
  let lines = balanceLines(i.text, boxW, fs, measure);
  while (fs > minFs && lines.length * fs * LINE + extra(fs) > areaH * share) {
    fs = Math.round(fs * 0.94);
    lines = balanceLines(i.text, boxW, fs, measure);
  }
  // the size the reader chose is a multiple of the size that fits: 1 is the fitted size, 1.5 half as big again (the words may then pass the usual area: they can be moved)
  const scale = clamp(i.fontScale, 0.4, 3);
  if (scale !== 1) {
    fs = Math.max(8, Math.round(fs * scale));
    lines = balanceLines(i.text, boxW, fs, measure);
  }
  const refSize = refSizeFor(fs);
  const blockH = lines.length * fs * LINE + extra(fs);
  const align: "center" | "left" = i.layout === "low" || i.layout === "top" ? "left" : "center";
  const x = align === "center" ? w / 2 : mx;

  // the top of the block
  let y0: number;
  if (i.layout === "low") y0 = bottom - blockH;
  else if (i.layout === "top") y0 = top;
  else y0 = top + (areaH - blockH) / 2;
  y0 = Math.max(top, y0);

  let cursor = y0 + (i.layout === "quote" ? fs * 1.5 : 0);
  const out: TextLayout = { fontSize: fs, refSize, align, lines: [], ref: null, panel: null, ribbon: null, quoteMark: null, rule: null };
  lines.forEach((t, n) => out.lines.push({ text: t, x, y: Math.round(cursor + fs * (0.9 + n * LINE)) }));
  cursor += lines.length * fs * LINE;
  if (i.reference) {
    const refTop = cursor + fs * 0.25;
    const baseline = Math.round(refTop + refSize * 1.0);
    out.ref = { text: i.reference, x, y: baseline };
    if (i.layout === "ribbon") {
      const rh = Math.round(refSize * 1.9);
      out.ribbon = { x: 0, y: Math.round(refTop + refSize * 1.0 - refSize * 1.3), w, h: rh };
      out.ref.y = Math.round(out.ribbon.y + rh / 2 + refSize * 0.34);
    } else {
      const rw = Math.min(boxW * 0.3, 140);
      const ry = Math.round(cursor + fs * 0.1);
      out.rule = align === "center" ? { x1: w / 2 - rw / 2, x2: w / 2 + rw / 2, y: ry } : { x1: mx, x2: mx + rw, y: ry };
    }
  }
  if (i.layout === "card") {
    const pad = Math.round(fs * 0.7);
    const contentTop = y0;
    out.panel = { x: mx - pad, y: Math.round(contentTop - pad), w: boxW + 2 * pad, h: Math.round(blockH + 2 * pad - fs * 0.1), r: Math.round(fs * 0.5) };
  }
  if (i.layout === "quote") out.quoteMark = { x, y: Math.round(y0 + fs * 1.45), size: Math.round(fs * 2.6) };
  return out;
}

/** Fits the footer's two texts into their corners: neither passes its share of the row, so they never meet. */
export function fitFooter(name: string, mark: string, g: FooterGeometry, measure: Measure): { name: string; mark: string } {
  return { name: ellipsize(name, g.leftMaxW, g.fontSize, measure), mark: ellipsize(mark, g.rightMaxW, g.fontSize, measure) };
}

// ---------------------------------------------------------------- the footer bar
// One strip across the bottom that holds everything that is not the words: the name (with the church's own words in front, if there
// are any), a logo, the credit a photo's licence asks for, the small site mark and, in a video, the music's credit. Where the
// credit fits on the same line as the site mark it goes there, otherwise on a line of its own. In the tall sizes the bar sits above
// the buttons the apps lay over the bottom, like the bands.

export interface BarInput {
  w: number;
  h: number;
  place: "safe" | "edge";
  /** the left text: the name, with the church's text before it when there is some ("" = none) */
  left: string;
  /** the credit a photo's licence asks for ("" = none) */
  credit: string;
  /** the music's credit, on a line of its own ("" = none) */
  extra: string;
  /** the small site mark, at the right ("" = none) */
  mark: string;
  /** a logo at the left: its width over its height, and the size chosen */
  logo: { aspect: number; size: "small" | "medium" | "large" } | null;
  /** keep a line free for the music's credit even while it is not shown (a video: the words must not change size when it comes and goes) */
  keepExtraRow?: boolean;
  /** where the text sits: at the left with the small print (credit and site mark) at the right, or centred or at the right on lines of their own */
  align?: "left" | "center" | "right";
  /** the size chosen: small, medium (the usual) or large letters and logo */
  size?: "small" | "medium" | "large";
  measure: Measure;
}

export interface BarItem {
  text: string;
  x: number;
  align: "left" | "center" | "right";
  role: "left" | "credit" | "mark" | "extra";
}

export interface BarLayout {
  /** the strip across the whole width */
  top: number;
  height: number;
  fontSize: number;
  rows: { baseline: number; items: BarItem[] }[];
  logo: { x: number; y: number; w: number; h: number } | null;
}

/** Works out the footer bar. Returns null when there is nothing to put in it. */
export function barLayout(i: BarInput): BarLayout | null {
  const { w, h, measure } = i;
  if (!i.left && !i.credit && !i.extra && !i.mark && !i.logo && !i.keepExtraRow) return null;
  const short = Math.min(w, h);
  const g = footerGeometry(w, h, i.place);
  const edge = footerEdge(w, h, i.place);

  // the logo
  let logo: { w: number; h: number } | null = null;
  if (i.logo) {
    const target = Math.round(short * (i.logo.size === "small" ? 0.05 : i.logo.size === "large" ? 0.1 : 0.07));
    let lw = Math.round(target * Math.max(0.1, i.logo.aspect));
    let lh = target;
    const maxW = Math.round((g.rightX - g.leftX) * 0.3);
    if (lw > maxW) {
      lh = Math.max(8, Math.round((lh * maxW) / lw));
      lw = maxW;
    }
    logo = { w: lw, h: lh };
  }
  const textX = g.leftX + (logo ? logo.w + Math.round(g.fontSize * 0.8) : 0);
  const avail = g.rightX - textX;
  const gapOf = (fs: number) => Math.round(fs * 1.5);
  const align = i.align ?? "left";
  const base = Math.round(g.fontSize * (i.size === "small" ? 0.85 : i.size === "large" ? 1.3 : 1));

  // one line if the left text, the credit and the mark fit side by side (a little smaller if need be), otherwise two
  let fs = base;
  let single = false;
  for (const k of align === "left" ? [1, 0.92, 0.85] : []) {
    const s = Math.round(base * k);
    const parts = [i.left, i.credit, i.mark].filter(Boolean).map((t) => measure(t, s));
    const need = parts.reduce((a, b) => a + b, 0) + gapOf(s) * Math.max(0, parts.length - 1);
    if (need <= avail) {
      fs = s;
      single = true;
      break;
    }
  }

  const rows: { items: BarItem[] }[] = [];
  const clip = (t: string, max: number) => ellipsize(t, max, fs, measure);
  if (align !== "left") {
    // centred or at the right: the church's text and name on one line, the small print under it
    const small = [i.credit, i.mark].filter(Boolean).join("  \u00b7  ");
    const x = align === "center" ? Math.round((textX + g.rightX) / 2) : g.rightX;
    if (i.left) rows.push({ items: [{ text: clip(i.left, avail), x, align, role: "left" }] });
    if (small) rows.push({ items: [{ text: clip(small, avail), x, align, role: "credit" }] });
  } else if (single) {
    const items: BarItem[] = [];
    if (i.left) items.push({ text: i.left, x: textX, align: "left", role: "left" });
    let right = g.rightX;
    if (i.mark) {
      items.push({ text: i.mark, x: right, align: "right", role: "mark" });
      right -= measure(i.mark, fs) + gapOf(fs);
    }
    if (i.credit) items.push({ text: i.credit, x: right, align: "right", role: "credit" });
    if (items.length) rows.push({ items });
  } else {
    const items: BarItem[] = [];
    const markW = i.mark ? Math.min(measure(i.mark, fs), Math.round(avail * 0.4)) : 0;
    if (i.left) items.push({ text: clip(i.left, avail - markW - (markW ? gapOf(fs) : 0)), x: textX, align: "left", role: "left" });
    if (i.mark) items.push({ text: clip(i.mark, markW), x: g.rightX, align: "right", role: "mark" });
    if (items.length) rows.push({ items });
    if (i.credit) rows.push({ items: [{ text: clip(i.credit, avail), x: textX, align: "left", role: "credit" }] });
  }
  if (i.extra) rows.push({ items: [{ text: clip(i.extra, avail), x: textX, align: "left", role: "extra" }] });
  else if (i.keepExtraRow) rows.push({ items: [] });
  if (rows.length === 0) rows.push({ items: [] });

  // the strip
  const lineH = Math.round(fs * 1.4);
  const padV = Math.round(fs * 0.6);
  const textH = rows.length * lineH + 2 * padV;
  const height = Math.max(textH, logo ? logo.h + 2 * Math.round(fs * 0.5) : 0);
  const top = edge - height;
  const first = top + (height - rows.length * lineH) / 2;
  return {
    top,
    height,
    fontSize: fs,
    rows: rows.map((r, n) => ({ baseline: Math.round(first + lineH * (n + 0.5) + fs * 0.34), items: r.items })),
    logo: logo ? { x: g.leftX, y: Math.round(top + (height - logo.h) / 2), w: logo.w, h: logo.h } : null,
  };
}
