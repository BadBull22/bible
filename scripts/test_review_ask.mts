// The rules for asking the reader to review the app (src/reviewAsk.ts). Run: node --no-warnings scripts/test_review_ask.mts
import { afterAnswer, afterOpen, afterShown, due, fresh, GAP_DAYS, MAX_ASKS, MIN_DAYS, MIN_OPENS } from "../src/reviewAsk.ts";

let bad = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
};
const DAY = 86_400_000;
const t0 = 1_700_000_000_000;
let s = fresh(t0);
eq("never on the first start", due(afterOpen(s), t0), false);
for (let i = 0; i < MIN_OPENS; i++) s = afterOpen(s);
eq("not before enough days have passed", due(s, t0 + 1 * DAY), false);
eq("not before enough days, even with many starts", due(s, t0 + (MIN_DAYS - 1) * DAY), false);
eq("asked after enough starts and days", due(s, t0 + MIN_DAYS * DAY), true);
const asked1 = afterShown(s, t0 + MIN_DAYS * DAY);
eq("not again the same day", due(asked1, t0 + MIN_DAYS * DAY + DAY), false);
eq("not again within the month", due(asked1, t0 + MIN_DAYS * DAY + (GAP_DAYS - 1) * DAY), false);
eq("again after the month if the reader said maybe later", due(afterAnswer(asked1, "later"), t0 + MIN_DAYS * DAY + GAP_DAYS * DAY), true);
eq("never again after don't ask again", due(afterAnswer(asked1, "never"), t0 + 400 * DAY), false);
eq("never again after going to the Store", due(afterAnswer(asked1, "review"), t0 + 400 * DAY), false);
let k = s;
for (let i = 0; i < MAX_ASKS; i++) k = afterShown(k, t0 + 10 * DAY);
eq("no more than three requests in all", due(k, t0 + 1000 * DAY), false);
console.log(bad ? `${bad} problem(s)` : "review ask: all checks passed");
process.exit(bad ? 1 : 0);
