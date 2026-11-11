// Sharing a Browse page: the page as text, set out like the page in the app so that its parts can be told apart in WhatsApp, an e-mail or a message: the
// title, the story or the intro, the boxes ("What this teaches us", "Where Christians differ", "The big idea"), and each Scripture reference with its words
// set apart as a quotation. Headings are in *bold* (WhatsApp shows it; an e-mail shows the asterisks, which still read as emphasis) and sections are
// divided by a line. When a picture goes with the page it is attached by the phone's share sheet and its credit line is written here. Pure (node tests it).

import type { ChildPage, Story, Topic } from "../../src/browse/types.ts";
import { ageLabel } from "../../src/browse/browseLogic.ts";

/** the words of one passage: its verses and the Bible they are from */
export interface PassageWords {
  verses: { verse: number; text: string }[];
  code: string;
}
/** the words that could be found, by reference (a reference with no entry is shared without its words) */
export type Words = Record<string, PassageWords | undefined>;

export interface ShareOptions {
  /** the credit line of the picture that is attached, if one is */
  pictureCredit?: string | null;
}

/** the closing line of everything that is shared */
export const FOOTER = "Bible Concordance · https://bible4me.org";
const BAR = "━━━━━━━━━━━━━━━━";

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number) => String(n).replace(/\d/g, (d) => SUP[Number(d)]);
const bold = (t: string) => `*${t}*`;
const clean = (t: string) => t.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();

/** a heading with the line above it that divides one part from the next, and what is in that part under it */
const part = (heading: string, ...body: string[]): string => [BAR, bold(heading), ...body].join("\n");

/** a passage: the reference in bold (with its label), then its words, then the Bible they are from; the reference alone when the words could not be found */
function passage(ref: string, words: Words, label?: string, note?: string): string {
  const out = [bold(ref) + (label ? ` · ${label}` : "")];
  if (note) out.push(note);
  const w = words[ref];
  if (w && w.verses.length > 0) {
    out.push("> " + w.verses.map((v) => `${sup(v.verse)} ${clean(v.text)}`).join(" "));
    out.push(`_${w.code}_`);
  }
  return out.join("\n");
}

/** the Christians-differ box, the way the page shows it (and "What our church teaches" when the owner wrote it) */
function differ(note?: string, teaching?: string): string[] {
  if (!note) return [];
  const out = [part("Where Christians differ", note)];
  if (teaching && teaching.trim()) out.push(part("What our church teaches", teaching.trim()));
  return out;
}

/** the blocks one after the other with a blank line between, then the closing line */
const finish = (blocks: string[]): string => [...blocks, `${BAR}\n${FOOTER}`].join("\n\n");

/** The text of a Bible story page. */
export function storyShareText(page: Story, words: Words, opts: ShareOptions = {}): string {
  const head = [bold(page.title.toUpperCase()), `Bible story · ${page.testament === "OT" ? "Old" : "New"} Testament`];
  if (page.also && page.also.length > 0) head.push(`Also called: ${page.also.join(", ")}`);
  if (opts.pictureCredit) head.push(`_Picture: ${opts.pictureCredit}_`);
  const blocks: string[] = [head.join("\n")];
  if (page.doctrine === "needs_review") blocks.push(...differ(page.doctrine_note, page.church_teaching));
  blocks.push(...page.summary.split("\n\n").map(clean));
  if (page.look_closer) blocks.push(`${bold("Look closer.")} ${clean(page.look_closer)}`);
  if (page.lessons && page.lessons.length > 0) blocks.push(part("What this teaches us", ...page.lessons.map((l) => `• ${clean(l)}`)));
  const passages = [...(page.context ? [page.context] : []), ...page.passages];
  passages.forEach((p, n) => blocks.push(n === 0 ? part("Read it in the Bible", passage(p.ref, words, p.label)) : passage(p.ref, words, p.label)));
  if (page.whole) blocks.push(`Read the whole story: ${page.whole}`);
  if (page.parallels && page.parallels.length > 0) blocks.push(`The same story in the other Gospels: ${page.parallels.join("; ")}`);
  if (page.also_read && page.also_read.length > 0) blocks.push(`Also read: ${page.also_read.join("; ")}`);
  return finish(blocks);
}

/** The text of a "Verses for..." page. */
export function topicShareText(page: Topic, words: Words, opts: ShareOptions = {}): string {
  const head = [bold(page.title.toUpperCase())];
  if (page.also && page.also.length > 0) head.push(`Also: ${page.also.join(", ")}`);
  if (opts.pictureCredit) head.push(`_Picture: ${opts.pictureCredit}_`);
  const blocks: string[] = [head.join("\n")];
  if (page.doctrine === "needs_review") blocks.push(...differ(page.doctrine_note, page.church_teaching));
  blocks.push(clean(page.intro));
  for (const i of page.items) {
    let one = passage(i.ref, words, undefined, clean(i.note));
    if (i.doctrine === "needs_review" && i.doctrine_note) one += `\n_Where Christians differ: ${clean(i.doctrine_note)}_`;
    blocks.push(one);
  }
  return finish(blocks);
}

/** The text of a children's page (its questions with their answers, which the page keeps folded away until they are tapped). */
export function childShareText(page: ChildPage, words: Words, opts: ShareOptions = {}): string {
  const head = [bold(page.title.toUpperCase()), `For children · ${ageLabel(page.age)}`];
  if (opts.pictureCredit) head.push(`_Picture: ${opts.pictureCredit}_`);
  const blocks: string[] = [head.join("\n")];
  if (page.doctrine === "needs_review") blocks.push(...differ(page.doctrine_note, page.church_teaching));
  blocks.push(...page.retelling.map(clean));
  blocks.push(part("The big idea", clean(page.message)));
  blocks.push(part("Read the real story together", passage(page.read_from, words)));
  blocks.push(part("Memory verse", passage(page.memory.ref, words)));
  blocks.push(part("Talk about it", ...page.questions.map((q, n) => `${n + 1}. ${clean(q.q)}\n    Answer: ${clean(q.a)}`)));
  if (page.try_this) blocks.push(part("Try this", clean(page.try_this)));
  return finish(blocks);
}

/** every reference whose words a page's text needs, in order, once each */
export function refsOf(page: Story | Topic | ChildPage): string[] {
  const out: string[] = [];
  const add = (r?: string) => r && !out.includes(r) && out.push(r);
  if ("passages" in page) {
    add(page.context?.ref);
    page.passages.forEach((p) => add(p.ref));
  } else if ("items" in page) {
    page.items.forEach((i) => add(i.ref));
  } else {
    add(page.read_from);
    add(page.memory.ref);
  }
  return out;
}
