// Records the owner's review marks in the data: a page marked Good at its current revision becomes `approved` (with the date of the mark).
// Usage: node --no-warnings scripts/apply_review.mts <marks.json>      (the marks as saved by the review mode: { "stories:the-creation": { verdict, comment, rev, date }, ... })
// A page marked Change or Remove, or rewritten after its mark, stays a draft and is listed. Nothing is released by this: it only records what he approved.

import { readFileSync, writeFileSync } from "node:fs";
import { put } from "./browse_json.mts";

const marksFile = process.argv[2];
if (!marksFile) {
  console.error("usage: apply_review.mts <marks.json>");
  process.exit(2);
}
const marks = JSON.parse(readFileSync(marksFile, "utf8")) as Record<string, { verdict: string; comment: string; rev: number; date: string }>;
let approved = 0;
const open: string[] = [];
for (const kind of ["stories", "topics", "children"] as const) {
  const url = new URL(`../src/browse/data/${kind}.json`, import.meta.url);
  const file = JSON.parse(readFileSync(url, "utf8"));
  for (const p of file.pages) {
    const m = marks[`${kind}:${p.id}`];
    if (!m) {
      open.push(`${kind}:${p.id} (not looked at yet)`);
      continue;
    }
    if (m.verdict === "good" && m.rev === p.review.rev) {
      if (p.review.status !== "approved") approved++;
      p.review = { status: "approved", rev: p.review.rev, date: m.date };
    } else {
      open.push(`${kind}:${p.id} (${m.verdict || "no verdict"}${m.rev !== p.review.rev ? ", page rewritten since the mark" : ""})`);
    }
  }
  writeFileSync(url, put(file, "") + "\n");
}
console.log(`${approved} page(s) newly approved; ${open.length} not approved:`);
for (const o of open) console.log("  " + o);
