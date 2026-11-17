// Which preferences travel in a backup, and how they come back. Run: node --experimental-strip-types mobile/scripts/test_backup_settings.mts
import assert from "node:assert/strict";
import { checkState, checkTheme, collectSettings, mergeSettings } from "../src/backupSettings.ts";

const state = JSON.stringify({ version: "KJV", book: "John", chapter: 3, size: 1.3, theme: "dark", textColor: "blue", contrast: "high", font: "sans", rate: 1.2, voice: null, red: true, dayVerse: true, second: "BSB", reminder: "07:30", updates: false });
const theme = JSON.stringify({ chosen: "advent", season: { key: "advent", slug: "advent", start: 1, end: 2, answer: "keep" }, declined: ["lent"], seasonal: true, keep: false, wordmarkFrom: "theme", backgroundFrom: "none", reading: "soft", appColour: "#8899aa" });

// what goes in: the preferences, never the place in the Bible or the season's bookkeeping
const got = collectSettings({ state, theme })!;
assert.deepEqual(got.state, { version: "KJV", second: "BSB", size: 1.3, theme: "dark", textColor: "blue", contrast: "high", font: "sans", rate: 1.2, voice: null, reminder: "07:30", updates: false });
assert.equal((got.state as Record<string, unknown>).book, undefined);
assert.equal((got.state as Record<string, unknown>).chapter, undefined);
assert.deepEqual(got.theme, { chosen: "advent", seasonal: true, keep: false, wordmarkFrom: "theme", backgroundFrom: "none", reading: "soft", appColour: "#8899aa" });
assert.equal((got.theme as Record<string, unknown>).season, undefined);
assert.equal((got.theme as Record<string, unknown>).declined, undefined);

// nothing stored, nothing to keep; storage that is not JSON is ignored
assert.equal(collectSettings({ state: null, theme: null }), null);
assert.equal(collectSettings({ state: "not json", theme: "[1,2]" }), null);

// a value the app does not understand is left out, the rest stays
assert.deepEqual(checkState({ theme: "neon", size: 99, rate: "fast", reminder: "25:99", font: "serif", voice: 5, updates: "yes", version: "x".repeat(500) }), { font: "serif" });
assert.deepEqual(checkState({ reminder: null, second: null, voice: null }), { reminder: null, second: null, voice: null });
assert.deepEqual(checkTheme({ chosen: "", appColour: "red", reading: "huge", keep: "no", wordmarkFrom: "x".repeat(200) }), {});
assert.deepEqual(checkTheme({ appColour: "standard" }), { appColour: "standard" });
assert.deepEqual(checkState("x"), {});
assert.deepEqual(checkState([]), {});

// coming back: the file's preferences are laid over what is there; the place in the Bible stays
const here = { state: JSON.stringify({ version: "BSB", book: "Psalms", chapter: 23, theme: "light", size: 1 }), theme: null };
const m = mergeSettings(here, got);
const merged = JSON.parse(m.state!);
assert.equal(merged.version, "KJV");
assert.equal(merged.theme, "dark");
assert.equal(merged.book, "Psalms", "where the reader is stays");
assert.equal(merged.chapter, 23);
assert.deepEqual(JSON.parse(m.theme!), got.theme);
assert.deepEqual(m.applied, ["settings"]);

// a file with nothing usable changes nothing; hostile parts are dropped
const none = mergeSettings(here, { state: { theme: "neon", __proto__: { x: 1 }, evil: "<script>" }, theme: 5 });
assert.equal(none.state, here.state);
assert.equal(none.theme, null);
assert.deepEqual(none.applied, []);
assert.equal(mergeSettings(here, undefined).state, here.state);
assert.equal(mergeSettings(here, "text").state, here.state);
const evil = JSON.parse(mergeSettings(here, { state: { theme: "sepia", evil: "<script>", book: "Revelation" } }).state!);
assert.equal(evil.theme, "sepia");
assert.equal(evil.evil, undefined, "only the listed preferences come in");
assert.equal(evil.book, "Psalms", "a file cannot move the reader");
// the stories and children's pages read travel too (only ids of the right shape), and come back added to what is already here
const withRead = collectSettings({ state: null, theme: null, read: JSON.stringify(["stories:jonah", "children:noah-for-children", "bad id", 7]) })!;
assert.deepEqual(withRead.read, ["stories:jonah", "children:noah-for-children"]);
assert.equal(collectSettings({ state: null, theme: null, read: "[]" }), null);
assert.equal(collectSettings({ state: null, theme: null, read: "not json" }), null);
const back = mergeSettings({ state: null, theme: null, read: JSON.stringify(["stories:ruth"]) }, withRead);
assert.deepEqual(JSON.parse(back.read!), ["stories:ruth", "stories:jonah", "children:noah-for-children"]);
assert.deepEqual(back.applied, ["read stories"]);
const same = mergeSettings({ state: null, theme: null, read: JSON.stringify(["stories:jonah", "children:noah-for-children"]) }, withRead);
assert.deepEqual(same.applied, [], "nothing new, nothing changes");
assert.equal(mergeSettings({ state: null, theme: null }, { read: "stories:jonah" }).read, null);
console.log("backup settings: all checks passed");
