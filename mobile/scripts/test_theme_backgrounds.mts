// node --no-warnings mobile/scripts/test_theme_backgrounds.mts
// Every theme has a pair of colours for the light pages and one for the dark pages, and the app's text colours stay readable on both colours of every pair.
import { readFileSync } from "node:fs";
import { contrast, parseHex, isHexColour } from "../../src/themes/palette.ts";
import { BACKGROUNDS, backgroundCss } from "../src/themeBackgrounds.ts";

// the theme slugs, read from the computer's list (that file also pulls in pictures, which node cannot load)
const LOOKS = [...readFileSync(new URL("../../src/themes/occasions.ts", import.meta.url), "utf8").matchAll(/\{ slug: "([a-z-]+)", name:/g)].map((m) => ({ slug: m[1] }));

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) {
    failed++;
    console.log("FAIL", name, detail);
  }
};

// every theme has colours, and nothing else does
for (const l of LOOKS) check(`${l.slug} has a background`, !!BACKGROUNDS[l.slug]);
for (const slug of Object.keys(BACKGROUNDS)) check(`${slug} is a theme`, LOOKS.some((l) => l.slug === slug));
for (const [slug, b] of Object.entries(BACKGROUNDS)) for (const c of [...b.light, ...b.dark]) check(`${slug} colour ${c}`, isHexColour(c));

// the text colours of styles.css, per page (light, sepia and dark). Under a theme the grey text and the links are a little stronger than the standard
// ones (the "html[data-occasion]" rules at the end of styles.css), so that they stay readable on the colours; these are those colours
const pages: { page: string; side: "light" | "dark"; text: string[]; muted: string[]; accent: string }[] = [
  { page: "light", side: "light", text: ["#22252b", "#000000", "#4a3420", "#1a2747"], muted: ["#4b4944", "#35332e"], accent: "#234d8a" },
  { page: "sepia", side: "light", text: ["#3b2f20"], muted: ["#57472f", "#3f3120"], accent: "#704510" },
  { page: "dark", side: "dark", text: ["#e9e7e0", "#ffffff", "#ecd9b8", "#d3defa"], muted: ["#c8c4ba", "#e2ded5"], accent: "#a3c2f2" },
];
for (const [slug, b] of Object.entries(BACKGROUNDS)) {
  for (const p of pages) {
    for (const bg of b[p.side]) {
      for (const t of p.text) check(`${slug} ${p.page}: text ${t} on ${bg}`, contrast(parseHex(t), parseHex(bg)) >= 7, contrast(parseHex(t), parseHex(bg)).toFixed(2));
      for (const m of p.muted) check(`${slug} ${p.page}: grey text ${m} on ${bg}`, contrast(parseHex(m), parseHex(bg)) >= 4.5, contrast(parseHex(m), parseHex(bg)).toFixed(2));
      check(`${slug} ${p.page}: link ${p.accent} on ${bg}`, contrast(parseHex(p.accent), parseHex(bg)) >= 4.5, contrast(parseHex(p.accent), parseHex(bg)).toFixed(2));
    }
  }
}

// the two colours of a pair are clearly different (so the gradient is seen), the light ones lighter than the dark ones
const lum = (hex: string) => {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const dist = (a: string, b: string) => Math.hypot(...parseHex(a).map((v, i) => v - parseHex(b)[i]));
for (const [slug, b] of Object.entries(BACKGROUNDS)) {
  check(`${slug} light: the two colours differ`, dist(b.light[0], b.light[1]) >= 25, String(Math.round(dist(b.light[0], b.light[1]))));
  check(`${slug} dark: the two colours differ`, dist(b.dark[0], b.dark[1]) >= 25, String(Math.round(dist(b.dark[0], b.dark[1]))));
  check(`${slug}: light is lighter than dark`, lum(b.light[0]) > lum(b.dark[0]) && lum(b.light[1]) > lum(b.dark[1]));
}

// the style rules
const css = backgroundCss();
check("css names every theme", Object.keys(BACKGROUNDS).every((s) => css.includes(`data-occasion="${s}"`) && css.includes(`data-chip="${s}"`)));

console.log(failed === 0 ? `theme backgrounds: all ${LOOKS.length} themes pass` : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
