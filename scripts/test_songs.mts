import assert from "node:assert/strict";
import { parseSong, parseSongFile, songSlides, songText, tidyLabel } from "../src/songs.ts";
import { groupsOf, stripKind } from "../src/presentGroups.ts";

// headings are tidied
assert.equal(tidyLabel("verse 1"), "Verse 1");
assert.equal(tidyLabel("[CHORUS]"), "Chorus");
assert.equal(tidyLabel("V2"), "Verse 2");
assert.equal(tidyLabel("pre chorus"), "Pre-Chorus");
assert.equal(tidyLabel("Not a heading"), "Not a heading");

const text = `Verse 1
Amazing grace, how sweet the sound
That saved a wretch like me

Chorus
My chains are gone
I've been set free

Verse 2
Twas grace that taught my heart to fear
And grace my fears relieved

Chorus

Bridge
Praise God`;
const p = parseSong(text);
assert.deepEqual(p.sections.map((s) => s.label), ["Verse 1", "Chorus", "Verse 2", "Bridge"]);
assert.deepEqual(p.arrangement, [0, 1, 2, 1, 3], "a heading alone is that section sung again");
assert.equal(p.sections[1].text, "My chains are gone\nI've been set free");

// no headings: a repeated block is sung again, not kept twice, and is the chorus; the others are verses
const bare = parseSong("one\ntwo\n\nthree\nfour\n\none\ntwo\n\nfive");
assert.deepEqual(bare.sections.map((s) => s.label), ["Chorus", "Verse 1", "Verse 2"]);
assert.deepEqual(bare.arrangement, [0, 1, 0, 2]);
// words copied from a web page: no headings, the chorus comes round with small changes (the same first line, other
// punctuation or a different ending); the verses are what is left
const web = parseSong(`Verse words, first
second line

You're a good, good song
It's who You are
and so on

Other verse words
more of them

You're a good good song!
It's who You are
but this time it ends differently

Last verse words
the end

Plain bridge words
only once`);
assert.deepEqual(web.sections.map((s) => s.label), ["Verse 1", "Chorus", "Verse 2", "Chorus 2", "Verse 3", "Verse 4"]);
assert.deepEqual(web.arrangement, [0, 1, 2, 3, 4, 5]);
// the same words with other punctuation are the same part, sung again
assert.deepEqual(parseSong("Oh, I sing!\nHigh\n\nOther\n\noh i sing\nhigh").arrangement, [0, 1, 0]);
// headed parts are left as written
assert.deepEqual(parseSong("Verse 1\na\n\nVerse 2\nb\n\nVerse 1").sections.map((s) => s.label), ["Verse 1", "Verse 2"]);
assert.deepEqual(parseSong("").sections, []);
assert.deepEqual(parseSong("  \n\n  ").arrangement, []);
// windows line endings
assert.deepEqual(parseSong("Verse 1\r\na\r\nb\r\n\r\nChorus\r\nc").sections.map((s) => s.text), ["a\nb", "c"]);

// slides: a verse a slide; a long one is split evenly; the group is the song
const long = parseSong("Verse 1\n" + Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n"));
const ls = songSlides({ title: "Long", ...long });
assert.equal(ls.length, 2);
assert.deepEqual(ls.map((s) => s.body.split("\n").length), [3, 3], "six lines are two slides of three, not four and two");
assert.equal(ls[0].title, "Long · Verse 1 (1/2)");
const slides = songSlides({ title: "Amazing Grace", ...p });
assert.deepEqual(slides.map((s) => s.section), ["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge"]);
assert.ok(slides.every((s) => s.kind === "song" && s.song === "Amazing Grace"));
const two = [...slides, ...songSlides({ title: "Other", ...parseSong("Verse 1\nx") })];
const { groups } = groupsOf(two);
assert.deepEqual(groups.map((g) => [g.name, g.from, g.to]), [["Amazing Grace", 0, 5], ["Other", 5, 6]], "a song is one group");
// a song slide typed by hand still starts its own group
assert.equal(groupsOf([{ kind: "song", title: "A", body: "" } as any, { kind: "song", title: "B", body: "" } as any]).groups.length, 2);

// the text back
assert.equal(songText(p), text.replace("Chorus\n\nBridge", "Chorus\n\nBridge"));

// a song file with a title, writers, copyright and a number
const file = parseSongFile(`Amazing Grace
Words: John Newton

Verse 1
Amazing grace

Chorus
My chains are gone

CCLI Song # 22025
© Public Domain
For use solely with the SongSelect Terms of Use.`);
assert.equal(file.title, "Amazing Grace");
assert.equal(file.author, "John Newton");
assert.equal(file.ccli, "22025");
assert.deepEqual(file.sections.map((s) => s.label), ["Verse 1", "Chorus"]);
assert.equal(file.sections[1].text, "My chains are gone", "the copyright lines are not words");
// no title line: the file's name stands in
assert.equal(parseSongFile("Verse 1\nhello", "How Great").title, "How Great");
// a title slide for each song: its own slide, in the same group as the song's words; a song sung twice is two groups
const withTitle = [
  ...songSlides({ title: "Amazing Grace", author: "John Newton", ...p }, 4, true),
  ...songSlides({ title: "Other", ...parseSong("Verse 1\nx") }, 4, true),
  ...songSlides({ title: "Amazing Grace", ...p }, 4, true),
];
assert.equal(withTitle[0].kind, "point");
assert.equal(withTitle[0].title, "Amazing Grace");
assert.equal(withTitle[0].body, "John Newton");
assert.equal(withTitle[0].section, "Title");
const g2 = groupsOf(withTitle).groups;
assert.deepEqual(g2.map((g) => [g.name, g.from, g.to]), [["Amazing Grace", 0, 6], ["Other", 6, 8], ["Amazing Grace", 8, 14]], "the title slide is part of its song; the same song again is a group of its own");
assert.equal(stripKind(withTitle[0], null), "song", "a song's title slide is coloured as the song");
assert.equal(songSlides({ title: "No title", ...p }, 4).length, 5, "no title slide unless asked");
console.log("songs: ok");

// words that came with no blank lines and no headings are cut into parts (made-up lines, not a song)
{
  const verse1 = ["Amber river flows", "Over silver stones", "Morning wakes the hills", "Singing to the sky"];
  const chorus = ["Hold the lantern high", "Light the road ahead", "Every step we take", "Leads us safely home"];
  const verse2 = ["Winter lays its snow", "Quiet on the fields", "Still the embers glow", "Warm beneath the roof"];
  const bridge = ["Open every door", "Let the evening in"];
  const flat = [...verse1, ...chorus, ...verse2, ...chorus, ...bridge, ...chorus].join("\n");
  const got = parseSong(flat);
  assert.deepEqual(got.sections.map((s) => s.label), ["Verse 1", "Chorus", "Verse 2", "Verse 3"]);
  assert.equal(got.arrangement.length, 6, "six parts are sung");
  assert.deepEqual(got.arrangement, [0, 1, 2, 1, 3, 1], "the chorus comes round again where it was sung");
  assert.equal(got.sections[1].text, chorus.join("\n"));
  // nothing repeats: parts of four lines
  const plain = Array.from({ length: 12 }, (_, i) => `Line number ${i + 1} of the words`).join("\n");
  const four = parseSong(plain);
  assert.equal(four.sections.length, 3);
  assert.ok(four.sections.every((s) => s.text.split("\n").length === 4));
  // a short block, and a block with its own headings, are left as they were
  assert.equal(parseSong("One\nTwo\nThree\nFour").sections.length, 1);
  assert.equal(parseSong("Verse 1\n" + plain).sections.length, 1);
  // a chorus whose lines are the same one line over and over is not looked for
  assert.equal(parseSong(Array(12).fill("Same line").join("\n")).sections.length >= 1, true);
}
console.log("songs (unbroken words): ok");

// safety net: markers a look-up leaves in the words, and names that clash (made-up lines)
{
  // "CHORUS(2)", "Chorus (1):" are headings, and "(x2)" is a direction, not words
  const a = parseSong("CHORUS(2)\nAlpha one\nAlpha two\n(x2)\n\nVerse 1\nBeta one\nBeta two");
  assert.deepEqual(a.sections.map((s) => s.label), ["Chorus 2", "Verse 1"]);
  assert.equal(a.sections[0].text, "Alpha one\nAlpha two");
  // a marker in the middle of a block starts a part of its own
  const b = parseSong("Verse 1\nGamma one\nGamma two\nCHORUS(1):\nDelta one\nDelta two");
  assert.deepEqual(b.sections.map((s) => s.label), ["Verse 1", "Chorus 1"]);
  assert.equal(b.sections[1].text, "Delta one\nDelta two");
  // no marker is left inside the words
  for (const s of [...a.sections, ...b.sections]) assert.ok(!/chorus|verse|\(x2\)/i.test(s.text), s.text);
  // two parts with the same name and other words: the second is numbered, and the first keeps the plain name
  const c = parseSong("Chorus\nEpsilon one\nEpsilon two\n\nChorus\nZeta one\nZeta two");
  assert.deepEqual(c.sections.map((s) => s.label), ["Chorus", "Chorus 2"]);
  // the same words under the same name are still one part sung twice
  const d = parseSong("Chorus\nEta one\nEta two\n\nVerse 1\nTheta one\n\nChorus\nEta one\nEta two");
  assert.equal(d.sections.length, 2);
  assert.deepEqual(d.arrangement, [0, 1, 0]);
  // a line that is only one letter in the middle of the words is words, not a heading
  assert.equal(parseSong("Iota one\nC\nIota two").sections.length, 1);
  // the saved text reads back the same (no marker doubled)
  const again = parseSong(songText(a));
  assert.deepEqual(again.sections.map((s) => s.label), ["Chorus 2", "Verse 1"]);
}
console.log("songs (safety net): ok");
