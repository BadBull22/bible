import assert from "node:assert/strict";
import { bulletinBlocks, defaultOrder, longDate, nextSunday, noticesOf, songTitles } from "../src/bulletin.ts";

// songs: titles only, each once, in order; a YouTube link slide counts as a song by its title
const music = [
  { kind: "song", title: "Verse 1", body: "Amazing grace, how sweet the sound", song: "Amazing Grace", section: "Verse 1" },
  { kind: "song", title: "Verse 2", body: "'Twas grace that taught my heart to fear", song: "Amazing Grace", section: "Verse 2" },
  { kind: "song", title: "Chorus", body: "How great is our God", song: "How Great Is Our God", section: "Chorus" },
  { kind: "link", title: "▶ Oceans", body: "▶ Play", link: "https://example.org/oceans" },
  { kind: "image", title: "A photo", body: "" },
] as never[];
assert.deepEqual(songTitles(music), ["Amazing Grace", "How Great Is Our God", "Oceans"]);

// notices: slides that carry words
const notices = noticesOf([
  { kind: "text", title: "Men's breakfast", body: "Saturday at 8am.\nAll welcome." },
  { kind: "image", title: "Poster", body: "" },
  { kind: "countdown", title: "Starts in", body: "" },
  { kind: "point", title: "Prayer meeting", body: "" },
] as never[]);
assert.deepEqual(notices, [
  { title: "Men's breakfast", body: "Saturday at 8am.\nAll welcome." },
  { title: "Prayer meeting", body: "" },
]);

// the starting order
const sermon = { title: "The Good Shepherd", series: "I am", passages: "John 10:1-18" };
const order = defaultOrder(["Amazing Grace", "Oceans"], sermon, true);
assert.equal(
  order,
  ["Welcome and prayer", "Worship: Amazing Grace", "Song: Oceans", "Notices", "Scripture reading: John 10:1-18", "Message: The Good Shepherd (I am)", "Response and prayer", "Offering", "Closing blessing"].join("\n"),
);
assert.ok(defaultOrder([], null, false).includes("Worship"));

// dates: as written, whatever the time zone
assert.equal(longDate("2026-11-08"), "Sunday 8 November 2026");
assert.equal(longDate(""), "");
assert.equal(longDate("8 November"), "");
assert.equal(nextSunday(new Date(2026, 10, 5)), "2026-11-08"); // a Thursday
assert.equal(nextSunday(new Date(2026, 10, 8)), "2026-11-08"); // a Sunday is itself
assert.equal(nextSunday(new Date(2026, 10, 9)), "2026-11-15"); // a Monday
assert.equal(nextSunday(new Date(2026, 11, 28)), "2027-01-03"); // across the year

// the bulletin
const blocks = bulletinBlocks({ church: "South Point Church", date: "2026-11-08", order, notices, showNotices: true, sermon, noteLines: 8 });
assert.deepEqual(blocks[0], { kind: "title", text: "South Point Church" });
assert.deepEqual(blocks[1], { kind: "subtitle", text: "Order of service · Sunday 8 November 2026" });
const text = JSON.stringify(blocks);
for (const must of ["Worship:", "Amazing Grace", "Men's breakfast", "Saturday at 8am.", "All welcome.", "The Good Shepherd", "John 10:1-18", "Series: I am"]) assert.ok(text.includes(must), `the bulletin has ${must}`);
// never the words of a song
assert.ok(!text.includes("how sweet the sound") && !text.includes("How great is our God"), "no song words");
assert.deepEqual(blocks.at(-1), { kind: "lines", count: 8 });
// a label is in bold, the rest is not
const worship = blocks.find((b) => b.kind === "para" && b.runs[0].text === "Worship:");
assert.ok(worship && worship.kind === "para" && worship.runs[0].bold === true && worship.runs[1].text.trim() === "Amazing Grace");

// without a church name, notices off, no note lines
const bare = bulletinBlocks({ church: "  ", date: "", order: "Welcome", notices, showNotices: false, sermon: null, noteLines: 0 });
assert.deepEqual(bare[0], { kind: "title", text: "Order of service" });
assert.deepEqual(bare[1], { kind: "subtitle", text: "Order of service" });
assert.ok(!JSON.stringify(bare).includes("Men's breakfast") && !bare.some((b) => b.kind === "lines" || b.kind === "subheading"));
assert.equal(bulletinBlocks({ church: "", date: "", order: "", notices: [], showNotices: true, sermon: null, noteLines: 99 }).at(-1)?.kind, "lines");
assert.deepEqual(bulletinBlocks({ church: "", date: "", order: "", notices: [], showNotices: true, sermon: null, noteLines: 99 }).at(-1), { kind: "lines", count: 30 });

console.log("bulletin: all checks passed");
