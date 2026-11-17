// The long story list: Old and New Testament in Bible order, and the marks for pages already read. Run: node --no-warnings --experimental-strip-types scripts/test_browse_sections.mts
import assert from "node:assert/strict";
import { BIBLE_BOOKS, bookOf, refRank, testamentGroups } from "../src/browse/browseLogic.ts";
import { readFileSync } from "node:fs";

const STORIES = (JSON.parse(readFileSync(new URL("../src/browse/data/stories.json", import.meta.url), "utf8")) as { pages: { id: string; testament: "OT" | "NT"; passages: { ref: string }[] }[] }).pages;

// the order of the books is the Bible's own, 66 of them
assert.equal(BIBLE_BOOKS.length, 66);
assert.equal(BIBLE_BOOKS[0], "Genesis");
assert.equal(BIBLE_BOOKS[38], "Malachi");
assert.equal(BIBLE_BOOKS[39], "Matthew");
assert.equal(BIBLE_BOOKS[65], "Revelation");
assert.ok(refRank("Genesis 3:1-5") < refRank("Genesis 12:1-3"));
assert.ok(refRank("Genesis 12:1") < refRank("Exodus 1:1"));
assert.ok(refRank("1 Samuel 17:1") < refRank("2 Samuel 1:1"));
assert.ok(refRank("Psalms 23:1") < refRank("Isaiah 53:1"));
assert.ok(refRank("Malachi 4:1") < refRank("Matthew 1:1"));
assert.equal(refRank("nonsense"), Number.MAX_SAFE_INTEGER);
assert.equal(bookOf("1 Kings 18:20-39"), "1 Kings");

// groups: Old then New, each in Bible order, an empty one left out, ties keep their own order
const items = [
  { id: "c", t: "NT", ref: "Luke 2:1-7" },
  { id: "a", t: "OT", ref: "Exodus 14:10-22" },
  { id: "b", t: "OT", ref: "Genesis 6:9-22" },
  { id: "d", t: "NT", ref: "Matthew 2:1-12" },
  { id: "e", t: "OT", ref: "Exodus 14:10-22" },
];
const place = (i: (typeof items)[number]) => ({ testament: i.t as "OT" | "NT", ref: i.ref });
const g = testamentGroups(items, place);
assert.deepEqual(g.map((x) => x.title), ["Old Testament", "New Testament"]);
assert.deepEqual(g[0].items.map((x) => x.id), ["b", "a", "e"]);
assert.deepEqual(g[1].items.map((x) => x.id), ["d", "c"]);
assert.deepEqual(testamentGroups(items.filter((i) => i.t === "NT"), place).map((x) => x.title), ["New Testament"]);
assert.deepEqual(testamentGroups([], place), []);

// the real stories: every one has a testament and a passage that is read in a known book, and the order is Genesis to Revelation
const real = testamentGroups(STORIES, (s) => ({ testament: s.testament, ref: s.passages[0]?.ref ?? "" }));
assert.equal(real.reduce((n, x) => n + x.items.length, 0), STORIES.length, "no story is lost");
for (const s of STORIES) assert.ok(refRank(s.passages[0]?.ref ?? "") < Number.MAX_SAFE_INTEGER, `${s.id} begins with a readable passage`);
for (const grp of real) {
  const ranks = grp.items.map((s) => refRank(s.passages[0].ref));
  assert.deepEqual([...ranks].sort((x, y) => x - y), ranks, `${grp.title} is in Bible order`);
}
for (const s of real[0].items) assert.equal(s.testament, "OT");
// each story's testament agrees with the book it begins in (the list would put it under the wrong heading otherwise)
for (const s of STORIES) {
  const book = bookOf(s.passages[0].ref);
  const inNt = (BIBLE_BOOKS as readonly string[]).indexOf(book) >= 39;
  assert.equal(s.testament, inNt ? "NT" : "OT", `${s.id}: ${book}`);
}

// the read marks
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
const { cleanReadIds, isRead, markRead, markAllUnread, readCountOf, reloadReadMarks, READ_KEY } = await import("../src/browse/readMarks.ts");
assert.equal(READ_KEY, "browse:read");
assert.equal(isRead("stories", "david-and-goliath"), false);
markRead("stories", "david-and-goliath");
markRead("stories", "david-and-goliath");
markRead("children", "noah-for-children");
assert.equal(isRead("stories", "david-and-goliath"), true);
assert.equal(isRead("children", "david-and-goliath"), false, "a story and a children's page are marked separately");
assert.deepEqual(JSON.parse(store.get(READ_KEY)!), ["stories:david-and-goliath", "children:noah-for-children"]);
assert.equal(readCountOf("stories", [{ id: "david-and-goliath" }, { id: "x" }], new Set(["stories:david-and-goliath"])), 1);
// what is stored is read back, and a list that is not a list or holds odd ids is cleaned
store.set(READ_KEY, JSON.stringify(["stories:a", "stories:a", "bad", "stories:Bad Id", 5, "topics:fear", "x".repeat(200)]));
reloadReadMarks();
assert.equal(isRead("stories", "a"), true);
assert.equal(isRead("topics", "fear"), true);
assert.equal(isRead("stories", "david-and-goliath"), false);
assert.deepEqual(cleanReadIds("no"), []);
assert.deepEqual(cleanReadIds(["stories:a", "stories:a", "bad", 3]), ["stories:a"]);
assert.equal(cleanReadIds(Array.from({ length: 3000 }, (_, i) => `stories:s${i}`)).length, 2000);
markAllUnread();
assert.equal(isRead("stories", "a"), false);
assert.deepEqual(JSON.parse(store.get(READ_KEY)!), []);
console.log("browse sections: all checks passed");
