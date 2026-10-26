import assert from "node:assert/strict";
import { leftText, parseCountdown, startText, targetOf } from "../src/countdown.ts";

// lengths
assert.deepEqual(parseCountdown("5"), { seconds: 300 });
assert.deepEqual(parseCountdown(" 7.5 "), { seconds: 450 });
assert.deepEqual(parseCountdown("10 min"), { seconds: 600 });
assert.deepEqual(parseCountdown("1:30"), { seconds: 90 }, "a bare m:ss is a length");
// times of day
assert.deepEqual(parseCountdown("at 10:30"), { clock: { h: 10, m: 30 } });
assert.deepEqual(parseCountdown("10:30am"), { clock: { h: 10, m: 30 } });
assert.deepEqual(parseCountdown("6:05 PM"), { clock: { h: 18, m: 5 } });
assert.deepEqual(parseCountdown("12:00am"), { clock: { h: 0, m: 0 } });
// not a countdown
assert.equal(parseCountdown(""), null);
assert.equal(parseCountdown("soon"), null);
assert.equal(parseCountdown("at 25:00"), null);

// when it reaches zero
const now = new Date(2026, 9, 26, 9, 55, 0).getTime();
assert.equal(targetOf("5", now), now + 300_000);
assert.equal(targetOf("at 10:00", now), new Date(2026, 9, 26, 10, 0, 0).getTime());
assert.ok((targetOf("at 9:00", now) as number) < now, "a time already past is in the past: the count shows 0:00");
assert.equal(targetOf("soon", now), null);

// how it reads
assert.equal(leftText(299_100), "5:00", "rounds up, so it does not show 4:59 for the first moment");
assert.equal(leftText(59_000), "0:59");
assert.equal(leftText(3_723_000), "1:02:03");
assert.equal(leftText(-5000), "0:00", "never below zero");
assert.equal(startText("5"), "5:00");
assert.equal(startText("at 10:30"), "10:30");
assert.equal(startText("??"), "0:00");
console.log("countdown: ok");
