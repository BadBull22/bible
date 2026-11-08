// Browse: a story or a "Verses for..." page as study-sheet blocks, the same blocks the app prints, saves as Word and copies. Pure data (node tests it).

import type { SheetBlock } from "../api";
import type { Story, Topic } from "./types";

/** the words of a passage as a reader sees them (verse numbers inside), by reference, when the reader asked for them on the printed page */
export type Texts = Record<string, string>;

const para = (text: string): SheetBlock => ({ kind: "para", runs: [{ text }] });
const bold = (text: string): SheetBlock => ({ kind: "para", runs: [{ text, bold: true }] });
const italic = (text: string): SheetBlock => ({ kind: "para", runs: [{ text, italic: true }] });
const bullet = (text: string): SheetBlock => ({ kind: "para", runs: [{ text: "•  " + text }] });
const quote = (text: string): SheetBlock => ({ kind: "quote", runs: [{ text }] });

function differ(out: SheetBlock[], note?: string, teaching?: string) {
  if (!note) return;
  out.push({ kind: "subheading", text: "Where Christians differ" });
  out.push(italic(note));
  if (teaching && teaching.trim()) {
    out.push({ kind: "subheading", text: "What our church teaches" });
    out.push(para(teaching));
  }
}

/** a picture for the top of the page, with the line printed under it (who made it, the licence) */
export interface PagePicture {
  src: string;
  width: number;
  height: number;
  caption: string;
}

export function storyBlocks(page: Story, texts: Texts = {}, picture: PagePicture | null = null): SheetBlock[] {
  const out: SheetBlock[] = [];
  out.push({ kind: "title", text: page.title });
  out.push({ kind: "subtitle", text: `Bible story, ${page.testament === "OT" ? "Old" : "New"} Testament${page.also && page.also.length > 0 ? `. Also called: ${page.also.join(", ")}` : ""}` });
  if (picture) out.push({ kind: "image", src: picture.src, width: picture.width, height: picture.height, caption: picture.caption });
  if (page.doctrine === "needs_review") differ(out, page.doctrine_note, page.church_teaching);
  for (const p of page.summary.split("\n\n")) out.push(para(p));
  if (page.look_closer) {
    out.push({ kind: "subheading", text: "Look closer" });
    out.push(quote(page.look_closer));
  }
  if (page.lessons && page.lessons.length > 0) {
    out.push({ kind: "heading", text: "What this teaches us" });
    for (const l of page.lessons) out.push(bullet(l));
  }
  out.push({ kind: "heading", text: "Read it in the Bible" });
  const passages = [...(page.context ? [page.context] : []), ...page.passages];
  for (const p of passages) {
    out.push(bold(`${p.ref}: ${p.label}`));
    if (texts[p.ref]) out.push(quote(texts[p.ref]));
  }
  if (page.whole) out.push(para(`Read the whole story: ${page.whole}`));
  if (page.parallels && page.parallels.length > 0) out.push(para(`The same story in the other Gospels: ${page.parallels.join("; ")}`));
  if (page.also_read && page.also_read.length > 0) out.push(para(`Also read: ${page.also_read.join("; ")}`));
  return out;
}

export function topicBlocks(page: Topic, texts: Texts = {}): SheetBlock[] {
  const out: SheetBlock[] = [];
  out.push({ kind: "title", text: page.title });
  out.push({ kind: "subtitle", text: "Passages, and what each one says" });
  if (page.doctrine === "needs_review") differ(out, page.doctrine_note, page.church_teaching);
  out.push(para(page.intro));
  for (const i of page.items) {
    out.push(bold(i.ref));
    out.push(para(i.note));
    if (texts[i.ref]) out.push(quote(texts[i.ref]));
    if (i.doctrine === "needs_review" && i.doctrine_note) out.push(italic(`Where Christians differ: ${i.doctrine_note}`));
  }
  return out;
}
