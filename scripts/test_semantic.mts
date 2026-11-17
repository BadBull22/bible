// Search by meaning: the pieces of the pipeline and the data file it makes. Run: node --experimental-strip-types scripts/test_semantic.mts
import assert from "node:assert/strict";
import fs from "node:fs";
import { asStrongs, breadcrumb, childrenOf, cleanText, domainPath, searchDomains, strongsSummary, type DomainNode, inDomain, levelOf, meaningSummary, normStrongs, packVerses, parentCode, SEMANTIC_CREDIT, unKey, unpackVerses, verseKey, verseOfRef, type SemanticFile } from "../src/semantic.ts";
import { buildLanguage } from "./build_semantic_domains.mts";

// ---- references
assert.equal(verseOfRef("04002401200018"), verseKey(40, 24, 12), "Matthew 24:12, word 18");
assert.equal(verseOfRef("01804101200018{N:001}"), verseKey(18, 41, 12), "a note's mark after it is ignored");
assert.equal(verseOfRef("04600100000000"), null, "verse 0 is not a verse");
assert.equal(verseOfRef("00000100100001"), null);
assert.equal(verseOfRef("99900100100001"), null);
assert.equal(verseOfRef("garbage"), null);
assert.equal(verseOfRef(""), null);
assert.deepEqual(unKey(verseKey(66, 22, 21)), { book: 66, chapter: 22, verse: 21 });

// ---- packed verse lists
const keys = [verseKey(43, 3, 16), verseKey(1, 1, 1), verseKey(43, 3, 16), verseKey(40, 5, 3)];
const packed = packVerses(keys);
assert.equal(packed[0], verseKey(1, 1, 1), "the first number is a verse");
assert.deepEqual(unpackVerses(packed), [verseKey(1, 1, 1), verseKey(40, 5, 3), verseKey(43, 3, 16)], "sorted, no repeats, and it unpacks to the same verses");
assert.deepEqual(unpackVerses(packVerses([])), []);
for (let i = 0; i < 50; i++) {
  const k = Array.from({ length: 30 }, () => verseKey(1 + Math.floor(Math.random() * 66), 1 + Math.floor(Math.random() * 150), 1 + Math.floor(Math.random() * 176)));
  assert.deepEqual(unpackVerses(packVerses(k)), [...new Set(k)].sort((a, b) => a - b));
}

// ---- Strong's numbers and the dictionaries' markup
assert.equal(normStrongs("G0026"), "G26");
assert.equal(normStrongs("H1697I"), "H1697");
assert.equal(normStrongs("h0100"), "H100");
assert.equal(normStrongs("0026"), "");
assert.equal(normStrongs(""), "");
assert.equal(normStrongs("X12"), "");
assert.equal(cleanText("= plant with {A:HOTTP} flexible stems, ◄ |iScirpus|i*; ► used for ropes"), "= plant with flexible stems, ◄ Scirpus; ► used for ropes");
assert.equal(cleanText("  a   b  "), "a b");
assert.ok(cleanText("word ".repeat(100), 50).length <= 51 && cleanText("word ".repeat(100), 50).endsWith("…"), "long text is cut at a word with an ellipsis");
assert.equal(cleanText(undefined as unknown as string), "");

// ---- the groups
assert.equal(parentCode("025007"), "025");
assert.equal(parentCode("025"), "");
assert.equal(parentCode("001001003001"), "001001003");
assert.equal(levelOf("001"), 1);
assert.equal(levelOf("001001003001"), 4);
assert.ok(inDomain("025007", "025") && inDomain("025", "025") && !inDomain("026", "025") && !inDomain("025", "025007"));
const names = new Map([["025", "Attitudes and Emotions"], ["025007", "Love, Affection, Compassion"]]);
assert.equal(domainPath("025007", names), "Attitudes and Emotions > Love, Affection, Compassion");
assert.equal(domainPath("025", names), "Attitudes and Emotions");
assert.equal(domainPath("099", names), "099", "an unnamed group shows its code");
assert.equal(meaningSummary("Love", "greek", 1, 2), "Love (Greek): 1 word, 2 verses.");
assert.equal(meaningSummary("Love", "hebrew", 52, 1036), "Love (Hebrew): 52 words, 1,036 verses.");

// ---- browsing the groups
const tree: DomainNode[] = [
  { code: "025", name: "Attitudes and Emotions", level: 1, words: 90, verses: 900 },
  { code: "025003", name: "Love, Affection, Compassion", level: 2, words: 12, verses: 300 },
  { code: "025009", name: "Hate, Hostility", level: 2, words: 5, verses: 40 },
  { code: "033", name: "Communication", level: 1, words: 200, verses: 2000 },
  { code: "033001", name: "Love-feasts and Affection", level: 2, words: 1, verses: 3 },
];
assert.deepEqual(childrenOf(tree, "").map((n) => n.code), ["025", "033"]);
assert.deepEqual(childrenOf(tree, "025").map((n) => n.code), ["025003", "025009"]);
assert.deepEqual(childrenOf(tree, "025003"), []);
assert.deepEqual(breadcrumb(tree, "025003").map((n) => n.name), ["Attitudes and Emotions", "Love, Affection, Compassion"]);
assert.deepEqual(breadcrumb(tree, "999"), []);
assert.deepEqual(searchDomains(tree, "love").map((n) => n.code), ["025003", "033001"], "most verses first");
assert.deepEqual(searchDomains(tree, "  LOVE affection ").map((n) => n.code), ["025003", "033001"], "every word must be in the name; capitals do not matter");
assert.deepEqual(searchDomains(tree, "love hostility"), []);
assert.deepEqual(searchDomains(tree, ""), []);
assert.deepEqual(searchDomains(tree, "...,"), []);
assert.equal(searchDomains(tree, "a", 2).length, 2, "the list is capped");
assert.equal(asStrongs("G26"), "G26");
assert.equal(asStrongs(" h0157 "), "H157");
assert.equal(asStrongs("g 26"), "G26");
assert.equal(asStrongs("grace"), "");
assert.equal(asStrongs("26"), "");
assert.equal(asStrongs(""), "");
assert.equal(strongsSummary("G26", 116, 105), "G26 is used 116 times in 105 verses.");
assert.equal(strongsSummary("H157", 1, 1), "H157 is used 1 time in 1 verse.");
assert.match(strongsSummary("G99999", 0, 0), /not used/);

// ---- a small made-up dictionary through the same pipeline as the real one
const fake = [
  {
    Lemma: "ἀγάπη",
    StrongCodes: ["G0026"],
    BaseForms: [
      {
        LEXMeanings: [
          {
            LEXEntryCode: "25.43",
            LEXDomains: [{ DomainCode: "025", Domain: "Attitudes and Emotions" }],
            LEXSubDomains: [{ DomainCode: "025003", Domain: "Love, Affection, Compassion" }],
            LEXSenses: [{ Glosses: ["love", "to love"], DefinitionShort: "to have love for {A:X} someone" }],
            LEXReferences: ["04002401200018", "04300301600005{N:001}", "04600100000000"],
          },
          { LEXDomains: [], LEXSubDomains: [], LEXSenses: [], LEXReferences: ["04002401200018"] },
          { LEXDomains: [{ DomainCode: "025", Domain: "Attitudes and Emotions" }], LEXSubDomains: [{ DomainCode: "025009", Domain: "X" }], LEXSenses: [], LEXReferences: [] },
        ],
      },
    ],
  },
  { Lemma: "nothing", StrongCodes: [], BaseForms: [{ LEXMeanings: [] }] },
];
const { language, report } = buildLanguage(fake, new Map([["025", "Attitudes and Emotions"], ["025003", "Love, Affection, Compassion"]]));
assert.equal(language.entries.length, 1, "a word with no meanings is left out");
assert.deepEqual(language.entries[0].s, ["G26"]);
assert.equal(language.entries[0].m.length, 1, "a meaning with no group or no verse is left out");
assert.deepEqual(unpackVerses(language.entries[0].m[0].v), [verseKey(40, 24, 12), verseKey(43, 3, 16)], "a reference that is not to a verse is dropped");
assert.equal(language.entries[0].m[0].t, "to have love for someone");
assert.equal(language.entries[0].m[0].c, "25.43");
assert.deepEqual(language.domains, [["025", "Attitudes and Emotions"], ["025003", "Love, Affection, Compassion"]], "the groups used, with the ones above them");
assert.equal(report.noDomain, 1);
assert.equal(report.noVerse, 1);

// ---- the data file that ships (skipped with a note if it has not been made)
const file = "src-tauri/resources/semantic_domains.json";
if (!fs.existsSync(file)) {
  console.log("semantic: pieces ok; the data file is not there yet, so it was not checked");
} else {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw) as SemanticFile;
  assert.equal(data.format, 1);
  assert.equal(data.licence, "CC BY-SA 4.0");
  assert.equal(data.credit, SEMANTIC_CREDIT, "the credit the licence asks for travels with the data");
  assert.match(data.licence_url, /by-sa\/4\.0/);
  assert.ok(raw.length < 8_000_000, `the file stays small (${raw.length} bytes)`);
  for (const [lang, lo, hi, minEntries, minMeanings] of [["greek", 40, 66, 5000, 8500], ["hebrew", 1, 39, 7000, 14000]] as const) {
    const L = data[lang];
    assert.ok(L.entries.length >= minEntries, `${lang}: ${L.entries.length} words`);
    const dom = new Map(L.domains);
    assert.equal(dom.size, L.domains.length, `${lang}: no group twice`);
    let meanings = 0;
    let verses = 0;
    let withStrongs = 0;
    for (const [c, n] of L.domains) {
      assert.match(c, /^(\d{3})+$/);
      assert.ok(n && n !== c, `${lang}: group ${c} has a name`);
      assert.ok(!parentCode(c) || dom.has(parentCode(c)), `${lang}: the group above ${c} is there`);
    }
    for (const e of L.entries) {
      assert.ok(e.l, "a word has its original-language spelling");
      if (e.s.length) withStrongs++;
      for (const s of e.s) assert.match(s, lang === "greek" ? /^G[1-9]\d*$/ : /^H[1-9]\d*$/);
      for (const m of e.m) {
        meanings++;
        assert.ok(m.d.length > 0 && m.d.every((c) => dom.has(c)), `${lang} ${e.l}: its group is named`);
        assert.ok(m.t.length <= 200);
        const list = unpackVerses(m.v);
        assert.ok(list.length > 0);
        verses += list.length;
        for (const k of list) {
          const { book, chapter, verse } = unKey(k);
          assert.ok(book >= lo && book <= hi && chapter >= 1 && chapter <= 150 && verse >= 1 && verse <= 176, `${lang} ${e.l}: verse ${k} is in its Testament`);
        }
      }
    }
    assert.ok(meanings >= minMeanings, `${lang}: ${meanings} meanings`);
    assert.ok(withStrongs / L.entries.length > 0.9, `${lang}: nearly every word has a Strong's number`);
    assert.ok(verses > 100_000, `${lang}: ${verses} verse links`);
  }
  // love is where it should be
  const love = data.greek.entries.find((e) => e.s.includes("G26"));
  assert.ok(love && love.m.some((m) => m.d.some((c) => /Love/.test(data.greek.domains.find(([x]) => x === c)?.[1] ?? ""))), "agape is in a group about love");
  const lovers = data.hebrew.entries.find((e) => e.s.includes("H157"));
  assert.ok(lovers && lovers.m.length >= 1);
  console.log(`semantic: all checks passed (${data.greek.entries.length} Greek and ${data.hebrew.entries.length} Hebrew words, ${(raw.length / 1e6).toFixed(1)} MB)`);
}
