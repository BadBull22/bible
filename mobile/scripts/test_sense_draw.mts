// The ring of a word's meanings: slices share the circle by their verses, the order is the most verses first, the books list is the biggest first.
// Run: node --experimental-strip-types mobile/scripts/test_sense_draw.mts
import assert from "node:assert/strict";
import { arcPath, senseArcs, senseColour, senseOrder, topBooks } from "../src/senseDraw.ts";

assert.deepEqual(senseOrder([3, 10, 10, 1]), [1, 2, 0, 3], "most verses first, a tie keeps the dictionary's order");
const arcs = senseArcs([50, 25, 25]);
assert.equal(arcs.length, 3);
assert.ok(Math.abs(arcs[0].to - arcs[0].from - Math.PI) < 0.05, "half the verses take half the ring");
assert.ok(arcs[1].from >= arcs[0].to, "slices do not overlap");
assert.ok(arcs[2].to < Math.PI * 2, "the last slice stops short of closing the circle");
assert.deepEqual(senseArcs([0, 0]), [], "nothing to draw without verses");
assert.equal(senseArcs([7]).length, 1, "one meaning is a whole ring");
assert.match(arcPath(170, 170, 100, 150, 0, 1), /^M[\d.,-]+ A150,150 0 0 1 .* Z$/);
assert.match(arcPath(170, 170, 100, 150, 0, 4), / 0 1 1 /, "a slice over half the ring takes the long way round");
assert.notEqual(senseColour(0, 5), senseColour(1, 5));
const names = ["Genesis", "Exodus", "Psalms"];
assert.deepEqual(topBooks([2, 0, 9], names, 5), [{ book: "Psalms", count: 9 }, { book: "Genesis", count: 2 }]);
assert.equal(topBooks([5, 4, 3], names, 2).length, 2, "only the first n books");
console.log("sense_draw: ok");
