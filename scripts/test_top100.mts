import assert from "node:assert/strict";
import { BUNDLED, bestHit, cleanTitle, clearNew, firstArtist, makeSongsFile, mergeChart, normTitle, readSongsFile, toTopSongs, TOP_100, topSongFor } from "../src/worshipTop100.ts";

// the list as the owner gave it: 100 songs, in order, names and artists only
assert.equal(TOP_100.length, 100);
assert.ok(TOP_100.every((s) => s.length === 2 && s[0] && s[1]));
const top = toTopSongs(BUNDLED);
assert.equal(top[0].title, "Jesus Be The Name");
assert.equal(top[99].title, "This Is Our God");
assert.equal(top[99].rank, 100);
assert.ok(top.every((s) => s.status === "listed"));

// "(Live)" is how it was recorded; "(Bless The Lord)" is part of the name
assert.equal(cleanTitle("Who Else (Live)"), "Who Else");
assert.equal(cleanTitle("The Lord Will Provide (Live From Passion 2024)"), "The Lord Will Provide");
assert.equal(cleanTitle("Firm Foundation (He Won't) (Live)"), "Firm Foundation (He Won't)");
assert.equal(cleanTitle("10,000 Reasons (Bless The Lord)"), "10,000 Reasons (Bless The Lord)");
assert.equal(cleanTitle("Amazing Grace (My Chains Are Gone)"), "Amazing Grace (My Chains Are Gone)");

// the first artist, plainly written
assert.equal(firstArtist("Elevation Worship / Tiffany Hudson"), "Elevation Worship");
assert.equal(firstArtist("ELEVATION RHYTHM / Lizzie Morgan"), "Elevation Rhythm");
assert.equal(firstArtist("Hillsong UNITED / TAYA"), "Hillsong UNITED");
assert.equal(firstArtist("Chris Tomlin"), "Chris Tomlin");

// a saved song is found in the list by its title, however it was typed
assert.equal(topSongFor(top, "who else")?.rank, 7);
assert.equal(topSongFor(top, "Who Else (Live)")?.rank, 7);
assert.equal(topSongFor(top, "GOODNESS OF GOD")?.rank, 5);
assert.equal(topSongFor(top, "A song that is not on it"), null);
assert.equal(normTitle("Who Else (Live)"), normTitle("who  else"));

// updating from the chart: new, kept, dropped
const prev = BUNDLED.slice(0, 3); // Jesus Be The Name, Washed, Holy Forever
const fresh = [
  { title: "Washed", artists: ["ELEVATION RHYTHM"] },
  { title: "A Brand New Song", artists: ["Some Band", "A Singer"] },
  { title: "Jesus Be The Name", artists: ["Elevation Worship", "Tiffany Hudson"] },
  { title: "Washed (Live)", artists: ["ELEVATION RHYTHM"] }, // the same song again: once
];
const merged = mergeChart(prev, fresh, "2026-10-27");
assert.deepEqual(merged.map((s) => [s.listed, s.status]), [["Washed", "listed"], ["A Brand New Song", "new"], ["Jesus Be The Name", "listed"], ["Holy Forever", "dropped"]]);
assert.equal(merged[1].added, "2026-10-27");
assert.equal(merged[1].artists, "Some Band / A Singer");
// a new song stays new on the next update, with the day it first came
const again = mergeChart(merged, fresh, "2026-11-03");
assert.equal(again.find((s) => s.listed === "A Brand New Song")?.status, "new");
assert.equal(again.find((s) => s.listed === "A Brand New Song")?.added, "2026-10-27");
// until the marks are cleared
assert.equal(clearNew(again).find((s) => s.listed === "A Brand New Song")?.status, "listed");
// the places run over the songs on the chart only, the dropped one has none
const shown = toTopSongs(merged);
assert.deepEqual(shown.map((s) => s.rank), [1, 2, 3, 0]);
assert.equal(shown[1].artist, "Some Band");

// the one to take from what a look-up found
const hits = [
  { title: "Goodness of God", artist: "CeCe Winans" },
  { title: "Goodness of God (Live)", artist: "Bethel Music" },
  { title: "Goodness of God", artist: "Jenn Johnson" },
];
assert.equal(bestHit(hits, "Goodness Of God", "Bethel Music")?.artist, "Bethel Music");
// two with the right title and none by the right artist: no guess, the preacher chooses
assert.equal(bestHit(hits, "Goodness Of God", "Someone Else"), null);
// only one with that title: take it
assert.equal(bestHit([{ title: "Washed", artist: "Elevation Rhythm" }, { title: "Washed Away", artist: "X" }], "Washed", "ELEVATION RHYTHM")?.artist, "Elevation Rhythm");
assert.equal(bestHit([{ title: "Something Else", artist: "X" }], "Washed", "Y"), null);

// the library as a file and back
const body = JSON.stringify({ sections: [{ label: "Verse 1", text: "a\nb" }], arrangement: [0] });
const file = makeSongsFile([{ title: "Test Song", author: "A", ccli: "", body }, { title: "No Words", author: "", ccli: "", body: JSON.stringify({ sections: [], arrangement: [] }) }], new Date("2026-10-26T10:00:00Z"));
assert.equal(file.app, "bible-concordance-songs");
const back = readSongsFile(JSON.stringify(file));
assert.ok("songs" in back);
if ("songs" in back) {
  assert.equal(back.songs.length, 1, "a song with no words is left out");
  assert.equal(back.songs[0].title, "Test Song");
}
assert.ok("error" in readSongsFile("not json"));
assert.ok("error" in readSongsFile(JSON.stringify({ app: "something else", songs: [] })));
assert.ok("error" in readSongsFile(JSON.stringify({ app: "bible-concordance-songs", version: 1, songs: [] })));

console.log("test_top100: all passed");
