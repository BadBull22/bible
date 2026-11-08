// The theme choice rules (wordmark and background picked separately, keep my selection). Run: node --no-warnings scripts/test_theme_choice.mts
import { handChosen, mayAutoSwitch, resolveChoice, type Choice } from "../src/themes/themeChoice.ts";

let bad = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
};
const known = (s: string) => ["christmas", "sea-of-galilee", "healing", "warm-paper"].includes(s);
const base: Choice = { chosen: "default", wordmarkFrom: "theme", backgroundFrom: "theme", keep: false };

// nothing selected: the default theme, with its slight glow; a season may switch it
eq("default", resolveChoice(base, null, known), { base: null, wordmark: null, background: null, defaultGlow: true, mixed: false });
eq("a season switches the default", resolveChoice(base, "christmas", known).base, "christmas");
eq("auto switch allowed", mayAutoSwitch(base, true), true);
eq("auto switch off in the setting", mayAutoSwitch(base, false), false);

// a theme picked by hand is never switched by a season
const picked = { ...base, chosen: "healing" };
eq("picked theme", resolveChoice(picked, "christmas", known), { base: "healing", wordmark: "healing", background: "healing", defaultGlow: false, mixed: false });
eq("picked: no auto switch", mayAutoSwitch(picked, true), false);

// mix and match
const mix = { ...base, chosen: "christmas", backgroundFrom: "sea-of-galilee" };
eq("christmas wordmark on the sea background", resolveChoice(mix, null, known), { base: "christmas", wordmark: "christmas", background: "sea-of-galilee", defaultGlow: false, mixed: true });
const onlyWordmark = { ...base, wordmarkFrom: "christmas" };
eq("a wordmark picked on its own (default background)", resolveChoice(onlyWordmark, "healing", known), { base: null, wordmark: "christmas", background: null, defaultGlow: true, mixed: true });
eq("picking only a wordmark counts as a selection by hand", handChosen(onlyWordmark), true);
eq("...so no season switches it", resolveChoice(onlyWordmark, "healing", known).background, null);
const onlyBackground = { ...base, backgroundFrom: "warm-paper" };
eq("a background on its own", resolveChoice(onlyBackground, null, known), { base: null, wordmark: null, background: "warm-paper", defaultGlow: false, mixed: true });

// plain parts
const plainBg = { ...base, chosen: "christmas", backgroundFrom: "none" };
eq("plain background beside a theme's wordmark", resolveChoice(plainBg, null, known), { base: "christmas", wordmark: "christmas", background: null, defaultGlow: false, mixed: true });
const plainAll = { ...base, wordmarkFrom: "none", backgroundFrom: "none" };
eq("all plain: no glow either", resolveChoice(plainAll, "christmas", known), { base: null, wordmark: null, background: null, defaultGlow: false, mixed: true });

// keep my selection: whatever is selected stays, nothing switches
const keep = { ...base, keep: true };
eq("keep: no season switch of the default", resolveChoice(keep, "christmas", known).base, null);
eq("keep: no auto switch", mayAutoSwitch(keep, true), false);
const keepMix = { ...mix, keep: true };
eq("keep: the mix stays", resolveChoice(keepMix, "healing", known), { base: "christmas", wordmark: "christmas", background: "sea-of-galilee", defaultGlow: false, mixed: true });

// a theme that no longer exists falls back safely
eq("unknown picked theme", resolveChoice({ ...base, chosen: "gone" }, null, known).base, null);
eq("unknown wordmark source", resolveChoice({ ...base, chosen: "healing", wordmarkFrom: "gone" }, null, known).wordmark, "healing");

console.log(bad ? `${bad} problem(s)` : "theme choice: all checks passed");
process.exit(bad ? 1 : 0);
