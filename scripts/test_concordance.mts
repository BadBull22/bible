// The Concordance's arithmetic and wording. Run: node scripts/test_concordance.mts
import assert from "node:assert/strict";
import { bookLine, byTestament, heat, mark, summary, thousands, type BookCount } from "../src/concordance.ts";

const b = (book: string, testament: string, order_index: number, verses: number, occurrences: number): BookCount => ({ book, testament, order_index, verses, occurrences });
const books = [b("Matthew", "NT", 40, 10, 14), b("Genesis", "OT", 1, 20, 25), b("Exodus", "OT", 2, 0, 0), b("John", "NT", 43, 52, 57)];

// the two testaments, each in the order of the Bible, with their totals
const t = byTestament(books);
assert.deepEqual(t.ot.books.map((x) => x.book), ["Genesis", "Exodus"]);
assert.deepEqual(t.nt.books.map((x) => x.book), ["Matthew", "John"]);
assert.equal(t.ot.occurrences, 25);
assert.equal(t.nt.occurrences, 71);
assert.equal(t.nt.verses, 62);
assert.deepEqual(byTestament([]).ot, { books: [], occurrences: 0, verses: 0 });

// the shading: none for none, full for the busiest, and a small count is still seen
assert.equal(heat(0, 57), 0);
assert.equal(heat(57, 57), 1);
assert.ok(heat(1, 100) >= 0.09 && heat(1, 100) < 0.2, "one use among a hundred is still faintly shaded");
assert.ok(heat(14, 57) > heat(2, 57));
assert.equal(heat(5, 0), 0);
assert.equal(heat(99, 10), 1, "never above one");

// the wording
assert.equal(thousands(1234567), "1,234,567");
assert.equal(summary("love", 310, 280, "BSB", []), "“love” appears 310 times in 280 verses in the BSB.");
assert.equal(summary("faith", 1, 1, "KJV", []), "“faith” appears 1 time in 1 verse in the KJV.");
assert.equal(summary("believe", 300, 270, "BSB", ["believe", "believes"]), "“believe” and its forms appear 300 times in 270 verses in the BSB.");
assert.equal(summary("zzz", 0, 0, "BSB", []), "“zzz” does not appear in the BSB.");
assert.equal(bookLine("John", 57, 52), "John: 57 times in 52 verses");
assert.equal(bookLine("Jude", 1, 1), "Jude: 1 time in 1 verse");
assert.equal(bookLine("Psalms", 1234, 900), "Psalms: 1,234 times in 900 verses");

// the word marked in a verse
const verse = "For God so loved the world; and loved ones, Loved.";
const pieces = mark(verse, String.raw`\b(?:love|loved|loves)\b`);
assert.equal(pieces.map((p) => p.text).join(""), verse, "nothing is lost");
assert.deepEqual(pieces.filter((p) => p.hit).map((p) => p.text), ["loved", "loved", "Loved"], "the matches, in the case they are written");
assert.equal(mark("no match here", String.raw`\bgold\b`).length, 1);
assert.deepEqual(mark("gold", String.raw`\bgold\b`), [{ text: "gold", hit: true }]);
assert.deepEqual(mark("plain", "(["), [{ text: "plain", hit: false }], "a broken pattern leaves the verse as it is");
console.log("concordance: all checks passed");
