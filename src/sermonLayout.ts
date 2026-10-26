// How a sermon's items hang together on screen, and where something added belongs.
//
// A sermon is a flat list of items (sermon.ts). Read as a page it has parts: a section of
// its own (a level-1 block such as Introduction, with what follows it), or a point (a
// heading, with its level-2 sections -- Scripture, Explain, Illustrate... -- and what follows
// each). What the preacher adds goes into the section whose role takes it: Scripture into
// Scripture, commentary into Explain, a story into Illustrate.

import type { Material, MaterialKind, SermonItem } from "./sermon";
import type { MediaKind } from "./sermonMedia";
import type { Role } from "./sermonTemplates";

export interface Part {
  /** the item that starts it (a heading or a level-1 block); none for what comes before any */
  head: SermonItem | null;
  kind: "point" | "section" | "loose";
  /** where it is in the list: [start, end) */
  start: number;
  end: number;
}

export interface Slot {
  /** the section (a block), or the part's head when there is no section to hold it */
  block: SermonItem | null;
  /** the items held: indexes into the list */
  members: number[];
  /** where the slot ends in the list (an item added to it goes here) */
  end: number;
}

const startsPart = (i: SermonItem) => i.type === "heading" || (i.type === "block" && i.level === 1);

/** The sermon's parts, in order. */
export function partsOf(items: SermonItem[]): Part[] {
  const out: Part[] = [];
  let cur: Part | null = null;
  items.forEach((it, n) => {
    if (startsPart(it)) {
      if (cur) cur.end = n;
      cur = { head: it, kind: it.type === "heading" ? "point" : "section", start: n, end: items.length };
      out.push(cur);
    } else if (!cur) {
      cur = { head: null, kind: "loose", start: n, end: items.length };
      out.push(cur);
    }
  });
  if (cur) (cur as Part).end = items.length;
  return out;
}

/** A part's sections and what each holds. The first slot is the part's own (its head, or
 * what comes before its first section). */
export function slotsOf(items: SermonItem[], part: Part): Slot[] {
  const slots: Slot[] = [{ block: part.head, members: [], end: part.head ? part.start + 1 : part.start }];
  for (let n = part.head ? part.start + 1 : part.start; n < part.end; n++) {
    const it = items[n];
    if (it.type === "block") slots.push({ block: it, members: [], end: n + 1 });
    else {
      const s = slots[slots.length - 1];
      s.members.push(n);
      s.end = n + 1;
    }
  }
  return slots;
}

/** The sections something belongs in, best first. */
export function rolesFor(kind: MaterialKind | MediaKind): Role[] {
  switch (kind) {
    case "passage":
    case "section":
    case "verse":
    case "xref":
      return ["scripture"];
    case "background":
    case "people":
      return ["context", "intro", "explain"];
    case "article":
      return ["explain", "context"];
    case "illustration":
    case "quote":
    case "image":
    case "video":
    case "audio":
    case "link":
    case "file":
      return ["illustrate", "story", "explain"];
    default:
      return ["explain", "story"];
  }
}

const roleOf = (i: SermonItem | null) => (i?.type === "block" ? i.role : null);

/** Where an item for these sections goes: into the section the preacher is working in
 * (`focus`, a section or a part's head) when it is one of them -- or, in that part, its
 * section that takes it -- otherwise the first part whose section of that kind is still
 * empty, then the first that has one at all; failing that, the end of the part being worked
 * on, or of the sermon. */
export function placeFor(items: SermonItem[], roles: Role[], focus: string | null): number {
  const parts = partsOf(items);
  if (!parts.some((p) => p.head)) return items.length;
  const focusAt = focus ? items.findIndex((i) => i.id === focus) : -1;
  const focusPart = focusAt >= 0 ? parts.find((p) => focusAt >= p.start && focusAt < p.end) : undefined;
  const rank = (s: Slot) => {
    const r = roleOf(s.block);
    return r ? roles.indexOf(r) : -1;
  };
  if (focusPart) {
    const slots = slotsOf(items, focusPart);
    // the very section clicked, whatever it is: the preacher chose it
    const clicked = slots.find((s) => s.block?.id === focus && s.block?.type === "block");
    if (clicked) return clicked.end;
    // a point clicked: its section that takes it
    const fits = slots.filter((s) => rank(s) >= 0).sort((a, b) => rank(a) - rank(b));
    if (fits[0]) return fits[0].end;
    return focusPart.end;
  }
  for (const want of roles) {
    const all = parts.flatMap((p) => slotsOf(items, p)).filter((s) => roleOf(s.block) === want);
    const empty = all.find((s) => s.members.length === 0);
    if (empty) return empty.end;
    if (all[0]) {
      // all have something: the one with least in it
      return all.reduce((a, b) => (b.members.length < a.members.length ? b : a)).end;
    }
  }
  return items.length;
}

/** Where an item for these sections goes when it is to come FIRST in a part: at the start of the
 * part's section that takes it, else straight after the part's head. `headId` null: the first
 * part. An index into `items` as they are. */
export function placeAtStart(items: SermonItem[], roles: Role[], headId: string | null): number {
  const parts = partsOf(items);
  const part = headId === null ? parts[0] : parts.find((p) => p.head?.id === headId);
  if (!part) return items.length;
  if (!part.head) return part.start;
  const rank = (s: Slot) => {
    const r = s.block === part.head ? null : roleOf(s.block);
    return r ? roles.indexOf(r) : -1;
  };
  const fit = slotsOf(items, part)
    .filter((s) => rank(s) >= 0)
    .sort((a, b) => rank(a) - rank(b))[0];
  return fit?.block ? items.indexOf(fit.block) + 1 : part.start + 1;
}

/** The point whose Scripture covers a passage: the head of the part holding a `section` of
 * Scripture that overlaps `ref` (commentary on John 3:9-15 belongs with the point on John 3:9-15). */
export function pointOfRef(items: SermonItem[], ref: { book: string; chapter: number; verse: number; verseEnd: number }): string | null {
  for (const p of partsOf(items)) {
    if (!p.head) continue;
    for (let n = p.start; n < p.end; n++) {
      const it = items[n];
      if (it.type !== "material" || it.material.kind !== "section" || !it.material.ref) continue;
      const s = it.material.ref;
      if (s.book === ref.book && s.chapter === ref.chapter && s.verse <= ref.verseEnd && ref.verse <= s.verseEnd) return p.head.id;
    }
  }
  return null;
}

/** Where gathered material goes: where the preacher is working, else the point whose Scripture
 * it is about, else the first section that takes it. */
export function placeMaterial(items: SermonItem[], m: Material, focus: string | null): number {
  const home = focus ?? (m.ref && m.kind !== "section" ? pointOfRef(items, m.ref) : null);
  return placeFor(items, rolesFor(m.kind), home);
}

/** Moves a whole part (its head and everything under it) before another part, or to the end. */
export function movePart(items: SermonItem[], headId: string, beforeHeadId: string | null): SermonItem[] {
  const parts = partsOf(items);
  const from = parts.find((p) => (p.head?.id ?? "") === headId);
  if (!from || beforeHeadId === headId) return items;
  const block = items.slice(from.start, from.end);
  const rest = [...items.slice(0, from.start), ...items.slice(from.end)];
  const at = beforeHeadId ? rest.findIndex((i) => i.id === beforeHeadId) : rest.length;
  if (at < 0) return items;
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/** Moves a point (its heading and everything under it) before another point, or after the LAST
 * POINT: unlike `movePart`, the end is the end of the points, so a Conclusion stays last. */
export function movePoint(items: SermonItem[], headId: string, beforeHeadId: string | null): SermonItem[] {
  if (beforeHeadId) return movePart(items, headId, beforeHeadId);
  const from = partsOf(items).find((p) => p.head?.id === headId);
  if (!from) return items;
  const rest = [...items.slice(0, from.start), ...items.slice(from.end)];
  const last = partsOf(rest).filter((p) => p.kind === "point").pop();
  if (!last) return items;
  return [...rest.slice(0, last.end), ...items.slice(from.start, from.end), ...rest.slice(last.end)];
}

/** Moves one item to the end of a section (or of a part, by its head). */
export function moveIntoSlot(items: SermonItem[], itemId: string, slotId: string): SermonItem[] {
  if (itemId === slotId) return items;
  const item = items.find((i) => i.id === itemId);
  if (!item || startsPart(item) || item.type === "block") return items;
  const rest = items.filter((i) => i.id !== itemId);
  const parts = partsOf(rest);
  const at = rest.findIndex((i) => i.id === slotId);
  if (at < 0) return items;
  const part = parts.find((p) => at >= p.start && at < p.end);
  const slot = part && slotsOf(rest, part).find((s) => s.block?.id === slotId);
  const end = slot ? slot.end : at + 1;
  return [...rest.slice(0, end), item, ...rest.slice(end)];
}
