// Content Factory: the layout rules (where the words and the footer go) and the looks. Run: node scripts/test_factory.mts
import assert from "node:assert/strict";
import { balanceLines, bandHeight, barLayout, ellipsize, fitFooter, footerEdge, footerGeometry, headerTop, isTall, layoutText, wrapLines } from "../src/factory/layout.ts";
import { makeLooks, PALETTES, seasonPalette } from "../src/factory/looks.ts";
import { DEFAULT_RECIPES, forget, pickFresh, remember, upcomingOccasion, usedKeys, weekPlan } from "../src/factory/autopilot.ts";
import { giveBack, inOrder, setStatus, tidy, waiting, type Post } from "../src/factory/inbox.ts";
import { SEASON_VERSES, SERIES_ORDER } from "../src/factory/seasonVerses.ts";
import { dayNumber, occasionOn } from "../src/themes/themeCalendar.ts";
import { acceptable, creditLine, needsCredit } from "../src/factory/commons.ts";
import { quoted, tidyQuotes } from "../src/factory/text.ts";
import { SIZES } from "../src/factory/types.ts";
import { groupFiles, projectCount, projectName } from "../src/factory/gallery.ts";
import { edgeColour, hasPlainEdge, removeBackground } from "../src/factory/cutout.ts";
import { lighten, pictureColours, regionStats, suggestReadable } from "../src/factory/readable.ts";

// a font where every letter is half as wide as its size
const measure = (t: string, s: number) => t.length * s * 0.5;

// ---- wrapping
assert.deepEqual(wrapLines("one two three four", 100, 20, measure), ["one two", "three four"]);
const lines = wrapLines("For God so loved the world that He gave His one and only Son", 300, 20, measure);
assert.ok(lines.every((l) => measure(l, 20) <= 300), "no line is wider than the box");
assert.equal(lines.join(" "), "For God so loved the world that He gave His one and only Son", "no word is lost");
// balanced: same number of lines, the last line is not a lone word when it need not be
const base = wrapLines("aaa bbb ccc ddd eee fff ggg hhh", 130, 20, measure);
const even = balanceLines("aaa bbb ccc ddd eee fff ggg hhh", 130, 20, measure);
assert.equal(even.length, base.length);
assert.ok(Math.max(...even.map((l) => l.length)) <= Math.max(...base.map((l) => l.length)));
assert.deepEqual(wrapLines("", 100, 20, measure), []);
assert.deepEqual(wrapLines("supercalifragilistic", 50, 20, measure), ["supercalifragilistic"], "a word too long stands alone");

// ---- the footer
for (const s of SIZES) {
  for (const place of ["safe", "edge"] as const) {
    const g = footerGeometry(s.w, s.h, place);
    assert.ok(g.baseline < s.h && g.baseline > s.h / 2, `${s.id}/${place}: the footer is on the picture`);
    assert.ok(g.leftX >= 0 && g.rightX <= s.w && g.leftX < g.rightX);
    assert.ok(g.leftMaxW + g.rightMaxW < g.rightX - g.leftX, `${s.id}/${place}: the two corners can never touch`);
    assert.ok(g.creditBaseline < g.baseline && g.fontSize >= 18);
  }
}
const story = SIZES.find((s) => s.id === "story")!;
const square = SIZES.find((s) => s.id === "square")!;
assert.ok(isTall(story.w, story.h) && !isTall(square.w, square.h));
const safe = footerGeometry(story.w, story.h, "safe");
const edge = footerGeometry(story.w, story.h, "edge");
assert.ok(safe.baseline < edge.baseline - 200, "in a tall size the safe place is well above the edge");
assert.ok(safe.rightX < edge.rightX, "and keeps clear of the right-hand icons");
assert.equal(footerGeometry(square.w, square.h, "safe").baseline, footerGeometry(square.w, square.h, "edge").baseline, "square: safe and edge are the same");
// long names shrink to their corner and end with ...
const g = footerGeometry(1080, 1080, "edge");
const fit = fitFooter("A Very Long Ministry Name That Goes On And On Forever And Ever Amen", "bible4me.org", g, measure);
assert.ok(measure(fit.name, g.fontSize) <= g.leftMaxW && fit.name.endsWith("..."));
assert.equal(fit.mark, "bible4me.org");
assert.equal(ellipsize("Sam", 1000, 20, measure), "Sam");
assert.equal(fitFooter("", "", g, measure).name, "");

// ---- the words
const VERSE = "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.";
for (const s of SIZES) {
  for (const layout of ["centre", "low", "top", "card", "quote", "ribbon"] as const) {
    for (const place of ["safe", "edge"] as const) {
      const t = layoutText({ text: VERSE, reference: "John 3:16 · BSB", layout, w: s.w, h: s.h, place, hasCredit: false, fontScale: 1, measure });
      const fg = footerGeometry(s.w, s.h, place);
      const label = `${s.id}/${layout}/${place}`;
      assert.ok(t.lines.length >= 1 && t.ref, `${label}: has words and a reference`);
      const lastY = t.ref!.y;
      assert.ok(lastY < fg.baseline - fg.fontSize, `${label}: the words end above the footer (${lastY} vs ${fg.baseline})`);
      assert.ok(t.lines.every((l) => l.y > 0 && l.y < s.h), `${label}: every line is on the picture`);
      assert.ok(t.lines.every((l) => measure(l.text, t.fontSize) <= s.w * 0.8 + 1), `${label}: no line is wider than the margins`);
      if (layout === "card") assert.ok(t.panel && t.panel.x >= 0 && t.panel.x + t.panel.w <= s.w, `${label}: the card is on the picture`);
      if (layout === "ribbon") assert.ok(t.ribbon);
      if (layout === "quote") assert.ok(t.quoteMark);
    }
  }
}
// a credit line lifts the words' limit
const noCredit = layoutText({ text: VERSE, reference: "John 3:16", layout: "low", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1, measure });
const withCredit = layoutText({ text: VERSE, reference: "John 3:16", layout: "low", w: 1080, h: 1080, place: "edge", hasCredit: true, fontScale: 1, measure });
assert.ok(withCredit.ref!.y < noCredit.ref!.y, "with a credit line the words sit higher");
// the size multiplier works, and a very long text still fits (smaller)
const small = layoutText({ text: VERSE, reference: "", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 0.6, measure });
const big = layoutText({ text: VERSE, reference: "", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1.4, measure });
assert.ok(small.fontSize < big.fontSize);
const long = layoutText({ text: VERSE.repeat(4), reference: "Psalm 119:1–17", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1, measure });
assert.ok(long.fontSize <= big.fontSize && long.ref!.y < 1080 - 60, "a long passage shrinks to fit");
// the size is a true multiple of the size that fits, so dragging a corner can make the words bigger than the usual area allows
{
  const one = layoutText({ text: VERSE, reference: "John 3:16", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1, measure });
  const half = layoutText({ text: VERSE, reference: "John 3:16", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 0.5, measure });
  const more = layoutText({ text: VERSE, reference: "John 3:16", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1.6, measure });
  assert.ok(Math.abs(half.fontSize / one.fontSize - 0.5) < 0.04, `half the size is half (${half.fontSize} of ${one.fontSize})`);
  assert.ok(Math.abs(more.fontSize / one.fontSize - 1.6) < 0.04, `1.6 times is 1.6 times (${more.fontSize} of ${one.fontSize})`);
  const lng = layoutText({ text: VERSE.repeat(3), reference: "", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 0.6, measure });
  const lng1 = layoutText({ text: VERSE.repeat(3), reference: "", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1, measure });
  assert.ok(lng.fontSize < lng1.fontSize, "a long passage gets smaller too when the size is turned down (it used to stay at the size that fits)");
  assert.equal(layoutText({ text: VERSE, reference: "John 3:16", layout: "centre", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 99, measure }).fontSize, Math.round(one.fontSize * 3), "never more than three times");
}
// no reference: none drawn
assert.equal(small.ref, null);

// ---- a logo above the words pushes them down
const noLogo = layoutText({ text: VERSE, reference: "John 3:16", layout: "top", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1, measure });
const withLogo = layoutText({ text: VERSE, reference: "John 3:16", layout: "top", w: 1080, h: 1080, place: "edge", hasCredit: false, fontScale: 1, measure, topMin: 200 });
assert.ok(withLogo.lines[0].y > noLogo.lines[0].y && withLogo.lines[0].y >= 200, "the words start below the logo");

// ---- header and footer bands
assert.equal(bandHeight(1080, 1080, { kind: "none", size: "medium" }), 0);
assert.equal(bandHeight(1080, 1080, { kind: "text", size: "small" }), 76);
assert.equal(bandHeight(1080, 1080, { kind: "logo", size: "medium" }), 108);
assert.equal(bandHeight(1080, 1080, { kind: "text", size: "large" }), 151);
assert.equal(bandHeight(1080, 1080, { kind: "picture", size: "medium" }, 7.2), 150, "a banner is as tall as its own shape makes it");
assert.equal(bandHeight(1080, 1080, { kind: "picture", size: "medium" }, 2), 238, "but never over a fifth of the short side");
assert.equal(bandHeight(1080, 1080, { kind: "picture", size: "medium" }, 0), 0, "no picture, no band");
assert.equal(headerTop(1080, 1080, "safe"), 0);
assert.ok(headerTop(1080, 1920, "safe") >= 200 && headerTop(1080, 1920, "edge") === 0, "in a tall size the header sits below the part the apps cover");
assert.equal(footerEdge(1080, 1080, "safe"), 1080);
assert.ok(footerEdge(1080, 1920, "safe") <= 1920 - 250 && footerEdge(1080, 1920, "edge") === 1920, "and the footer band above the apps' buttons");
for (const s of SIZES) {
  for (const place of ["safe", "edge"] as const) {
    const plain = footerGeometry(s.w, s.h, place);
    const band = bandHeight(s.w, s.h, { kind: "text", size: "medium" });
    const g = footerGeometry(s.w, s.h, place, band);
    assert.ok(g.baseline < footerEdge(s.w, s.h, place) - band, `${s.id}/${place}: the name and the mark sit above the footer band`);
    assert.ok(g.baseline <= plain.baseline, `${s.id}/${place}: and are never lower than without a band`);
    const hb = bandHeight(s.w, s.h, { kind: "text", size: "medium" });
    const top = headerTop(s.w, s.h, place) + hb;
    for (const layout of ["centre", "low", "top", "card", "quote", "ribbon"] as const) {
      const t = layoutText({ text: VERSE, reference: "John 3:16", layout, w: s.w, h: s.h, place, hasCredit: false, fontScale: 1, measure, topMin: top + Math.min(s.w, s.h) * 0.03, footerBand: band });
      const label = `${s.id}/${place}/${layout} with both bands`;
      assert.ok(t.lines[0].y - t.fontSize * 0.9 >= top, `${label}: the words start below the header`);
      assert.ok(t.ref!.y < g.baseline - g.fontSize, `${label}: and end above the name and the mark`);
      if (t.panel) assert.ok(t.panel.y >= top - 1 && t.panel.y + t.panel.h <= g.baseline, `${label}: the card is clear of both bands`);
    }
  }
}

assert.equal(creditLine("This Photo was taken by Wolfgang Moroder", "CC BY-SA 3.0"), "Photo: Wolfgang Moroder, CC BY-SA 3.0, Wikimedia Commons", "a credit does not say 'This photo was taken by' twice");
assert.equal(creditLine("Photo by Jane Smith", "CC BY 4.0"), "Photo: Jane Smith, CC BY 4.0, Wikimedia Commons");
assert.equal(creditLine("Wolfgang Moroder. Feel free to use my photos, but please give credit.", "CC BY-SA 3.0"), "Photo: Wolfgang Moroder, CC BY-SA 3.0, Wikimedia Commons", "a photographer's own note is left out");
assert.equal(creditLine("<a href='x'>J. R. Smith</a> (talk)", "CC BY 2.0"), "Photo: J. R. Smith, CC BY 2.0, Wikimedia Commons", "initials stay, a bracket ends the name");
assert.equal(creditLine("Jane Smith - Own work", "CC BY 4.0"), "Photo: Jane Smith, CC BY 4.0, Wikimedia Commons");
assert.ok(creditLine("A Very Long Photographer Name Indeed Of Great Length And More", "CC BY 4.0").length < 90, "a long name is cut at a word");
assert.equal(creditLine("Someone", "CC0"), "", "CC0 needs no credit");
// ---- the footer bar: name, church text, logo, credit and site mark in one strip
const CREDIT = "Photo: Elliott Brown, CC BY-SA 4.0, Wikimedia Commons";
const barOf = (w: number, h: number, place: "safe" | "edge", o: Partial<Parameters<typeof barLayout>[0]> = {}) => barLayout({ w, h, place, left: "", credit: "", extra: "", mark: "bible4me.org", logo: null, measure, ...o });
assert.equal(barLayout({ w: 1080, h: 1080, place: "edge", left: "", credit: "", extra: "", mark: "", logo: null, measure }), null, "nothing to show, no bar");
for (const sz of SIZES) {
  for (const place of ["safe", "edge"] as const) {
    const edge = footerEdge(sz.w, sz.h, place);
    const cases: [string, Partial<Parameters<typeof barLayout>[0]>][] = [
      ["site only", {}],
      ["credit and site", { credit: CREDIT }],
      ["name, credit and site", { left: "by Pastor Sam", credit: CREDIT }],
      ["church text, name, credit, music", { left: "Grace Community Church · Sundays 10:00  ·  by Pastor Sam", credit: CREDIT, extra: "Music: Nocturne by Southern Cross Music" }],
      ["a logo and a very long credit", { left: "by Pastor Sam", credit: CREDIT + " " + CREDIT, logo: { aspect: 2.2, size: "large" } }],
      ["a reserved music row", { credit: CREDIT, keepExtraRow: true }],
    ];
    for (const [name, o] of cases) {
      const b = barOf(sz.w, sz.h, place, o)!;
      const label = `${sz.id}/${place}/${name}`;
      assert.ok(b, label);
      assert.ok(b.top >= 0 && b.top + b.height <= edge + 1 && b.height > b.fontSize * 2, `${label}: the bar is on the picture, above the edge it sits on`);
      assert.ok(b.height < Math.min(sz.w, sz.h) * 0.3, `${label}: and stays a slim strip (${b.height})`);
      const g = footerGeometry(sz.w, sz.h, place);
      for (const row of b.rows) {
        assert.ok(row.baseline > b.top && row.baseline < b.top + b.height, `${label}: every line of text is inside the bar`);
        let lo = Infinity;
        let hi = -Infinity;
        for (const it of row.items) {
          const tw = measure(it.text, b.fontSize);
          const x0 = it.align === "left" ? it.x : it.x - tw;
          assert.ok(x0 >= g.leftX - 1 && x0 + tw <= g.rightX + 1, `${label}: "${it.text.slice(0, 20)}" is inside the margins`);
          lo = Math.min(lo, x0);
          hi = Math.max(hi, x0 + tw);
        }
        // items on a line never overlap
        const boxes = row.items.map((it) => { const tw = measure(it.text, b.fontSize); return it.align === "left" ? [it.x, it.x + tw] : [it.x - tw, it.x]; }).sort((p, q) => p[0] - q[0]);
        for (let k = 1; k < boxes.length; k++) assert.ok(boxes[k][0] >= boxes[k - 1][1], `${label}: two texts on a line do not touch`);
      }
      if (b.logo) assert.ok(b.logo.x >= 0 && b.logo.y >= b.top && b.logo.y + b.logo.h <= b.top + b.height && b.logo.w <= (g.rightX - g.leftX) * 0.31, `${label}: the logo is inside the bar`);
    }
  }
}
// the credit goes on the same line as the site mark when it fits, and on a line of its own when it does not
const one = barOf(1080, 1080, "edge", { credit: CREDIT })!;
assert.equal(one.rows.length, 1, "the credit and the site share a line");
assert.ok(one.rows[0].items.some((it) => it.role === "credit") && one.rows[0].items.some((it) => it.role === "mark"));
const heavy = barOf(1080, 1080, "edge", { left: "Grace Community Church · Sundays 10:00  ·  by Pastor Sam", credit: CREDIT })!;
assert.equal(heavy.rows.length, 2, "with a lot to say, the credit takes a line of its own");
assert.ok(heavy.rows[1].items[0].role === "credit" && heavy.rows[0].items.some((it) => it.role === "mark"), "and the site mark stays on the first line");
assert.ok(barOf(1080, 1080, "edge", { credit: CREDIT, extra: "Music: Nocturne by Southern Cross Music" })!.rows.length === 2, "the music's credit is a line of its own");
assert.equal(barOf(1080, 1080, "edge", { credit: CREDIT, keepExtraRow: true })!.height, barOf(1080, 1080, "edge", { credit: CREDIT, extra: "Music: Nocturne by Southern Cross Music" })!.height, "a video keeps the room for the music's credit, so the words do not jump");
// the bar sits above the apps' buttons in the tall sizes
assert.ok(barOf(1080, 1920, "safe", { credit: CREDIT })!.top + barOf(1080, 1920, "safe", { credit: CREDIT })!.height <= 1920 - 250, "tall: the bar is above the buttons");
assert.equal(barOf(1080, 1920, "edge", { credit: CREDIT })!.top + barOf(1080, 1920, "edge", { credit: CREDIT })!.height, 1920, "tall, at the edge: the bar is at the very bottom");
// the words keep above the bar, whatever it holds
for (const sz of SIZES) {
  for (const place of ["safe", "edge"] as const) {
    const b = barOf(sz.w, sz.h, place, { left: "Grace Community Church · by Pastor Sam", credit: CREDIT, extra: "Music: Nocturne by Southern Cross Music", logo: { aspect: 1, size: "medium" } })!;
    const limit = b.top - Math.round(Math.min(sz.w, sz.h) * 0.035);
    for (const layout of ["centre", "low", "top", "card", "quote", "ribbon"] as const) {
      const t = layoutText({ text: VERSE, reference: "John 3:16 · BSB", layout, w: sz.w, h: sz.h, place, hasCredit: false, fontScale: 1, measure, limit });
      const label = `${sz.id}/${place}/${layout} above the bar`;
      assert.ok(t.ref!.y <= limit, `${label}: the reference ends above the bar (${t.ref!.y} vs ${limit})`);
      if (t.panel) assert.ok(t.panel.y + t.panel.h <= limit + 2, `${label}: the card ends above the bar`);
    }
  }
}

// ---- the footer bar: the choices that header and footer share (placing, size)
{
  const SHORT = "Photo: Jane Smith, CC BY 4.0";
  const base = barOf(1080, 1080, "edge", { left: "by Pastor Sam", credit: SHORT })!;
  const small = barOf(1080, 1080, "edge", { left: "by Pastor Sam", credit: SHORT, size: "small" })!;
  const large = barOf(1080, 1080, "edge", { left: "by Pastor Sam", credit: SHORT, size: "large" })!;
  assert.ok(small.fontSize < base.fontSize && base.fontSize < large.fontSize, "size: small, medium, large letters");
  assert.ok(small.height <= base.height && base.height <= large.height, "and a bar to match");
  for (const align of ["center", "right"] as const) {
    for (const sz of SIZES) {
      for (const place of ["safe", "edge"] as const) {
        const b = barOf(sz.w, sz.h, place, { left: "Grace Community Church \u00b7 Sundays 10:00  \u00b7  by Pastor Sam", credit: CREDIT, extra: "Music: Nocturne", align, logo: { aspect: 2, size: "medium" } })!;
        const g = footerGeometry(sz.w, sz.h, place);
        const label = `${sz.id}/${place}/${align}`;
        assert.ok(b.rows.length >= 2 && b.rows[0].items[0].role === "left" && b.rows[1].items[0].role === "credit", `${label}: the church's text and name, then the small print below`);
        for (const row of b.rows) for (const it of row.items) {
          const tw = measure(it.text, b.fontSize);
          const x0 = it.align === "center" ? it.x - tw / 2 : it.align === "right" ? it.x - tw : it.x;
          assert.ok(x0 >= g.leftX - 1 && x0 + tw <= g.rightX + 1, `${label}: "${it.text.slice(0, 18)}" is inside the margins`);
        }
        assert.equal(b.rows[0].items[0].align, align);
        assert.ok(b.logo && b.logo.x >= g.leftX - 1, `${label}: the logo stays at the left`);
      }
    }
  }
}

// ---- taking the plain background off a logo
{
  const W = 24;
  const H = 24;
  const make = (bg: [number, number, number]) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let p = 0; p < W * H; p++) { d[p * 4] = bg[0]; d[p * 4 + 1] = bg[1]; d[p * 4 + 2] = bg[2]; d[p * 4 + 3] = 255; }
    // a red square from (6,6) to (17,17) with a 2x2 hole of the background colour in the middle
    for (let y = 6; y <= 17; y++) for (let x = 6; x <= 17; x++) { const i = (y * W + x) * 4; d[i] = 200; d[i + 1] = 30; d[i + 2] = 30; }
    for (let y = 11; y <= 12; y++) for (let x = 11; x <= 12; x++) { const i = (y * W + x) * 4; d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; }
    return d;
  };
  const alpha = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4 + 3];
  for (const bg of [[255, 255, 255], [0, 0, 0]] as [number, number, number][]) {
    const name = bg[0] ? "white" : "black";
    const d = make(bg);
    assert.deepEqual(edgeColour(d, W, H), bg, `${name}: the edge colour is read`);
    assert.ok(hasPlainEdge(d, W, H), `${name}: a plain edge`);
    const r = removeBackground(d, W, H, { tolerance: 28, holes: false });
    assert.deepEqual(r.background, bg);
    assert.equal(alpha(d, 0, 0), 0, `${name}: the corner is see-through`);
    assert.equal(alpha(d, 3, 20), 0, `${name}: so is the rest of the outside`);
    assert.equal(alpha(d, 8, 8), 255, `${name}: the logo stays`);
    assert.equal(alpha(d, 11, 11), 255, `${name}: a hole in the logo stays while "inside the letters" is off`);
    const d2 = make(bg);
    removeBackground(d2, W, H, { tolerance: 28, holes: true });
    assert.equal(alpha(d2, 11, 11), 0, `${name}: and goes when it is on`);
    assert.equal(alpha(d2, 8, 8), 255);
  }
  // a noisy, slightly off-white background (a JPEG) still goes at a middling tolerance
  const noisy = make([252, 251, 253]);
  for (let p = 0; p < W * H; p++) { const n = (p * 7) % 9; noisy[p * 4] -= n > 4 ? 6 : 0; noisy[p * 4 + 1] -= n; }
  removeBackground(noisy, W, H, { tolerance: 28, holes: false });
  assert.equal(alpha(noisy, 1, 1), 0, "a noisy background goes");
  // an edge pixel that is half background is only half see-through, and loses the background's colour (no white fringe)
  const e = make([255, 255, 255]);
  const edgeI = (6 * W + 5) * 4; // just outside the red square
  e[edgeI] = 228; e[edgeI + 1] = 143; e[edgeI + 2] = 143; // pink: red blended with white
  removeBackground(e, W, H, { tolerance: 20, holes: false });
  assert.ok(e[edgeI + 3] > 0 && e[edgeI + 3] < 255, "an edge pixel is partly see-through");
  assert.ok(e[edgeI + 1] < 143, "and its colour is cleaned of the white");
  // a picture with no plain edge is left to the reader's choice
  const busy = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) { busy[p * 4] = (p * 53) % 256; busy[p * 4 + 1] = (p * 97) % 256; busy[p * 4 + 2] = (p * 29) % 256; busy[p * 4 + 3] = 255; }
  assert.equal(hasPlainEdge(busy, W, H), false, "a busy edge is not a plain background");
  // an already see-through picture has no edge colour to read
  const clear = new Uint8ClampedArray(W * H * 4);
  assert.equal(edgeColour(clear, W, H), null, "a see-through edge: nothing to take off");
}

// ---- helping the words stand out from a photo
{
  const plain = (r: number, g: number, b: number, w = 20, h = 20) => { const d = new Uint8ClampedArray(w * h * 4); for (let p = 0; p < w * h; p++) { d[p * 4] = r; d[p * 4 + 1] = g; d[p * 4 + 2] = b; d[p * 4 + 3] = 255; } return d; };
  const white = regionStats(plain(255, 255, 255), 20, 20, { x: 0, y: 0, w: 20, h: 20 });
  const dark = regionStats(plain(20, 20, 30), 20, 20, { x: 0, y: 0, w: 20, h: 20 });
  assert.ok(white.mean > 0.99 && dark.mean < 0.1 && white.spread < 0.01, "brightness and spread are read");
  // half black, half white: a busy region
  const half = plain(0, 0, 0);
  for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) { const i = (y * 20 + x) * 4; half[i] = half[i + 1] = half[i + 2] = 255; }
  assert.ok(regionStats(half, 20, 20, { x: 0, y: 0, w: 20, h: 20 }).spread > 0.4, "a half and half region is very busy");
  assert.equal(regionStats(half, 20, 20, { x: 0, y: 0, w: 5, h: 20 }).mean, 0, "a region of its own is read on its own");
  const bright = suggestReadable(0.85, 0.05);
  const mid = suggestReadable(0.45, 0.05);
  const dim = suggestReadable(0.1, 0.03);
  assert.ok(bright.darken > mid.darken && mid.darken > 0 && dim.darken === 0, `a bright photo is darkened more (${bright.darken}), a dark even one not at all`);
  assert.equal(bright.blur, 0, "an even photo is not softened");
  const busy = suggestReadable(0.5, 0.3);
  assert.ok(busy.blur > 0.3 && busy.darken > suggestReadable(0.5, 0.05).darken, "a busy photo is also softened and darkened a little more");
  assert.ok(suggestReadable(1, 0.5).darken <= 0.75 && suggestReadable(1, 0.5).blur <= 0.6, "never past the limits");
  // the main colours of a picture
  const two = new Uint8ClampedArray(20 * 20 * 4);
  for (let p = 0; p < 400; p++) { const top = p < 260; two[p * 4] = top ? 20 : 230; two[p * 4 + 1] = top ? 60 : 60; two[p * 4 + 2] = top ? 200 : 40; two[p * 4 + 3] = 255; }
  const cols = pictureColours(two, 20, 20);
  assert.equal(cols.length, 2, "two colours found");
  assert.ok(cols[0].startsWith("#") && cols[0].length === 7);
  assert.equal(lighten("#000000", 1), "#ffffff");
  assert.equal(lighten("#336699", 0), "#336699");
  assert.equal(lighten("nonsense", 0.5), "nonsense");
}

// ---- the gallery groups saved files by project
assert.equal(projectName("2026-11-13 This week 03 of 07 - Square 1080x1080.png"), "2026-11-13 This week");
assert.equal(projectName("2026-11-13 Verse of the day - Story 1080x1920.png"), "2026-11-13 Verse of the day");
assert.equal(projectName("2026-11-13 Verse of the day - Story video.mp4"), "2026-11-13 Verse of the day");
assert.equal(projectName("Verses - for love - Wide 1920x1080.png"), "Verses - for love", "a dash in the name stays");
assert.equal(projectName("2026-11-14 New Year- 7 verses 03 of 7 - Square 1080x1080 (2).png"), "2026-11-14 New Year- 7 verses", "saved again: the same project");
const mkFile = (name: string, modified: number) => ({ path: `C:/x/${name}`, name, folder: name.endsWith(".mp4") ? "Videos" : "Pictures", size: 1, modified });
const groups = groupFiles([
  mkFile("A week 02 of 02 - Square 1080x1080.png", 100),
  mkFile("A week 01 of 02 - Square 1080x1080.png", 101),
  mkFile("A week - Story video.mp4", 102),
  mkFile("One verse - Square 1080x1080.png", 300),
  mkFile("One verse - Story 1080x1920.png", 299),
]);
assert.equal(groups.length, 2, "two projects");
assert.equal(groups[0].title, "One verse", "the newest project first");
assert.equal(groups[1].files[0].name, "A week 01 of 02 - Square 1080x1080.png", "pictures first, in order");
assert.equal(groups[1].files[2].name, "A week - Story video.mp4", "the video last");
assert.equal(groups[1].cover.name, "A week 01 of 02 - Square 1080x1080.png");
assert.equal(projectCount(groups[1]), "2 pictures and a video");
assert.equal(projectCount(groups[0]), "2 pictures");
assert.deepEqual(groupFiles([]), []);

// ---- the looks
const six = makeLooks(1, {});
assert.equal(six.length, 6);
assert.equal(new Set(six.map((l) => l.layout)).size, 6, "six different layouts");
assert.deepEqual(makeLooks(1, {}).map((l) => l.id), six.map((l) => l.id), "the same seed gives the same looks");
assert.notDeepEqual(makeLooks(2, {}).map((l) => l.layout).join(), six.map((l) => l.layout).join(), "another seed gives others");
const xmas = makeLooks(3, { occasion: "christmas" });
assert.equal(xmas[0].background.kind === "gradient" && xmas[0].background.from, seasonPalette("christmas")!.from, "the season's colours come first");
assert.equal(seasonPalette("easter")!.id, "resurrection");
assert.equal(seasonPalette(null), null);
const withPics = makeLooks(4, { pictures: [{ key: "a", credit: "Photo: X (CC BY)" }, { key: "b" }] });
assert.equal(withPics.filter((l) => l.background.kind === "image").length, 2, "two of the six use a picture when pictures are to hand");
assert.ok(withPics.filter((l) => l.background.kind === "image").every((l) => l.background.kind === "image" && l.background.darken >= 0.38));
assert.ok(PALETTES.length >= 14);
// ---- quotation marks in verses taken out of their chapter
assert.equal(tidyQuotes("Look, I am with you. For I will not leave you.”"), "Look, I am with you. For I will not leave you.", "a closing mark with no opening one is dropped");
assert.equal(tidyQuotes("“Be still, and know."), "Be still, and know.", "an opening mark with no closing one is dropped");
assert.equal(tidyQuotes("saying, “ If you will listen ”"), "saying, “If you will listen”", "spaces inside the marks go; balanced marks stay");
assert.equal(tidyQuotes("He said, “Come.”  Then   he left."), "He said, “Come.” Then he left.", "inner quotes and spacing");
assert.equal(tidyQuotes("For God so loved the world."), "For God so loved the world.");
assert.equal(quoted("For God so loved"), "“For God so loved”");
assert.equal(quoted("“Come,” he said."), "“Come,” he said.", "text that has quotes is not wrapped again");
// ---- the automation: no repeats, the week's plan, the seasons
const items = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}` }));
const key = (t: { id: string }) => t.id;
const a = pickFresh(items, key, new Set(), 5, 1);
assert.equal(new Set(a.map(key)).size, 5, "five different things");
assert.deepEqual(pickFresh(items, key, new Set(), 5, 1).map(key), a.map(key), "the same seed gives the same pick");
assert.notDeepEqual(pickFresh(items, key, new Set(), 5, 2).map(key), a.map(key), "another seed gives others");
const usedA = new Set(a.map(key));
assert.ok(pickFresh(items, key, usedA, 5, 1).every((t) => !usedA.has(t.id)), "what was used is not picked while fresh things are left");
const nearlyAll = new Set(items.slice(0, 18).map(key));
const few = pickFresh(items, key, nearlyAll, 5, 3);
assert.equal(few.length, 5);
assert.ok(few.slice(0, 2).every((t) => !nearlyAll.has(t.id)), "the fresh ones come first, then the used ones fill up");
const today = dayNumber(2026, 11, 13);
let hist = remember([], ["v:John 3:16", "s:x"], today - 200);
hist = remember(hist, ["v:Psalm 23:1"], today - 10);
assert.deepEqual([...usedKeys(hist, today)], ["v:Psalm 23:1"], "only what was made in the last 120 days counts");
assert.equal(remember(hist, ["v:Psalm 23:1"], today).filter((h) => h.key === "v:Psalm 23:1").length, 1, "remembering again does not double");
assert.ok(remember(hist, [], today + 300).every((h) => today + 300 - h.day < 400), "what is over a year old is forgotten");
assert.deepEqual(forget(hist, ["s:x"]).map((h) => h.key), ["v:John 3:16", "v:Psalm 23:1"]);

let foundComing = 0;
for (let d = dayNumber(2026, 1, 1); d < dayNumber(2027, 1, 1); d++) {
  const now = occasionOn(d);
  const up = upcomingOccasion(d, 14);
  if (now) assert.equal(up?.id, now.id, "a season that is on is the season");
  else if (up) {
    foundComing++;
    assert.ok(up.start > d && up.start - d <= 14, "a season that is coming starts within the horizon");
  }
}
assert.ok(foundComing > 5, "there are days with a season coming");
const full = weekPlan(DEFAULT_RECIPES, today, true);
assert.equal(full.length, 7, "a post for each of seven days");
assert.equal(new Set(full.map((p) => p.day)).size, 7, "no two on the same day");
assert.ok(full.every((p) => p.day >= today && p.day < today + 7));
for (const r of ["topic", "story", "memory", "fact", "season"]) assert.equal(full.filter((p) => p.recipe === r).length, 1, `${r} once`);
assert.equal(weekPlan(DEFAULT_RECIPES, today, false).filter((p) => p.recipe === "season").length, 0, "no season, no season post");
assert.equal(weekPlan(["story"], today, true).length, 1, "only what is chosen");
assert.equal(weekPlan(["daily"], today, true).length, 7);
assert.equal(weekPlan([], today, true).length, 0);

for (const id of SERIES_ORDER) assert.ok(SEASON_VERSES[id], `${id} has verses`);
for (const [id, list] of Object.entries(SEASON_VERSES)) {
  assert.ok(list!.refs.length >= 6, `${id}: enough verses`);
  assert.equal(new Set(list!.refs).size, list!.refs.length, `${id}: no verse twice`);
  assert.ok(list!.refs.every((r) => /^([1-3] )?[A-Z][A-Za-z]+( [A-Z][a-z]+)* \d+:\d+(-\d+)?$/.test(r)), `${id}: references are written as the app writes them`);
  assert.ok(!/easter/i.test(list!.name), "never the word Easter");
}
assert.equal(SEASON_VERSES.easter?.name, "Resurrection Sunday");

const mk = (id: string, status: Post["status"], day: number): Post => ({ id, recipe: "daily", title: id, day, cards: [{ text: "t", reference: "r", version: "BSB" }], caption: "", status, lookSeed: 1, keys: [`k:${id}`], madeDay: today });
const box = [mk("b", "new", today + 2), mk("a", "approved", today + 1), mk("c", "posted", today - 100), mk("d", "skipped", today - 3)];
assert.deepEqual(inOrder(box).map((p) => p.id), ["c", "d", "a", "b"], "in the order of the days");
assert.deepEqual(waiting(box).map((p) => p.id), ["b", "a"]);
assert.equal(setStatus(box, "b", "posted").find((p) => p.id === "b")!.status, "posted");
assert.deepEqual(tidy(box, today).map((p) => p.id), ["b", "a", "d"], "old posted ones go; waiting ones stay");
assert.deepEqual(giveBack([{ key: "k:d", day: today }, { key: "k:z", day: today }], box[3]).map((h) => h.key), ["k:z"], "a skipped post gives back what it used");
// ---- online photos: which licences, which credit
for (const ok of ["CC0", "Public domain", "CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC BY 2.0", "PDM", "Public Domain Mark 1.0"]) assert.ok(acceptable(ok), `${ok} is usable`);
for (const no of ["CC BY-NC 4.0", "CC BY-ND 2.0", "CC BY-NC-SA 3.0", "All rights reserved", "", "Fair use", "GFDL"]) assert.ok(!acceptable(no), `${no || "(none)"} is not usable`);
assert.ok(!needsCredit("CC0") && !needsCredit("Public domain"), "public domain and CC0 need no credit");
assert.ok(needsCredit("CC BY 4.0") && needsCredit("CC BY-SA 3.0"));
assert.equal(creditLine("<a href='x'>Jane Smith</a>", "CC BY-SA 4.0"), "Photo: Jane Smith, CC BY-SA 4.0, Wikimedia Commons");
assert.equal(creditLine("", "CC BY 2.0"), "Photo: CC BY 2.0, Wikimedia Commons");
assert.equal(creditLine("Original: Sri Chakra Pranav Derivative work: UnpetitproleX", "CC BY-SA 4.0"), "Photo: Sri Chakra Pranav, CC BY-SA 4.0, Wikimedia Commons", "long artist notes are cut down");
assert.equal(creditLine("Jane", "CC0"), "", "no credit line for CC0");
console.log("factory: all checks passed");
