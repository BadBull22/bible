// Builds src-tauri/resources/semantic_domains.json from the UBS open-licence dictionaries (github.com/ubsicap/ubs-open-license, folder "dictionaries").
// The English JSON of both is read; only what the app uses is kept: for each word its Strong's numbers, and for each meaning the group(s) of meaning it
// belongs to, its glosses, a short definition and the verses it is used in. The syntax trees and everything else in that repository are not used.
//
//   node --experimental-strip-types scripts/build_semantic_domains.mts <the "dictionaries" folder> [output file] [--check <study.db>]
//
// Licence of what is read and written: CC BY-SA 4.0 (see NOTICE.md). The app's code is not affected by it.

import fs from "node:fs";
import path from "node:path";
import { cleanText, normStrongs, packVerses, parentCode, SEMANTIC_CREDIT, SEMANTIC_LICENCE_URL, verseOfRef, type SemanticEntry, type SemanticFile, type SemanticLanguage } from "../src/semantic.ts";

const GREEK = "greek/JSON/UBSGreekNTDic-v1.1-en.JSON";
const GREEK_DOMAINS = "greek/JSON/UBSGreekNTDicLexicalDomains-v1.1-en.JSON";
const HEBREW = "hebrew/JSON/UBSHebrewDic-v0.9.4-en.JSON";
const HEBREW_DOMAINS = "hebrew/JSON/UBSHebrewDicLexicalDomains-v0.9.4-en.JSON";

interface Raw {
  [k: string]: any;
}

const read = (root: string, file: string): Raw[] => {
  const j = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  return Array.isArray(j) ? j : Object.values(j);
};

/** The names of the groups from the dictionary's own list of them. */
function domainNames(list: Raw[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of list) {
    const label = (d.SemanticDomainLocalizations ?? []).find((l: Raw) => l.LanguageCode === "en")?.Label;
    if (d.Code && label) out.set(String(d.Code), cleanText(label, 120));
  }
  return out;
}

/** One language: the entries that have at least one meaning with a group and a verse, and the names of the groups they use (and the groups above those). */
export function buildLanguage(dictionary: Raw[], listed: Map<string, string>): { language: SemanticLanguage; report: Record<string, number> } {
  const names = new Map<string, string>();
  const entries: SemanticEntry[] = [];
  const report = { entries: dictionary.length, kept: 0, meanings: 0, noStrongs: 0, noDomain: 0, noVerse: 0, refs: 0, verses: 0 };
  for (const e of dictionary) {
    const strongs = [...new Set((e.StrongCodes ?? []).map((s: string) => normStrongs(String(s))).filter(Boolean))] as string[];
    if (strongs.length === 0) report.noStrongs++;
    const meanings: SemanticEntry["m"] = [];
    for (const bf of e.BaseForms ?? []) {
      for (const m of bf.LEXMeanings ?? []) {
        // the most specific group(s): sub-groups when the dictionary gives them (Greek), else the groups (Hebrew's four levels)
        const doms: Raw[] = [...(m.LEXSubDomains ?? []), ...(m.LEXDomains ?? [])];
        const subs = (m.LEXSubDomains ?? []).length ? m.LEXSubDomains : m.LEXDomains ?? [];
        const codes = [...new Set((subs as Raw[]).map((d) => String(d.DomainCode ?? "")).filter((c) => /^\d{3,12}$/.test(c) && c.length % 3 === 0))] as string[];
        if (codes.length === 0) {
          report.noDomain++;
          continue;
        }
        const verses = (m.LEXReferences ?? []).map((r: string) => verseOfRef(String(r))).filter((v: number | null): v is number => v !== null);
        report.refs += (m.LEXReferences ?? []).length;
        if (verses.length === 0) {
          report.noVerse++;
          continue;
        }
        for (const d of doms) {
          const c = String(d.DomainCode ?? "");
          if (c && !names.has(c) && !listed.has(c) && d.Domain) names.set(c, cleanText(String(d.Domain), 120));
        }
        const sense = (m.LEXSenses ?? [])[0] ?? {};
        const glosses = (sense.Glosses ?? []).map((g: string) => cleanText(String(g), 60)).filter(Boolean).slice(0, 8);
        const packed = packVerses(verses);
        report.verses += packed.length;
        const entry: SemanticEntry["m"][number] = { d: codes, g: glosses, t: cleanText(String(sense.DefinitionShort || sense.DefinitionLong || ""), 160), v: packed };
        if (m.LEXEntryCode) entry.c = String(m.LEXEntryCode);
        meanings.push(entry);
      }
    }
    if (meanings.length === 0) continue;
    entries.push({ s: strongs, l: String(e.Lemma ?? ""), m: meanings });
    report.kept++;
    report.meanings += meanings.length;
  }
  // every group a meaning uses, and the groups above it, with their names
  const used = new Set<string>();
  for (const en of entries) for (const m of en.m) for (const c of m.d) for (let x = c; x; x = parentCode(x)) used.add(x);
  const domains: [string, string][] = [...used].sort().map((c) => [c, listed.get(c) ?? names.get(c) ?? c]);
  return { language: { domains, entries }, report };
}

/** Builds the whole file from the folder of dictionaries. */
export function build(root: string): { file: SemanticFile; reports: Record<string, Record<string, number>> } {
  const g = buildLanguage(read(root, GREEK), domainNames(read(root, GREEK_DOMAINS)));
  const h = buildLanguage(read(root, HEBREW), domainNames(read(root, HEBREW_DOMAINS)));
  return {
    file: {
      format: 1,
      credit: SEMANTIC_CREDIT,
      licence: "CC BY-SA 4.0",
      licence_url: SEMANTIC_LICENCE_URL,
      source: "UBS Dictionary of the Greek New Testament v1.1 and UBS Dictionary of Biblical Hebrew v0.9.4 (English), github.com/ubsicap/ubs-open-license",
      greek: g.language,
      hebrew: h.language,
    },
    reports: { greek: g.report, hebrew: h.report },
  };
}

// run from the command line (not when the test imports this file)
if (process.argv[1] && /build_semantic_domains\.mts$/.test(process.argv[1])) {
  const root = process.argv[2];
  const out = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "src-tauri/resources/semantic_domains.json";
  if (!root) {
    console.error("Usage: node --experimental-strip-types scripts/build_semantic_domains.mts <the dictionaries folder> [output file]");
    process.exit(1);
  }
  const { file, reports } = build(root);
  fs.writeFileSync(out, JSON.stringify(file));
  console.log(reports, `${(fs.statSync(out).size / 1e6).toFixed(2)} MB written to ${out}`);
}
