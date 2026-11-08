import assert from "node:assert/strict";
import { adventOf, dayNumber, easterOf, isoOf, lastWeekday, nthWeekday, occasionOn, occurrenceKey, passoverOf, weekdayOf, windowsOf } from "../src/themes/themeCalendar.ts";

const iso = (n: number | null) => (n === null ? null : isoOf(n));
const day = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return dayNumber(y, m, d);
};
const on = (s: string) => occasionOn(day(s))?.id ?? null;

// Easter (Western), known dates
assert.equal(iso(easterOf(2024)), "2024-03-31");
assert.equal(iso(easterOf(2025)), "2025-04-20");
assert.equal(iso(easterOf(2026)), "2026-04-05");
assert.equal(iso(easterOf(2027)), "2027-03-28");
assert.equal(iso(easterOf(2028)), "2028-04-16");
assert.equal(iso(easterOf(2029)), "2029-04-01");

// weekdays and helpers
assert.equal(weekdayOf(day("2026-11-07")), 6); // a Saturday
assert.equal(iso(nthWeekday(2026, 5, 0, 2)), "2026-05-10"); // Mother's Day 2026
assert.equal(iso(nthWeekday(2026, 6, 0, 3)), "2026-06-21"); // Father's Day 2026
assert.equal(iso(nthWeekday(2026, 11, 4, 4)), "2026-11-26"); // fourth Thursday of November 2026
assert.equal(iso(lastWeekday(2026, 10, 0)), "2026-10-25"); // Bible Sunday 2026
assert.equal(iso(adventOf(2026)), "2026-11-29");
assert.equal(iso(adventOf(2027)), "2027-11-28");
assert.equal(iso(adventOf(2028)), "2028-12-03");
assert.equal(iso(adventOf(2029)), "2029-12-02");

// Passover (15 Nisan), through the Hebrew calendar of the running engine
assert.equal(iso(passoverOf(2026)), "2026-04-02");
assert.equal(iso(passoverOf(2027)), "2027-04-22");
assert.equal(iso(passoverOf(2028)), "2028-04-11");

// windows in 2026
const w26 = Object.fromEntries(windowsOf(2026).filter((w) => w.id !== "communion").map((w) => [w.id, `${isoOf(w.start)}..${isoOf(w.end)}`]));
assert.equal(w26.lent, "2026-02-18..2026-03-28");
assert.equal(w26.palmsunday, "2026-03-29..2026-04-01");
assert.equal(w26.goodfriday, "2026-04-02..2026-04-04");
assert.equal(w26.easter, "2026-04-04..2026-04-14"); // from Holy Saturday, a little longer after Resurrection Sunday
assert.equal(w26.ascension, "2026-05-14..2026-05-17");
assert.equal(w26.pentecost, "2026-05-24..2026-05-30");
assert.equal(w26.trinity, "2026-05-31..2026-05-31");
assert.equal(w26.harvest, "2026-11-22..2026-11-26");
assert.equal(w26.advent, "2026-11-29..2026-12-23");
assert.equal(w26.christmas, "2026-12-15..2026-12-30"); // a day early
assert.equal(w26.newyear, "2026-12-31..2027-01-02");
assert.equal(w26.epiphany, "2026-01-03..2026-01-08");
assert.equal(w26.passover, "2026-04-01..2026-04-09"); // from the day before

// Communion: every first Sunday of the month, 2026
const first = windowsOf(2026).filter((w) => w.id === "communion").map((w) => isoOf(w.start));
assert.deepEqual(first, ["2026-01-04", "2026-02-01", "2026-03-01", "2026-04-05", "2026-05-03", "2026-06-07", "2026-07-05", "2026-08-02", "2026-09-06", "2026-10-04", "2026-11-01", "2026-12-06"]);

// what a given day suggests
assert.equal(on("2026-01-04"), "epiphany"); // first Sunday of January, inside the Epiphany window
assert.equal(on("2026-01-05"), "epiphany");
assert.equal(on("2026-01-20"), null);
assert.equal(on("2026-02-18"), "lent");
assert.equal(on("2026-03-01"), "lent"); // Communion never interrupts a season (the owner, 2026-11-08: no swapping)
assert.equal(on("2026-03-02"), "lent");
assert.equal(on("2026-03-29"), "palmsunday");
assert.equal(on("2026-03-31"), "palmsunday");
// 2026: Palm Sunday, then Passover from the day before the feast, then Resurrection Sunday's theme from Holy Saturday: each once, in order
assert.equal(on("2026-04-01"), "passover");
assert.equal(on("2026-04-02"), "passover");
assert.equal(on("2026-04-03"), "passover");
assert.equal(on("2026-04-04"), "easter");
assert.equal(on("2026-04-05"), "easter"); // Resurrection Sunday (also the first Sunday of April)
assert.equal(on("2026-04-06"), "easter"); // and it holds, even though Passover runs to the 9th: no going back
assert.equal(on("2026-04-09"), "easter");
assert.equal(on("2026-04-14"), "easter");
assert.equal(on("2026-04-15"), null);
// other years: Good Friday shows when Passover is not near (2027), Passover covers it when it is (2028)
assert.equal(on("2027-03-26"), "goodfriday");
assert.equal(on("2027-03-27"), "easter"); // Holy Saturday
assert.equal(on("2027-04-21"), "passover"); // Passover a month after the Western date, from the day before
assert.equal(on("2027-04-22"), "passover");
assert.equal(on("2028-04-09"), "palmsunday");
assert.equal(on("2028-04-10"), "passover"); // the day before Passover (11 April)
assert.equal(on("2028-04-14"), "passover");
assert.equal(on("2028-04-15"), "easter");
assert.equal(on("2028-04-16"), "easter"); // Resurrection Sunday itself
assert.equal(on("2026-05-10"), "mothersday");
assert.equal(on("2026-05-14"), "ascension");
// the owner: Mother's Day wins when it falls on the Sunday after Ascension (2027: Ascension Thursday 6 May, Mother's Day Sunday 9 May)
assert.equal(on("2027-05-06"), "ascension");
assert.equal(on("2027-05-08"), "ascension");
assert.equal(on("2027-05-09"), "mothersday");
assert.equal(on("2027-05-10"), null);
assert.equal(on("2026-05-24"), "pentecost");
assert.equal(on("2026-05-31"), "trinity");
assert.equal(on("2026-06-01"), "childrensday");
assert.equal(on("2026-06-21"), "fathersday");
assert.equal(on("2026-10-25"), "biblesunday");
assert.equal(on("2026-10-31"), "reformation");
assert.equal(on("2026-11-01"), "communion");
assert.equal(on("2026-11-23"), "harvest");
assert.equal(on("2026-11-29"), "advent"); // first Sunday of Advent
assert.equal(on("2026-12-06"), "advent"); // first Sunday of December: Communion does not interrupt Advent
assert.equal(on("2026-12-07"), "advent");
assert.equal(on("2026-12-14"), "advent");
assert.equal(on("2026-12-15"), "christmas"); // Christmas begins on 15 December (a day early) and holds
assert.equal(on("2026-12-20"), "christmas");
assert.equal(on("2026-12-25"), "christmas");
assert.equal(on("2026-12-31"), "newyear");
assert.equal(on("2027-01-02"), "newyear"); // a window that began last year
assert.equal(on("2027-01-03"), "epiphany"); // the first Sunday of January sits in the Epiphany window: Communion stays quiet
assert.equal(on("2026-07-05"), "communion"); // a first Sunday with nothing else on
assert.equal(on("2026-07-06"), null);

// an occurrence has a stable key
const w = occasionOn(day("2026-07-05"))!;
assert.equal(occurrenceKey(w), "communion:2026-07-05");
assert.equal(occurrenceKey(occasionOn(day("2027-01-01"))!), "newyear:2026-12-31");

// the rule: over many years no theme ever comes back after another has taken over (no A, B, A), and the three main themes are never interrupted
let runs = 0;
for (let y = 2024; y <= 2045; y++) {
  const seen = new Set<string>();
  let last = "";
  for (let n = day(`${y}-01-01`); n <= day(`${y}-12-31`); n++) {
    const o = occasionOn(n);
    const key = o ? occurrenceKey(o) : "";
    if (key !== last) {
      if (key && seen.has(key)) assert.fail(`${isoOf(n)}: ${key} came back after another theme (swapping)`);
      if (key) seen.add(key);
      last = key;
      runs++;
    }
  }
  const e = easterOf(y);
  assert.equal(occasionOn(e)?.id, "easter", `${y}: Resurrection Sunday itself`);
  assert.equal(occasionOn(dayNumber(y, 12, 25))?.id, "christmas", `${y}: Christmas Day`);
  const p = passoverOf(y);
  if (p !== null) {
    const id = occasionOn(p)?.id;
    assert.ok(id === "passover" || id === "easter", `${y}: Passover day shows Passover (or Resurrection Sunday if it is that day), not ${id}`);
  }
}

console.log(`theme calendar: all checks passed (${runs} theme runs over 22 years, none comes back)`);
