// Reading OpenSong songs. Run: node --experimental-strip-types scripts/test_opensong.mts
import assert from "node:assert/strict";
import { openSongLabel, parseOpenSong, parseOpenSongLyrics } from "../src/opensong.ts";
import { songSlides } from "../src/songs.ts";

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<song>
  <title>Amazing Grace</title>
  <author>John Newton</author>
  <copyright>Public Domain</copyright>
  <presentation>V1 C V2 C</presentation>
  <hymn_number></hymn_number>
  <ccli>22025</ccli>
  <capo print="false"></capo>
  <key>G</key>
  <lyrics>[V1]
.G        C
 Amazing grace, how sweet the sound
;a comment for the band
 That saved a wretch like me
[C]
 My chains are&#32;gone
 I've been set free &amp; found
[V2]
 Twas grace that taught my heart to fear
---
 And grace my fears relieved</lyrics>
</song>`;
const s = parseOpenSong(sample)!;
assert.equal(s.title, "Amazing Grace");
assert.equal(s.author, "John Newton");
assert.equal(s.ccli, "22025");
assert.deepEqual(s.sections.map((x) => x.label), ["Verse 1", "Chorus", "Verse 2"]);
assert.equal(s.sections[0].text, "Amazing grace, how sweet the sound\nThat saved a wretch like me", "chord lines and comments are left out");
assert.equal(s.sections[1].text, "My chains are gone\nI've been set free & found", "XML escapes are read");
assert.equal(s.sections[2].text, "Twas grace that taught my heart to fear\nAnd grace my fears relieved", "a slide break inside a part is dropped");
assert.deepEqual(s.arrangement, [0, 1, 2, 1], "the presentation line sets the order");
// it makes slides like any other song
const slides = songSlides({ title: s.title, author: s.author, ccli: s.ccli, ...s });
assert.deepEqual(slides.map((x) => x.section), ["Verse 1", "Chorus", "Verse 2", "Chorus"]);
assert.match(slides[0].credit ?? "", /CCLI Song #22025/);

// no presentation line: the parts as written; a CDATA block; other markers
const c = parseOpenSong(`<song><title><![CDATA[Great Is Thy Faithfulness]]></title><lyrics><![CDATA[[1]
 Great is Thy faithfulness
[P]
 Morning by morning
[B]
 Summer and winter
[T]
 Amen]]></lyrics></song>`)!;
assert.equal(c.title, "Great Is Thy Faithfulness");
assert.deepEqual(c.sections.map((x) => x.label), ["Verse 1", "Pre-Chorus", "Bridge", "Tag"]);
assert.deepEqual(c.arrangement, [0, 1, 2, 3]);
assert.equal(c.ccli, "");

// the same code again: the same words are one part sung again; other words are another part
const d = parseOpenSong(`<song><title>T</title><lyrics>[C]
 one
[V1]
 two
[C]
 one
[C]
 three</lyrics></song>`)!;
assert.deepEqual(d.sections.map((x) => [x.label, x.text]), [["Chorus", "one"], ["Verse 1", "two"], ["Chorus 2", "three"]]);

// the file's name stands in for a missing title; words before any marker are a verse; chords and underscores
const e = parseOpenSong(`<song><lyrics> Words with no marker
 Syl_la_ble
.Am</lyrics></song>`, "From the file name")!;
assert.equal(e.title, "From the file name");
assert.deepEqual(e.sections.map((x) => [x.label, x.text]), [["Verse", "Words with no marker\nSyllable"]]);

// a presentation line naming a part that is not there is tolerated
assert.deepEqual(parseOpenSong(`<song><title>T</title><presentation>V1 X9 C</presentation><lyrics>[V1]
 a
[C]
 b</lyrics></song>`)!.arrangement, [0, 1]);
// one that names nothing that exists falls back to the order written
assert.deepEqual(parseOpenSong(`<song><title>T</title><presentation>Z Q</presentation><lyrics>[V1]
 a</lyrics></song>`)!.arrangement, [0]);

// files that are not songs, or are broken, give nothing and never throw
for (const bad of ["", "   ", "hello", "{\"json\": true}", "<html><body>no</body></html>", "<song></song>", "<song><title>No words</title></song>", "<song><title>T</title><lyrics></lyrics></song>", "<song><title>T</title><lyrics>[V1]\n.C G\n;only chords</lyrics></song>", "<song><title>Cut off", "\u0000\u0001\u0002<song", "<song><title>T</title><lyrics>[V1]"]) {
  assert.equal(parseOpenSong(bad), null, JSON.stringify(bad.slice(0, 40)));
}
// a title-less, name-less song is not kept
assert.equal(parseOpenSong("<song><lyrics>[V1]\n words</lyrics></song>"), null);
// a broken file that still has its words is read as far as it goes
assert.equal(parseOpenSong("<song><title>Half</title><lyrics>[V1]\n words here</lyrics>")?.sections[0].text, "words here");
// absurd input is bounded
const big = "<song><title>Big</title><lyrics>" + "[V1]\n line\n".repeat(20000) + "</lyrics></song>";
assert.ok(parseOpenSong(big));
assert.ok(parseOpenSong("<song><title>" + "x".repeat(100000) + "</title><lyrics>[V1]\n a</lyrics></song>")!.title.length <= 200);

// the labels
assert.equal(openSongLabel("V1"), "Verse 1");
assert.equal(openSongLabel("c"), "Chorus");
assert.equal(openSongLabel("C2"), "Chorus 2");
assert.equal(openSongLabel("P"), "Pre-Chorus");
assert.equal(openSongLabel("3"), "Verse 3");
assert.equal(openSongLabel("Intro"), "Intro");
assert.deepEqual(parseOpenSongLyrics(""), []);

console.log("opensong: all checks passed");
