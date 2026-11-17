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
import { spawn } from "node:child_process";
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
mkdirSync(DRAFTS, { recursive: true });

type Any = Record<string, any>;
const readJson = (p: string): Any => JSON.parse(readFileSync(p, "utf-8").replace(/^﻿/, ""));
const today = () => new Date().toISOString().slice(0, 10);
const slug = (t: string) => t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------------------------------------------------------------- the data
const latestBatch = () => readdirSync(PHONE).filter((n) => n.startsWith("batch-")).sort().pop()!;
const builtInIds = (): Set<string> => new Set((readJson(join(root, "src/browse/data/stories.json")).pages as Any[]).map((p) => p.id));
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
      return { id: f.replace(/\.json$/, ""), title: d.page?.title ?? f, status: d.page?.review?.status ?? "draft", wanted: d.wanted ?? null };
    });
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
  return { latest: latestBatch(), board, drafts, tags: tagList(), counts: { builtIn: built.size, published: pub.size, drafts: drafts.length } };
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
const pictureIndex = (): Any => (picIndex ??= readJson(join(root, "src-tauri/resources/pictures.json")));
const picEntry = (id: string): Any | undefined => (pictureIndex().pictures as Any[]).find((p) => p.id === id);
const picFile = (p: Any) => join(LIB, p.c, `${p.id}.jpg`);
const MAX_PICTURE_BYTES = 600_000;

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
    .filter((p) => (p.refs as any[]).some((r) => r[0] === book && r[1] === chapter))
    .map((p) => ({ id: p.id, title: p.title, collection: p.c, credit: p.credit, downloaded: existsSync(picFile(p)) }));
}

// ---------------------------------------------------------------- checking and building
function assemble(dest: string, ids: string[], requireApproved: boolean) {
  cpSync(join(PHONE, latestBatch()), dest, { recursive: true });
  const stories = readJson(join(dest, "stories.json"));
  const kwPath = join(dest, "keywords.json");
  const keywords = existsSync(kwPath) ? readJson(kwPath) : { stories: {}, topics: {} };
  keywords.stories ??= {};
  const picDir = join(dest, "pictures");
  const credPath = join(picDir, "credits.json");
  const credits: Any = existsSync(credPath) ? readJson(credPath) : {};
  for (const id of ids) {
    const d = readJson(join(DRAFTS, `${id}.json`));
    if (requireApproved && d.page?.review?.status !== "approved") continue;
    stories.pages = (stories.pages as Any[]).filter((p) => p.id !== d.page.id);
    stories.pages.push(d.page);
    if (Array.isArray(d.keywords) && d.keywords.length) keywords.stories[d.page.id] = d.keywords;
    const e = d.picture?.id ? picEntry(d.picture.id) : undefined;
    if (e && existsSync(picFile(e))) {
      if (statSync(picFile(e)).size > MAX_PICTURE_BYTES) throw new Error(`The picture "${e.title}" is larger than the phone takes (600 KB): choose another or ask for it to be made smaller.`);
      mkdirSync(picDir, { recursive: true });
      copyFileSync(picFile(e), join(picDir, `${d.page.id}.jpg`));
      credits[d.page.id] = creditFor(e);
    }
  }
  if (Object.keys(credits).length) {
    mkdirSync(picDir, { recursive: true });
    writeFileSync(credPath, JSON.stringify(credits, null, 1));
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

async function check(id: string) {
  const tmp = join(os.tmpdir(), `story-studio-${process.pid}-${Date.now()}`);
  try {
    assemble(tmp, [id], false);
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
  if (!approved.length) return { ok: false, text: "No page is approved yet, so there is nothing to add to the file." };
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
  return { ok: true, batch: name, bytes: bytes.length, sha: createHash("sha256").update(bytes).digest("hex"), approved, text: r.out.slice(-1800) };
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
    if (req.method === "GET" && url.pathname === "/api/draft") {
      const id = url.searchParams.get("id");
      if (!safeId(id) || !existsSync(join(DRAFTS, `${id}.json`))) return send(res, { error: "No such draft." }, 404);
      return send(res, { ...readJson(join(DRAFTS, `${id}.json`)), existingIds: allIds().filter((x) => x !== id) });
    }
    if (req.method !== "POST") return send(res, { error: "Not found" }, 404);
    const b = await body(req);
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
      const strip = (pg: Any) => JSON.stringify({ ...pg, review: undefined });
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
    if (url.pathname === "/api/check") return safeId(b.id) ? send(res, await check(b.id)) : send(res, { error: "Bad id" }, 400);
    if (url.pathname === "/api/build") return send(res, await build());
    send(res, { error: "Not found" }, 404);
  } catch (e) {
    send(res, { error: String(e) }, 500);
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Story Studio is running: http://localhost:${PORT}   (close this window to stop it)`));
