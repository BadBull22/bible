// The phone's check of the additional pages file (mobile/src/extraValidate.ts): whatever arrives, nothing that cannot be shown gets through, and a bad
// page never takes the good ones with it.
//   node --no-warnings mobile/scripts/test_extra_pages.mts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseExtraPages } from "../src/extraValidate.ts";

const read = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/browse/data/${name}.json`, import.meta.url)), "utf-8")).pages as any[];
const stories = read("stories");
const topics = read("topics");
const children = read("children");
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const renamed = (p: any, id: string, title = p.title) => ({ ...clone(p), id, title });

const problems: string[] = [];
const expect = (what: string, ok: boolean) => {
  if (!ok) problems.push(what);
};
const file = (o: object) => JSON.stringify({ format: 1, ...o });

// 1. every page that ships in the app is a page the phone accepts (the checks are no stricter than the built-in pages)
const all = parseExtraPages(file({ stories, topics, children }));
expect("every built-in story passes", all.pages.stories.length === stories.length);
expect("every built-in topic passes", all.pages.topics.length === topics.length);
expect("every built-in children's page passes", all.pages.children.length === children.length);
expect("nothing is skipped", all.skipped.length === 0);

// 2. a normal additional file: three new pages and some search words
const good = parseExtraPages(
  file({
    revision: "2026-11-12",
    stories: [renamed(stories[0], "a-new-story", "A new story")],
    topics: [renamed(topics[0], "verses-for-a-new-need", "Verses for a new need")],
    children: [renamed(children[0], "a-new-child-page", "A new child page")],
    keywords: { stories: { "a-new-story": ["fresh", "different words"] }, topics: { "verses-for-a-new-need": ["need"] } },
  }),
);
expect("a good file: 1 story, 1 topic, 1 children's page", good.pages.stories.length === 1 && good.pages.topics.length === 1 && good.pages.children.length === 1);
expect("the label is kept", good.revision === "2026-11-12");
expect("search words are kept", good.pages.keywords.stories["a-new-story"]?.length === 2 && good.pages.keywords.topics["verses-for-a-new-need"]?.[0] === "need");

// 3. a file that is not what the app reads gives nothing
for (const [name, text] of [["rubbish", "<html>"], ["a list", "[1]"], ["the wrong format", JSON.stringify({ format: 2, stories })], ["no format", JSON.stringify({ stories })], ["empty", ""]] as const) {
  const r = parseExtraPages(text);
  expect(`${name}: no pages`, r.pages.stories.length + r.pages.topics.length + r.pages.children.length === 0 && r.skipped.length === 1);
}
expect("a file with no pages is fine", parseExtraPages(file({})).skipped.length === 0);

// 4. one page at a time: a page that is wrong is left out and the others stay
const ok = renamed(stories[1], "still-fine", "Still fine");
const cases: [string, (p: any) => void][] = [
  ["a draft", (p) => (p.review = { status: "draft", rev: 1 })],
  ["no review", (p) => delete p.review],
  ["no summary", (p) => delete p.summary],
  ["an empty summary", (p) => (p.summary = "   ")],
  ["a summary that is not text", (p) => (p.summary = 5)],
  ["a bad id", (p) => (p.id = "Has Spaces")],
  ["an id that leaves the folder", (p) => (p.id = "../x")],
  ["no title", (p) => delete p.title],
  ["a title that is too long", (p) => (p.title = "x".repeat(61))],
  ["a passage that is not a reference", (p) => (p.passages = [{ ref: "not a reference", label: "x" }])],
  ["no passages", (p) => (p.passages = [])],
  ["too many passages", (p) => (p.passages = Array(9).fill(p.passages[0]))],
  ["passages that are not a list", (p) => (p.passages = "1 Samuel 17:1")],
  ["a testament that is neither", (p) => (p.testament = "XX")],
  ["lessons that are not a list", (p) => (p.lessons = "one")],
  ["tags that are not a list", (p) => (p.tags = "faith")],
  ["a doctrine that is neither", (p) => (p.doctrine = "maybe")],
  ["a flagged page with no note", (p) => ((p.doctrine = "needs_review"), delete p.doctrine_note)],
  ["a link that is not a page name", (p) => (p.related = ["Bad Id!"])],
  ["an enormous summary", (p) => (p.summary = "word ".repeat(2000))],
];
for (const [what, spoil] of cases) {
  const bad = renamed(stories[0], "spoiled", "Spoiled");
  spoil(bad);
  const r = parseExtraPages(file({ stories: [ok, bad] }));
  expect(`${what}: left out`, r.pages.stories.length === 1 && r.pages.stories[0].id === "still-fine" && r.skipped.length === 1);
}
// the other two kinds
const badTopic = (spoil: (p: any) => void) => {
  const t = renamed(topics[0], "bad-topic", "Verses for nothing");
  spoil(t);
  return parseExtraPages(file({ topics: [t] })).pages.topics.length === 0;
};
expect("a topic with no passages is left out", badTopic((p) => (p.items = [])));
expect("a topic whose passage is not a reference is left out", badTopic((p) => (p.items[0].ref = "nope")));
expect("a topic with no intro is left out", badTopic((p) => delete p.intro));
expect("a topic with no dictionary word is left out", badTopic((p) => delete p.dictionary));
const badChild = (spoil: (p: any) => void) => {
  const c = renamed(children[0], "bad-child", "Bad child");
  spoil(c);
  return parseExtraPages(file({ children: [c] })).pages.children.length === 0;
};
expect("a children's page with an odd age is left out", badChild((p) => (p.age = "13-15")));
expect("a children's page with no retelling is left out", badChild((p) => (p.retelling = [])));
expect("a children's page with no questions is left out", badChild((p) => (p.questions = [])));
expect("a children's page with a question that has no answer is left out", badChild((p) => (p.questions[0] = { q: "Why?" })));
expect("a children's page with no memory verse is left out", badChild((p) => delete p.memory));
expect("a children's page with no big idea is left out", badChild((p) => delete p.message));

// 5. the same id twice in one file: the first stays
const twice = parseExtraPages(file({ stories: [renamed(stories[0], "same", "First"), renamed(stories[1], "same", "Second")] }));
expect("a repeated id keeps the first only", twice.pages.stories.length === 1 && twice.pages.stories[0].title === "First" && twice.skipped.length === 1);

// 6. odd shapes inside the file do not throw
for (const x of [null, 5, "text", [], { stories: "no" }, { stories: [null, 5, "x", []] }, { stories: [{}] }, { topics: [{ id: "a", title: "b", items: [null] }] }]) {
  try {
    parseExtraPages(JSON.stringify({ format: 1, ...(x && typeof x === "object" && !Array.isArray(x) ? x : { stories: x }) }));
  } catch (e) {
    problems.push(`an odd file threw: ${JSON.stringify(x)} (${e})`);
  }
}

console.log(`extra pages: ${all.pages.stories.length + all.pages.topics.length + all.pages.children.length} built-in pages accepted; ${cases.length + 10} spoiled pages refused one by one`);
if (problems.length) {
  for (const p of problems) console.log("  PROBLEM: " + p);
  console.log(`extra pages: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("extra pages: all checks pass");
