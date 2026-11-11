// The verse sheet's "Commentaries": which note speaks on a verse. Run: node --no-warnings mobile/scripts/test_commentary_for.mts
import { commentariesOnVerse } from "../src/commentaryFor.ts";

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
const c = (module: string, notes: [number, string][]) => ({ module, title: module + " title", notes });

const henry = c("henry", [[0, "intro to the chapter"], [1, "on 1 to 8, first paragraph"], [1, "on 1 to 8, second paragraph"], [9, "on 9 to 15"], [16, "on 16 to the end"]]);
const barnes = c("barnes", [[3, "on verse 3"], [16, "on verse 16"]]);
const wholeOnly = c("whole", [[0, "only about the whole chapter"]]);

let r = commentariesOnVerse([henry, barnes], 16);
check(r.here.length === 2 && r.here[0].from === 16 && r.here[0].texts[0] === "on 16 to the end", "verse 16: each commentary's note that starts at 16");
r = commentariesOnVerse([henry, barnes], 12);
check(r.here[0].from === 9 && r.here[0].texts.join() === "on 9 to 15", "verse 12: Henry's note that began at verse 9 (it runs to the next note)");
check(r.here[1].from === 3, "verse 12: Barnes's last note before it began at verse 3 (so the sheet can say where the note begins)");
r = commentariesOnVerse([henry], 1);
check(r.here[0].texts.length === 2 && r.here[0].texts[1] === "on 1 to 8, second paragraph", "verse 1: both paragraphs that start at verse 1, in order");
r = commentariesOnVerse([henry], 5);
check(r.here[0].from === 1 && r.here[0].texts.length === 2, "verse 5 is inside the note that began at verse 1");
check(!commentariesOnVerse([henry], 5).here[0].texts.includes("intro to the chapter"), "the whole-chapter note is not shown for a verse");
r = commentariesOnVerse([barnes], 2);
check(r.here.length === 0 && r.others === 1, "a verse before a commentary's first note: nothing, and it is counted as 'others'");
r = commentariesOnVerse([wholeOnly, henry], 3);
check(r.here.length === 1 && r.here[0].module === "henry" && r.others === 1, "a commentary with only a whole-chapter note has nothing on a verse");
r = commentariesOnVerse([], 3);
check(r.here.length === 0 && r.others === 0, "no commentaries: nothing");
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
