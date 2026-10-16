import assert from "node:assert/strict";
import { movePart, moveIntoSlot, partsOf, placeFor, placeMaterial, rolesFor, slotsOf } from "../src/sermonLayout.ts";

let n = 0;
const id = () => `i${++n}`;
const block = (role: string, label: string, level: 1 | 2) => ({ id: id(), type: "block", role, label, prompt: "", text: "", level }) as any;
const heading = (text: string) => ({ id: id(), type: "heading", text }) as any;
const mat = (kind: string, title: string) => ({ id: id(), type: "material", material: { key: title, kind, title, text: "", topic: "" } }) as any;

// a Points sermon: Introduction; Point 1..2 with Scripture / Explain / Illustrate / Apply; Conclusion
const intro = block("intro", "Introduction", 1);
const p1 = heading("Point 1"), s1 = block("scripture", "Scripture", 2), e1 = block("explain", "Explain", 2), i1 = block("illustrate", "Illustrate", 2), a1 = block("apply", "Apply", 2);
const p2 = heading("Point 2"), s2 = block("scripture", "Scripture", 2), e2 = block("explain", "Explain", 2), i2 = block("illustrate", "Illustrate", 2), a2 = block("apply", "Apply", 2);
const concl = block("conclusion", "Conclusion", 1);
let items: any[] = [intro, p1, s1, e1, i1, a1, p2, s2, e2, i2, a2, concl];

const parts = partsOf(items);
assert.deepEqual(parts.map((p) => [p.kind, p.head?.id]), [["section", intro.id], ["point", p1.id], ["point", p2.id], ["section", concl.id]]);
assert.equal(slotsOf(items, parts[1]).length, 5);

const add = (m: any, focus: string | null = null) => {
  const at = placeMaterial(items, m.material, focus);
  items = [...items.slice(0, at), m, ...items.slice(at)];
  return m;
};
const after = (x: any) => items[items.findIndex((i) => i.id === x.id) - 1];

// Scripture fills each point's Scripture in turn, then commentary each Explain
const v1 = add(mat("section", "John 3:1-5"));
const v2 = add(mat("section", "John 3:6-10"));
assert.equal(after(v1).id, s1.id, "first passage under Point 1's Scripture");
assert.equal(after(v2).id, s2.id, "second under Point 2's");
const c1 = add(mat("commentary", "Clarke"));
assert.equal(after(c1).id, e1.id);
const story = add(mat("illustration", "Moody"));
assert.equal(after(story).id, i1.id);
// background with no Background section: the Introduction
const bg = add(mat("background", "Tyndale"));
assert.equal(after(bg).id, intro.id);
// working in Point 2: commentary goes to its Explain, even though Point 1's is taken anyway
const c2 = add(mat("commentary", "Barnes"), p2.id);
assert.equal(after(c2).id, e2.id);
// a section clicked: what fits goes into it, a second goes after the first
const q1 = add(mat("quote", "Spurgeon says"), i2.id);
const q2 = add(mat("quote", "Moody says"), i2.id);
assert.equal(after(q1).id, i2.id);
assert.equal(after(q2).id, q1.id);
// a section clicked that doesn't take it (Apply): it still goes there, as the preacher chose
const sp = add(mat("sermon", "No. 130"), a2.id);
assert.equal(after(sp).id, a2.id);
// pictures and links go where stories go
assert.deepEqual(rolesFor("video").slice(0, 1), ["illustrate"]);
// with no template yet, everything goes to the end
assert.equal(placeFor([mat("passage", "x")], ["scripture"], null), 1);

// moving Point 2 (with all it holds) before Point 1
const moved = movePart(items, p2.id, p1.id);
const heads = partsOf(moved).map((p) => p.head?.id);
assert.deepEqual(heads, [intro.id, p2.id, p1.id, concl.id]);
assert.equal(moved.length, items.length);
const p2part = partsOf(moved)[1];
assert.ok(moved.slice(p2part.start, p2part.end).some((i) => i.id === c2.id), "Point 2 took its commentary with it");
// ...and to the end
assert.equal(partsOf(movePart(items, p1.id, null)).at(-1)!.head!.id, p1.id);

// dragging the story from Point 1's Illustrate into Point 2's Explain
const m2 = moveIntoSlot(items, story.id, e2.id);
const e2part = partsOf(m2).find((p) => p.head?.id === p2.id)!;
const e2slot = slotsOf(m2, e2part).find((s) => s.block?.id === e2.id)!;
assert.ok(e2slot.members.map((k) => m2[k].id).includes(story.id));
assert.equal(m2.length, items.length);
// a section or a point can't be dropped into a section
assert.equal(moveIntoSlot(items, e1.id, e2.id), items);
assert.equal(moveIntoSlot(items, p1.id, e2.id), items);

console.log("sermonLayout: all checks passed");
