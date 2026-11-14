// What the Content Factory puts in the computer's backup, and how it is put back. Run: node scripts/test_carry.mts
import assert from "node:assert/strict";
import { collectFactory, describe, isFresh, mergeFactory, PORTABLE_SETTINGS } from "../src/factory/carry.ts";

const post = (id: string, status = "new") => ({ id, recipe: "verse", title: id, day: 1, cards: [{ text: "x", reference: "", version: "BSB" }], caption: "", status, lookSeed: 1, keys: [], madeDay: 1 });

// a studio that was never used leaves nothing in the backup
assert.equal(collectFactory(null, [], []), null);
assert.equal(collectFactory(null, "junk", 5), null);

// the names, logos and header and footer go in; where the tool bar sits does not
const stored = { names: ["Pastor Sam"], asked: true, header: { kind: "text", text: "Hello" }, headerImage: "data:image/png;base64,AAAA", dock: "right", tool: "header", panelOpen: false, libOpen: true };
const got = collectFactory(stored, [post("a"), { id: "bad" }, post("b", "posted")], [{ key: "John 3:16", day: 20000 }, { key: 5 }]);
assert.ok(got);
assert.deepEqual(Object.keys(got.factory.settings!).sort(), ["asked", "header", "headerImage", "names"]);
assert.equal(got.factory.settings!.dock, undefined);
assert.equal(got.factory.posts!.length, 2, "a post with no cards is not kept");
assert.equal(got.factory.history!.length, 1);
assert.ok(!PORTABLE_SETTINGS.includes("dock" as never));

// on a computer that was never set up the settings come back, and its own screen choices stay
assert.ok(isFresh(null));
assert.ok(isFresh({ asked: false, dock: "top" }));
assert.ok(!isFresh({ asked: true }));
const fresh = mergeFactory({ settings: { dock: "top", tool: "text" }, posts: [], history: [] }, got);
assert.equal(fresh.settingsRestored, true);
assert.deepEqual((fresh.settings as Record<string, unknown>).names, ["Pastor Sam"]);
assert.equal((fresh.settings as Record<string, unknown>).dock, "top");
assert.equal(fresh.postsAdded, 2);
assert.equal(fresh.history.length, 1);
assert.match(describe(fresh), /^Content Factory: your names, logos and header and footer and 2 ready-to-post items came back\.$/);

// on a computer already set up nothing is overwritten: the settings stay, posts are only added, a post here keeps its status
const mine = { settings: { asked: true, names: ["Someone else"] }, posts: [post("a", "approved")], history: [{ key: "John 3:16", day: 20000 }] };
const kept = mergeFactory(mine, got);
assert.equal(kept.settingsRestored, false);
assert.deepEqual((kept.settings as Record<string, unknown>).names, ["Someone else"]);
assert.equal(kept.postsAdded, 1, "only the post that was not here");
assert.equal((kept.posts as Array<{ id: string; status: string }>).find((p) => p.id === "a")!.status, "approved");
assert.equal(kept.history.length, 1, "the same entry is not added twice");
assert.match(describe(kept), /^Content Factory: 1 ready-to-post item came back\.$/);
assert.equal(describe({ settingsRestored: false, postsAdded: 0 }), "");

// a file that is not what it should be changes nothing
for (const bad of [null, undefined, 5, "x", [], {}, { factory: 5 }, { factory: { posts: "no", history: 3, settings: [] } }]) {
  const r = mergeFactory(mine, bad);
  assert.equal(r.settingsRestored, false);
  assert.equal(r.postsAdded, 0);
  assert.deepEqual(r.posts, mine.posts);
}
// a post with an odd status comes back as new
const odd = mergeFactory({ settings: null, posts: [], history: [] }, { factory: { posts: [post("z", "weird")] } });
assert.equal((odd.posts[0] as { status: string }).status, "new");
console.log("carry: all checks passed");
