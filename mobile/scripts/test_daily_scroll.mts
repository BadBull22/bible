// How the Daily Scroll chooses its cards. Run: node --experimental-strip-types mobile/scripts/test_daily_scroll.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRef } from "../../src/browse/browseLogic.ts";
import { buildDeck, buildPool, dayNumber, firstSentences, hashOf, kindLabel, pickCards, trimWords, recentIds, remember, REST_DAYS, RHYTHM, type History, type Sources } from "../src/dailyScroll.ts";

const verses = [...JSON.parse(readFileSync("mobile/data/daily_scroll_verse_cards.json", "utf8")).cards, ...JSON.parse(readFileSync("mobile/data/daily_scroll_verse_cards_batch2.json", "utf8")).cards];
const stories = JSON.parse(readFileSync("src/browse/data/stories.json", "utf8")).pages;
const topics = JSON.parse(readFileSync("src/browse/data/topics.json", "utf8")).pages;
const children = JSON.parse(readFileSync("src/browse/data/children.json", "utf8")).pages;
const daily: [string, number, number, number][] = [...readFileSync("mobile/src/votd.ts", "utf8").matchAll(/\["([^"]+)", (\d+), (\d+), (\d+)\]/g)].map((m) => [m[1], +m[2], +m[3], +m[4]]);
const authors = [...readFileSync("src/bibleAuthors.ts", "utf8").matchAll(/name: "([^"]+)",\s*testament: "[^"]+",\s*note: "([^"]+)"/g)].map((m) => ({ name: m[1], note: m[2], books: [] }));
const src: Sources = {
  verseCards: verses.map((c: { id: string; ref: string }) => ({ id: c.id, ref: c.ref })),
  daily,
  topics: topics.map((t: { id: string; title: string; items: { ref: string; note: string }[] }) => ({ id: t.id, title: t.title, items: t.items })),
  stories: stories.map((s: { id: string; title: string; summary: string }) => ({ id: s.id, title: s.title, summary: s.summary })),
  authors,
  children: children.map((c: { id: string; title: string; memory: { ref: string } }) => ({ id: c.id, title: c.title, memory: c.memory })),
};
const pool = buildPool(src);
console.log(`pool: ${pool.length} cards (${verses.length} verse cards, ${daily.length} daily, ${topics.reduce((n: number, t: { items: unknown[] }) => n + t.items.length, 0)} topic passages, ${stories.length} stories, ${authors.length} authors, ${children.length} memory verses)`);
assert.ok(pool.length >= 950, "about a thousand cards are held");
assert.equal(new Set(pool.map((c) => c.id)).size, pool.length, "every card has its own id");
assert.ok(pool.every((c) => (c.kind === "story" || c.kind === "author" ? !!c.text : !!c.ref)), "a card has words or a reference");

// every card that shows Scripture has a reference the screen can read (book, chapter, verses)
for (const c of pool) if (c.ref) assert.ok(parseRef(c.ref), `${c.id}: cannot read "${c.ref}"`);

// the same day gives the same deck; 20 cards, no repeats inside the deck, in the rhythm
const today = 320;
const a = buildDeck(pool, {}, today);
const b = buildDeck(pool, {}, today);
assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
assert.equal(a.length, 20);
assert.equal(new Set(a.map((c) => c.id)).size, 20);
assert.deepEqual(a.map((c) => c.kind), RHYTHM);
assert.notDeepEqual(a.map((c) => c.id), buildDeck(pool, {}, today + 1).map((c) => c.id), "another day, another deck");

// "Show me more" adds ten more cards that are not already in the deck
const more = buildDeck(pool, {}, today, 1);
assert.equal(more.length, 30);
assert.equal(new Set(more.map((c) => c.id)).size, 30);
assert.deepEqual(more.slice(0, 20).map((c) => c.id), a.map((c) => c.id), "the first twenty stay as they were");
assert.equal(buildDeck(pool, {}, today, 3).length, 50);

// nothing comes back within 50 days: simulate 48 days and look for a repeat
let history: History = {};
const seen = new Set<string>();
let lastDeck: string[] = [];
for (let d = 100; d < 148; d++) {
  const deck = buildDeck(pool, history, d);
  lastDeck = deck.map((c) => c.id);
  for (const c of deck) {
    assert.ok(!seen.has(c.id), `${c.id} came back on day ${d}`);
    seen.add(c.id);
  }
  history = remember(history, d, deck);
}
assert.equal(seen.size, 48 * 20);
// asking again on the same day (history already holds today's deck) gives today's deck, not a new one
assert.deepEqual(buildDeck(pool, history, 147).map((c) => c.id), lastDeck);
assert.equal(recentIds(history, 147).size, 47 * 20, "today's own cards are not counted as recent");
// the history forgets old days
const old = remember({ "1": ["x"], "250": ["y"] }, 250, a);
assert.equal(old["1"], undefined);
assert.deepEqual(old["250"], a.map((c) => c.id));

// a small pool (or after a full cycle) starts again rather than running dry
const tiny = pool.slice(0, 25);
assert.equal(pickCards(tiny, { "10": tiny.map((c) => c.id) }, 11, 20).length, 20);
// a kind that has run out is replaced by another: no verses at all still gives a full deck
const noVerses = pool.filter((c) => c.kind === "story" || c.kind === "author");
assert.equal(pickCards(noVerses, {}, 5, 20).length, 20);
assert.equal(pickCards([], {}, 5, 20).length, 0);

// the small things
assert.equal(firstSentences("One. Two! Three? Four.", 2), "One. Two!");
assert.equal(firstSentences("No end", 2), "No end");
assert.equal(dayNumber(new Date(2026, 0, 1)), 0);
assert.equal(dayNumber(new Date(2026, 0, 31)), 30);
assert.equal(hashOf("vc001"), hashOf("vc001"));
assert.notEqual(hashOf("vc001"), hashOf("vc002"));
assert.equal(kindLabel({ id: "x", kind: "topic", title: "Verses for… fear" }), "Verses for… fear");
assert.equal(trimWords("Short.", 50), "Short.");
assert.equal(trimWords("One two three four five six seven eight nine ten", 20), "One two three four…");
assert.equal(trimWords("A first sentence that is quite long. And a second one that goes on.", 45), "A first sentence that is quite long.");
assert.ok(trimWords("word ".repeat(300), 420).length <= 421);
assert.equal(REST_DAYS, 50);
console.log("daily scroll: all checks passed");
