// Listen mode's queue. Run: node --experimental-strip-types mobile/scripts/test_listen_queue.mts
import assert from "node:assert/strict";
import { buildQueue, chaptersFinished, chaptersFrom } from "../src/listenQueue.ts";

const books = [
  { name: "Genesis", chapters: 50 },
  { name: "Jude", chapters: 1 },
  { name: "Revelation", chapters: 22 },
];

// the chapters after this one: on through the book, into the next, and it ends at the end of the Bible
assert.deepEqual(chaptersFrom(books, "Genesis", 49, 4), [
  { book: "Genesis", chapter: 49 },
  { book: "Genesis", chapter: 50 },
  { book: "Jude", chapter: 1 },
  { book: "Revelation", chapter: 1 },
]);
assert.equal(chaptersFrom(books, "Revelation", 21, 10).length, 2, "nothing after Revelation 22");
assert.deepEqual(chaptersFrom(books, "Nowhere", 1, 3), []);
assert.equal(chaptersFrom(books, "Genesis", 1, 10).length, 10);

// the queue: a heading, then the verses; the first chapter can start part way
const ch = (book: string, chapter: number, n: number) => ({ book, chapter, verses: Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1}  of ${book} ${chapter}.\n` })) });
const q = buildQueue([ch("John", 3, 4), ch("John", 4, 2), ch("Jude", 1, 3)]);
assert.equal(q.pieces.length, 5 + 3 + 4);
assert.deepEqual(q.pieces[0], { t: "John, chapter 3", h: true, l: "John 3" });
assert.deepEqual(q.pieces[1], { t: "Verse 1 of John 3.", h: false, l: "John 3" }, "spaces and line breaks are tidied");
assert.deepEqual(q.spans, [{ from: 0, to: 5 }, { from: 5, to: 8 }, { from: 8, to: 12 }]);
assert.deepEqual(q.pieces.filter((p) => p.h).map((p) => p.l), ["John 3", "John 4", "Jude 1"]);
const part = buildQueue([ch("John", 3, 6), ch("John", 4, 2)], 4);
assert.equal(part.pieces[0].t, "John, chapter 3");
assert.equal(part.pieces[1].t, "Verse 4 of John 3.");
assert.equal(part.pieces.length, 1 + 3 + 3);
// an empty verse is left out; no chapters, no queue
assert.equal(buildQueue([{ book: "A", chapter: 1, verses: [{ verse: 1, text: "   " }] }]).pieces.length, 1);
assert.deepEqual(buildQueue([]), { pieces: [], spans: [] });

// which chapters were heard to the end
const spans = q.spans;
assert.equal(chaptersFinished(spans, 0, false), 0);
assert.equal(chaptersFinished(spans, 4, false), 0, "still on the last verse of the first chapter");
assert.equal(chaptersFinished(spans, 5, false), 1, "the second chapter has begun, so the first is done");
assert.equal(chaptersFinished(spans, 8, false), 2);
assert.equal(chaptersFinished(spans, 3, true), 3, "the whole queue was read");
console.log("listen queue: all checks passed");
