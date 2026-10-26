import assert from "node:assert/strict";
import { groupsOf, slideForLetter, stripKind } from "../src/presentGroups.ts";

const S = (kind: string, title = "", extra: object = {}) => ({ kind, title, body: "", ...extra }) as any;
const slides = [
  S("title", "Born again"),
  S("point", "God loves us first"),
  S("scripture", "John 3:16"),
  S("point", "1. A visit at night"),
  S("image", "A photo"),
  S("link", "A video"),
  S("scripture", "John 3:1-8"),
  S("song", "Amazing Grace"),
  S("text", "Pray"),
];

const { groups, groupOf } = groupsOf(slides);
assert.deepEqual(groups.map((g) => g.name), ["Title", "God loves us first", "1. A visit at night", "Amazing Grace"]);
assert.deepEqual(groups.map((g) => [g.from, g.to]), [[0, 1], [1, 3], [3, 7], [7, 9]], "a group runs to the next one's first slide");
assert.deepEqual(groupOf, [0, 1, 1, 2, 2, 2, 2, 3, 3]);
// the letters leave out B (black), N (next) and P (back), which the show uses
assert.deepEqual(groups.map((g) => g.letter), ["A", "C", "D", "E"]);
const many = groupsOf(Array.from({ length: 40 }, (_, i) => S("point", `Point ${i}`))).groups;
assert.ok(!many.some((g) => ["B", "N", "P"].includes(g.letter)), "no reserved letters");
assert.equal(many[22].letter, "Z");
assert.equal(many[23].letter, "", "no letter once they run out");

// a key jumps to the group's first slide, in either case
assert.equal(slideForLetter(groups, "d"), 3);
assert.equal(slideForLetter(groups, "D"), 3);
assert.equal(slideForLetter(groups, "b"), null, "B is black, not a group");
assert.equal(slideForLetter(groups, "Z"), null);
assert.equal(slideForLetter(groups, "Enter"), null);

// no title slide: the first slide starts a group whatever it is
const bare = groupsOf([S("scripture", "John 3:16"), S("scripture", "John 3:17")]);
assert.deepEqual(bare.groups.map((g) => [g.name, g.from, g.to]), [["John 3:16", 0, 2]]);
assert.deepEqual(groupsOf([]).groups, []);

// what each slide is
assert.equal(stripKind(S("link"), "video"), "video");
assert.equal(stripKind(S("link"), "audio"), "music");
assert.equal(stripKind(S("link"), null), "link");
assert.equal(stripKind(S("image"), null), "picture");
assert.equal(stripKind(S("text"), null), "words");

console.log("presentGroups: all checks passed");
