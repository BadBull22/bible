// "How are you today?": every mood leads to a real "Verses for..." page with passages. Run: node --experimental-strip-types mobile/scripts/test_moods.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOODS, passageIndex } from "../src/moods.ts";
import { parseRef } from "../../src/browse/browseLogic.ts";

const topics = JSON.parse(readFileSync("src/browse/data/topics.json", "utf8")).pages as { id: string; title: string; items: { ref: string; note: string }[] }[];
assert.ok(MOODS.length >= 12, "a good choice of moods");
assert.equal(new Set(MOODS.map((m) => m.id)).size, MOODS.length, "every mood has its own id");
for (const m of MOODS) {
  const t = topics.find((x) => x.id === m.topic);
  assert.ok(t, `${m.id}: the page "${m.topic}" exists`);
  assert.ok(t!.items.length >= 5 && t!.items.every((i) => !!parseRef(i.ref)), `${m.id}: its passages can be read`);
  assert.ok(m.label.length <= 24 && m.line.length > 10 && m.line.length < 70, `${m.id}: short label and line`);
  assert.ok(m.prayer.length > 8 && /\s$/.test(m.prayer), `${m.id}: the prayer starter ends where the reader goes on writing`);
  assert.ok(!/easter/i.test(m.label + m.line + m.prayer), "no 'Easter'");
}
// a different passage each day, the same all day, and skipping goes on to others without repeating before the page runs out
const seen = new Set<number>();
for (let skip = 0; skip < 12; skip++) seen.add(passageIndex("anxious", 100, 12, skip));
assert.equal(seen.size, 12);
assert.equal(passageIndex("anxious", 100, 12), passageIndex("anxious", 100, 12));
assert.notEqual(passageIndex("anxious", 100, 12), passageIndex("anxious", 101, 12));
assert.ok([...Array(30).keys()].every((d) => passageIndex("fear", d, 12) >= 0 && passageIndex("fear", d, 12) < 12));
assert.equal(passageIndex("fear", 5, 0), 0);
console.log("moods: all checks passed");
