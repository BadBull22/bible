// Makes the links agree both ways: a topic that lists a story is added to that story's `topics`, and a children's page that names a story becomes that story's `child_page`.
// Usage: node --no-warnings scripts/link_browse.mts   (then run scripts/test_browse.mts)
import { readFileSync, writeFileSync } from "node:fs";
import { put } from "./browse_json.mts";

const url = (n: string) => new URL(`../src/browse/data/${n}.json`, import.meta.url);
const stories = JSON.parse(readFileSync(url("stories"), "utf8"));
const topics = JSON.parse(readFileSync(url("topics"), "utf8"));
const children = JSON.parse(readFileSync(url("children"), "utf8"));
let added = 0;
for (const t of topics.pages) {
  for (const sid of t.stories ?? []) {
    const s = stories.pages.find((p: { id: string }) => p.id === sid);
    if (!s) throw new Error(`topic ${t.id} lists a story that does not exist: ${sid}`);
    s.topics ??= [];
    if (!s.topics.includes(t.id)) {
      s.topics.push(t.id);
      added++;
    }
  }
}
for (const c of children.pages) {
  if (!c.story) continue;
  const s = stories.pages.find((p: { id: string }) => p.id === c.story);
  if (!s) throw new Error(`children's page ${c.id} names a story that does not exist: ${c.story}`);
  if (s.child_page && s.child_page !== c.id) throw new Error(`story ${s.id} already has the children's page ${s.child_page}, not ${c.id}`);
  if (s.child_page !== c.id) {
    s.child_page = c.id;
    added++;
  }
}
writeFileSync(url("stories"), put(stories, "") + "\n");
console.log(`added ${added} link(s) to the stories`);
