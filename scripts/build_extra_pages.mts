// Makes the file behind the phone's "Fetch additional stories" button: new Bible stories, "Verses for..." pages and children's pages that are added
// WITHOUT a new version of the app.
//
//   node --no-warnings scripts/build_extra_pages.mts <folder> [--out <file>] [--revision <label>]
//
// <folder> holds the new pages in exactly the format of src/browse/data (a folder with stories.json, topics.json and/or children.json, each
// {"format": 1, "tags": [...], "pages": [...]}, and optionally keywords.json: {"stories": {"<id>": ["word", ...]}, "topics": {...}}).
// Every page must be "approved" (review.status). The pages are checked with the SAME rules the pages inside the app pass (scripts/test_browse.mts, with the
// Bibles and the people and places data) and with the phone's own check (mobile/src/extraValidate.ts). Only when all of that passes is the file written
// (default installer/packs/extra-pages.json, which is not part of the repository). Publishing it is a separate step (it is printed at the end, not run).
//
// Notes: the new pages are added after the built-in ones; an id the app already has is refused here (the built-in page would stay anyway). The phone shows
// no picture for a new page (the picture downloads are the pages the app was made with). Pictures are not required for new pages.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExtraPages } from "../mobile/src/extraValidate.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const folder = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!folder || !existsSync(folder)) {
  console.error("Usage: node --no-warnings scripts/build_extra_pages.mts <folder with stories.json / topics.json / children.json> [--out <file>] [--revision <label>]");
  process.exit(2);
}
const dir = resolve(folder);
const out = resolve(option("--out") ?? here("../installer/packs/extra-pages.json"));
const revision = option("--revision") ?? new Date().toISOString().slice(0, 16).replace("T", " ");

type Any = Record<string, any>;
const load = (name: string): Any | null => {
  const file = `${dir}/${name}.json`;
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.error(`${name}.json is not valid JSON: ${e}`);
    process.exit(1);
  }
};
const stories = load("stories");
const topics = load("topics");
const children = load("children");
const keywords = load("keywords");
if (!stories && !topics && !children) {
  console.error("The folder has no stories.json, topics.json or children.json.");
  process.exit(1);
}

const problems: string[] = [];

// 1. the same rules as the pages inside the app (every page of the folder is checked as if it were already in the data)
console.log("Checking the pages against the app's rules (the Bibles, the writing rules, the links between pages)...");
const run = spawnSync(process.execPath, ["--no-warnings", here("test_browse.mts")], { env: { ...process.env, BROWSE_EXTRA: dir }, encoding: "utf-8" });
process.stdout.write((run.stdout ?? "").split("\n").filter((l) => !/has no hidden search words|have no picture yet|no picture/.test(l)).join("\n"));
if (run.status !== 0) {
  process.stderr.write(run.stderr ?? "");
  console.error("\nThe pages do not pass the app's rules. Nothing was written.");
  process.exit(1);
}

// 2. only approved pages go out
const pages = (f: Any | null): Any[] => (f && Array.isArray(f.pages) ? f.pages : []);
for (const [kind, f] of [["story", stories], ["topic", topics], ["child", children]] as const) {
  if (f && f.format !== 1) problems.push(`${kind}: the file's format must be 1`);
  for (const p of pages(f)) if (p.review?.status !== "approved") problems.push(`${kind} ${p.id}: is not approved (review.status must be "approved" before it goes out)`);
}

// 3. the hidden search words: short, and for pages that exist (in the app or in this folder)
const known = {
  stories: new Set<string>([...(JSON.parse(readFileSync(here("../src/browse/data/stories.json"), "utf-8")).pages as Any[]).map((p) => p.id), ...pages(stories).map((p) => p.id)]),
  topics: new Set<string>([...(JSON.parse(readFileSync(here("../src/browse/data/topics.json"), "utf-8")).pages as Any[]).map((p) => p.id), ...pages(topics).map((p) => p.id)]),
};
const theirs = { stories: new Set(pages(stories).map((p) => p.id)), topics: new Set(pages(topics).map((p) => p.id)) };
for (const group of ["stories", "topics"] as const) {
  for (const [id, list] of Object.entries((keywords?.[group] ?? {}) as Record<string, string[]>)) {
    const where = `keywords ${group} ${id}`;
    if (!known[group].has(id)) problems.push(`${where}: is not the id of a page`);
    else if (!theirs[group].has(id)) problems.push(`${where}: is a page that is already in the app (search words are only added for the new pages)`);
    if (!Array.isArray(list) || list.length < 1 || list.length > 20) problems.push(`${where}: needs 1 to 20 words`);
    for (const w of Array.isArray(list) ? list : []) if (typeof w !== "string" || !w.trim() || w.length > 40 || /https?:|@|[\\/]/.test(w)) problems.push(`${where}: "${w}" is not a short word or phrase`);
  }
}

// 4. the file, and the phone's own check of it
const file = { format: 1, revision, stories: pages(stories), topics: pages(topics), children: pages(children), keywords: { stories: keywords?.stories ?? {}, topics: keywords?.topics ?? {} } };
const text = JSON.stringify(file);
const checked = parseExtraPages(text);
for (const s of checked.skipped) problems.push(`the phone would leave out ${s.where}: ${s.why}`);
const total = file.stories.length + file.topics.length + file.children.length;
if (total === 0) problems.push("there are no pages in the folder");
if (total > 1000) problems.push(`${total} pages (the phone takes at most 1000)`);
if (Buffer.byteLength(text) > 6 << 20) problems.push(`the file is ${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB (the phone takes at most 6 MB)`);

if (problems.length) {
  for (const p of problems) console.error("  PROBLEM: " + p);
  console.error(`\n${problems.length} problem(s). Nothing was written.`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
const sha = createHash("sha256").update(text).digest("hex");
console.log(`\nWrote ${out}`);
console.log(`  ${file.stories.length} stories, ${file.topics.length} "Verses for..." pages, ${file.children.length} children's pages; ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB; sha-256 ${sha}`);
console.log("\nTo put it where the phone looks (NOT done by this script; do it only when you mean to publish):");
console.log('  first time:  gh release create extra-pages "' + out + '" --repo BadBull22/bible --title "Additional stories" --notes "Additional Bible stories, verse pages and children\'s pages for the phone app." --latest=false');
console.log('  after that:  gh release upload extra-pages "' + out + '" --repo BadBull22/bible --clobber');
console.log("The file must be called extra-pages.json. Every phone gets the new pages the next time its reader presses \"Fetch additional stories\".");
