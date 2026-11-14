// The words of a restore. Run: node --experimental-strip-types scripts/test_restore.mts
import assert from "node:assert/strict";
import { broughtText, confirmText, whenText } from "../src/restore.ts";

assert.equal(whenText(0), "");
assert.match(whenText(new Date(2026, 10, 12, 9, 5).getTime()), /^12 Nov 2026 at 9:05$/);
const c = confirmText("Automatic backup 2026-11-12 0905.json", new Date(2026, 10, 12, 9, 5).getTime());
assert.ok(c.startsWith("Restore from “Automatic backup 2026-11-12 0905.json”, saved 12 Nov 2026 at 9:05?"), c);
assert.match(c, /Nothing you have now is deleted/);
assert.ok(confirmText("a.json", 0).startsWith("Restore from “a.json”?"), "no date when none is known");
assert.equal(broughtText({ notes: 2, highlights: 1, bookmarks: 0, plans: 1, sermons: 3 }, ""), "Restored 2 notes, 1 highlight, 0 bookmarks, 1 reading plan and 3 sermons. Nothing already here was deleted.");
assert.ok(broughtText({ notes: 0, highlights: 0, bookmarks: 0, plans: 0, sermons: 0 }, "Content Factory: 2 ready-to-post items came back.").endsWith(" Content Factory: 2 ready-to-post items came back."));
console.log("restore: all checks passed");
