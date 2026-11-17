// Builds src-tauri/resources/semantic_sil.json: the plain-English side of the Meaning screens, from the SIL Semantic Domains list (semdom.org, v4,
// CC BY-SA 4.0, SIL Global). For each group of meanings of the UBS dictionaries it says which SIL domain goes with it, and the file holds those SIL
// domains: name, the path above it, a plain description, the related domains and a few of the everyday words people use for it.
//   Greek: found from the Louw-Nida numbers (the UBS Greek groups are Louw-Nida's; 706 SIL domains cite them).
//   Hebrew: no Louw-Nida numbers exist, so the match is the hand-made table scripts/data/hebrew_sil_map.txt ("-" = no good match, no card).
// Run: node --no-warnings scripts/build_semantic_sil.mts      Needs scripts/data/semdom-v4.json (https://semdom.org/data/semdom.json).

import { readFileSync, writeFileSync } from "node:fs";

type Any = Record<string, any>;
const root = new URL("../", import.meta.url);
const sil: Any[] = JSON.parse(readFileSync(new URL("scripts/data/semdom-v4.json", root), "utf8"));
const sem = JSON.parse(readFileSync(new URL("src-tauri/resources/semantic_domains.json", root), "utf8"));
const byCode = new Map<string, Any>(sil.map((x) => [x.code, x]));
const byGuid = new Map<string, Any>(sil.map((x) => [x.guid, x]));

const STOP = new Set("a an the to be of or and in on for with one's someone something somebody oneself it is that this by at as from".split(" "));
const stem = (w: string) => { w = w.toLowerCase(); for (const s of ["ing", "edly", "ed", "es", "s", "ly"]) if (w.length > 4 && w.endsWith(s)) return w.slice(0, -s.length); return w; };
const toks = (t: string) => (t.match(/[A-Za-z']+/g) ?? []).filter((w) => !STOP.has(w.toLowerCase()) && w.length > 2).map(stem);

// ---- Louw-Nida "25C" for a UBS Greek code "025003" (domain 25, sub-domain 3rd letter)
const lnLabel = (code: string): string => {
  const dom = parseInt(code.slice(0, 3), 10);
  let sub = code.length > 3 ? parseInt(code.slice(3), 10) : 0;
  let letter = "";
  while (sub > 0) { const r = (sub - 1) % 26; letter = String.fromCharCode(65 + r) + letter; sub = Math.floor((sub - 1) / 26); }
  return `${dom}${letter}`;
};
const silByLn = new Map<string, Any[]>();
for (const x of sil) for (const part of String(x.louwNidaCodes ?? "").split(";")) { const m = /^\s*(\d+)([A-Z]*)/.exec(part); if (m) { const k = m[1] + m[2]; silByLn.set(k, [...(silByLn.get(k) ?? []), x]); } }

const greekNames: Record<string, string> = Object.fromEntries(sem.greek.domains);
const hebrewNames: Record<string, string> = Object.fromEntries(sem.hebrew.domains);

const greek: Record<string, string> = {};
for (const code of Object.keys(greekNames)) {
  const found = silByLn.get(lnLabel(code));
  if (!found?.length) continue;
  const mine = new Set(toks(greekNames[code]));
  const score = (x: Any) => toks(x.name).filter((t) => mine.has(t)).length * 10 - x.code.split(".").length;
  greek[code] = [...found].sort((a, b) => score(b) - score(a))[0].code;
}

const hebrew: Record<string, string> = {};
const lines = readFileSync(new URL("scripts/data/hebrew_sil_map.txt", root), "utf8").split(/\r?\n/);
for (const line of lines) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [h, s] = line.trim().split(/\s+/);
  if (!(h in hebrewNames)) throw new Error(`Hebrew group ${h} does not exist`);
  if (s === "-") continue;
  if (!byCode.has(s)) throw new Error(`SIL domain ${s} (for Hebrew ${h}) does not exist`);
  hebrew[h] = s;
}

// ---- the SIL domains that are used, with what the card shows
const used = new Set([...Object.values(greek), ...Object.values(hebrew)]);
const pathOf = (code: string): string[] => { const p: string[] = []; let c = code; while (c.includes(".")) { c = c.slice(0, c.lastIndexOf(".")); const n = byCode.get(c)?.name; if (n) p.unshift(n); } return p; };
const domains: Record<string, Any> = {};
for (const code of [...used].sort()) {
  const x = byCode.get(code)!;
  const words = [...new Set<string>((x.questions ?? []).flatMap((q: Any) => String(q.exampleWords ?? "").split(",").map((w: string) => w.trim()).filter(Boolean)))].slice(0, 16);
  const related = (x.relatedGuids ?? []).map((g: string) => byGuid.get(g)).filter(Boolean).map((r: Any) => ({ c: r.code, n: r.name }));
  domains[code] = { n: x.name, p: pathOf(code), d: String(x.description ?? "").trim(), r: related, w: words };
}

const out = {
  format: 1,
  credit: "Plain-English descriptions, related groups and everyday words: SIL Semantic Domains, version 4 (semdom.org), © SIL Global, adapted (a Hebrew or Greek group of the UBS dictionaries is paired with the SIL domain that matches it).",
  licence: "CC BY-SA 4.0",
  licence_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  source: "https://semdom.org/data/semdom.json",
  greek,
  hebrew,
  domains,
};
writeFileSync(new URL("src-tauri/resources/semantic_sil.json", root), JSON.stringify(out));

// ---- how much of the Bible's meaning data is covered
const unpackCount = (p: number[]) => p.length;
for (const lang of ["greek", "hebrew"] as const) {
  const map = lang === "greek" ? greek : hebrew;
  let total = 0, covered = 0, senses = 0, coveredSenses = 0;
  for (const e of sem[lang].entries) for (const m of e.m) {
    senses++; total += unpackCount(m.v);
    const hit = m.d.some((d: string) => map[d]);
    if (hit) { coveredSenses++; covered += unpackCount(m.v); }
  }
  console.log(`${lang}: ${Object.keys(map).length} groups matched; ${coveredSenses} of ${senses} senses (${Math.round((100 * coveredSenses) / senses)}%) and ${Math.round((100 * covered) / total)}% of verse uses have a card`);
}
console.log(`${used.size} SIL domains kept; file ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
