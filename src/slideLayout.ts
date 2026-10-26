// Where the parts of a slide go when they would crowd each other: a cursive heading graphic over the background, the
// words, and a picture beside them. All in percent of the slide (0 to 100 across and down). Pure, so it can be tested
// under Node (scripts/test_slide_layout.mts).
//
// Spacing is automatic first: a slide with its own heading graphic and words and/or a picture gets the heading on top
// (as large as fits) and the words and picture under it, side by side. The preacher can then drag any part (`layout` on
// the slide holds where each now is); "Auto-space" takes that away and the slide is spaced again.

import type { SlideSpec } from "./sermonOutputs";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the parts are, when the preacher has placed them. */
export interface SlideLayout {
  words?: Box;
  picture?: Box;
  overlay?: Box;
}

/** The part of a heading graphic that is not see-through, as fractions (0 to 1) of the picture. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A heading graphic bigger than this much of the slide is a decoration (a paint sweep), not a heading to space things round. */
export const DECORATION_AREA = 0.7;

const MARGIN = 6;
const MIN = 8;

const WORD_KINDS = ["title", "point", "text", "scripture", "song"];

/** Whether the slide has words to place (a heading left off with nothing under it does not). */
export function hasWords(s: SlideSpec): boolean {
  if (!WORD_KINDS.includes(s.kind)) return false;
  const heading = !(s.noHeading && ["text", "point", "title"].includes(s.kind)) && !!s.title.trim();
  return heading || !!s.body.trim();
}

/** Kinds that can have a picture beside the words. */
export function canHavePicture(s: SlideSpec): boolean {
  return WORD_KINDS.includes(s.kind) && !!s.picture;
}

/** A box kept on the slide and big enough to grab. */
export function clampBox(b: Box): Box {
  const w = Math.min(100, Math.max(MIN, b.w));
  const h = Math.min(100, Math.max(MIN, b.h));
  return { x: Math.min(100 - w, Math.max(0, b.x)), y: Math.min(100 - h, Math.max(0, b.y)), w, h };
}

export interface Parts {
  words: boolean;
  picture: boolean;
  /** the heading graphic's solid part, or null for none (or one that is only a decoration) */
  heading: BBox | null;
}

export interface Boxes {
  words: Box | null;
  picture: Box | null;
  overlay: Box | null;
}

/** The heading graphic's solid part as a size in percent of the slide. */
const sizeOf = (bb: BBox) => ({ w: (bb.x1 - bb.x0) * 100, h: (bb.y1 - bb.y0) * 100 });

/** Spaces the parts so none lies on another: the heading on top, as large as fits (never larger than it is), the words and
 * the picture under it, side by side when there are both. With no heading graphic the words are on the left and the picture on
 * the right, or the words alone fill the slide. */
export function autoBoxes(p: Parts): Boxes {
  const under = p.words || p.picture;
  let overlay: Box | null = null;
  let top = 10;
  if (p.heading) {
    const { w, h } = sizeOf(p.heading);
    const room = { w: 100 - 2 * MARGIN, h: under ? 38 : 70 };
    const s = Math.min(1, room.w / Math.max(w, 1), room.h / Math.max(h, 1));
    const ow = w * s;
    const oh = h * s;
    const oy = under ? 7 : (100 - oh) / 2;
    overlay = { x: (100 - ow) / 2, y: oy, w: ow, h: oh };
    top = under ? oy + oh + 4 : top;
  }
  const area = { x: MARGIN, y: top, w: 100 - 2 * MARGIN, h: Math.max(MIN, 94 - top) };
  if (p.words && p.picture) {
    const ww = Math.round((area.w - 3) * 0.58);
    return { overlay, words: { ...area, w: ww }, picture: { x: area.x + ww + 3, y: area.y, w: area.w - ww - 3, h: area.h } };
  }
  return { overlay, words: p.words ? area : null, picture: p.picture ? area : null };
}

export interface Plan extends Boxes {
  /** the parts are placed in boxes (a slide with a heading graphic of its own, or placed by the preacher); otherwise they flow as usual */
  boxed: boolean;
  /** the preacher has placed them */
  manual: boolean;
}

/** What goes where on a slide. `heading` is the slide's own heading graphic's solid part (not a decoration for every slide). */
export function planOf(_s: SlideSpec, parts: { words: boolean; picture: boolean; heading: BBox | null }, layout?: SlideLayout): Plan {
  const manual = !!layout && (!!layout.words || !!layout.picture || !!layout.overlay);
  const auto = autoBoxes(parts);
  const boxed = manual || (!!parts.heading && (parts.words || parts.picture));
  const pick = (mine: Box | undefined, theirs: Box | null, present: boolean) => (present ? (mine ? clampBox(mine) : theirs) : null);
  return {
    boxed,
    manual,
    words: pick(layout?.words, auto.words, parts.words),
    picture: pick(layout?.picture, auto.picture, parts.picture),
    overlay: pick(layout?.overlay, auto.overlay, !!parts.heading),
  };
}

/** Where to put the whole heading picture (it is as big as the slide) so that its solid part fills `box`, in percent of the slide. */
export function overlayPlacement(box: Box, bb: BBox): { left: number; top: number; width: number; height: number } {
  const { w, h } = sizeOf(bb);
  const s = Math.min(box.w / Math.max(w, 1), box.h / Math.max(h, 1));
  const width = 100 * s;
  const height = 100 * s;
  return {
    left: box.x + (box.w - w * s) / 2 - bb.x0 * width,
    top: box.y + (box.h - h * s) / 2 - bb.y0 * height,
    width,
    height,
  };
}

/** The solid part of an image from its see-through channel: `alpha` is one byte a pixel, `width` pixels a row. A pixel is
 * solid if it is more than a tenth opaque. null for a picture with nothing in it. */
export function solidPart(alpha: ArrayLike<number>, width: number): BBox | null {
  const height = Math.floor(alpha.length / width);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > 25) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height };
}
