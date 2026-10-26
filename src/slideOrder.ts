// Moving slides about, and the sermon with them.
//
// A slide made from the sermon remembers the item it came from (`from`). Dragging one then moves
// that item in the sermon the same way, so the slides and the sermon stay in step:
//   - a point's slide moves the whole point, with everything under it (and the slides of that);
//   - a passage's slides (a long one runs over several) or a picture's slide move that one item,
//     into the part and the place where the slide was dropped;
//   - the title slide stays at the top (the big idea is a slide like any other, but not from an item);
//   - the preacher's own slides (no `from`) just move.
// A drop is a "gap": the position before slide number `gap` (slides.length: after the last).

import type { SermonItem } from "./sermon";
import type { SlideSpec } from "./sermonOutputs";
import { movePoint, partsOf, placeAtStart, rolesFor } from "./sermonLayout.ts";

type Range = [number, number];

/** What the preacher's page needs to move slides (SlidesEditor asks; SermonBuilder answers). */
export interface SlideOrder {
  /** the slides that move with slide i: [first, after-last), or null when it can't be moved */
  unit: (i: number) => Range | null;
  /** where a drop at `gap` lands for slide i (null: nowhere new) */
  gap: (i: number, gap: number) => number | null;
  /** the gap one step earlier (-1) or later (1), null when there is none */
  step: (i: number, dir: -1 | 1) => number | null;
  /** moves slide i's slides (and the sermon) to the gap; the new position of the first, or null */
  move: (i: number, gap: number) => number | null;
  /** false when the sermon is in a different order from the slides (they were moved before the sermon followed) */
  inStep: boolean;
  /** puts the sermon in the order of the slides */
  match: () => void;
}

/** Only the title slide is fixed (older saved slides also had the big idea pinned: that no longer holds). */
const fixed = (s: SlideSpec | undefined) => !!s?.pinned && s.kind === "title";
const itemOf = (items: SermonItem[], s: SlideSpec | undefined) => (s?.from ? items.find((i) => i.id === s.from) : undefined);
const isHead = (items: SermonItem[], s: SlideSpec | undefined) => itemOf(items, s)?.type === "heading";
const pinCount = (slides: SlideSpec[]) => {
  let n = 0;
  while (n < slides.length && fixed(slides[n])) n++;
  return n;
};

/** The slides that move with slide `i`. A point's slide takes the slides of its own part with it;
 * any other slide takes the rest of the same item's slides (a passage over several slides). */
export function unitOf(slides: SlideSpec[], items: SermonItem[], i: number): Range | null {
  const s = slides[i];
  if (!s || fixed(s)) return null;
  const it = itemOf(items, s);
  if (it?.type === "heading") {
    const part = partsOf(items).find((p) => p.head?.id === it.id);
    let e = i + 1;
    for (; e < slides.length; e++) {
      const n = slides[e];
      if (fixed(n)) break;
      const ni = itemOf(items, n);
      if (!ni) continue; // the preacher's own slide: it stays with the point above it
      if (ni.type === "heading") break;
      const at = items.indexOf(ni);
      if (!part || at < part.start || at >= part.end) break;
    }
    return [i, e];
  }
  if (it && s.from) {
    let a = i;
    let b = i + 1;
    while (a > 0 && slides[a - 1].from === s.from) a--;
    while (b < slides.length && slides[b].from === s.from) b++;
    return [a, b];
  }
  return [i, i + 1];
}

/** Where a point can be dropped: before any point's slide, or after the last point's slides. */
function pointGaps(slides: SlideSpec[], items: SermonItem[]): number[] {
  const heads = slides.flatMap((s, i) => (!fixed(s) && isHead(items, s) ? [i] : []));
  if (heads.length === 0) return [];
  return [...heads, unitOf(slides, items, heads[heads.length - 1])![1]];
}

/** Where a drop at `gap` really lands for slide `i`'s slides: a point only between points, and
 * nothing into the middle of another passage's slides, or above the title slides. Null when that
 * is where they already are. */
export function dropGap(slides: SlideSpec[], items: SermonItem[], i: number, gap: number): number | null {
  const u = unitOf(slides, items, i);
  if (!u) return null;
  let g = Math.min(Math.max(gap, pinCount(slides)), slides.length);
  if (isHead(items, slides[i])) {
    const marks = pointGaps(slides, items);
    if (marks.length === 0) return null;
    g = marks.reduce((best, m) => (Math.abs(m - g) < Math.abs(best - g) ? m : best), marks[0]);
  } else if (g > 0 && g < slides.length && slides[g - 1].from && slides[g - 1].from === slides[g].from && !isHead(items, slides[g])) {
    const inside = unitOf(slides, items, g)!;
    g = g - inside[0] <= inside[1] - g ? inside[0] : inside[1];
  }
  return g >= u[0] && g <= u[1] ? null : g;
}

/** The gap one step earlier (-1) or later (1) for slide `i`'s slides: they swap places with what
 * is next to them. Null when they are already first or last. */
export function stepGap(slides: SlideSpec[], items: SermonItem[], i: number, dir: -1 | 1): number | null {
  const u = unitOf(slides, items, i);
  if (!u) return null;
  if (isHead(items, slides[i])) {
    const marks = pointGaps(slides, items);
    const g = dir < 0 ? marks.filter((m) => m < u[0]).pop() : marks.find((m) => m > u[1]);
    return g === undefined ? null : g;
  }
  if (dir < 0) {
    const p = slides[u[0] - 1];
    if (!p || fixed(p)) return null;
    return isHead(items, p) ? u[0] - 1 : unitOf(slides, items, u[0] - 1)![0];
  }
  const n = slides[u[1]];
  if (!n) return null;
  return isHead(items, n) ? u[1] + 1 : unitOf(slides, items, u[1])![1];
}

/** The slides with the unit `u` moved to `gap` (which is outside it), and where it starts now. */
export function moveSlides(slides: SlideSpec[], u: Range, gap: number): { slides: SlideSpec[]; at: number } {
  const unit = slides.slice(u[0], u[1]);
  const rest = [...slides.slice(0, u[0]), ...slides.slice(u[1])];
  const at = gap > u[1] ? gap - unit.length : gap;
  return { slides: [...rest.slice(0, at), ...unit, ...rest.slice(at)], at };
}

/** Where in the sermon an item goes so that the slides made from it come out in the order they were dropped in.
 * `prev` is the sermon item whose slide the item's slide now follows (null: it is first), `bearing` the ids of the items that
 * have slides. After another item it goes straight after it. Straight under a point's heading it goes at the start of the
 * section that takes it (Scripture for a passage) when that section starts before the point's first slide, else straight after
 * the heading: a point keeps Scripture, then its own words, then pictures, so a picture dropped above a passage cannot go into its
 * usual section without the slide going back to where it was. First of all it goes before the first thing the slides show. */
function slotFor(rest: SermonItem[], it: SermonItem, prev: SermonItem | null, bearing: Set<string>): number {
  const roles = rolesFor(it.type === "material" ? it.material.kind : it.type === "media" ? it.media.kind : "link");
  if (prev && prev.type !== "heading") return rest.findIndex((x) => x.id === prev.id) + 1;
  if (prev) {
    const part = partsOf(rest).find((p) => p.head?.id === prev.id);
    const headAt = rest.findIndex((x) => x.id === prev.id);
    let first = part ? part.end : rest.length;
    for (let k = headAt + 1; part && k < part.end; k++) {
      if (bearing.has(rest[k].id)) {
        first = k;
        break;
      }
    }
    const at = placeAtStart(rest, roles, prev.id);
    return at <= first ? at : headAt + 1;
  }
  const first = rest.findIndex((x) => bearing.has(x.id));
  return first >= 0 ? first : placeAtStart(rest, roles, partsOf(rest)[0]?.head?.id ?? null);
}

/** The sermon's items after the same move: `slides` are the slides as they were, `u` the unit that
 * moves and `gap` where it goes. Slides that are not from the sermon change nothing. */
export function moveInSermon(items: SermonItem[], slides: SlideSpec[], u: Range, gap: number): SermonItem[] {
  const it = itemOf(items, slides[u[0]]);
  if (!it) return items;
  const { slides: after, at } = moveSlides(slides, u, gap);
  if (it.type === "heading") {
    // before the next point that follows it, else after the last point
    const next = after.slice(at + (u[1] - u[0])).find((s) => isHead(items, s));
    return movePoint(items, it.id, next?.from ?? null);
  }
  if (it.type !== "material" && it.type !== "media") return items;
  const rest = items.filter((x) => x.id !== it.id);
  const bearing = new Set(slides.flatMap((x) => (x.from && x.from !== it.id ? [x.from] : [])));
  // the sermon's own item that the slide now follows
  let prev: SermonItem | undefined;
  for (let k = at - 1; k >= 0 && !prev; k--) {
    if (fixed(after[k])) break;
    prev = itemOf(rest, after[k]);
  }
  const index = slotFor(rest, it, prev ?? null, bearing);
  return [...rest.slice(0, index), it, ...rest.slice(index)];
}

/** The points in the order of `headIds`: the places held by points that have slides are refilled in
 * that order (a point moves with everything under it); every other part stays where it is. */
function orderPoints(items: SermonItem[], headIds: string[]): SermonItem[] {
  const parts = partsOf(items);
  const slots = parts.flatMap((p, i) => (p.kind === "point" && p.head && headIds.includes(p.head.id) ? [i] : []));
  const wanted = headIds.filter((id) => slots.some((i) => parts[i].head?.id === id));
  const next = [...parts];
  slots.forEach((slot, k) => (next[slot] = parts.find((p) => p.head?.id === wanted[k])!));
  return next.flatMap((p) => items.slice(p.start, p.end));
}

/** The sermon put in the order of the slides: the points in the slides' order (each with everything
 * under it), and each passage or picture in the point whose slides it comes after, in the slides' order.
 * What the slides don't show (sections, notes, commentary) stays with its point, and what is already
 * in the right place is not touched. Slides that are not from the sermon are ignored. */
export function syncSermon(items: SermonItem[], slides: SlideSpec[]): SermonItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  // the sermon items the slides show, in the slides' order, once each
  const order: SermonItem[] = [];
  const seen = new Set<string>();
  for (const s of slides) {
    const it = s.from ? byId.get(s.from) : undefined;
    if (!it || seen.has(it.id) || (it.type !== "heading" && it.type !== "material" && it.type !== "media")) continue;
    seen.add(it.id);
    order.push(it);
  }
  const heads = new Set(order.filter((i) => i.type === "heading").map((i) => i.id));
  let cur = orderPoints(items, [...heads]);
  /** the point (one that has slides) an item is under, going by where it is in the list */
  const headBefore = (id: string) => {
    for (let k = cur.findIndex((x) => x.id === id) - 1; k >= 0; k--) if (heads.has(cur[k].id)) return cur[k].id;
    return null;
  };
  let head: string | null = null;
  let prev: SermonItem | null = null;
  for (const it of order) {
    if (it.type === "heading") {
      head = it.id;
    } else {
      const placed = headBefore(it.id) === head && (!prev || cur.findIndex((x) => x.id === prev!.id) < cur.findIndex((x) => x.id === it.id));
      if (!placed) {
        const rest = cur.filter((x) => x.id !== it.id);
        const index = slotFor(rest, it, prev, new Set(order.filter((x) => x.id !== it.id).map((x) => x.id)));
        cur = [...rest.slice(0, index), it, ...rest.slice(index)];
      }
    }
    prev = it;
  }
  return cur;
}

/** Does the sermon already follow the order of the slides? */
export function sermonFollows(items: SermonItem[], slides: SlideSpec[]): boolean {
  const next = syncSermon(items, slides);
  return next.every((x, i) => x.id === items[i].id);
}
