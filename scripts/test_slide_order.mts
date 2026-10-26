import assert from "node:assert/strict";
import { dropGap, moveInSermon, moveSlides, sermonFollows, stepGap, syncSermon, unitOf } from "../src/slideOrder.ts";

let n = 0;
const id = () => `i${++n}`;
const block = (role: string, label: string, level: 1 | 2) => ({ id: id(), type: "block", role, label, prompt: "", text: "", level }) as any;
const heading = (text: string) => ({ id: id(), type: "heading", text }) as any;
const verse = (title: string, v: number) => ({ id: id(), type: "material", material: { key: title, kind: "section", title, text: `${title} words.`, source: "BSB", ref: { book: "John", chapter: 3, verse: v, verseEnd: v + 4 }, topic: "" } }) as any;
const picture = (title: string) => ({ id: id(), type: "media", media: { kind: "image", title, file: `${title}.png` } }) as any;

// Introduction; Point 1 (v1); Point 2 (v2, v3, a picture under Illustrate); Point 3 (v4); Conclusion
const intro = block("intro", "Introduction", 1);
const p1 = heading("Point 1"), s1 = block("scripture", "Scripture", 2), v1 = verse("John 3:1-5", 1), e1 = block("explain", "Explain", 2);
const p2 = heading("Point 2"), s2 = block("scripture", "Scripture", 2), v2 = verse("John 3:6-10", 6), v3 = verse("John 3:11-15", 11), i2 = block("illustrate", "Illustrate", 2), pic = picture("Nicodemus");
const p3 = heading("Point 3"), s3 = block("scripture", "Scripture", 2), v4 = verse("John 3:16-20", 16);
const concl = block("conclusion", "Conclusion", 1);
const ITEMS: any[] = [intro, p1, s1, v1, e1, p2, s2, v2, v3, i2, pic, p3, s3, v4, concl];
// the slides as sermonOutputs.slidesOf makes them (it can't be loaded here: it reaches the app's
// Tauri layer): a fixed title slide, a slide per point, per passage and per picture, each knowing its item
const slidesFor = (items: any[]): any[] => [
  { kind: "title", title: "John 3", body: "", pinned: true },
  ...items.flatMap((i): any[] =>
    i.type === "heading"
      ? [{ kind: "point", title: i.text, body: "", from: i.id }]
      : i.type === "material"
        ? ["passage", "section", "verse", "xref"].includes(i.material.kind)
          ? [{ kind: "scripture", title: i.material.title, body: i.material.text, from: i.id }]
          : []
        : i.type === "media"
          ? [{ kind: "image", title: i.media.title, body: "", image: i.media.file, from: i.id }]
          : [],
  ),
];
const titles = (slides: any[]) => slides.map((s) => s.title);

const slides = slidesFor(ITEMS);
assert.deepEqual(titles(slides), ["John 3", "Point 1", "John 3:1-5", "Point 2", "John 3:6-10", "John 3:11-15", "Nicodemus", "Point 3", "John 3:16-20"], "slides as the sermon gives them");
const at = (title: string) => slides.findIndex((s) => s.title.startsWith(title));
assert.ok(slides[0].pinned, "the title slide is fixed");

// units: a point takes its slides with it; a picture or passage is alone
assert.deepEqual(unitOf(slides, ITEMS, at("Point 1")), [1, 3]);
assert.deepEqual(unitOf(slides, ITEMS, at("Point 2")), [3, 7]);
assert.deepEqual(unitOf(slides, ITEMS, at("Point 3")), [7, 9]);
assert.equal(unitOf(slides, ITEMS, 0), null, "the title slide can't be moved");
assert.deepEqual(unitOf(slides, ITEMS, at("Nicodemus")), [6, 7]);

/** drag slide `from` (by its start of title) to `gap`; the items, the slides moved as a list, and the slides made again */
function drag(from: string, gap: number) {
  const i = at(from);
  const g = dropGap(slides, ITEMS, i, gap);
  assert.notEqual(g, null, `${from} to ${gap} should move`);
  const u = unitOf(slides, ITEMS, i)!;
  const items = moveInSermon(ITEMS, slides, u, g!);
  return { items, moved: moveSlides(slides, u, g!).slides, made: slidesFor(items) };
}
const same = (r: ReturnType<typeof drag>, what: string) => {
  assert.deepEqual(titles(r.made), titles(r.moved), `${what}: the slides made from the sermon match the slides as moved`);
  // the other way round: slides moved on their own, then the sermon made to match them
  assert.equal(sermonFollows(ITEMS, r.moved), false, `${what}: the sermon, untouched, is out of step with the moved slides`);
  const matched = syncSermon(ITEMS, r.moved);
  assert.deepEqual(titles(slidesFor(matched)), titles(r.moved), `${what}: the sermon made to match the slides gives the slides as moved`);
  assert.equal(sermonFollows(matched, r.moved), true, `${what}: and then it follows them`);
  assert.deepEqual(matched.map((i: any) => i.id), r.items.map((i: any) => i.id), `${what}: the same sermon as moving it with the slide`);
};
const names = (items: any[]) => items.map((x) => x.text ?? x.label ?? x.material?.title ?? x.media?.title);

// a point to the front: Point 3 before Point 1, with its passage
let r = drag("Point 3", 1);
same(r, "Point 3 first");
assert.equal(names(r.items).indexOf("Point 3") < names(r.items).indexOf("Point 1"), true);
assert.equal(r.items.at(-1).id, concl.id, "the Conclusion stays last");

// a point to the end: Point 1 after Point 3, before the Conclusion
r = drag("Point 1", slides.length);
same(r, "Point 1 last");
assert.equal(r.items.at(-1).id, concl.id);
assert.equal(r.items.indexOf(p1) > r.items.indexOf(v4), true);

// a point dropped in the middle of another point's slides goes to the nearest edge between points
assert.equal(dropGap(slides, ITEMS, at("Point 1"), at("Nicodemus")), at("Point 3"), "a point only lands between points");

// a passage first in its point: John 3:11-15 above John 3:6-10
r = drag("John 3:11", at("John 3:6"));
same(r, "swap the two passages of Point 2");
assert.equal(r.items.indexOf(v3) < r.items.indexOf(v2), true);

// the picture up into Point 1, after its passage
r = drag("Nicodemus", at("Point 2"));
same(r, "the picture to Point 1");
assert.equal(r.items.indexOf(pic) > r.items.indexOf(v1) && r.items.indexOf(pic) < r.items.indexOf(p2), true, "the picture is in Point 1's part now");

// a passage down to the very end: after John 3:16-20, still before the Conclusion
r = drag("John 3:1", slides.length);
same(r, "passage to the end");
assert.equal(r.items.indexOf(v1) > r.items.indexOf(v4) && r.items.indexOf(v1) < r.items.indexOf(concl), true);

// a passage straight after a point's own slide goes to the start of that point's Scripture
r = drag("John 3:11", at("Point 2") + 1);
same(r, "to the start of Point 2");
assert.equal(r.items.indexOf(v3) === r.items.indexOf(s2) + 1, true, "first in Point 2's Scripture section");

// a passage to the very top (after the title slide): the first part, which is the Introduction here
r = drag("John 3:6", 1);
same(r, "passage to the top");
assert.equal(r.items.indexOf(v2) === r.items.indexOf(intro) + 1, true, "straight after the Introduction's own line");

// nothing above the title slide, and no move that changes nothing
assert.equal(dropGap(slides, ITEMS, at("Point 1"), 0), null);
assert.equal(dropGap(slides, ITEMS, at("Point 1"), at("Point 1")), null);
assert.equal(dropGap(slides, ITEMS, at("Point 1"), at("Point 2")), null, "just after itself is where it is");

// the Earlier / Later buttons use the same steps
assert.equal(stepGap(slides, ITEMS, at("Point 2"), -1), at("Point 1"));
assert.equal(stepGap(slides, ITEMS, at("Point 1"), -1), null, "nothing earlier than the first point");
assert.equal(stepGap(slides, ITEMS, at("Point 3"), 1), null, "nothing later than the last point");
assert.equal(stepGap(slides, ITEMS, at("Point 1"), 1), at("Point 3"), "Point 1 swaps with Point 2");
assert.equal(stepGap(slides, ITEMS, at("John 3:6"), -1), at("Point 2"), "up past a point's own slide");
assert.equal(stepGap(slides, ITEMS, at("Nicodemus"), 1), at("Point 3") + 1, "down past the next point's slide");

// a passage over several slides moves as one, and can't be dropped into
const chunks = [slides[0], slides[1], { ...slides[2], title: "John 3:1-3" }, { ...slides[2], title: "John 3:4-5" }, ...slides.slice(3)];
assert.deepEqual(unitOf(chunks, ITEMS, 2), [2, 4]);
assert.deepEqual(unitOf(chunks, ITEMS, 3), [2, 4], "either chunk is the same unit");
assert.equal(dropGap(chunks, ITEMS, at("Nicodemus") + 1, 3), 2, "a drop between the chunks goes to the nearer edge");

// the preacher's own slides: they just move, and the sermon stays as it was
const own = [...slides.slice(0, 3), { kind: "text", title: "My song", body: "" }, ...slides.slice(3)];
const j = own.findIndex((s) => s.title === "My song");
assert.deepEqual(unitOf(own, ITEMS, j), [j, j + 1]);
assert.deepEqual(unitOf(own, ITEMS, at("Point 1")), [1, 4], "a slide of their own stays with the point above it");
assert.equal(moveInSermon(ITEMS, own, [j, j + 1], 1), ITEMS, "a slide that is not from the sermon changes nothing in it");

// a slide whose item has gone: nothing to match
const gone = slides.map((s) => (s.from === pic.id ? { ...s, from: "removed" } : s));
const k = gone.findIndex((s) => s.from === "removed");
assert.equal(moveInSermon(ITEMS, gone, [k, k + 1], 1), ITEMS);

// a sermon already in the slides' order is left alone
assert.equal(sermonFollows(ITEMS, slides), true);
assert.equal(syncSermon(ITEMS, slides).every((i, k) => i === ITEMS[k]), true, "nothing moved");

// slides shuffled any way at all (title first): the sermon made to match gives exactly that order
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
for (let round = 0; round < 300; round++) {
  const rest = slides.slice(1);
  for (let a = rest.length - 1; a > 0; a--) {
    const b = Math.floor(rnd() * (a + 1));
    [rest[a], rest[b]] = [rest[b], rest[a]];
  }
  const shuffled = [slides[0], ...rest];
  const matched = syncSermon(ITEMS, shuffled);
  assert.deepEqual(titles(slidesFor(matched)), titles(shuffled), `shuffle ${round}: ${titles(shuffled).join(" | ")}`);
  assert.equal(matched.length, ITEMS.length, "nothing lost or doubled");
  assert.equal(matched.at(-1)!.id, concl.id, "the Conclusion stays last");
}

// a passage under a section with no slide of its own (before the first point) is not pulled out of it
const lead = verse("John 3:1", 1);
const ITEMS2: any[] = [intro, lead, p1, s1, v1, concl];
const slides2 = [{ kind: "title", title: "T", body: "", pinned: true }, { kind: "scripture", title: "John 3:1", body: "", from: lead.id }, { kind: "point", title: "Point 1", body: "", from: p1.id }, { kind: "scripture", title: "John 3:1-5", body: "", from: v1.id }] as any[];
assert.equal(sermonFollows(ITEMS2, slides2), true, "in step as it is");
const flipped = [slides2[0], slides2[3], slides2[1], slides2[2]];
const m2 = syncSermon(ITEMS2, flipped);
assert.deepEqual(m2.map((i: any) => i.id), [intro.id, v1.id, lead.id, p1.id, s1.id, concl.id], "the passage that was under the point goes up before it, straight after the Introduction's line");

// the big idea is a slide like any other (older saved slides also had it marked fixed: that is ignored); only the title stays first
const big = { kind: "point", title: "The big idea", body: "", pinned: true } as any;
const withBig = [slides[0], big, ...slides.slice(1)];
assert.deepEqual(unitOf(withBig, ITEMS, 1), [1, 2], "the big idea can be picked up, alone");
assert.equal(moveInSermon(ITEMS, withBig, [1, 2], 5), ITEMS, "it is not from the sermon: nothing in the sermon changes");
assert.equal(dropGap(withBig, ITEMS, 1, 0), null, "nothing above the title slide");
assert.equal(dropGap(withBig, ITEMS, 1, 5), 5, "but anywhere below it");
assert.equal(unitOf(withBig, ITEMS, 0), null, "the title stays");
const above = moveInSermon(ITEMS, withBig, [withBig.findIndex((s) => s.from === v4.id), withBig.findIndex((s) => s.from === v4.id) + 1], 1);
assert.equal(above.indexOf(v4) === above.indexOf(intro) + 1, true, "a passage dropped above the big idea goes to the very top, after the Introduction's line");

// EVERY single move that can be made (any slide, any slot it can go into): the slides made again from the moved sermon must be
// exactly the slides as dropped. (A point keeps Scripture, then its own sections, then pictures: a picture dropped above a passage
// has to go before the Scripture section, not into its usual Illustrate section, or the slide would go back.)
function allMoves(items: any[], what: string) {
  const all = slidesFor(items);
  let checked = 0;
  for (let i = 1; i < all.length; i++) {
    const u = unitOf(all, items, i)!;
    if (u[0] !== i) continue; // once per unit
    for (let g = 1; g <= all.length; g++) {
      const to = dropGap(all, items, i, g);
      if (to === null || to !== g) continue;
      const moved = moveSlides(all, u, to).slides;
      const made = slidesFor(moveInSermon(items, all, u, to));
      assert.deepEqual(titles(made), titles(moved), `${what}: slide ${i} (${all[i].title}) to gap ${g}: made again ${titles(made).join(" | ")}`);
      // and the other way: the sermon made to follow the moved slides gives the same
      assert.deepEqual(titles(slidesFor(syncSermon(items, moved))), titles(moved), `${what}: slide ${i} to gap ${g}: sermon made to match`);
      checked++;
    }
  }
  assert.ok(checked > 15, `${what}: checked ${checked} moves`);
  return checked;
}
const n1 = allMoves(ITEMS, "three points");

// a sermon like the owner's: sections before the first point (one holding a verse and a passage), points whose Scripture comes
// first and then words, an article, a story and a video; things with no slide of their own sit between the ones that have
const B = (role: string, label: string, level: 1 | 2) => block(role, label, level);
const mat2 = (kind: string, title: string) => ({ id: id(), type: "material", material: { key: title + n, kind, title, text: title, topic: "" } }) as any;
const oIntro = B("intro", "Not only this passage", 1), oBg = B("context", "", 1), oSec = B("explain", "healing every disease", 1);
const oV = mat2("verse", "Matthew 9:35"), oS = mat2("section", "Mark 5:27–31");
const oH1 = heading("Mark 5:27–31"), o1s = B("scripture", "", 2), oA = mat2("xref", "Acts 19:12"), oM = mat2("xref", "Matthew 14:36"), o1e = B("explain", "", 2);
const oW1 = mat2("word", "word one"), oW2 = mat2("word", "word two"), o1i = B("illustrate", "", 2);
const oH2 = heading("Mark 5:32–34"), o2s = B("scripture", "", 2), oS2 = mat2("section", "Mark 5:32–34"), o2e = B("explain", "", 2);
const oArt = mat2("article", "Faith"), oStory = mat2("illustration", "That is Your Fault."), oVid = { id: id(), type: "media", media: { kind: "link", title: "The Chosen", url: "https://x" } } as any;
const o2a = B("apply", "", 2), oEnd = B("conclusion", "", 1);
const OWNER: any[] = [oIntro, oBg, oSec, oV, oS, oH1, o1s, oA, oM, o1e, oW1, oW2, o1i, oH2, o2s, oS2, o2e, oArt, oStory, oVid, o2a, oEnd];
const n2 = allMoves(OWNER, "the owner's kind of sermon");
console.log(`slideOrder: ${n1 + n2} single moves each give back the slides as dropped`);

console.log("slideOrder: all checks passed");
