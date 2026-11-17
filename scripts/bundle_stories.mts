// Moves stories and their children's pages out of a Story Studio batch folder and INTO the app (src/browse), with their pictures and credits.
// Usage: node --no-warnings scripts/bundle_stories.mts <batch folder> [--keep <story id> ...]
//   The batch holds every approved page. A story that has a children's page goes into the app together with that page (a story and its children's page are
//   always on the same side); the stories named after --keep stay out (they remain downloads), and so do stories with no children's page.
// Writes: src/browse/data/{stories,children,keywords}.json, src/browse/pictures/stories/<id>.jpg + credits.json,
//   src/browse/pictures/kids/<children's page id>.jpg + <id>-line.png (the outline to colour in) + credits.json.
// Then run scripts/test_browse.mts, and rebuild the extras file in the Studio (it leaves out whatever is built into the app).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "./browse_json.mts";

type Any = Record<string, any>;
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const batch = resolve(args[0] ?? "");
const keep = new Set<string>();
for (let i = 1; i < args.length; i++) if (args[i] === "--keep") keep.add(args[++i]);
if (!args[0] || !existsSync(join(batch, "stories.json"))) {
  console.error("usage: bundle_stories.mts <batch folder> [--keep <story id> ...]");
  process.exit(2);
}
const read = (p: string): Any => JSON.parse(readFileSync(p, "utf-8").replace(/^﻿/, ""));

const data = (name: string) => join(root, "src", "browse", "data", `${name}.json`);
const storiesFile = read(data("stories"));
const childrenFile = read(data("children"));
const keywordsFile = read(data("keywords"));
const bStories = read(join(batch, "stories.json"));
const bChildren = read(join(batch, "children.json"));
const bKeywords = existsSync(join(batch, "keywords.json")) ? read(join(batch, "keywords.json")) : { stories: {} };

const have = new Set((storiesFile.pages as Any[]).map((p) => p.id));
const haveKids = new Set((childrenFile.pages as Any[]).map((p) => p.id));
const going = (bStories.pages as Any[]).filter((p) => p.child_page && !keep.has(p.id) && !have.has(p.id));
const goingIds = new Set(going.map((p) => p.id));
const kids = (bChildren.pages as Any[]).filter((c) => goingIds.has(c.story) && !haveKids.has(c.id));
// every story goes with its children's page and the other way round
for (const s of going) if (!kids.some((c) => c.id === s.child_page)) throw new Error(`${s.id}: its children's page ${s.child_page} is not in the batch`);
for (const c of kids) if (!going.some((s) => s.child_page === c.id)) throw new Error(`${c.id}: its story is not going into the app`);

// a story in the app links only to stories that are in the app (a link to one that stays a download would lead nowhere)
for (const s of going) if (Array.isArray(s.related)) s.related = s.related.filter((id: string) => have.has(id) || goingIds.has(id));

// the pages
for (const t of bStories.tags ?? []) if (storiesFile.tags && !storiesFile.tags.includes(t)) storiesFile.tags.push(t);
storiesFile.pages.push(...going);
childrenFile.pages.push(...kids);
keywordsFile.stories ??= {};
for (const s of going) if (bKeywords.stories?.[s.id]) keywordsFile.stories[s.id] = bKeywords.stories[s.id];
writeFileSync(data("stories"), put(storiesFile, "") + "\n");
writeFileSync(data("children"), put(childrenFile, "") + "\n");
writeFileSync(data("keywords"), put(keywordsFile, "") + "\n");

// the pictures
const sDir = join(root, "src", "browse", "pictures", "stories");
const kDir = join(root, "src", "browse", "pictures", "kids");
mkdirSync(kDir, { recursive: true });
const sCredits = read(join(sDir, "credits.json"));
const bsCredits = existsSync(join(batch, "pictures", "credits.json")) ? read(join(batch, "pictures", "credits.json")) : {};
let sPics = 0;
for (const s of going) {
  const src = join(batch, "pictures", `${s.id}.jpg`);
  if (!existsSync(src) || !bsCredits[s.id]) continue;
  copyFileSync(src, join(sDir, `${s.id}.jpg`));
  sCredits[s.id] = bsCredits[s.id];
  sPics++;
}
writeFileSync(join(sDir, "credits.json"), JSON.stringify(sCredits, null, 1) + "\n");

const kCreditsPath = join(kDir, "credits.json");
const kCredits: Any = existsSync(kCreditsPath) ? read(kCreditsPath) : {};
const bkCredits = existsSync(join(batch, "child-pictures", "credits.json")) ? read(join(batch, "child-pictures", "credits.json")) : {};
let kPics = 0;
let outlines = 0;
for (const c of kids) {
  const src = join(batch, "child-pictures", `${c.id}.jpg`);
  if (!existsSync(src) || !bkCredits[c.id]) continue;
  copyFileSync(src, join(kDir, `${c.id}.jpg`));
  kCredits[c.id] = bkCredits[c.id];
  kPics++;
  const line = join(batch, "child-pictures", `${c.id}-outline.png`);
  if (existsSync(line)) {
    copyFileSync(line, join(kDir, `${c.id}-line.png`));
    outlines++;
  }
}
writeFileSync(kCreditsPath, JSON.stringify(kCredits, null, 1) + "\n");

console.log(`Bundled ${going.length} stories and ${kids.length} children's pages; ${sPics} story pictures, ${kPics} children's pictures, ${outlines} outlines.`);
const none = going.filter((s) => !existsSync(join(sDir, `${s.id}.jpg`))).map((s) => s.id);
if (none.length) console.log(`Stories without a picture: ${none.join(", ")}`);
console.log("Next: node --no-warnings scripts/test_browse.mts");
