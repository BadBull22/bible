// node --no-warnings mobile/scripts/test_scripture_links.mts
import { linkRefs } from "../src/scriptureLinks.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) {
    failed++;
    console.log("FAIL", name, detail);
  }
};
const refs = (t: string, d?: string) => linkRefs(t, d).filter((p): p is { text: string; book: string; chapter: number; verse: number } => "book" in p).map((p) => `${p.book} ${p.chapter}:${p.verse}=${p.text}`);

// the lesson the owner looked at: a full reference, then a bare one that follows the book just named
const lesson = "He trusts the LORD who rescued him from the lion and the bear (1 Samuel 17:37), and he says the battle belongs to the LORD (17:47).";
check("full then bare", JSON.stringify(refs(lesson)) === JSON.stringify(["1 Samuel 17:37=1 Samuel 17:37", "1 Samuel 17:47=17:47"]), JSON.stringify(refs(lesson)));
// the pieces put back together are the sentence, unchanged
check("nothing lost", linkRefs(lesson).map((p) => p.text).join("") === lesson);
// a bare one with no book before it takes the page's own book
check("page book", JSON.stringify(refs("turned the day (17:50-52).", "1 Samuel")) === JSON.stringify(["1 Samuel 17:50=17:50-52"]));
check("no book at all: left alone", refs("turned the day (17:50-52).").length === 0);
// the spellings
check("Psalm", refs("as in Psalm 23:1 and Song of Solomon 2:4")[0] === "Psalms 23:1=Psalm 23:1" && refs("as in Psalm 23:1 and Song of Solomon 2:4")[1] === "Song of Solomon 2:4=Song of Solomon 2:4");
check("numbered books", refs("see 2 Corinthians 12:9 and 1 John 4:19")[0] === "2 Corinthians 12:9=2 Corinthians 12:9" && refs("see 2 Corinthians 12:9 and 1 John 4:19")[1] === "1 John 4:19=1 John 4:19");
// words that are not references
check("verse words", refs("verses 37 and 45-47 of the chapter", "1 Samuel").length === 0);
check("times and numbers", refs("at 10:30 on 3:45 a ratio", undefined).length === 0 && refs("at 10:30", "Luke").length === 1 /* a bare c:v is a reference when the page has a book: the story texts never write times */);
check("not part of a longer number", refs("1234:56", "Luke").length === 0);
check("an unknown name is left alone", refs("Frodo 3:16").length === 0);
console.log(failed === 0 ? "scripture links: all checks passed" : `${failed} FAILED`);
process.exit(failed ? 1 : 0);
