// The senses of a word and the plain-English cards: the drawing rules and the SIL data file. Run: node --no-warnings --experimental-strip-types scripts/test_semantic_senses.mts
import assert from "node:assert/strict";
import fs from "node:fs";
import { arcPath, barHeight, senseArcs, senseColour, senseOrder, treeColumns, wordToLookUp, type DomainNode } from "../src/semantic.ts";

// the wheel: the slices share the circle by verses, in the order given, and never overlap
const arcs = senseArcs([35, 29, 26, 15, 9, 1]);
assert.equal(arcs.length, 6);
for (let i = 1; i < arcs.length; i++) assert.ok(arcs[i].from >= arcs[i - 1].to, "slices do not overlap");
assert.ok(arcs[0].from >= 0 && arcs.at(-1)!.to <= Math.PI * 2, "slices stay inside the circle");
const share = (a: { from: number; to: number }) => (a.to - a.from) / (Math.PI * 2);
assert.ok(Math.abs(share(arcs[0]) - 35 / 115) < 0.01, "the biggest sense gets its share");
assert.ok(share(arcs[5]) > 0, "a one-verse sense still shows");
const one = senseArcs([12]);
assert.ok(one[0].to - one[0].from > Math.PI * 2 - 0.001, "a single sense is the whole ring");
assert.deepEqual(senseArcs([]), []);
assert.deepEqual(senseArcs([0, 0]), []);
assert.deepEqual(senseOrder([5, 9, 9, 1]), [1, 2, 0, 3], "most verses first, the dictionary's order breaks ties");
assert.notEqual(senseColour(0, 14), senseColour(1, 14));
assert.equal(senseColour(3, 14), senseColour(3, 14));
const path = arcPath(100, 100, 50, 80, 0, Math.PI);
assert.match(path, /^M100,20 A80,80 0 0 1 100,180 L100,150 A50,50 0 0 0 100,50 Z$/, path);
assert.match(arcPath(0, 0, 10, 20, 0, 4), / 0 1 1 /, "a slice over half the circle takes the long way");
assert.equal(barHeight(0, 10, 50), 0);
assert.equal(barHeight(1, 1000, 50), 3, "a small count still shows");
assert.equal(barHeight(10, 10, 50), 50);

// the tree: one column per level, a level with very many groups shows only the group on the path
const nodes: DomainNode[] = [];
for (let i = 1; i <= 25; i++) nodes.push({ code: String(i).padStart(3, "0"), name: `Top ${i}`, level: 1, words: 1, verses: 1 });
for (let i = 1; i <= 4; i++) nodes.push({ code: `025${String(i).padStart(3, "0")}`, name: `Sub ${i}`, level: 2, words: 1, verses: 1 });
const cols = treeColumns(nodes, "025003");
assert.equal(cols.length, 2);
assert.deepEqual(cols[0].nodes.map((n) => n.code), ["025"], "25 top groups: only the one on the path");
assert.equal(cols[0].others, 24);
assert.equal(cols[1].nodes.length, 4);
assert.equal(cols[1].selected, "025003");
assert.equal(treeColumns(nodes, "025").at(0)!.nodes.length, 25, "the last level always shows all its groups");
assert.deepEqual(treeColumns([], "025"), [{ parent: "", selected: "025", nodes: [], others: 0 }]);

// the English word looked up
assert.equal(wordToLookUp("  Love! "), "love");
assert.equal(wordToLookUp("Son of God"), "son of god");
assert.equal(wordToLookUp("???"), "");
assert.equal(wordToLookUp("x".repeat(60)), "");
assert.equal(wordToLookUp("don't"), "don't");

// ---- the data file made by scripts/build_semantic_sil.mts
const sil = JSON.parse(fs.readFileSync(new URL("../src-tauri/resources/semantic_sil.json", import.meta.url), "utf8"));
const sem = JSON.parse(fs.readFileSync(new URL("../src-tauri/resources/semantic_domains.json", import.meta.url), "utf8"));
assert.equal(sil.licence, "CC BY-SA 4.0");
assert.match(sil.credit, /SIL/);
assert.match(sil.licence_url, /by-sa\/4\.0/);
const greek = new Set(sem.greek.domains.map((d: string[]) => d[0]));
const hebrew = new Set(sem.hebrew.domains.map((d: string[]) => d[0]));
for (const [g, s] of Object.entries<string>(sil.greek)) { assert.ok(greek.has(g), `Greek group ${g} exists`); assert.ok(sil.domains[s], `domain ${s} is in the file`); }
for (const [h, s] of Object.entries<string>(sil.hebrew)) { assert.ok(hebrew.has(h), `Hebrew group ${h} exists`); assert.ok(sil.domains[s], `domain ${s} is in the file`); }
for (const [code, d] of Object.entries<any>(sil.domains)) {
  assert.ok(d.n && d.d.length > 10, `${code} has a name and a description`);
  assert.ok(Array.isArray(d.w) && d.w.length > 0 && d.w.length <= 16);
  for (const r of d.r) assert.ok(r.c && r.n);
  assert.equal(d.p.length, code.split(".").length - 1, `${code}: the path has one name for each level above it`);
}
assert.ok(Object.keys(sil.greek).length > 600, "most Greek groups are matched");
assert.ok(Object.keys(sil.hebrew).length > 250, "most Hebrew groups are matched");
// love is where it should be, in both languages
assert.equal(sil.domains[sil.greek["025003"]].n, "Love", "Greek: Love, Affection, Compassion is SIL's Love");
assert.equal(sil.domains[sil.hebrew["002001002018"]].n, "Love", "Hebrew: Love is SIL's Love");
// how much of the Bible's meaning data has a card
for (const lang of ["greek", "hebrew"] as const) {
  const map = sil[lang]; let senses = 0, covered = 0;
  for (const e of sem[lang].entries) for (const m of e.m) { if (m.d.some((d: string) => d.startsWith("003") && lang === "hebrew")) continue; senses++; if (m.d.some((d: string) => { for (let c = d; c; c = c.slice(0, -3)) if (map[c]) return true; return false; })) covered++; }
  assert.ok(covered / senses > (lang === "greek" ? 0.9 : 0.72), `${lang}: ${Math.round((100 * covered) / senses)}% of senses (names left out) have a card`);
}
console.log(`semantic senses: all checks passed (${Object.keys(sil.domains).length} SIL domains, ${(JSON.stringify(sil).length / 1024).toFixed(0)} KB)`);
