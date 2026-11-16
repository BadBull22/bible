// Memory verse practice: the boxes, the days, the blanks. Run: node --experimental-strip-types mobile/scripts/test_memory_verse.mts
import assert from "node:assert/strict";
import { addDays, afterPractice, blankWords, dayString, daysBetween, dueVerses, firstLetters, INTERVALS, levelForBox, refOf, stageName, SUGGESTED, TOP_BOX } from "../src/memoryVerse.ts";

// days
assert.equal(dayString(new Date(2026, 10, 16, 23, 59)), "2026-11-16");
assert.equal(addDays("2026-11-30", 1), "2026-12-01");
assert.equal(addDays("2026-03-01", -1), "2026-02-28");
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
assert.equal(addDays("2026-03-28", 2), "2026-03-30", "across a clock change nothing slips a day");
assert.equal(addDays("2026-10-24", 2), "2026-10-26");
assert.equal(daysBetween("2026-11-16", "2026-11-20"), 4);
assert.equal(daysBetween("2026-11-20", "2026-11-16"), -4);

// the boxes: knowing it moves up and waits longer; not yet goes back to the start and comes round tomorrow; the top box stays at the top
assert.deepEqual(afterPractice(0, true, "2026-11-16"), { box: 1, due_on: "2026-11-17" });
assert.deepEqual(afterPractice(1, true, "2026-11-16"), { box: 2, due_on: "2026-11-19" });
assert.deepEqual(afterPractice(3, true, "2026-11-16"), { box: 4, due_on: "2026-11-30" });
assert.deepEqual(afterPractice(5, true, "2026-11-16"), { box: 6, due_on: addDays("2026-11-16", 60) });
assert.deepEqual(afterPractice(TOP_BOX, true, "2026-11-16"), { box: TOP_BOX, due_on: addDays("2026-11-16", 60) });
assert.deepEqual(afterPractice(4, false, "2026-11-16"), { box: 0, due_on: "2026-11-17" });
assert.deepEqual(afterPractice(-3, true, "2026-11-16"), { box: 1, due_on: "2026-11-17" }, "a bad box is treated as the start");
assert.ok(INTERVALS.every((n, i) => i === 0 || n > INTERVALS[i - 1]), "the gaps only grow");

// what is due: today and overdue, the oldest first
const list = [
  { due_on: "2026-11-20" },
  { due_on: "2026-11-14" },
  { due_on: "2026-11-16" },
  { due_on: "2026-11-17" },
];
assert.deepEqual(dueVerses(list, "2026-11-16").map((v) => v.due_on), ["2026-11-14", "2026-11-16"]);
assert.deepEqual(dueVerses(list, "2026-11-01"), []);

// names
assert.equal(stageName(0), "New");
assert.equal(stageName(1), "Learning");
assert.equal(stageName(4), "Getting there");
assert.equal(stageName(5), "Strong");
assert.equal(stageName(6), "Learned");
assert.equal(refOf({ book: "John", chapter: 3, verse: 16, verse_end: 16 }), "John 3:16");
assert.equal(refOf({ book: "John", chapter: 3, verse: 16, verse_end: 17 }), "John 3:16-17");

// the blanks: none at level 0, all at 4, about a quarter/half/three quarters between; the same every time for the same verse; the words keep their order
const text = "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";
const n = text.split(" ").length;
assert.equal(blankWords(text, 0, "John 3:16").hiddenCount, 0);
assert.equal(blankWords(text, 4, "John 3:16").hiddenCount, n);
for (const [level, share] of [[1, 0.25], [2, 0.5], [3, 0.75]] as const) assert.equal(blankWords(text, level, "John 3:16").hiddenCount, Math.round(n * share));
assert.deepEqual(blankWords(text, 2, "John 3:16"), blankWords(text, 2, "John 3:16"));
assert.notDeepEqual(blankWords(text, 2, "John 3:16").parts.map((p) => p.hidden), blankWords(text, 2, "Psalms 23:1").parts.map((p) => p.hidden), "another verse hides other words");
assert.equal(blankWords(text, 2, "x").parts.map((p) => p.word).join(" "), text);
assert.equal(blankWords("", 2, "x").parts.length, 0);
assert.equal(blankWords(text, 9, "x").hiddenCount, n, "a level too high is the top level");

// the level of hiding grows with the box and never leaves 1 to 4
assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(levelForBox), [1, 1, 2, 2, 3, 3, 4]);
assert.equal(levelForBox(-4), 1);
assert.equal(levelForBox(99), 4);

// first letters
assert.equal(firstLetters("For God so loved"), "F G s l");
assert.equal(firstLetters("“Be still,” and know"), "B s a k");
assert.equal(firstLetters("  "), "");

// the suggestions are real references
assert.ok(SUGGESTED.length >= 8 && SUGGESTED.every(([b, c, v, e]) => b && c > 0 && v > 0 && e >= v));
console.log("memory verse: all checks passed");
