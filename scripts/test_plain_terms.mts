import assert from "node:assert/strict";
import { plainTerm } from "../src/plainTerms.ts";

assert.equal(plainTerm("Easter Day: Principal Service"), "Resurrection Sunday: Principal Service (modern reference: Easter Day)");
assert.equal(plainTerm("Easter Day: Early Service"), "Resurrection Sunday: Early Service (modern reference: Easter Day)");
assert.equal(plainTerm("The Great Vigil of Easter"), "The Great Vigil of the Resurrection (modern reference: The Great Vigil of Easter)");
assert.equal(plainTerm("Monday in Easter Week"), "Monday in Resurrection Week (modern reference: Monday in Easter Week)");
assert.equal(plainTerm("Fifth Sunday in Easter"), "Fifth Sunday of the Resurrection Season (modern reference: Fifth Sunday in Easter)");
assert.equal(plainTerm("Second Sunday of Easter"), "Second Sunday of the Resurrection Season (modern reference: Second Sunday of Easter)");
assert.equal(plainTerm("Easter"), "Resurrection (modern reference: Easter)");
// nothing else changes
assert.equal(plainTerm("The Day of Pentecost"), "The Day of Pentecost");
assert.equal(plainTerm("Good Friday"), "Good Friday");
assert.equal(plainTerm("Eastern Orthodox"), "Eastern Orthodox");
assert.equal(plainTerm(""), "");

console.log("plain terms: all checks passed");
