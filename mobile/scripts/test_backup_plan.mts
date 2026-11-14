// When automatic backup copies are made. Run: node --experimental-strip-types mobile/scripts/test_backup_plan.mts
import assert from "node:assert/strict";
import { backupFileName, hashOf, isEmpty, lastText, QUIET_MS, timeForCopy } from "../src/backupPlan.ts";

assert.equal(backupFileName("2026-11-14"), "Bible Concordance backup 2026-11-14.json");
// nothing changed: never; changed: after a quiet while, or at once when leaving
assert.equal(timeForCopy({ dirty: false, changedAt: 0, now: 9e9, leaving: true }), false);
assert.equal(timeForCopy({ dirty: true, changedAt: 1000, now: 1000 + QUIET_MS - 1, leaving: false }), false);
assert.equal(timeForCopy({ dirty: true, changedAt: 1000, now: 1000 + QUIET_MS, leaving: false }), true);
assert.equal(timeForCopy({ dirty: true, changedAt: 1000, now: 1001, leaving: true }), true);
// the preference checksum changes with the text
assert.equal(hashOf("a"), hashOf("a"));
assert.notEqual(hashOf('{"theme":"dark"}'), hashOf('{"theme":"light"}'));
// the words
const now = new Date(2026, 10, 14, 15, 0);
assert.equal(lastText(0, now), "never");
assert.equal(lastText(new Date(2026, 10, 14, 14, 2).getTime(), now), "today at 14:02");
assert.equal(lastText(new Date(2026, 10, 13, 9, 30).getTime(), now), "yesterday at 09:30");
assert.equal(lastText(new Date(2026, 10, 9, 9, 30).getTime(), now), "9 Nov at 09:30");
assert.equal(isEmpty({ bookmarks: 0, highlights: 0, notes: 0, plans: 0 }, null), true);
assert.equal(isEmpty({ bookmarks: 0, highlights: 0, notes: 1, plans: 0 }, null), false);
assert.equal(isEmpty({ bookmarks: 0, highlights: 0, notes: 0, plans: 0 }, "My Bible"), false);
console.log("backup plan: all checks passed");
