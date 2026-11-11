// "Other links" on the phone is a copy of the computer app's list of websites (src/components/LibraryPanel.tsx: COMMUNITY and MYSWORD).
// This checks the two lists say the same, that every address on the phone is an https one (the phone opens only those), and that nothing is
// missing. Run: node --no-warnings mobile/scripts/test_library_sites.mts
import { readFileSync } from "node:fs";
import { MYSWORD, SITES, SITES_NOTE, mySwordUrl } from "../src/librarySites.ts";

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

const desktop = readFileSync(new URL("../../src/components/LibraryPanel.tsx", import.meta.url), "utf8");
const block = /const COMMUNITY[^=]*=\s*\[([\s\S]*?)\n\];/.exec(desktop)?.[1] ?? "";
const entries = [...block.matchAll(/name:\s*"([^"]+)",[\s\S]*?url:\s*"([^"]+)",[\s\S]*?about:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ name: m[1], url: m[2], about: m[3] }));
check(entries.length === 4, `the computer's list has 4 sites (found ${entries.length})`);
check(SITES.length === entries.length, "the phone lists the same number of sites");
for (const d of entries) {
  const p = SITES.find((s) => s.name === d.name);
  check(!!p, `${d.name}: on the phone`);
  if (!p) continue;
  check(p.about === d.about, `${d.name}: same words as the computer`);
  check(p.url.replace(/^https?:/, "") === d.url.replace(/^https?:/, ""), `${d.name}: same address as the computer (the phone's is https)`);
}
for (const s of SITES) check(s.url.startsWith("https://"), `${s.name}: https address (the phone opens only those)`);

const dm = /const MYSWORD[^=]*=\s*\[([\s\S]*?)\];/.exec(desktop)?.[1] ?? "";
const kinds = [...dm.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
check(kinds.length === 5, `the computer's MySword list has 5 kinds (found ${kinds.length})`);
check(JSON.stringify(kinds) === JSON.stringify(MYSWORD), "the phone's MySword kinds are the same, in the same order");
check(desktop.includes("https://www.mysword.info/download-mysword/${path}"), "the computer opens MySword at the same address the phone builds");
check(MYSWORD.every(([, p]) => mySwordUrl(p).startsWith("https://www.mysword.info/download-mysword/")), "MySword addresses are https");

check(/separate from Bible Concordance and have no connection with it/.test(SITES_NOTE), "the note says the sites are separate and have no connection");
check(/never downloads from them/.test(SITES_NOTE), "the note says the app never downloads from them");
check(/rights/.test(SITES_NOTE) && /Add from a file/.test(SITES_NOTE), "the note says to check the rights, then Add from a file");
const text = JSON.stringify([SITES, SITES_NOTE, MYSWORD]);
check(!/\bAI\b|Easter/i.test(text), "no mention of AI, and no \"Easter\", in the words");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
