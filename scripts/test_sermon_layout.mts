import assert from "node:assert/strict";
import { movePart, moveIntoSlot, partsOf, placeFor, placeMaterial, pointOfRef, rolesFor, slotsOf } from "../src/sermonLayout.ts";

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


// material about a verse range goes to the point whose Scripture covers it
const sec = (a: number, b: number) => ({ id: id(), type: "material", material: { key: `s:${a}`, kind: "section", title: `John 3:${a}-${b}`, text: "", topic: "", ref: { book: "John", chapter: 3, verse: a, verseEnd: b } } }) as any;
const g1 = heading("Part 1"), gs1 = block("scripture", "The verses", 2), ge1 = block("explain", "What it says", 2);
const g2 = heading("Part 2"), gs2 = block("scripture", "The verses", 2), ge2 = block("explain", "What it says", 2);
const sec1 = sec(1, 8), sec2 = sec(9, 15);
let gi: any[] = [g1, gs1, sec1, ge1, g2, gs2, sec2, ge2];
assert.equal(pointOfRef(gi, { book: "John", chapter: 3, verse: 10, verseEnd: 12 }), g2.id);
assert.equal(pointOfRef(gi, { book: "John", chapter: 3, verse: 2, verseEnd: 2 }), g1.id);
assert.equal(pointOfRef(gi, { book: "John", chapter: 4, verse: 2, verseEnd: 2 }), null);
const clark = { id: id(), type: "material", material: { key: "c1", kind: "commentary", title: "Clarke on John 3:10", text: "", topic: "", ref: { book: "John", chapter: 3, verse: 10, verseEnd: 10 } } } as any;
const at2 = placeMaterial(gi, clark.material, null);
gi = [...gi.slice(0, at2), clark, ...gi.slice(at2)];
assert.equal(gi[gi.indexOf(clark) - 1].id, ge2.id, "commentary on verse 10 goes into Part 2's explanation");
// with no section covering it, the old rule still applies (first empty fitting section)
const other = { key: "c2", kind: "commentary", title: "x", text: "", topic: "", ref: { book: "Romans", chapter: 1, verse: 1, verseEnd: 1 } } as any;
assert.equal(gi[placeMaterial(gi, other, null) - 1].id, ge1.id);
// a clicked point still wins
assert.equal(gi[placeMaterial(gi, clark.material, g1.id) - 1].id, ge1.id);
console.log("sermonLayout: all checks passed");

// ---- Scripture on slides (sermonOutputs): whole verses, a few to a slide
{
  const { scriptureSlides, tidyQuotes, versesOf } = await import("../src/scriptureSlides.ts");
  const john = "16 For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life. 17 For God did not send His Son into the world to condemn the world, but to save the world through Him. 18 Whoever believes in Him is not condemned, but whoever does not believe has already been condemned, because he has not believed in the name of God’s one and only Son. 19 And this is the verdict: The Light has come into the world, but men loved the darkness rather than the Light because their deeds were evil.";
  assert.deepEqual(versesOf(john, 16).map((v) => v.n), [16, 17, 18, 19]);
  assert.deepEqual(versesOf("1 He chose the 12 tribes. 2 And they went", 1).map((v) => [v.n, v.text]), [[1, "He chose the 12 tribes."], [2, "And they went"]], "a number inside a verse is not a verse");
  assert.deepEqual(versesOf("No numbers here at all.", 5), [{ n: null, text: "No numbers here at all." }]);
  const parts = scriptureSlides(john, 16, true);
  assert.ok(parts.length >= 2 && parts.every((p) => p.text.length <= 360), JSON.stringify(parts.map((p) => p.text.length)));
  assert.deepEqual(parts.map((p) => [p.from, p.to]).flat().filter((x) => x != null)[0], 16);
  assert.ok(parts.every((p) => /^\d+ /.test(p.text)), "each slide starts at a verse");
  assert.equal(parts[parts.length - 1].to, 19);
  const bare = scriptureSlides(john, 16, false);
  assert.ok(bare.every((p) => !/\b1[6-9] /.test(p.text)), "verse numbers off");
  const many = Array.from({ length: 12 }, (_, i) => `${i + 1} Short verse ${i + 1}.`).join(" ");
  assert.deepEqual(scriptureSlides(many, 1, true).map((p) => [p.from, p.to]), [[1, 4], [5, 8], [9, 12]], "at most four verses a slide");
  const long = "1 " + "A very long verse that goes on and on. ".repeat(20) + "2 Short.";
  const lp = scriptureSlides(long, 1, true);
  assert.ok(lp.length >= 3 && lp.every((p) => p.text.length <= 380), "a long verse is split at sentences");
  assert.equal(tidyQuotes("Jesus said, “ Rabbi, ‘ You are,’ ” he said. ”"), "Jesus said, “Rabbi, ‘You are,’” he said.”");
  console.log("scripture on slides: ok");
}
