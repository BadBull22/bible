// Merges a finished batch of Browse pages (research/browse-drafts/<dir>/<kind>.json) into src/browse/data/<kind>.json.
// Usage: node --no-warnings scripts/merge_browse_drafts.mts <stories|topics|children> <dir> [<dir> ...]
// The pages are added at the end (an id that already exists stops the merge); new tags are added to the file's tag list.
// Then run scripts/test_browse.mts: nothing is kept that does not pass it.

import { readFileSync, writeFileSync } from "node:fs";
import { put } from "./browse_json.mts";

const [kind, ...dirs] = process.argv.slice(2);
if (!["stories", "topics", "children"].includes(kind) || dirs.length === 0) {
  console.error("usage: merge_browse_drafts.mts <stories|topics|children> <dir> [<dir> ...]");
  process.exit(2);
}

const target = new URL(`../src/browse/data/${kind}.json`, import.meta.url);
const file = JSON.parse(readFileSync(target, "utf8"));

for (const dir of dirs) {
  const draft = JSON.parse(readFileSync(new URL(`../research/browse-drafts/${dir}/${kind}.json`, import.meta.url), "utf8"));
  const have = new Set(file.pages.map((p: { id: string }) => p.id));
  for (const p of draft.pages) {
    if (have.has(p.id)) throw new Error(`${kind}: ${p.id} is already in the data file`);
    file.pages.push(p);
    have.add(p.id);
  }
  if (file.tags) for (const t of draft.tags ?? []) if (!file.tags.includes(t)) file.tags.push(t);
  console.log(`${dir}: added ${draft.pages.length} page(s)`);
}


writeFileSync(target, put(file, "") + "\n");
console.log(`${kind}.json now holds ${file.pages.length} pages`);
