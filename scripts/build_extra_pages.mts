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
// Notes: the new pages are added after the built-in ones; an id the app already has is refused here (the built-in page would stay anyway). A new story
// MAY bring its picture: put <id>.jpg for each such story in a "pictures" folder beside stories.json, with a credits.json in the same folder ({"<id>":
// {"title","artist","credit","licence","licence_url","page", ...}}, the same fields as src/browse/pictures/stories/credits.json; the licence must be public
// domain or CC BY / CC BY-SA). The pictures travel inside the file (a JPEG of at most 600 KB each, at most 40) and the phone shows one under its story,
// whether or not the story-picture download is installed. Pictures are not required for new pages.
// A new CHILDREN'S page may bring its picture too, from a "child-pictures" folder: <id>.jpg (the picture), optionally <id>-outline.png (the same picture as
// black lines on white, to colour in; a PNG of at most 300 KB) and a credits.json written like the one above. The phone shows the picture under the title of
// the children's page, with a button to switch to the outline.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const theirs = { stories: new Set(pages(stories).map((p) => p.id)), topics: new Set(pages(topics).map((p) => p.id)), children: new Set(pages(children).map((p) => p.id)) };
for (const group of ["stories", "topics"] as const) {
  for (const [id, list] of Object.entries((keywords?.[group] ?? {}) as Record<string, string[]>)) {
    const where = `keywords ${group} ${id}`;
    if (!known[group].has(id)) problems.push(`${where}: is not the id of a page`);
    else if (!theirs[group].has(id)) problems.push(`${where}: is a page that is already in the app (search words are only added for the new pages)`);
    if (!Array.isArray(list) || list.length < 1 || list.length > 20) problems.push(`${where}: needs 1 to 20 words`);
    for (const w of Array.isArray(list) ? list : []) if (typeof w !== "string" || !w.trim() || w.length > 40 || /https?:|@|[\\/]/.test(w)) problems.push(`${where}: "${w}" is not a short word or phrase`);
  }
}

// 3b. the pictures that come with new stories (pictures/<id>.jpg and pictures/credits.json) and with new children's pages (child-pictures/<id>.jpg, an
// optional <id>-outline.png, and child-pictures/credits.json)
type Picture = { image: string; outline?: string; credit: Any };
function readPictures(folder: string, ids: Set<string>, what: string, withOutline: boolean): Record<string, Picture> {
  const found: Record<string, Picture> = {};
  const pdir = `${dir}/${folder}`;
  if (!existsSync(pdir)) return found;
  let credits: Any = {};
  try {
    credits = existsSync(`${pdir}/credits.json`) ? JSON.parse(readFileSync(`${pdir}/credits.json`, "utf-8")) : {};
  } catch (e) {
    problems.push(`${folder}/credits.json is not valid JSON: ${e}`);
  }
  for (const name of readdirSync(pdir).filter((n) => /\.(jpe?g)$/i.test(n))) {
    const id = name.replace(/\.jpe?g$/i, "");
    const where = `${folder}/${name}`;
    if (!ids.has(id)) {
      problems.push(`${where}: is not the id of one of the new ${what}`);
      continue;
    }
    const bytes = readFileSync(`${pdir}/${name}`);
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) problems.push(`${where}: is not a JPEG`);
    if (bytes.length > 600_000) problems.push(`${where}: is ${bytes.length} bytes (600,000 at most)`);
    const c = credits[id];
    if (!c) problems.push(`${where}: has no entry in ${folder}/credits.json`);
    else {
      for (const f of ["title", "artist", "credit", "licence", "licence_url", "page"]) if (typeof c[f] !== "string" || !c[f].trim()) problems.push(`${where}: the credit has no ${f}`);
      if (!/public domain|CC BY/i.test(String(c.licence ?? ""))) problems.push(`${where}: the licence "${c.licence}" is not one the app may carry (public domain, CC BY, CC BY-SA)`);
    }
    found[id] = { image: bytes.toString("base64"), credit: c ?? {} };
    const line = `${pdir}/${id}-outline.png`;
    if (withOutline && existsSync(line)) {
      const png = readFileSync(line);
      if (!(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47)) problems.push(`${folder}/${id}-outline.png: is not a PNG`);
      if (png.length > 300_000) problems.push(`${folder}/${id}-outline.png: is ${png.length} bytes (300,000 at most)`);
      found[id].outline = png.toString("base64");
    }
  }
  for (const id of Object.keys(credits)) if (!found[id]) problems.push(`${folder}/credits.json: has an entry for "${id}" without a ${id}.jpg`);
  if (Object.keys(found).length > 40) problems.push(`more than 40 pictures in ${folder} (the phone takes at most 40)`);
  return found;
}
const pictures = readPictures("pictures", theirs.stories, "stories", false);
const childPictures = readPictures("child-pictures", theirs.children, "children's pages", true);

// 4. the file, and the phone's own check of it
const file = { format: 1, revision, stories: pages(stories), topics: pages(topics), children: pages(children), keywords: { stories: keywords?.stories ?? {}, topics: keywords?.topics ?? {} }, ...(Object.keys(pictures).length ? { pictures } : {}), ...(Object.keys(childPictures).length ? { child_pictures: childPictures } : {}) };
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
console.log(`  ${file.stories.length} stories, ${file.topics.length} "Verses for..." pages, ${file.children.length} children's pages, ${Object.keys(pictures).length} story pictures, ${Object.keys(childPictures).length} children's pictures (${Object.values(childPictures).filter((p) => p.outline).length} with an outline); ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB; sha-256 ${sha}`);
console.log("\nTo put it where the phone looks (NOT done by this script; do it only when you mean to publish):");
console.log('  first time:  gh release create extra-pages "' + out + '" --repo BadBull22/bible --title "Additional stories" --notes "Additional Bible stories, verse pages and children\'s pages for the phone app." --latest=false');
console.log('  after that:  gh release upload extra-pages "' + out + '" --repo BadBull22/bible --clobber');
console.log("The file must be called extra-pages.json. Every phone gets the new pages the next time its reader presses \"Fetch additional stories\".");
