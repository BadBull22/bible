import assert from "node:assert/strict";
import { addShortcut, DEFAULT_SHORTCUTS, MAX_SHORTCUTS, moveShortcut, parseShortcuts, removeShortcut, resetShortcuts, resolveShortcuts } from "../src/shortcuts.ts";

// the default is the six default tiles: not custom, nothing placed
assert.deepEqual(DEFAULT_SHORTCUTS, { custom: false, ids: [] });

// the first shortcut replaces the default tiles
let s = addShortcut(DEFAULT_SHORTCUTS, "map");
assert.deepEqual(s, { custom: true, ids: ["map"] });
// no repeats
assert.equal(addShortcut(s, "map"), s);
// up to six
for (const id of ["study", "library", "timeline", "dictionary", "pictures"]) s = addShortcut(s, id);
assert.equal(s.ids.length, MAX_SHORTCUTS);
assert.equal(MAX_SHORTCUTS, 6);
const full = addShortcut(s, "settings");
assert.equal(full, s, "a seventh is refused");
assert.deepEqual(s.ids, ["map", "study", "library", "timeline", "dictionary", "pictures"]);

// removing one keeps the order of the rest
s = removeShortcut(s, "library");
assert.deepEqual(s.ids, ["map", "study", "timeline", "dictionary", "pictures"]);
assert.equal(s.custom, true);
// a place is free again
s = addShortcut(s, "settings");
assert.equal(s.ids.at(-1), "settings");
// removing something that is not there changes nothing important
assert.deepEqual(removeShortcut(s, "nothing").ids, s.ids);

// removing the last brings the default tiles back
let one = addShortcut(DEFAULT_SHORTCUTS, "map");
assert.deepEqual(removeShortcut(one, "map"), DEFAULT_SHORTCUTS);
// "Back to the default"
assert.deepEqual(resetShortcuts(), DEFAULT_SHORTCUTS);

// what is saved is made safe
assert.deepEqual(parseShortcuts(null), DEFAULT_SHORTCUTS);
assert.deepEqual(parseShortcuts({}), DEFAULT_SHORTCUTS);
assert.deepEqual(parseShortcuts({ ids: [] }), DEFAULT_SHORTCUTS);
assert.deepEqual(parseShortcuts({ ids: "map" }), DEFAULT_SHORTCUTS);
assert.deepEqual(parseShortcuts({ ids: ["map", 5, null, "map", "", "study"] }), { custom: true, ids: ["map", "study"] });
assert.equal(parseShortcuts({ ids: ["a", "b", "c", "d", "e", "f", "g", "h"] }).ids.length, 6);

// a target that no longer exists is skipped
const targets = [{ id: "map" }, { id: "study" }];
assert.deepEqual(resolveShortcuts({ custom: true, ids: ["map", "gone", "study"] }, targets), [{ id: "map" }, { id: "study" }]);

// moving: a shortcut takes the place of the tile it is dropped on, the others make room
const abcd = { custom: true, ids: ["a", "b", "c", "d"] };
assert.deepEqual(moveShortcut(abcd, "a", 2).ids, ["b", "c", "a", "d"]);
assert.deepEqual(moveShortcut(abcd, "d", 1).ids, ["a", "d", "b", "c"]);
assert.deepEqual(moveShortcut(abcd, "b", 0).ids, ["b", "a", "c", "d"]);
assert.deepEqual(moveShortcut(abcd, "c", 3).ids, ["a", "b", "d", "c"]);
assert.equal(moveShortcut(abcd, "b", 1), abcd, "dropping on its own place changes nothing");
assert.equal(moveShortcut(abcd, "zzz", 1), abcd, "an unknown shortcut changes nothing");
assert.deepEqual(moveShortcut(abcd, "a", 99).ids, ["b", "c", "d", "a"], "a place past the end is the last place");
assert.deepEqual(moveShortcut(abcd, "d", -5).ids, ["d", "a", "b", "c"], "a place before the start is the first place");
assert.equal(moveShortcut(abcd, "a", 2).ids.length, 4);

console.log("shortcuts: all checks passed");
