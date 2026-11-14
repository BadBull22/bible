// The additional pages file on the computer: the sentences under the "Fetch additional stories" button and the pictures that come inside the file.
// Run: node --experimental-strip-types scripts/test_extra_fetch.mts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, extraTotal, fetchMessage, NONE, picturesFrom, readExtraFile, type ExtraInfo } from "../src/browse/extraFile.ts";

const info = (stories: number, topics: number, children: number, skipped = 0): ExtraInfo => ({ stories, topics, children, skipped, revision: "" });

// the wording
assert.equal(describe(info(1, 0, 0)), "1 story");
assert.equal(describe(info(2, 1, 1)), "2 stories, 1 Verses for… page and 1 children's page");
assert.equal(describe(info(0, 0, 2)), "2 children's pages");
assert.equal(extraTotal(info(2, 1, 1)), 4);
assert.equal(fetchMessage(NONE, info(2, 0, 2), false), "Added 2 stories and 2 children's pages.");
assert.equal(fetchMessage(info(2, 0, 2), info(3, 0, 2), false), "Added 1 story. In all you have 5 pages beyond the ones that came with the app.");
assert.equal(fetchMessage(info(2, 0, 2), info(2, 0, 2), true), "You already have all of them: 2 stories and 2 children's pages.");
assert.equal(fetchMessage(info(2, 0, 2), info(2, 0, 2), false), "Updated. You have 2 stories and 2 children's pages.");
assert.equal(fetchMessage(NONE, NONE, false), "There are no additional stories yet. Please look again later.");
assert.match(fetchMessage(NONE, info(0, 0, 0, 3), false), /can't show them yet/);
assert.match(fetchMessage(NONE, info(1, 0, 0, 2), false), /2 pages need a newer version/);

// the pictures inside the file: only for pages that were accepted, only a proper JPEG (and PNG outline) with a whole credit
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const credit = { title: "T", artist: "A", credit: "C", licence: "Public domain", licence_url: "https://example.org/l", page: "https://example.org/p" };
const file = JSON.stringify({
  format: 1,
  pictures: { "a-story": { image: JPEG, credit }, "not-accepted": { image: JPEG, credit }, "bad-image": { image: "aGVsbG8=", credit }, "no-credit": { image: JPEG, credit: { title: "T" } } },
  child_pictures: { "a-child": { image: JPEG, outline: PNG, credit }, "plain-child": { image: JPEG, credit }, "bad-outline": { image: JPEG, outline: JPEG, credit } },
});
const p = picturesFrom(file, { stories: ["a-story", "bad-image", "no-credit"], children: ["a-child", "plain-child", "bad-outline", "missing"] });
assert.deepEqual(Object.keys(p.stories), ["a-story"]);
assert.equal(p.stories["a-story"].url, `data:image/jpeg;base64,${JPEG}`);
assert.equal(p.stories["a-story"].credit.artist, "A");
assert.deepEqual(Object.keys(p.children).sort(), ["a-child", "bad-outline", "plain-child"]);
assert.equal(p.children["a-child"].outline, `data:image/png;base64,${PNG}`);
assert.equal(p.children["plain-child"].outline, null);
assert.equal(p.children["bad-outline"].outline, null, "an outline that is not a PNG is dropped, the picture stays");
assert.deepEqual(picturesFrom("not json", { stories: ["a-story"], children: [] }), { stories: {}, children: {} });
assert.deepEqual(picturesFrom("[]", { stories: ["a-story"], children: [] }), { stories: {}, children: {} });

// a file that is not what the app reads gives no pages and no pictures
const none = readExtraFile("not json");
assert.equal(none.pages.stories.length + none.pages.children.length, 0);
assert.deepEqual(none.pictures, { stories: {}, children: {} });

// the real file the owner published, when it is here: its pages pass the app's own check and its pictures are found
const real = "installer/packs/ready-to-upload/extra-pages.json";
if (existsSync(real)) {
  const r = readExtraFile(readFileSync(real, "utf8"));
  assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
  assert.ok(r.pages.stories.length + r.pages.children.length > 0);
  for (const s of r.pages.stories) assert.ok(r.pictures.stories[s.id], `a picture for ${s.id}`);
  for (const c of r.pages.children) assert.ok(r.pictures.children[c.id], `a picture for ${c.id}`);
  console.log(`extra fetch: the real file reads (${r.pages.stories.length} stories, ${r.pages.children.length} children's pages, all with pictures)`);
}
console.log("extra fetch: all checks passed");
