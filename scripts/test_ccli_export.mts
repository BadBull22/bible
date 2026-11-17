// The CCLI line in the saved PowerPoint and ProPresenter files: only when the switch is on. Run: node --experimental-strip-types scripts/test_ccli_export.mts
import assert from "node:assert/strict";
import { ccliOn, CCLI_KEY, setCcliOn, withCcli } from "../src/ccliExport.ts";

const slides = [
  { kind: "title", title: "Songs", credit: undefined as string | undefined },
  { kind: "song", title: "Amazing Grace", credit: "Amazing Grace · John Newton · CCLI Song #22025" },
  { kind: "song", title: "Second", credit: "Second · CCLI Song #5" },
];

// with the switch off the lines are taken out, with it on they stay; the slides themselves are not changed
const off = withCcli(slides, false);
assert.deepEqual(off.map((s) => s.credit), [undefined, undefined, undefined]);
assert.equal(slides[1].credit, "Amazing Grace · John Newton · CCLI Song #22025", "the original slides keep theirs");
const on = withCcli(slides, true);
assert.deepEqual(on.map((s) => s.credit), slides.map((s) => s.credit));
assert.deepEqual(off.map((s) => s.title), slides.map((s) => s.title));

// the remembered switch is the presenter's own key; where no storage exists it is off and nothing breaks
assert.equal(CCLI_KEY, "bc-present-ccli");
assert.equal(ccliOn(), false);
assert.doesNotThrow(() => setCcliOn(true));
// with a storage it is read back
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
assert.equal(ccliOn(), false);
setCcliOn(true);
assert.equal(store.get("bc-present-ccli"), "1");
assert.equal(ccliOn(), true);
assert.deepEqual(withCcli(slides).map((s) => s.credit), slides.map((s) => s.credit), "the stored switch decides when none is given");
setCcliOn(false);
assert.deepEqual(withCcli(slides).map((s) => s.credit), [undefined, undefined, undefined]);
console.log("ccli export: all checks passed");
