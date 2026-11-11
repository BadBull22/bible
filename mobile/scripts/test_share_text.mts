// The text a Browse page is shared as (mobile/src/shareText.ts), checked on EVERY page that ships in the app:
//   node --no-warnings mobile/scripts/test_share_text.mts
// Each page is written out with its passages' words and without them (the words could not be found), and with and without a picture credit.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FOOTER, childShareText, refsOf, storyShareText, topicShareText, type Words } from "../src/shareText.ts";
import { parseRef } from "../../src/browse/browseLogic.ts";

const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/browse/data/${name}.json`, import.meta.url)), "utf-8")).pages as any[];
const stories = read("stories");
const topics = read("topics");
const children = read("children");

const problems: string[] = [];
const bad = (where: string, msg: string) => problems.push(`${where}: ${msg}`);

/** invented words for a reference: a verse for each number in its range, so the text can be checked for numbers and order */
const wordsFor = (refs: string[]): Words => {
  const w: Words = {};
  for (const r of refs) {
    const p = parseRef(r)!;
    const verses = [];
    for (let v = p.verse; v <= Math.min(p.verseEnd, p.verse + 12); v++) verses.push({ verse: v, text: `Words of ${p.book} ${p.chapter}:${v}\nover two lines.` });
    w[r] = { verses, code: "BSB" };
  }
  return w;
};

function common(where: string, text: string, page: any, refs: string[], withWords: boolean) {
  if (!text.startsWith(`*${page.title.toUpperCase()}*`)) bad(where, "does not start with the title in bold");
  if (!text.endsWith(FOOTER)) bad(where, "does not end with the footer line");
  if (/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(text)) bad(where, "has a stray undefined/NaN/null");
  if (/Easter/i.test(text)) bad(where, 'says "Easter"');
  if (/\n{3,}/.test(text)) bad(where, "has more than one blank line in a row");
  if (/[ \t]+\n/.test(text)) bad(where, "has a space at the end of a line");
  if (/\*\*|\* \*/.test(text)) bad(where, "has broken bold markers");
  for (const r of refs) {
    if (!text.includes(`*${r}*`)) bad(where, `the reference ${r} is not written out in bold`);
    const quoted = text.includes("> ") && text.includes(`Words of ${r.replace(/:\d+(-\d+)?$/, ":")}`);
    if (withWords && !quoted) bad(where, `the words of ${r} are missing`);
    if (!withWords && text.includes("Words of")) bad(where, "words appear that were not given");
  }
  if (withWords && !/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(text)) bad(where, "the verse numbers are missing");
  if (!withWords && /(^|\n)> /.test(text)) bad(where, "a quotation appears without words");
  if (page.doctrine === "needs_review" && !text.includes("*Where Christians differ*")) bad(where, "the Christians-differ box is missing");
  if (page.doctrine !== "needs_review" && text.includes("*Where Christians differ*")) bad(where, "a Christians-differ box on a page that has none");
}

let longest = 0;
for (const s of stories) {
  const refs = refsOf(s);
  for (const withWords of [true, false]) {
    const text = storyShareText(s, withWords ? wordsFor(refs) : {}, { pictureCredit: withWords ? "A painting, an artist. Public domain." : null });
    const where = `story ${s.id}${withWords ? "" : " (no words)"}`;
    common(where, text, s, refs, withWords);
    longest = Math.max(longest, text.length);
    for (const h of ["*Read it in the Bible*"]) if (!text.includes(h)) bad(where, `${h} is missing`);
    if (s.lessons?.length && !text.includes("*What this teaches us*")) bad(where, "the lessons box is missing");
    if (s.lessons?.length && s.lessons.some((l: string) => !text.includes(`• ${l.replace(/\s+/g, " ").trim()}`))) bad(where, "a lesson is missing or not a bullet");
    for (const para of s.summary.split("\n\n")) if (!text.includes(para.replace(/\s+/g, " ").trim())) bad(where, "a paragraph of the story is missing");
    if (s.look_closer && !text.includes("*Look closer.*")) bad(where, "Look closer is missing");
    if (s.whole && !text.includes(`Read the whole story: ${s.whole}`)) bad(where, "the whole-story line is missing");
    if (s.parallels?.length && !text.includes("The same story in the other Gospels:")) bad(where, "the other Gospels line is missing");
    if (withWords && !text.includes("_Picture: A painting, an artist. Public domain._")) bad(where, "the picture credit is missing");
    if (!withWords && text.includes("_Picture:")) bad(where, "a picture credit appears that was not given");
    // the order the page has: title, (the Christians-differ box), the story, what this teaches us, the passages, the footer
    const order = [text.indexOf("*" + s.title.toUpperCase() + "*"), text.indexOf(s.summary.split("\n\n")[0].replace(/\s+/g, " ").trim()), s.lessons?.length ? text.indexOf("*What this teaches us*") : -2, text.indexOf("*Read it in the Bible*"), text.lastIndexOf(FOOTER)].filter((n) => n !== -2);
    if (order.some((n, i) => i > 0 && n <= order[i - 1])) bad(where, "the parts are not in the page's order");
  }
}
for (const t of topics) {
  const refs = refsOf(t);
  for (const withWords of [true, false]) {
    const text = topicShareText(t, withWords ? wordsFor(refs) : {});
    const where = `topic ${t.id}${withWords ? "" : " (no words)"}`;
    common(where, text, t, refs, withWords);
    longest = Math.max(longest, text.length);
    if (!text.includes(t.intro.replace(/\s+/g, " ").trim())) bad(where, "the intro is missing");
    for (const i of t.items) if (!text.includes(i.note.replace(/\s+/g, " ").trim())) bad(where, `the note on ${i.ref} is missing`);
  }
}
for (const c of children) {
  const refs = refsOf(c);
  for (const withWords of [true, false]) {
    const text = childShareText(c, withWords ? wordsFor(refs) : {});
    const where = `child ${c.id}${withWords ? "" : " (no words)"}`;
    common(where, text, c, refs, withWords);
    longest = Math.max(longest, text.length);
    for (const h of ["*The big idea*", "*Read the real story together*", "*Memory verse*", "*Talk about it*"]) if (!text.includes(h)) bad(where, `${h} is missing`);
    if ((text.match(/\n {4}Answer: /g) ?? []).length !== c.questions.length) bad(where, "a question has no answer under it");
    for (const q of c.questions) if (!text.includes(q.q.replace(/\s+/g, " ").trim())) bad(where, "a question is missing");
    for (const p of c.retelling) if (!text.includes(p.replace(/\s+/g, " ").trim())) bad(where, "a paragraph of the retelling is missing");
    if (c.try_this && !text.includes("*Try this*")) bad(where, "Try this is missing");
    if (!text.includes(c.age === "3-5" ? "Ages 3 to 5" : c.age === "6-8" ? "Ages 6 to 8" : "Ages 9 to 12")) bad(where, "the age is missing");
  }
}

// one page written out whole, so a person can read what is sent
const sample = stories.find((s: any) => s.id === "david-and-goliath") ?? stories[0];
const shown = storyShareText(sample, wordsFor(refsOf(sample).slice(0, 2)), { pictureCredit: "The picture's credit." });
if (process.argv.includes("--show")) console.log(shown + "\n");

// an empty page does not break the builder
const plain = storyShareText({ ...sample, also: undefined, look_closer: undefined, lessons: undefined, context: undefined, whole: undefined, parallels: undefined, also_read: undefined, doctrine: "plain" }, {});
if (/\*What this teaches us\*|\*Look closer/.test(plain)) bad("story without lessons", "has boxes that the page does not");

console.log(`share text: ${stories.length} stories, ${topics.length} topics, ${children.length} children's pages, each written with and without words (longest ${longest} characters)`);
if (problems.length) {
  for (const p of problems.slice(0, 40)) console.log("  PROBLEM: " + p);
  console.log(`share text: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("share text: all pages pass");
