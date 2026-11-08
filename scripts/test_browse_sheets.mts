// Browse: the children's sheet (word search, memory verse with blanks, the sheet blocks). Run: node --no-warnings scripts/test_browse_sheets.mts
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { blankOut, kidsSheetBlocks, levelFor, readWord, wordSearch } from "../src/browse/sheets.ts";
import { parseRef } from "../src/browse/browseLogic.ts";

let bad = 0;
const fail = (m: string) => {
  bad++;
  console.log("FAIL " + m);
};

// the word search
for (const level of ["easy", "medium", "hard"] as const) {
  const ws = wordSearch(["BOAT", "LAKE", "STORM", "WIND", "WAVES", "JESUS"], level, "demo");
  if (ws.placed.length !== 6) fail(`${level}: placed ${ws.placed.length} of 6`);
  for (const p of ws.placed) if (readWord(ws, p) !== p.word) fail(`${level}: ${p.word} is not in the grid where it was placed`);
  if (ws.grid.some((r) => r.length !== ws.size) || ws.grid.length !== ws.size) fail(`${level}: grid is not square`);
  if (ws.grid.flat().some((c) => !/^[A-Z]$/.test(c))) fail(`${level}: a cell is not a capital letter`);
  const allowed = level === "easy" ? ["0,1", "1,0"] : level === "medium" ? ["0,1", "1,0", "1,1"] : null;
  if (allowed && ws.placed.some((p) => !allowed.includes(`${p.dr},${p.dc}`))) fail(`${level}: a word runs in a direction this level does not use`);
  const again = wordSearch(["BOAT", "LAKE", "STORM", "WIND", "WAVES", "JESUS"], level, "demo");
  if (JSON.stringify(again) !== JSON.stringify(ws)) fail(`${level}: the same words and seed gave a different grid`);
}
const hard = wordSearch(["A", "AB", "SHEEP"], "hard", "x");
if (hard.placed.length !== 3) fail("short words not placed");
if (wordSearch([], "easy", "x").size !== 0) fail("no words should give an empty grid");
if (wordSearch(["boat", "Boat", "b0at"], "easy", "x").placed.length !== 2) fail("words are made capitals, doubles are dropped, other characters are removed");

// blanks
const b = blankOut("When I am afraid, I will trust in You.", ["afraid", "trust"]);
if (b.text !== "When I am _________, I will ________ in You." ) fail(`blankOut text: ${b.text}`);
if (JSON.stringify([...b.bank].sort()) !== JSON.stringify(["afraid", "trust"])) fail("blankOut bank");
if (blankOut("He is not here.", ["risen"]).blanked.length !== 0) fail("a hint that is not in the verse is skipped");
if (blankOut("The wind and the winds", ["wind"]).text.indexOf("winds") < 0) fail("only a whole word is blanked");

// the real pages
const db = new DatabaseSync(new URL("../src-tauri/resources/bible.db", import.meta.url), { readOnly: true });
const verseOf = (ref: string): string => {
  const r = parseRef(ref)!;
  const row = db
    .prepare("SELECT v.text FROM verses v JOIN books b ON b.id=v.book_id JOIN versions ver ON ver.id=v.version_id WHERE ver.code='BSB' AND b.name=? AND v.chapter=? AND v.verse=?")
    .get(r.book, r.chapter, r.verse) as { text: string } | undefined;
  return row?.text ?? "";
};
const pages = JSON.parse(readFileSync(new URL("../src/browse/data/children.json", import.meta.url), "utf8")).pages;
for (const page of pages) {
  const ws = wordSearch(page.words, levelFor(page.age), page.id);
  if (ws.placed.length !== new Set(page.words).size) fail(`${page.id}: not every word is in the word search`);
  if (ws.size > 14) fail(`${page.id}: the word search is ${ws.size} wide (14 at most, to print well)`);
  const verse = verseOf(page.memory.ref);
  if (!verse) fail(`${page.id}: memory verse ${page.memory.ref} not found in the BSB`);
  const bl = blankOut(verse, page.memory.blanks_hint ?? []);
  if (bl.blanked.length !== (page.memory.blanks_hint ?? []).length) fail(`${page.id}: the blank words ${JSON.stringify(page.memory.blanks_hint)} are not all in the BSB verse "${verse}"`);
  const blocks = kidsSheetBlocks(page, { verse, search: { src: "data:,", width: 10, height: 10 }, searchAnswers: { src: "data:,", width: 10, height: 10 }, answers: true });
  const kinds = blocks.map((x) => x.kind);
  if (kinds[0] !== "title" || !kinds.includes("image") || kinds.filter((k) => k === "lines").length !== 3) fail(`${page.id}: the sheet is missing a part`);
  const plain = kidsSheetBlocks(page, { verse, search: null, searchAnswers: null, answers: false });
  if (JSON.stringify(plain).includes("Answer key")) fail(`${page.id}: the answer key shows when it was not asked for`);
  if (!JSON.stringify(blocks).includes("Answer key")) fail(`${page.id}: the answer key is missing when asked for`);
}

console.log(bad ? `${bad} problem(s)` : `browse sheets: all checks passed (${pages.length} children's pages)`);
process.exit(bad ? 1 : 0);
