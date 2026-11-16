// The varied daily notifications. Run: node --experimental-strip-types mobile/scripts/test_notify_plan.mts
import assert from "node:assert/strict";
import { planNotifications, type PlanInput } from "../src/notifyPlan.ts";
import type { Learning } from "../src/memoryVerse.ts";

const verseFor = (d: Date) => ({ ref: `John ${d.getDate()}:16`, text: "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life." });
const learn = (book: string, due: string): Learning => ({ book, chapter: 1, verse: 1, verse_end: 1, added_on: "2026-11-01", box: 1, due_on: due, last_on: null });
const base = (over: Partial<PlanInput> = {}): PlanInput => ({ now: new Date(2026, 10, 16, 6, 0), hour: 7, minute: 30, verseFor, memory: [], prayers: [], ...over });

// fourteen days, one each morning at 7:30, in order, each with its own id; the first is today because 7:30 has not passed
let plan = planNotifications(base());
assert.equal(plan.length, 14);
assert.deepEqual(plan.map((p) => new Date(p.at).getDate()).slice(0, 3), [16, 17, 18]);
assert.ok(plan.every((p) => new Date(p.at).getHours() === 7 && new Date(p.at).getMinutes() === 30));
assert.equal(new Set(plan.map((p) => p.id)).size, 14);
assert.ok(plan.every((p, i) => i === 0 || p.at > plan[i - 1].at));

// once today's time has passed the plan starts tomorrow
plan = planNotifications(base({ now: new Date(2026, 10, 16, 8, 0) }));
assert.equal(plan.length, 13);
assert.equal(new Date(plan[0].at).getDate(), 17);
// a time a few seconds away is too late to schedule
assert.equal(planNotifications(base({ now: new Date(2026, 10, 16, 7, 29, 50) })).length, 13);

// without memory verses or prayers the days vary between the verse, the scroll and "How are you today?"
plan = planNotifications(base());
const kinds = new Set(plan.map((p) => p.open));
assert.deepEqual([...kinds].sort(), ["mood", "scroll"]);
assert.ok(new Set(plan.map((p) => p.title)).size >= 3, "different titles through the fortnight");
assert.ok(plan.some((p) => p.title === "Verse for today" && p.body.startsWith("“For God so loved") && p.body.includes("— John ")));
assert.ok(plan.every((p) => p.body.length > 10 && p.body.length < 220), "every message is short enough to read");

// memory verses due bring a "Time to practise" day (never before they are due), and the message names the verse
plan = planNotifications(base({ memory: [learn("Psalms", "2026-11-16"), learn("John", "2026-11-16"), learn("Romans", "2026-11-16")] }));
const practise = plan.filter((p) => p.open === "memory");
assert.ok(practise.length >= 1);
assert.ok(practise.every((p) => /ready to practise\.$/.test(p.body) && /and 2 more verses are ready/.test(p.body)));
const later = planNotifications(base({ memory: [learn("Psalms", "2027-06-01")] }));
assert.ok(!later.some((p) => p.open === "memory"), "nothing is due, so no practise reminder");
const one = planNotifications(base({ memory: [learn("Psalms", "2026-11-16")] })).find((p) => p.open === "memory")!;
assert.ok(one.body.startsWith("Psalms 1:1 is ready"));
const two = planNotifications(base({ memory: [learn("Psalms", "2026-11-16"), learn("John", "2026-11-16")] })).find((p) => p.open === "memory")!;
assert.ok(two.body.includes("and 1 more verse are ready"), two.body);

// prayers bring "A moment to pray" and rotate through the list
plan = planNotifications(base({ prayers: ["My mother's health", "A new job", "Our church"] }));
const pray = plan.filter((p) => p.open === "prayer");
assert.ok(pray.length >= 1 && pray.every((p) => p.title === "A moment to pray" && /^You are praying about: “/.test(p.body)));
assert.ok(new Set(pray.map((p) => p.body)).size >= 2, "a different request each time");

// a verse with no words known still gives a notification; no verse at all falls back to the scroll
plan = planNotifications(base({ verseFor: (d) => ({ ref: "Psalms 23:1", text: "" }) }));
assert.ok(plan.some((p) => p.title === "Verse for today" && p.body === "Today's verse is Psalms 23:1. Tap to read it."));
plan = planNotifications(base({ verseFor: () => null }));
assert.ok(!plan.some((p) => p.title === "Verse for today") && plan.length === 14);

// a long request is cut, not run on
const long = "x ".repeat(200);
assert.ok(planNotifications(base({ prayers: [long] })).filter((p) => p.open === "prayer").every((p) => p.body.length < 140));

// the same inputs always give the same plan
assert.deepEqual(planNotifications(base()), planNotifications(base()));
assert.equal(planNotifications(base({ days: 3 })).length, 3);
console.log("notify plan: all checks passed");
