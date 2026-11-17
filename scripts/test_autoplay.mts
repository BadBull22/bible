// Slides that move on by themselves. Run: node --experimental-strip-types scripts/test_autoplay.mts
import assert from "node:assert/strict";
import { autoForDeck, hasAuto, nextAfterTimer, NO_AUTO, parseAuto, secondsFor, secondsLeft } from "../src/autoplay.ts";

// an old deck, with nothing about timing, loads as "off"
assert.deepEqual(parseAuto(undefined), NO_AUTO);
assert.deepEqual(parseAuto(null), NO_AUTO);
assert.deepEqual(parseAuto("nonsense"), NO_AUTO);
assert.deepEqual(parseAuto({}), NO_AUTO);
assert.equal(parseAuto({ seconds: 8, loop: true, fade: 0.8 }).seconds, 8);
assert.equal(parseAuto({ seconds: -5 }).seconds, 0, "never negative");
assert.equal(parseAuto({ seconds: 99999 }).seconds, 3600, "never more than an hour");
assert.equal(parseAuto({ seconds: "12" }).seconds, 12, "a number written as text still counts");
assert.equal(parseAuto({ seconds: "abc" }).seconds, 0);
assert.equal(parseAuto({ loop: "yes" }).loop, false, "only a real true switches it on");
assert.equal(parseAuto({ fade: 50 }).fade, 3);
assert.equal(parseAuto({ fade: 0 }).fade, 0, "a cut is allowed");
assert.equal(hasAuto(NO_AUTO), false);
assert.equal(hasAuto({ ...NO_AUTO, seconds: 5 }), true);

// how long a slide stays
const auto = { seconds: 10, loop: false, fade: 0.3 };
assert.equal(secondsFor({ kind: "point" }, auto), 10);
assert.equal(secondsFor({ kind: "point", after: 4 }, auto), 4, "a slide's own time wins");
assert.equal(secondsFor({ kind: "point", after: 0 }, auto), 0, "0 makes one slide wait for a click");
assert.equal(secondsFor({ kind: "link" }, auto), 0, "a video or music slide waits unless it has a time");
assert.equal(secondsFor({ kind: "link", after: 30 }, auto), 30);
assert.equal(secondsFor({ kind: "countdown" }, auto), 0);
assert.equal(secondsFor(undefined, auto), 0);
assert.equal(secondsFor({ kind: "point" }, NO_AUTO), 0, "off means off");

// where the timer goes
assert.equal(nextAfterTimer(0, 3, false), 1);
assert.equal(nextAfterTimer(2, 3, false), null, "it stops at the end");
assert.equal(nextAfterTimer(2, 3, true), 0, "or starts over");
assert.equal(nextAfterTimer(0, 1, true), null, "one slide does not loop onto itself");
assert.equal(nextAfterTimer(0, 0, true), null);

// the countdown to the next slide
assert.equal(secondsLeft({ kind: "point" }, auto, 1000, 1000), 10);
assert.equal(secondsLeft({ kind: "point" }, auto, 1000, 4500), 7);
assert.equal(secondsLeft({ kind: "point" }, auto, 1000, 999999), 0);
assert.equal(secondsLeft({ kind: "link" }, auto, 1000, 1000), null);

// saved with the deck: nothing is written for a deck without timing, so an older deck is saved as it always was
assert.deepEqual(autoForDeck(NO_AUTO), {});
assert.deepEqual(autoForDeck(null), {});
assert.deepEqual(autoForDeck({ seconds: 8, loop: true, fade: 0.8 }), { auto: { seconds: 8, loop: true, fade: 0.8 } });
// and what was written reads back, or an old deck reads as off
const saved = JSON.parse(JSON.stringify({ slides: [], ...autoForDeck({ seconds: 8, loop: true, fade: 0.8 }) }));
assert.deepEqual(parseAuto(saved.auto), { seconds: 8, loop: true, fade: 0.8 });
assert.deepEqual(parseAuto(JSON.parse(JSON.stringify({ slides: [] })).auto), NO_AUTO);

console.log("autoplay: all checks passed");
