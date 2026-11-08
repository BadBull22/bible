// Browse: the printed story and topic pages, and the picture on the children's sheet. Run: node --no-warnings scripts/test_browse_print.mts
import { readFileSync } from "node:fs";
import { storyBlocks, topicBlocks } from "../src/browse/printBlocks.ts";
import { kidsSheetBlocks } from "../src/browse/sheets.ts";

let bad = 0;
const fail = (m: string) => {
  bad++;
  console.log("FAIL " + m);
};
const read = (n: string) => JSON.parse(readFileSync(new URL(`../src/browse/data/${n}.json`, import.meta.url), "utf8")).pages;
const text = (blocks: any[]) => JSON.stringify(blocks);

for (const s of read("stories")) {
  const b = storyBlocks(s, { [s.passages[0].ref]: "1 The words of the passage." });
  if (b[0].kind !== "title" || b[0].text !== s.title) fail(`${s.id}: the first block is not the title`);
  if (!text(b).includes("Read it in the Bible")) fail(`${s.id}: no passages heading`);
  for (const p of s.passages) if (!text(b).includes(p.ref)) fail(`${s.id}: passage ${p.ref} is not on the printed page`);
  if (!text(b).includes("The words of the passage")) fail(`${s.id}: the passage words asked for are missing`);
  if (s.lessons?.length && !s.lessons.every((l: string) => text(b).includes(l.slice(0, 40)))) fail(`${s.id}: a lesson is missing from the printed page`);
  if (s.doctrine === "needs_review" && !text(b).includes("Where Christians differ")) fail(`${s.id}: the flagged page does not print its neutral note`);
  if (s.doctrine !== "needs_review" && text(b).includes("Where Christians differ")) fail(`${s.id}: a plain page prints a differ box`);
  if (text(b).includes("undefined")) fail(`${s.id}: "undefined" on the printed page`);
  const plain = storyBlocks(s);
  if (plain.some((x: any) => x.kind === "quote" && x.runs?.[0]?.text?.startsWith("1 The words"))) fail(`${s.id}: passage words printed when not asked for`);
}
for (const t of read("topics")) {
  const b = topicBlocks(t);
  if (b[0].kind !== "title") fail(`${t.id}: the first block is not the title`);
  for (const i of t.items) if (!text(b).includes(i.ref) || !text(b).includes(i.note.slice(0, 30))) fail(`${t.id}: ${i.ref} or its note is missing`);
  if (t.doctrine === "needs_review" && !text(b).includes("Where Christians differ")) fail(`${t.id}: the flagged page does not print its neutral note`);
  if (text(b).includes("undefined")) fail(`${t.id}: "undefined" on the printed page`);
}

// the picture of a story: under the title, with its credit line
{
  const st = read("stories")[0];
  const withPic = storyBlocks(st, {}, { src: "data:image/png;base64,AAAA", width: 900, height: 700, caption: "A credit line." });
  if (withPic[2].kind !== "image" || (withPic[2] as any).caption !== "A credit line.") fail("the story picture is not right under the title");
  if (storyBlocks(st).some((b) => b.kind === "image")) fail("a story prints a picture when it has none");
}

// the pictures on the children's sheet: the colour picture small under the title, the outline on a page of its own after the sheet
{
  const kid = read("children")[0];
  const pic = { src: "data:image/png;base64,AAAA", width: 320, height: 240 };
  const line = { src: "data:image/png;base64,BBBB", width: 1500, height: 1100 };
  const base = { verse: "x", search: null, searchAnswers: null, answers: false };
  const small = kidsSheetBlocks(kid, { ...base, picture: pic });
  if (small[2].kind !== "image" || (small[2] as any).caption !== "" || (small[2] as any).layout) fail("the small picture is not right under the title");
  if (small.some((x: any) => x.layout === "page")) fail("a colouring page appears when it was not asked for");
  const both = kidsSheetBlocks(kid, { ...base, picture: pic, colouringPage: line, answers: true });
  const pages = both.filter((x: any) => x.kind === "image" && x.layout === "page");
  if (pages.length !== 1 || !(pages[0] as any).caption.startsWith("Colour this picture")) fail("the colouring page is missing or has no caption");
  if (both.findIndex((x: any) => x.layout === "page") > both.findIndex((x) => x.kind === "heading" && (x as any).text.startsWith("Answer key"))) fail("the colouring page must come before the answer key");
  const only = kidsSheetBlocks(kid, { ...base, colouringPage: line });
  if (only.filter((x) => x.kind === "image").length !== 1) fail("the colouring page alone should be the only picture");
  if (kidsSheetBlocks(kid, base).some((b) => b.kind === "image")) fail("a picture appears when there is none");
}

console.log(bad ? `${bad} problem(s)` : `browse print: all checks passed (${read("stories").length} stories, ${read("topics").length} topics)`);
process.exit(bad ? 1 : 0);
