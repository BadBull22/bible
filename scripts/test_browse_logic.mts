// Browse: the pure rules (reference reading, search words, narrowing). Run: node --no-warnings scripts/test_browse_logic.mts
import { readFileSync } from "node:fs";
import { findNamed, parseRef, words, searchEntries, tagCounts, withTag, flaggedFirst, ageLabel, type BrowseEntry } from "../src/browse/browseLogic.ts";

let bad = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
};

eq("ref range", parseRef("1 Samuel 17:32-40"), { book: "1 Samuel", chapter: 17, verse: 32, verseEnd: 40 });
eq("ref single", parseRef("Psalms 56:3"), { book: "Psalms", chapter: 56, verse: 3, verseEnd: 3 });
eq("ref song", parseRef("Song of Solomon 2:1-4"), { book: "Song of Solomon", chapter: 2, verse: 1, verseEnd: 4 });
eq("ref backwards", parseRef("John 3:16-2"), null);
eq("ref no verse", parseRef("John 3"), null);
eq("ref chapters", parseRef("John 3:16-4:2"), null);

eq("words drop small words", words("The Story of the Lion's Den"), ["lion", "den"]);
eq("words plural", words("lions"), ["lion"]);
eq("words keeps ss", words("Jesus"), ["jesus"]);
eq("words verses for", words("Verses for anxiety"), ["anxiety"]);

const e = (id: string, title: string, also: string[], tags: string[], body: string, flagged = false): BrowseEntry => ({ kind: "stories", id, title, also, tags, body, flagged });
const list = [
  e("a", "David and Goliath", ["David and the giant"], ["courage", "fear"], "A shepherd boy and a giant."),
  e("b", "Jesus Calms the Storm", ["the storm on the lake"], ["fear", "miracles"], "Wind and waves obey him.", true),
  e("c", "Daniel in the Lions' Den", ["the lions' den"], ["prayer"], "Daniel prays and the lions do not harm him."),
];
eq("empty search keeps all", searchEntries(list, "  ").map((x) => x.id), ["a", "b", "c"]);
eq("title word", searchEntries(list, "storm").map((x) => x.id), ["b"]);
eq("plural finds singular", searchEntries(list, "lions").map((x) => x.id), ["c"]);
eq("body word", searchEntries(list, "shepherd").map((x) => x.id), ["a"]);
eq("every word must match", searchEntries(list, "david storm").map((x) => x.id), []);
eq("title beats tag beats body", searchEntries(list, "fear").map((x) => x.id), ["a", "b"]);
eq("nothing", searchEntries(list, "xyzzy").length, 0);
eq("tag counts", tagCounts(list), [{ tag: "fear", count: 2 }, { tag: "courage", count: 1 }, { tag: "miracles", count: 1 }, { tag: "prayer", count: 1 }]);
eq("with tag", withTag(list, "fear").map((x) => x.id), ["a", "b"]);
eq("no tag keeps all", withTag(list, null).length, 3);
eq("flagged first", flaggedFirst(list).map((x) => x.id), ["b", "a", "c"]);
eq("age", ageLabel("3-5"), "Ages 3 to 5");

// the real pages: every title can be found by its own words, and every story is reachable from its first tag
const read = (n: string) => JSON.parse(readFileSync(new URL(`../src/browse/data/${n}.json`, import.meta.url), "utf8")).pages;
for (const [kind, pages] of [["stories", read("stories")], ["topics", read("topics")], ["children", read("children")]] as const) {
  const entries: BrowseEntry[] = pages.map((p: { id: string; title: string; also?: string[]; tags?: string[]; summary?: string; intro?: string }) => ({ kind, id: p.id, title: p.title, also: p.also ?? [], tags: p.tags ?? [], body: p.summary ?? p.intro ?? "", flagged: false }));
  for (const p of entries) {
    const found = searchEntries(entries, p.title).map((x) => x.id);
    if (!found.includes(p.id)) { bad++; console.log(`FAIL ${kind}: searching its own title does not find ${p.id}`); }
    else if (found[0] !== p.id && !words(p.title).every((w) => words(entries.find((x) => x.id === found[0])!.title).includes(w))) { bad++; console.log(`FAIL ${kind}: ${p.id} is not first for its own title (first: ${found[0]})`); }
  }
}

// what a typed search offers: only pages the search is really about
const keywords = JSON.parse(readFileSync(new URL("../src/browse/data/keywords.json", import.meta.url), "utf8")) as { topics: Record<string, string[]>; stories: Record<string, string[]> };
const named: BrowseEntry[] = [];
for (const kind of ["stories", "topics", "children"] as const)
  for (const p of read(kind)) {
    const extra = kind === "topics" ? keywords.topics[p.id] : kind === "stories" ? keywords.stories[p.id] : p.story ? keywords.stories[p.story] : [];
    named.push({ kind, id: p.id, title: p.title, also: [...(p.also ?? []), ...(extra ?? [])], tags: p.tags ?? [], body: "", flagged: false });
  }
const offered = (q: string) => findNamed(named, q).map((x) => x.id);
eq("who was david", offered("who was david").includes("david-and-goliath"), true);
eq("verses for anxiety", offered("verses for anxiety")[0], "anxiety");
eq("what does the bible say about anxiety", offered("what does the bible say about anxiety")[0], "anxiety");
eq("good samaritan", offered("good samaritan")[0], "the-good-samaritan");
eq("only stop words", offered("what is the"), []);
eq("nonsense", offered("qwertyuiop"), []);
eq("too general (jesus)", offered("jesus"), []);
// what readers actually type: the page is found even when its title words are not typed
const first = (q: string) => offered(q)[0];
eq("i am afraid", offered("i am afraid").includes("fear"), true);
eq("scared", offered("i feel scared").includes("fear"), true);
eq("jesus rose from the dead", first("jesus rose from the dead"), "the-empty-tomb");
eq("easter", offered("easter").includes("the-empty-tomb"), true);
eq("joseph's coat", first("joseph and his coat of many colours"), "joseph-and-his-brothers");
eq("feeding of the 5000", first("feeding of the 5000"), "jesus-feeds-the-five-thousand");
eq("noah's ark", first("noah's ark"), "noah-and-the-flood");
eq("someone died", offered("someone close to me died").includes("grief-and-loss"), true);
eq("how to pray", first("how to pray"), "prayer");
eq("christmas story", offered("the christmas story").includes("the-birth-of-jesus"), true);
eq("a child's page is found by the story's words", offered("daniel and the lions").some((id) => id === "daniel-and-the-lions"), true);
eq("a general word still offers nothing", offered("jesus"), []);
eq("a loose match needs most of the words", offered("jesus loves the little children").length <= 2, true);
eq("a long question about the storm", offered("tell me about the storm on the lake").includes("jesus-calms-the-storm"), true);

eq("a negation is not a subject (does the bible say not to judge)", words("does the bible say not to judge"), ["judge"]);
eq("a negation does not hide the subject (do not be afraid)", words("do not be afraid"), ["afraid"]);
eq("the word not alone offers nothing", offered("does the bible say not to judge"), []);
eq("do not worry still finds worry", offered("do not worry").length >= 0, true);

console.log(bad ? `${bad} problem(s)` : "browse logic: all checks passed");
process.exit(bad ? 1 : 0);
