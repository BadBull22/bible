import assert from "node:assert/strict";
import { autoBoxes, type Box, canHavePicture, clampBox, hasWords, overlayPlacement, planOf, solidPart } from "../src/slideLayout.ts";

const S = (kind: string, title = "T", body = "", extra: object = {}) => ({ kind, title, body, ...extra }) as any;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 100.0001 && b.y + b.h <= 100.0001;

// what has words, what can have a picture
assert.equal(hasWords(S("text", "Hi", "there")), true);
assert.equal(hasWords(S("text", "Hi", "", { noHeading: true })), false, "a heading left off with nothing under it");
assert.equal(hasWords(S("text", "Hi", "words", { noHeading: true })), true);
assert.equal(hasWords(S("image", "A picture")), false);
assert.equal(canHavePicture(S("text", "x", "y", { picture: "p.png" })), true);
assert.equal(canHavePicture(S("image", "x", "", { picture: "p.png" })), false);

// a wide heading graphic (a cursive word), words and a picture: nothing lies on anything else, all on the slide
const wide = { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.6 }; // 60% wide, 20% high, in the middle
const a = autoBoxes({ words: true, picture: true, heading: wide });
assert.ok(a.overlay && a.words && a.picture);
for (const b of [a.overlay!, a.words!, a.picture!]) assert.ok(inside(b), JSON.stringify(b));
assert.equal(overlaps(a.overlay!, a.words!), false, "the heading is clear of the words");
assert.equal(overlaps(a.overlay!, a.picture!), false, "the heading is clear of the picture");
assert.equal(overlaps(a.words!, a.picture!), false, "the words are clear of the picture");
assert.ok(a.overlay!.y < a.words!.y, "the heading is on top");
assert.ok(a.words!.x < a.picture!.x, "the words are on the left, the picture on the right");
assert.ok(Math.abs(a.overlay!.w / a.overlay!.h - 3) < 0.01, "the heading keeps its shape");
assert.ok(a.overlay!.w <= 60.0001, "it is not made larger than it is");

// a heading that is too big for the room is made smaller to fit the top
const huge = { x0: 0.02, y0: 0.1, x1: 0.98, y1: 0.9 }; // 96 by 80
const h = autoBoxes({ words: true, picture: false, heading: huge });
assert.ok(h.overlay!.h <= 38.0001 && h.overlay!.w <= 88.0001);
assert.equal(overlaps(h.overlay!, h.words!), false);

// a heading and nothing else is centred and may be large
const alone = autoBoxes({ words: false, picture: false, heading: wide });
assert.ok(Math.abs(alone.overlay!.x + alone.overlay!.w / 2 - 50) < 0.01 && Math.abs(alone.overlay!.y + alone.overlay!.h / 2 - 50) < 0.01);
assert.equal(alone.words, null);

// no heading graphic: words left and picture right, or the words alone
const wp = autoBoxes({ words: true, picture: true, heading: null });
assert.equal(wp.overlay, null);
assert.equal(overlaps(wp.words!, wp.picture!), false);
assert.ok(autoBoxes({ words: true, picture: false, heading: null }).words!.w > 80);

// the plan: boxed with a heading graphic of the slide's own and something to place; otherwise as it flows
const sl = S("text", "Welcome", "Hello");
assert.equal(planOf(sl, { words: true, picture: false, heading: wide }).boxed, true);
assert.equal(planOf(sl, { words: true, picture: false, heading: null }).boxed, false, "no heading graphic: the slide flows as before");
assert.equal(planOf(sl, { words: false, picture: false, heading: wide }).boxed, false, "a heading alone has nothing to space");
// the preacher's own places win, kept on the slide, for the parts that are there
const mine = planOf(sl, { words: true, picture: false, heading: wide }, { words: { x: -5, y: 90, w: 40, h: 40 }, picture: { x: 1, y: 1, w: 10, h: 10 } });
assert.equal(mine.manual, true);
assert.ok(inside(mine.words!), "kept on the slide");
assert.equal(mine.picture, null, "no picture on this slide, so no place for one");
assert.ok(mine.overlay, "a part the preacher did not move is spaced as before");
assert.equal(planOf(sl, { words: true, picture: false, heading: null }, { words: { x: 10, y: 10, w: 30, h: 30 } }).boxed, true, "placed by the preacher: boxed even without a heading graphic");
assert.equal(planOf(sl, { words: true, picture: false, heading: null }, {}).manual, false, "an empty layout is no layout");

// clamping
assert.deepEqual(clampBox({ x: -10, y: 120, w: 3, h: 500 }), { x: 0, y: 0, w: 8, h: 100 });

// putting the whole picture so that its solid part fills a box
const box = { x: 20, y: 10, w: 60, h: 20 };
const pl = overlayPlacement(box, wide);
assert.ok(Math.abs(pl.width - 100) < 0.001 && Math.abs(pl.height - 100) < 0.001, "a box the size of the solid part: the picture is its own size");
assert.ok(Math.abs(pl.left - (20 - 20)) < 0.001 && Math.abs(pl.top - (10 - 40)) < 0.001, "and moved so that the solid part lands on the box");
const half = overlayPlacement({ x: 0, y: 0, w: 30, h: 10 }, wide);
assert.ok(Math.abs(half.width - 50) < 0.001, "half the size");
assert.ok(Math.abs(half.left - (0 - 0.2 * 50)) < 0.001 && Math.abs(half.top - (0 - 0.4 * 50)) < 0.001);

// finding the solid part of a see-through picture (8 by 4 pixels: a 4 by 2 block in the middle)
const alpha = new Uint8Array(32);
for (let y = 1; y <= 2; y++) for (let x = 2; x <= 5; x++) alpha[y * 8 + x] = 255;
alpha[0] = 10; // faint: not solid
assert.deepEqual(solidPart(alpha, 8), { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
assert.equal(solidPart(new Uint8Array(16), 4), null, "nothing in it");
console.log("slideLayout: ok");
