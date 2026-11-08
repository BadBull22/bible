// The Browse data tests (research/browse-plan/browse_plan.md section 8). Every item is something a machine decides:
//   node scripts/test_browse.mts                 the data as it is now (drafts allowed: the owner reviews them in the running app)
//   BROWSE_RELEASE=1 node scripts/test_browse.mts   also refuses any page that is not approved (what a release build runs)
// It reads the Bibles in src-tauri/resources/bible.db and the people and places data in commentaries.db (read only).

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const bible = new DatabaseSync(here("../src-tauri/resources/bible.db"), { readOnly: true });
const study = new DatabaseSync(here("../src-tauri/resources/commentaries.db"), { readOnly: true });
const load = <T,>(name: string) => JSON.parse(readFileSync(here(`../src/browse/data/${name}.json`), "utf-8")) as { format: number; tags?: string[]; pages: T[] };
const release = process.env.BROWSE_RELEASE === "1";

type Any = Record<string, any>;
const stories = load<Any>("stories");
const topics = load<Any>("topics");
const children = load<Any>("children");

// BROWSE_EXTRA=<folder>: draft pages written elsewhere (a folder with stories.json, topics.json and/or children.json, each {"pages": [...]}
// and optionally "tags") are checked as if they were already in the data: this is how a batch is validated before it is merged.
const extra = process.env.BROWSE_EXTRA;
if (extra) {
  for (const [name, file] of [["stories", stories], ["topics", topics], ["children", children]] as const) {
    try {
      const x = JSON.parse(readFileSync(`${extra}/${name}.json`, "utf-8")) as { tags?: string[]; pages: Any[] };
      file.pages.push(...x.pages);
      file.tags = [...new Set([...(file.tags ?? []), ...(x.tags ?? [])])];
    } catch {
      /* this batch has no such file */
    }
  }
}

const problems: string[] = [];
const notes: string[] = [];
const bad = (where: string, msg: string) => problems.push(`${where}: ${msg}`);

// ---------------------------------------------------------------- the Bibles: which verses exist
const bookId = new Map<string, number>(bible.prepare("select id, name from books").all().map((r: Any) => [r.name as string, r.id as number]));
const versionId = new Map<string, number>(bible.prepare("select id, code from versions").all().map((r: Any) => [r.code as string, r.id as number]));
const verseStmt = bible.prepare("select 1 from verses where version_id = ? and book_id = ? and chapter = ? and verse = ?");
const has = (code: string, book: string, ch: number, v: number) => !!verseStmt.get(versionId.get(code)!, bookId.get(book)!, ch, v);

interface Ref {
  book: string;
  chapter: number;
  v1: number;
  v2: number;
}
/** "Book c:v" or "Book c:v1-v2" in the app's own spelling, one chapter; null if it is anything else. */
function parseRef(s: string): Ref | null {
  const m = /^(.+?) (\d+):(\d+)(?:-(\d+))?$/.exec(s);
  if (!m) return null;
  return { book: m[1], chapter: Number(m[2]), v1: Number(m[3]), v2: Number(m[4] ?? m[3]) };
}
const label = (r: Ref) => `${r.book} ${r.chapter}:${r.v1}${r.v2 !== r.v1 ? "-" + r.v2 : ""}`;

/** Checks one reference; returns it parsed. `codes` are the Bibles in which every verse must exist. */
function checkRef(where: string, s: string, codes: string[] = ["BSB"], maxVerses = 60): Ref | null {
  const r = parseRef(s);
  if (!r) return (bad(where, `"${s}" is not a reference in the form "Book c:v" or "Book c:v1-v2" (one chapter)`), null);
  if (!bookId.has(r.book)) return (bad(where, `"${s}": "${r.book}" is not a book name the app uses`), null);
  if (label(r) !== s) bad(where, `"${s}" is not written the canonical way (${label(r)})`);
  if (r.v2 < r.v1) bad(where, `"${s}": the end is before the start`);
  if (r.v2 - r.v1 + 1 > maxVerses) bad(where, `"${s}": more than ${maxVerses} verses`);
  for (const code of codes) {
    for (let v = r.v1; v <= r.v2; v++) {
      if (!has(code, r.book, r.chapter, v)) {
        // KJV and the others number a few verses differently: only the BSB is a hard failure for ranges
        (code === "BSB" ? bad : (w: string, m: string) => notes.push(`${w}: ${m}`))(where, `"${s}": verse ${v} is missing in the ${code}`);
        break;
      }
    }
  }
  return r;
}

const words = (s: string) => s.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const count = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const between = (where: string, what: string, n: number, lo: number, hi: number) => {
  if (n < lo || n > hi) bad(where, `${what} is ${n}, it must be ${lo} to ${hi}`);
};

// ---------------------------------------------------------------- structure
const idRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const all: { kind: string; file: Any; page: Any }[] = [];
for (const [kind, file] of [["story", stories], ["topic", topics], ["child", children]] as const) {
  if (file.format !== 1) bad(kind, "the file's format must be 1");
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const p of file.pages) {
    const where = `${kind} ${p.id}`;
    all.push({ kind, file, page: p });
    if (!idRe.test(p.id ?? "")) bad(where, "the id must be lower-case letters, digits and hyphens");
    if (ids.has(p.id)) bad(where, "the id is used twice");
    ids.add(p.id);
    if (!p.title || p.title.length > 60) bad(where, "the title is missing or longer than 60 characters");
    if (titles.has(p.title)) bad(where, "the title is used twice");
    titles.add(p.title);
    for (const t of p.tags ?? []) if (!(file.tags ?? []).includes(t)) bad(where, `the tag "${t}" is not in the file's list`);
    if (kind !== "child" && (!p.tags || p.tags.length < 1 || p.tags.length > 6)) bad(where, "tags must be 1 to 6");
    if (!["plain", "needs_review"].includes(p.doctrine)) bad(where, 'doctrine must be "plain" or "needs_review"');
    if (p.doctrine === "needs_review") between(where, "the doctrine note (words)", count(p.doctrine_note ?? ""), 1, 90);
    if (!p.review || !["draft", "approved"].includes(p.review.status)) bad(where, "review.status must be draft or approved");
    if (release && p.review?.status !== "approved") bad(where, "a release build may only hold approved pages");
  }
}
const storyIds = new Set<string>(stories.pages.map((p: Any) => p.id));
const topicIds = new Set<string>(topics.pages.map((p: Any) => p.id));
const childIds = new Set<string>(children.pages.map((p: Any) => p.id));
const mustExist = (where: string, what: string, ids: string[] | undefined, set: Set<string>) => {
  for (const id of ids ?? []) if (!set.has(id)) bad(where, `${what} "${id}" does not exist`);
};

// ---------------------------------------------------------------- stories
const OT_LAST = 39;
for (const s of stories.pages) {
  const where = `story ${s.id}`;
  between(where, "the summary (words)", count(s.summary ?? ""), 40, 170);
  if (s.look_closer) between(where, "look_closer (words)", count(s.look_closer), 1, 60);
  if (s.lessons) {
    between(where, "lessons (how many)", s.lessons.length, 1, 5);
    for (const l of s.lessons) between(where, "a lesson (words)", count(l), 8, 50);
  }
  if (s.also) between(where, "also (names)", s.also.length, 0, 6);
  if (!s.passages || s.passages.length < 1 || s.passages.length > 8) bad(where, "there must be 1 to 8 passages");
  const refs: Ref[] = [];
  for (const p of s.passages ?? []) {
    const r = checkRef(`${where} passage`, p.ref, ["BSB", "KJV"]);
    if (r) refs.push(r);
    if (!p.label) bad(where, `the passage ${p.ref} has no label`);
  }
  if (s.context) checkRef(`${where} context`, s.context.ref, ["BSB"]);
  for (const k of ["parallels", "also_read"]) for (const x of s[k] ?? []) checkRef(`${where} ${k}`, x, ["BSB"]);
  if (refs[0]) {
    const id = bookId.get(refs[0].book)!;
    const t = id <= OT_LAST ? "OT" : "NT";
    if (t !== s.testament) bad(where, `testament is ${s.testament} but ${refs[0].book} is in the ${t}`);
  }
  if (s.whole) {
    const w = checkRef(`${where} whole`, s.whole, ["BSB"], 200);
    if (w) for (const r of refs) if (r.book !== w.book || r.chapter !== w.chapter || r.v1 < w.v1 || r.v2 > w.v2) bad(where, `the passage ${label(r)} is not inside "whole" (${s.whole})`);
  }
  mustExist(where, "related story", s.related, storyIds);
  mustExist(where, "topic", s.topics, topicIds);
  if (s.child_page) {
    if (!childIds.has(s.child_page)) bad(where, `child_page "${s.child_page}" does not exist`);
    else if (children.pages.find((c: Any) => c.id === s.child_page).story !== s.id) bad(where, `the children's page "${s.child_page}" does not point back to this story`);
  }
  // people and places: they exist and are cited by a verse inside the story's chapters (never matched by name)
  const chapters = [...refs, ...((s.parallels ?? []) as string[]).map(parseRef).filter((r): r is Ref => !!r)];
  for (const [field, kind] of [["people", "person"], ["places", "place"]] as const) {
    for (const id of s[field] ?? []) {
      if (!study.prepare("select 1 from entities where kind = ? and id = ?").get(kind, id)) {
        bad(where, `${field} id "${id}" is not in the People & Places data`);
        continue;
      }
      const cited = chapters.some((r) => study.prepare("select 1 from entity_refs where kind = ? and entity_id = ? and book = ? and chapter = ?").get(kind, id, r.book, r.chapter));
      if (!cited) bad(where, `${field} id "${id}" is not cited by any verse in the story's chapters`);
    }
  }
}

// ---------------------------------------------------------------- topics
for (const t of topics.pages) {
  const where = `topic ${t.id}`;
  if (!/^Verses (for|on) /.test(t.title)) bad(where, 'the title must start "Verses for" or "Verses on"');
  between(where, "the intro (words)", count(t.intro ?? ""), 1, 60);
  between(where, "the number of passages", (t.items ?? []).length, 8, 12);
  const seen = new Set<string>();
  for (const it of t.items ?? []) {
    checkRef(`${where} item`, it.ref, ["BSB", "KJV"]);
    if (seen.has(it.ref)) bad(where, `${it.ref} appears twice`);
    seen.add(it.ref);
    between(where, `the note on ${it.ref} (words)`, count(it.note ?? ""), 1, 32);
    if (it.doctrine === "needs_review") between(where, `the doctrine note on ${it.ref} (words)`, count(it.doctrine_note ?? ""), 1, 90);
  }
  if (!t.dictionary) bad(where, "the dictionary query is missing");
  mustExist(where, "see_also topic", t.see_also, topicIds);
  mustExist(where, "story", t.stories, storyIds);
}

// ---------------------------------------------------------------- children's pages
const FREE = ["BSB", "KJV", "WEB", "ASV"];
const MAX_WORDS: Record<string, number> = { "3-5": 6, "6-8": 8, "9-12": 10 };
const MAX_SENTENCE: Record<string, number> = { "3-5": 12, "6-8": 12, "9-12": 16 };
for (const c of children.pages) {
  const where = `child ${c.id}`;
  if (!MAX_WORDS[c.age]) bad(where, 'age must be "3-5", "6-8" or "9-12"');
  const text: string = (c.retelling ?? []).join(" ");
  between(where, "the retelling (words)", count(text), 60, 220);
  const sentences = text.split(/[.!?]+["”]?\s+|[.!?]+["”]?$/).map((x) => x.trim()).filter(Boolean);
  const avg = count(text) / Math.max(1, sentences.length);
  if (avg > (MAX_SENTENCE[c.age] ?? 12)) bad(where, `the average sentence is ${avg.toFixed(1)} words, the limit for ages ${c.age} is ${MAX_SENTENCE[c.age]}`);
  // the big idea: a child can read it (short, in short sentences)
  between(where, "the message (words)", count(c.message ?? ""), 6, 35);
  const mSentences = (c.message ?? "").split(/[.!?]+["”]?\s+|[.!?]+["”]?$/).map((x: string) => x.trim()).filter(Boolean);
  if (mSentences.length < 1 || mSentences.length > 3) bad(where, "the message must be one to three sentences");
  if (count(c.message ?? "") / Math.max(1, mSentences.length) > (MAX_SENTENCE[c.age] ?? 12)) bad(where, `the message sentences are too long for ages ${c.age}`);
  checkRef(`${where} read_from`, c.read_from, ["BSB"], 200);
  const m = checkRef(`${where} memory`, c.memory?.ref ?? "", FREE, 1);
  if (m && m.v1 !== m.v2) bad(where, "the memory verse must be a single verse");
  between(where, "the number of questions", (c.questions ?? []).length, 3, 3);
  if (c.try_this) between(where, "try_this (words)", count(c.try_this), 1, 30);
  between(where, "the number of word search words", (c.words ?? []).length, 3, MAX_WORDS[c.age] ?? 6);
  for (const w of c.words ?? []) {
    if (!/^[A-Z]{3,10}$/.test(w)) bad(where, `the word-search word "${w}" must be 3 to 10 capital letters A to Z`);
    if (!text.toUpperCase().includes(w)) bad(where, `the word-search word "${w}" does not appear in the retelling`);
  }
  if (c.story) {
    if (!storyIds.has(c.story)) bad(where, `story "${c.story}" does not exist`);
    else if (stories.pages.find((s: Any) => s.id === c.story).child_page !== c.id) bad(where, `the story "${c.story}" does not point back to this children's page`);
  }
}

// ---------------------------------------------------------------- no URLs, e-mail addresses or paths; quotation marks
const textOf = (p: Any, kind: string): string[] => {
  const out: string[] = [];
  const add = (x?: string) => x && out.push(x);
  if (kind === "story") {
    add(p.summary); add(p.look_closer); for (const l of p.lessons ?? []) add(l); add(p.context?.label); for (const a of p.passages ?? []) add(a.label); for (const a of p.also ?? []) add(a); add(p.doctrine_note); add(p.church_teaching);
  } else if (kind === "topic") {
    add(p.intro); for (const i of p.items ?? []) { add(i.note); add(i.doctrine_note); } for (const a of p.also ?? []) add(a); add(p.doctrine_note); add(p.church_teaching);
  } else {
    for (const r of p.retelling ?? []) add(r); add(p.message); for (const q of p.questions ?? []) { add(q.q); add(q.a); } add(p.try_this); add(p.doctrine_note);
  }
  return out;
};
for (const { kind, page } of all) {
  for (const t of textOf(page, kind)) {
    if (/https?:|www\.|@[a-z0-9-]+\.|[A-Za-z]:\\/.test(t)) bad(`${kind} ${page.id}`, `contains a web address, e-mail address or file path: "${t.slice(0, 60)}"`);
    if (kind !== "child") for (const q of t.match(/“[^”]+”|"[^"]+"/g) ?? []) if (count(q) >= 6) notes.push(`${kind} ${page.id}: a quotation of ${count(q)} words, for a human look: ${q.slice(0, 70)}`);
  }
}

// ---------------------------------------------------------------- no run of 8 words copied from a bundled English Bible
const SHINGLE = 8;
const mine = new Map<string, string>(); // 8-word run -> the page it is in
for (const { kind, page } of all) {
  for (const t of textOf(page, kind)) {
    const w = words(t);
    for (let i = 0; i + SHINGLE <= w.length; i++) mine.set(w.slice(i, i + SHINGLE).join(" "), `${kind} ${page.id}`);
  }
}
for (const code of ["BSB", "KJV", "ASV", "WEB", "YLT"]) {
  if (!versionId.has(code)) continue;
  const rows = bible.prepare("select text from verses where version_id = ? order by book_id, chapter, verse").all(versionId.get(code)) as Any[];
  const w: string[] = [];
  for (const r of rows) for (const x of words(String(r.text))) w.push(x);
  for (let i = 0; i + SHINGLE <= w.length; i++) {
    const hit = mine.get(w.slice(i, i + SHINGLE).join(" "));
    if (hit) bad(hit, `copies a run of ${SHINGLE} words from the ${code}: "${w.slice(i, i + SHINGLE).join(" ")}"`);
  }
}

// ---------------------------------------------------------------- the children's pictures (original SVG artwork: colour and outline)
{
  const dir = new URL("../src/browse/pictures/kids/", import.meta.url);
  let without = 0;
  for (const c of children.pages) {
    const where = `child ${c.id}`;
    const colour = new URL(`${c.id}.svg`, dir);
    const line = new URL(`${c.id}-line.svg`, dir);
    if (!existsSync(colour)) {
      without++;
      if (release) bad(where, "has no picture");
      continue;
    }
    if (!existsSync(line)) bad(where, "has a picture but no outline version (run scripts/make_line_art.mts)");
    const svg = readFileSync(colour, "utf-8");
    if (!/viewBox="0 0 800 600"/.test(svg)) bad(where, 'the picture must have viewBox="0 0 800 600"');
    if (svg.length > 60000) bad(where, `the picture is ${svg.length} bytes (60000 at most)`);
    if (/<text|<image|<script|href=|filter/i.test(svg)) bad(where, "the picture must not contain text, images, scripts, links or filters");
  }
  if (without > 0) notes.push(`${without} of ${children.pages.length} children's pages have no picture yet`);
}

// ---------------------------------------------------------------- the stories' pictures (a painting or engraving each, built in) and their credits
{
  const dir = new URL("../src/browse/pictures/stories/", import.meta.url);
  const credits = JSON.parse(readFileSync(new URL("credits.json", dir), "utf-8")) as Record<string, Any>;
  let without = 0;
  for (const st of stories.pages) {
    const where = `story ${st.id}`;
    const file = ["jpg", "jpeg", "png"].map((e) => new URL(`${st.id}.${e}`, dir)).find((u) => existsSync(u));
    if (!file) {
      without++;
      if (release) bad(where, "has no picture");
      continue;
    }
    const bytes = readFileSync(file);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!jpeg && !png) bad(where, "the picture file is not a JPEG or a PNG");
    if (bytes.length > 3_000_000) bad(where, `the picture is ${bytes.length} bytes (3,000,000 at most)`);
    const c = credits[st.id];
    if (!c) bad(where, "the picture has no entry in credits.json");
    else for (const f of ["title", "artist", "credit", "licence", "licence_url", "page"]) if (!c[f]) bad(where, `the credit for the picture has no ${f}`);
    if (c && !/public domain|CC BY/i.test(c.licence ?? "")) bad(where, `the picture's licence "${c.licence}" is not one the app may bundle (public domain, CC BY, CC BY-SA)`);
  }
  for (const id of Object.keys(credits)) if (!stories.pages.some((st: Any) => st.id === id)) bad(`credits.json`, `has an entry for "${id}", which is not a story`);
  if (without > 0) notes.push(`${without} of ${stories.pages.length} stories have no picture yet`);
}

// ---------------------------------------------------------------- the hidden search words (keywords.json): they only help the search find a page
{
  const kw = JSON.parse(readFileSync(here("../src/browse/data/keywords.json"), "utf-8")) as { topics: Record<string, string[]>; stories: Record<string, string[]> };
  for (const [group, ids] of [["topics", topicIds], ["stories", storyIds]] as const) {
    for (const [id, list] of Object.entries(kw[group])) {
      const where = `keywords ${group} ${id}`;
      if (!ids.has(id)) bad(where, "is not the id of a page");
      between(where, "the number of words", list.length, 1, 20);
      for (const w of list) {
        if (typeof w !== "string" || !w.trim() || w.length > 40) bad(where, `"${w}" is not a short word or phrase`);
        if (/https?:|@/.test(w) || w.includes("\\") || w.includes("/")) bad(where, `"${w}" looks like an address`);
      }
    }
    // every page can be found by something the reader would type: each story and topic has hidden search words
    for (const id of ids) if (!(kw[group][id] ?? []).length && !(group === "stories" && id === "the-prodigal-son")) notes.push(`${group} ${id} has no hidden search words`);
  }
}

// ---------------------------------------------------------------- the report
const n = { stories: stories.pages.length, topics: topics.pages.length, children: children.pages.length };
const draft = all.filter((a) => a.page.review?.status !== "approved").length;
console.log(`browse data: ${n.stories} stories, ${n.topics} topics, ${n.children} children's pages (${all.length - draft} approved, ${draft} draft)`);
for (const x of notes.slice(0, 30)) console.log("  note: " + x);
if (problems.length) {
  for (const p of problems) console.log("  PROBLEM: " + p);
  console.log(`browse data: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(release ? "browse data: all checks passed (release mode: every page approved)" : "browse data: all checks passed");
