// Story Studio: a small private tool for the owner (never part of the apps). It runs on this computer only (address http://localhost:4177) and does
// the work AROUND writing a story: the "What to write" board, reading and editing a draft, the app's own checks in plain words, the owner's approval,
// and making the file the phone fetches. It writes nothing outside this project, and it NEVER uploads or publishes anything.
//
//   node --no-warnings extra-pages/tools/story-studio/server.mts          (or double-click "Start Story Studio.bat")
//
// Drafts live in extra-pages/drafts/<id>.json as { "page": {...a story as in src/browse/data/stories.json...}, "keywords": ["word", ...], "wanted": 12 }.
// The words of a story are written outside this tool; here they are read, edited, checked and approved. A page counts as approved only when the owner
// presses Approve here (it records the date); the builder refuses anything else.

import http from "node:http";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const PHONE = join(root, "extra-pages", "phone");
const DRAFTS = join(root, "extra-pages", "drafts");
const PORT = Number(process.env.STORY_STUDIO_PORT) || 4177;
const CDRAFTS = join(DRAFTS, "children");
const CACHE = join(DRAFTS, "_pics");
mkdirSync(DRAFTS, { recursive: true });
mkdirSync(CDRAFTS, { recursive: true });
mkdirSync(CACHE, { recursive: true });

type Any = Record<string, any>;
const readJson = (p: string): Any => JSON.parse(readFileSync(p, "utf-8").replace(/^﻿/, ""));
const today = () => new Date().toISOString().slice(0, 10);
const slug = (t: string) => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------- the data
const latestBatch = () => readdirSync(PHONE).filter((n) => n.startsWith("batch-")).sort().pop()!;
const builtInIds = (): Set<string> => new Set((readJson(join(root, "src/browse/data/stories.json")).pages as Any[]).map((p) => p.id));
const builtInChildIds = (): Set<string> => new Set((readJson(join(root, "src/browse/data/children.json")).pages as Any[]).map((p) => p.id));
const publishedIds = (): Set<string> => new Set((readJson(join(PHONE, latestBatch(), "stories.json")).pages as Any[]).map((p) => p.id));
const tagList = (): string[] => readJson(join(root, "src/browse/data/stories.json")).tags ?? [];
const allIds = (): string[] => [...builtInIds(), ...publishedIds()];

function wantedList() {
  const lines = readFileSync(join(here, "wanted.txt"), "utf-8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  return lines.map((l) => {
    const [n, group, title, ref, covered] = l.split("|");
    return { n: Number(n), group, title, ref, covered: covered || "", id: covered || slug(title) };
  });
}
const wantedFile = join(DRAFTS, "_wanted.json");
const wantedSelected = (): number[] => (existsSync(wantedFile) ? readJson(wantedFile).numbers ?? [] : []);

function draftFiles() {
  return readdirSync(DRAFTS)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => {
      const d = readJson(join(DRAFTS, f));
      return { id: f.replace(/\.json$/, ""), title: d.page?.title ?? f, status: d.page?.review?.status ?? "draft", wanted: d.wanted ?? null, child: d.page?.child_page ?? null };
    });
}

const kidsFile = join(DRAFTS, "_kidswanted.json");
/** the stories the owner ticked as needing a children's page, so they can all be written first and each story read together with its children's page */
const kidsWanted = (): string[] => (existsSync(kidsFile) ? readJson(kidsFile).ids ?? [] : []);

function childFiles() {
  return readdirSync(CDRAFTS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const d = readJson(join(CDRAFTS, f));
      return { id: f.replace(/\.json$/, ""), title: d.page?.title ?? f, status: d.page?.review?.status ?? "draft", story: d.page?.story ?? null };
    });
}

/** how full the phone's file would be: at most 150 story pictures and 24 MB (mobile/src-tauri/src/extra_pages.rs); pictures over 200 KB are shrunk to about 100 KB when the file is made */
function capacity() {
  const batch = join(PHONE, latestBatch());
  const pubPics = existsSync(join(batch, "pictures")) ? readdirSync(join(batch, "pictures")).filter((f) => f.endsWith(".jpg")) : [];
  let bytes = pubPics.reduce((n, f) => n + statSync(join(batch, "pictures", f)).size, 0);
  const kidDir = join(batch, "child-pictures");
  if (existsSync(kidDir)) bytes += readdirSync(kidDir).reduce((n, f) => n + statSync(join(kidDir, f)).size, 0);
  const published = new Set(pubPics.map((f) => f.replace(/\.jpg$/, "")));
  let pics = pubPics.length;
  let approved = 0;
  for (const f of readdirSync(DRAFTS).filter((x) => x.endsWith(".json") && !x.startsWith("_"))) {
    const d = readJson(join(DRAFTS, f));
    if (d.page?.review?.status !== "approved") continue;
    approved++;
    bytes += JSON.stringify(d.page).length;
    const e = d.picture?.id ? picEntry(d.picture.id) : undefined;
    if (e && existsSync(picFile(e)) && !published.has(d.page.id)) {
      pics++;
      const sz = statSync(picFile(e)).size;
      bytes += sz > SHRINK_ABOVE ? 300_000 : sz; // bigger pictures are shrunk when the file is made (about 100 to 360 KB each)
    }
  }
  // children's pages: their own list of at most 150 pictures (with an outline each), also inside the same 24 MB
  let kidPics = existsSync(kidDir) ? readdirSync(kidDir).filter((f) => f.endsWith(".jpg")).length : 0;
  const kidPublished = new Set(existsSync(kidDir) ? readdirSync(kidDir).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(/\.jpg$/, "")) : []);
  for (const f of existsSync(CDRAFTS) ? readdirSync(CDRAFTS).filter((x) => x.endsWith(".json")) : []) {
    const d = readJson(join(CDRAFTS, f));
    if (d.page?.review?.status !== "approved") continue;
    bytes += JSON.stringify(d.page).length;
    const e = d.picture?.id ? picEntry(d.picture.id) : undefined;
    if (e && existsSync(picFile(e)) && !kidPublished.has(d.page.id)) {
      kidPics++;
      const sz = statSync(picFile(e)).size;
      bytes += (sz > 200_000 ? 150_000 : sz) + 20_000;
    }
  }
  return { pictures: pics, maxPictures: 150, kidPictures: kidPics, bytes: Math.round(bytes * 1.34), maxBytes: 24 * 1024 * 1024, approvedStories: approved };
}

function state() {
  const built = builtInIds();
  const pub = publishedIds();
  const drafts = draftFiles();
  const sel = new Set(wantedSelected());
  const board = wantedList().map((w) => {
    let status = "todo";
    if (w.covered) status = built.has(w.covered) ? "built-in" : pub.has(w.covered) ? "published" : "todo";
    else {
      const d = drafts.find((x) => x.wanted === w.n || x.id === w.id);
      if (d) status = d.status === "approved" ? "approved" : "draft";
    }
    return { ...w, status, wanted: sel.has(w.n) };
  });
  return { latest: latestBatch(), board, drafts, children: childFiles(), tags: tagList(), capacity: capacity(), kidsWanted: kidsWanted(), counts: { builtIn: built.size, published: pub.size, drafts: drafts.length } };
}

// ---------------------------------------------------------------- the Bible (BSB) for the preview
let db: DatabaseSync | null = null;
function verses(ref: string) {
  db ??= new DatabaseSync(join(root, "src-tauri/resources/bible.db"), { readOnly: true });
  const m = /^(.+?) (\d+):(\d+)(?:-(\d+))?$/.exec(ref.trim());
  if (!m) return [];
  const book = db.prepare("SELECT id FROM books WHERE name = ?").get(m[1]) as Any | undefined;
  const ver = db.prepare("SELECT id FROM versions WHERE code = 'BSB'").get() as Any | undefined;
  if (!book || !ver) return [];
  const v1 = Number(m[3]);
  const v2 = m[4] ? Number(m[4]) : v1;
  return db.prepare("SELECT verse, text FROM verses WHERE version_id = ? AND book_id = ? AND chapter = ? AND verse BETWEEN ? AND ? ORDER BY verse").all(ver.id, book.id, Number(m[2]), v1, v2) as Any[];
}

// ---------------------------------------------------------------- the picture library (the owner's downloaded paintings)
const LIB = join(process.env.APPDATA ?? "", "com.local.bibleconcordance", "pictures");
let picIndex: Any | null = null;
// the app's picture library, plus pictures added by hand for stories it has none for (extra-pages/pictures-extra.json: same entry format, public domain or CC BY / CC BY-SA only)
const pictureIndex = (): Any => {
  if (picIndex) return picIndex;
  const base = readJson(join(root, "src-tauri/resources/pictures.json"));
  const extraPath = join(root, "extra-pages", "pictures-extra.json");
  if (existsSync(extraPath)) {
    const more = readJson(extraPath);
    base.collections = [...(base.collections ?? []), ...(more.collections ?? [])];
    base.pictures = [...(base.pictures ?? []), ...(more.pictures ?? [])];
  }
  return (picIndex = base);
};
const picEntry = (id: string): Any | undefined => (pictureIndex().pictures as Any[]).find((p) => p.id === id);
const libFile = (p: Any) => join(LIB, p.c, `${p.id}.jpg`);
const cacheFile = (p: Any) => join(CACHE, `${p.id}.jpg`);
/** the picture's file on this computer: the downloaded library first, then the Studio's own cache (pictures fetched for a children's page) */
const picFile = (p: Any) => (existsSync(libFile(p)) ? libFile(p) : cacheFile(p));
/** a small picture from Wikimedia Commons to look at before choosing (the browser loads it straight from there) */
function thumbUrl(p: Any): string | null {
  const m = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/.exec(p.url ?? "");
  return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/330px-${m[3]}` : null;
}
async function fetchPicture(id: string): Promise<string> {
  const e = picEntry(id);
  if (!e) throw new Error("No such picture.");
  if (existsSync(picFile(e))) return picFile(e);
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(e.url ?? "")) throw new Error("This picture has no download address.");
  const r = await fetch(e.url, { headers: { "User-Agent": "BibleConcordance-StoryStudio/1.0 (a private authoring tool; https://bible4me.org)" } });
  if (!r.ok) throw new Error(`Wikimedia said ${r.status}. Wait a minute and try again (it limits how fast pictures may be fetched).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error("That was not a JPEG picture.");
  writeFileSync(cacheFile(e), bytes);
  return cacheFile(e);
}
function makeOutline(id: string): Promise<{ ok: boolean; text: string }> {
  const e = picEntry(id);
  if (!e || !existsSync(picFile(e))) return Promise.resolve({ ok: false, text: "Choose and fetch the picture first." });
  return new Promise((done) => {
    const py = spawn("python", ["-I", join(here, "outline.py"), picFile(e), join(CACHE, `${id}-outline.png`)], { cwd: root });
    let out = "";
    py.stdout.on("data", (b) => (out += b));
    py.stderr.on("data", (b) => (out += b));
    py.on("error", () => done({ ok: false, text: "Python was not found on this computer." }));
    py.on("close", (code) => done({ ok: code === 0, text: out.trim() }));
  });
}
const MAX_PICTURE_BYTES = 600_000;
/** pictures bigger than this are shown smaller on the phone anyway: they are shrunk (1100 px, quality 80) so more stories fit in the 24 MB file */
const SHRINK_ABOVE = 200_000;

/** the six credit fields the phone shows under a story's picture, from the picture's own entry and its collection */
function creditFor(p: Any): Any {
  const c = (pictureIndex().collections as Any[]).find((x) => x.key === p.c) ?? {};
  let title: string = p.title;
  const m = /^(.+) · picture (\d+)$/.exec(title);
  if (p.c === "sweet" && m) title = `${m[1].replace(/^(\w+) (\d+)$/, "$1, chapter $2")}, picture ${m[2]}`;
  return { title, artist: c.artist, credit: p.credit, licence: c.licence, licence_url: c.licence_url, page: p.page, collection: c.title, id: p.id };
}

/** paintings that go with a chapter, newest collections first; "downloaded" says whether the file is on this computer */
function picturesFor(book: string, chapter: number) {
  return (pictureIndex().pictures as Any[])
    .filter((p) => (p.refs as any[]).some((r) => r[0] === book && (!chapter || r[1] === chapter))) // chapter 0 = the whole book
    .map((p) => ({ id: p.id, title: p.title, collection: p.c, credit: p.credit, downloaded: existsSync(picFile(p)), thumb: existsSync(picFile(p)) ? null : thumbUrl(p) }));
}

// ---------------------------------------------------------------- checking and building
function assemble(dest: string, ids: string[], requireApproved: boolean, kidIds: string[] = []) {
  cpSync(join(PHONE, latestBatch()), dest, { recursive: true });
  const stories = readJson(join(dest, "stories.json"));
  const kwPath = join(dest, "keywords.json");
  const keywords = existsSync(kwPath) ? readJson(kwPath) : { stories: {}, topics: {} };
  keywords.stories ??= {};
  const picDir = join(dest, "pictures");
  const credPath = join(picDir, "credits.json");
  const credits: Any = existsSync(credPath) ? readJson(credPath) : {};
  // a page that is built into the app is never in the file as well (the app refuses an id used twice): drop it from what the file already held
  const builtS = builtInIds();
  const builtC = builtInChildIds();
  stories.pages = (stories.pages as Any[]).filter((p) => !builtS.has(p.id));
  for (const id of builtS) {
    delete keywords.stories[id];
    delete credits[id];
    rmSync(join(picDir, `${id}.jpg`), { force: true });
  }
  ids = ids.filter((id) => !builtS.has(id));
  const kids = existsSync(CDRAFTS) ? readdirSync(CDRAFTS).filter((f) => f.endsWith(".json")).map((f) => readJson(join(CDRAFTS, f))) : [];
  const usable = (id: string) => kids.find((k) => k.page?.id === id && (requireApproved ? k.page?.review?.status === "approved" : kidIds.includes(id)));
  for (const id of ids) {
    const d = readJson(join(DRAFTS, `${id}.json`));
    if (requireApproved && d.page?.review?.status !== "approved") continue;
    stories.pages = (stories.pages as Any[]).filter((p) => p.id !== d.page.id);
    const pg = { ...d.page };
    if (pg.child_page && !usable(pg.child_page)) pg.child_page = null; // a link to a children's page that is not going out
    stories.pages.push(pg);
    if (Array.isArray(d.keywords) && d.keywords.length) keywords.stories[d.page.id] = d.keywords;
    const e = d.picture?.id ? picEntry(d.picture.id) : undefined;
    if (e && existsSync(picFile(e))) {
      mkdirSync(picDir, { recursive: true });
      const c = creditFor(e);
      if (statSync(picFile(e)).size > SHRINK_ABOVE) {
        // too big for the phone's file: shown at a smaller file size, and the credit says so
        const r = spawnSync("python", ["-I", join(here, "resize.py"), picFile(e), join(picDir, `${d.page.id}.jpg`), String(MAX_PICTURE_BYTES), "1100", "80"], { encoding: "utf-8" });
        if (r.status !== 0) throw new Error(`The picture "${e.title}" is larger than the phone takes (600 KB) and could not be made smaller: ${r.stdout}${r.stderr}`);
        c.credit = `${c.credit}; shown at a smaller file size`;
      } else copyFileSync(picFile(e), join(picDir, `${d.page.id}.jpg`));
      credits[d.page.id] = c;
    }
  }
  if (Object.keys(credits).length) {
    mkdirSync(picDir, { recursive: true });
    writeFileSync(credPath, JSON.stringify(credits, null, 1));
  }
  // children's pages (and their pictures with the outline to colour in)
  const cpath = join(dest, "children.json");
  const children = existsSync(cpath) ? readJson(cpath) : { format: 1, pages: [] };
  const kdir = join(dest, "child-pictures");
  const kcred: Any = existsSync(join(kdir, "credits.json")) ? readJson(join(kdir, "credits.json")) : {};
  children.pages = (children.pages as Any[]).filter((c) => !builtC.has(c.id));
  for (const id of builtC) {
    delete kcred[id];
    rmSync(join(kdir, `${id}.jpg`), { force: true });
    rmSync(join(kdir, `${id}-outline.png`), { force: true });
  }
  for (const k of kids) {
    if (builtC.has(k.page?.id)) continue;
    if (requireApproved && k.page?.review?.status !== "approved") continue;
    if (!requireApproved && !kidIds.includes(k.page?.id)) continue; // a check only brings the children's page being checked
    children.pages = (children.pages as Any[]).filter((c) => c.id !== k.page.id);
    children.pages.push(k.page);
    const e = k.picture?.id ? picEntry(k.picture.id) : undefined;
    if (e && existsSync(picFile(e))) {
      mkdirSync(kdir, { recursive: true });
      const kc = creditFor(e);
      if (statSync(picFile(e)).size > SHRINK_ABOVE) {
        // too big for the phone's file: shown at a smaller file size, and the credit says so
        const r = spawnSync("python", ["-I", join(here, "resize.py"), picFile(e), join(kdir, `${k.page.id}.jpg`), String(MAX_PICTURE_BYTES), "1100", "80"], { encoding: "utf-8" });
        if (r.status !== 0) throw new Error(`The picture "${e.title}" is larger than the phone takes (600 KB) and could not be made smaller: ${r.stdout}${r.stderr}`);
        kc.credit = `${kc.credit}; shown at a smaller file size`;
      } else copyFileSync(picFile(e), join(kdir, `${k.page.id}.jpg`));
      kcred[k.page.id] = kc;
      const ol = join(CACHE, `${e.id}-outline.png`);
      if (existsSync(ol)) copyFileSync(ol, join(kdir, `${k.page.id}-outline.png`));
    }
  }
  writeFileSync(cpath, JSON.stringify(children, null, 1));
  if (Object.keys(kcred).length) {
    mkdirSync(kdir, { recursive: true });
    writeFileSync(join(kdir, "credits.json"), JSON.stringify(kcred, null, 1));
  }
  writeFileSync(join(dest, "stories.json"), JSON.stringify(stories, null, 1));
  writeFileSync(kwPath, JSON.stringify(keywords, null, 1));
}

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, ["--no-warnings", ...args], { cwd: root, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    p.on("close", (code) => done({ code: code ?? 1, out }));
  });
}

async function check(id: string, kind: "story" | "child" = "story") {
  const tmp = join(os.tmpdir(), `story-studio-${process.pid}-${Date.now()}`);
  try {
    let storyId = id;
    if (kind === "child") storyId = readJson(join(CDRAFTS, `${id}.json`)).page.story;
    const haveDraft = existsSync(join(DRAFTS, `${storyId}.json`));
    const kidIds: string[] = [];
    if (kind === "child") kidIds.push(id);
    else if (haveDraft) {
      const cp = readJson(join(DRAFTS, `${storyId}.json`)).page.child_page;
      if (cp && existsSync(join(CDRAFTS, `${cp}.json`))) kidIds.push(cp);
    }
    assemble(tmp, haveDraft ? [storyId] : [], false, kidIds);
    if (kind === "child" && !haveDraft) {
      // the story is already published or built in: only the children's page is new
      const kid = readJson(join(CDRAFTS, `${id}.json`));
      const cp = join(tmp, "children.json");
      const ch = existsSync(cp) ? readJson(cp) : { format: 1, pages: [] };
      ch.pages = (ch.pages as Any[]).filter((c) => c.id !== id);
      ch.pages.push(kid.page);
      writeFileSync(cp, JSON.stringify(ch, null, 1));
    }
    const r = await run(["scripts/test_browse.mts"], { BROWSE_EXTRA: tmp });
    const problems = r.out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(story|child|topic) |^PROBLEM|copies a run|^browse data:/.test(l) && !/^browse data: \d+ stories/.test(l) && !/all checks passed/.test(l));
    const plain = (l: string) => l.replace(/^PROBLEM: (story|child|topic) [^:]+: /, "").replace(/^(story|child|topic) [^:]+: /, "");
    const mine = problems.filter((l) => l.includes(id) || l.startsWith("browse data:"));
    return { ok: r.code === 0, lines: r.code === 0 ? [] : (mine.length ? mine : problems.slice(0, 40)).map(plain), raw: r.code === 0 ? "" : r.out.slice(-3000) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function build() {
  const approved = draftFiles().filter((d) => d.status === "approved").map((d) => d.id);
  const approvedKids = childFiles().filter((d) => d.status === "approved").map((d) => d.id);
  if (!approved.length && !approvedKids.length) return { ok: false, text: "No page is approved yet, so there is nothing to add to the file." };
  let name = `batch-${today()}-studio`;
  for (let i = 2; existsSync(join(PHONE, name)); i++) name = `batch-${today()}-studio-${i}`;
  const dest = join(PHONE, name);
  assemble(dest, approved, true);
  const out = join(root, "installer", "packs", "test-extra-pages.json");
  const r = await run(["scripts/build_extra_pages.mts", `extra-pages/phone/${name}`, "--out", out]);
  if (r.code !== 0) {
    rmSync(dest, { recursive: true, force: true });
    return { ok: false, text: "The file was NOT made. The checks said:\n" + r.out.split(/\r?\n/).filter((l) => /PROBLEM|problem|do not pass/.test(l)).join("\n") + "\n\n" + r.out.slice(-1500) };
  }
  const ready = join(root, "installer", "packs", "ready-to-upload");
  mkdirSync(ready, { recursive: true });
  const bytes = readFileSync(out);
  writeFileSync(join(ready, "extra-pages.json"), bytes);
  return { ok: true, batch: name, bytes: bytes.length, sha: createHash("sha256").update(bytes).digest("hex"), approved, approvedKids, text: r.out.slice(-1800) };
}

// ---------------------------------------------------------------- the web server
const body = (req: http.IncomingMessage) =>
  new Promise<Any>((done) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        done(s ? JSON.parse(s) : {});
      } catch {
        done({});
      }
    });
  });

const send = (res: http.ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
const safeId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(readFileSync(join(here, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, state());
    if (req.method === "GET" && url.pathname === "/api/verses") return send(res, verses(url.searchParams.get("ref") ?? ""));
    if (req.method === "GET" && url.pathname === "/api/pictures") return send(res, picturesFor(url.searchParams.get("book") ?? "", Number(url.searchParams.get("chapter"))));
    if (req.method === "GET" && url.pathname === "/api/picfile") {
      const e = picEntry(url.searchParams.get("id") ?? "");
      if (!e || !existsSync(picFile(e))) return send(res, { error: "Not downloaded." }, 404);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=3600" });
      return res.end(readFileSync(picFile(e)));
    }
    if (req.method === "GET" && url.pathname === "/api/outlinefile") {
      const f = join(CACHE, `${(url.searchParams.get("id") ?? "").replace(/[^a-z0-9-]/gi, "")}-outline.png`);
      if (!existsSync(f)) return send(res, { error: "No outline yet." }, 404);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      return res.end(readFileSync(f));
    }
    if (req.method === "GET" && url.pathname === "/api/cdraft") {
      const id = url.searchParams.get("id");
      if (!safeId(id) || !existsSync(join(CDRAFTS, `${id}.json`))) return send(res, { error: "No such draft." }, 404);
      const kid = readJson(join(CDRAFTS, `${id}.json`));
      const sf = join(DRAFTS, `${kid.page.story}.json`);
      const storyPage = existsSync(sf) ? readJson(sf).page : (readJson(join(PHONE, latestBatch(), "stories.json")).pages as Any[]).find((x) => x.id === kid.page.story) ?? null;
      const adultPicture = existsSync(sf) ? readJson(sf).picture ?? null : null;
      return send(res, { ...kid, storyPage, adultPicture });
    }
    if (req.method === "GET" && url.pathname === "/api/draft") {
      const id = url.searchParams.get("id");
      if (!safeId(id) || !existsSync(join(DRAFTS, `${id}.json`))) return send(res, { error: "No such draft." }, 404);
      return send(res, { ...readJson(join(DRAFTS, `${id}.json`)), existingIds: allIds().filter((x) => x !== id) });
    }
    if (req.method !== "POST") return send(res, { error: "Not found" }, 404);
    const b = await body(req);
    if (url.pathname === "/api/kidswanted") {
      writeFileSync(kidsFile, JSON.stringify({ ids: (Array.isArray(b.ids) ? b.ids : []).filter((x: unknown) => safeId(x)) }));
      return send(res, { ok: true });
    }
    if (url.pathname === "/api/wanted") {
      writeFileSync(wantedFile, JSON.stringify({ numbers: (b.numbers as number[]).filter((n) => Number.isInteger(n)) }));
      return send(res, { ok: true });
    }
    if (url.pathname === "/api/draft") {
      if (!safeId(b.id) || !b.draft?.page) return send(res, { error: "That is not a draft." }, 400);
      const d = b.draft as Any;
      d.page.id = b.id;
      // the owner's approval is about the WORDS: it stays when only the picture changes or nothing changed, and is withdrawn when any word changes
      const file = join(DRAFTS, `${b.id}.json`);
      const before = existsSync(file) ? readJson(file) : null;
      const strip = (pg: Any) => JSON.stringify({ ...pg, review: undefined, child_page: undefined });
      const same = before && strip(before.page) === strip(d.page);
      if (before?.page?.review?.status === "approved") d.page.review = same ? before.page.review : { status: "draft", rev: (before.page.review.rev ?? 0) + 1, date: today() };
      else if (d.page.review?.status === "approved" && !before) d.page.review = { status: "draft", rev: 1, date: today() };
      writeFileSync(file, JSON.stringify({ page: d.page, keywords: d.keywords ?? [], wanted: d.wanted ?? null, picture: d.picture ?? null }, null, 1));
      return send(res, { ok: true, status: d.page.review?.status ?? "draft" });
    }
    if (url.pathname === "/api/approve") {
      if (!safeId(b.id)) return send(res, { error: "Bad id" }, 400);
      const f = join(DRAFTS, `${b.id}.json`);
      const d = readJson(f);
      const rev = (d.page.review?.rev ?? 0) + (b.approve ? 1 : 0);
      d.page.review = { status: b.approve ? "approved" : "draft", rev: rev || 1, date: today() };
      writeFileSync(f, JSON.stringify(d, null, 1));
      return send(res, { ok: true, status: d.page.review.status });
    }
    if (url.pathname === "/api/check") return safeId(b.id) ? send(res, await check(b.id, b.kind === "child" ? "child" : "story")) : send(res, { error: "Bad id" }, 400);
    if (url.pathname === "/api/fetchpic") {
      try {
        await fetchPicture(String(b.id));
        const o = b.outline ? await makeOutline(String(b.id)) : { ok: true, text: "" };
        return send(res, { ok: true, outline: o });
      } catch (e) {
        return send(res, { ok: false, error: String(e instanceof Error ? e.message : e) });
      }
    }
    if (url.pathname === "/api/cnew") {
      // a new children's page for a story (a draft or already published): a skeleton with the links filled in
      const sid = String(b.story);
      const sd = existsSync(join(DRAFTS, `${sid}.json`)) ? readJson(join(DRAFTS, `${sid}.json`)).page : (readJson(join(PHONE, latestBatch(), "stories.json")).pages as Any[]).find((x) => x.id === sid);
      if (!sd) return send(res, { error: "That story is not a draft or an added story." }, 404);
      const id = slug(`${sd.title} children`).replace(/-children$/, "") + "-for-children";
      const f = join(CDRAFTS, `${id}.json`);
      if (!existsSync(f)) {
        const read = sd.whole ?? sd.passages[0].ref;
        const page = { id, title: String(b.title || sd.title), age: String(b.age || "6-8"), story: sid, read_from: read, retelling: [""], message: "", memory: { ref: "", blanks_hint: [] }, questions: [{ q: "", a: "" }, { q: "", a: "" }, { q: "", a: "There is no wrong answer. " }], try_this: "", words: [], doctrine: "plain", review: { status: "draft", rev: 1, date: today() } };
        writeFileSync(f, JSON.stringify({ page, picture: null }, null, 1));
      }
      // link the story to its children's page
      const sf = join(DRAFTS, `${sid}.json`);
      if (existsSync(sf)) {
        const sdraft = readJson(sf);
        sdraft.page.child_page = id;
        writeFileSync(sf, JSON.stringify(sdraft, null, 1));
      }
      return send(res, { ok: true, id });
    }
    if (url.pathname === "/api/cdraft") {
      if (!safeId(b.id) || !b.draft?.page) return send(res, { error: "That is not a draft." }, 400);
      const d = b.draft as Any;
      d.page.id = b.id;
      const file = join(CDRAFTS, `${b.id}.json`);
      const before = existsSync(file) ? readJson(file) : null;
      const strip = (pg: Any) => JSON.stringify({ ...pg, review: undefined });
      const same = before && strip(before.page) === strip(d.page);
      if (before?.page?.review?.status === "approved") d.page.review = same ? before.page.review : { status: "draft", rev: (before.page.review.rev ?? 0) + 1, date: today() };
      else d.page.review = { status: "draft", rev: d.page.review?.rev ?? 1, date: today() };
      writeFileSync(file, JSON.stringify({ page: d.page, picture: d.picture ?? null }, null, 1));
      return send(res, { ok: true, status: d.page.review.status });
    }
    if (url.pathname === "/api/capprove") {
      if (!safeId(b.id)) return send(res, { error: "Bad id" }, 400);
      const f = join(CDRAFTS, `${b.id}.json`);
      const d = readJson(f);
      const rev = (d.page.review?.rev ?? 0) + (b.approve ? 1 : 0);
      d.page.review = { status: b.approve ? "approved" : "draft", rev: rev || 1, date: today() };
      writeFileSync(f, JSON.stringify(d, null, 1));
      return send(res, { ok: true, status: d.page.review.status });
    }
    if (url.pathname === "/api/build") return send(res, await build());
    send(res, { error: "Not found" }, 404);
  } catch (e) {
    send(res, { error: String(e) }, 500);
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Story Studio is running: http://localhost:${PORT}   (close this window to stop it)`));
