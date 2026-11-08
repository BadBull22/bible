// The theme background behind the Bible text must stay readable. Reads each theme's colours from src/themes/screens/*.css and checks, for the
// app's own light and dark paper and text colours, that the text keeps a contrast of at least 7:1 (WCAG AAA) on the weakest point of the
// background at the strongest setting ("full": the paper veil is only 30%).
// Run: node --no-warnings scripts/test_reading_theme.mts
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../src/themes/screens/", import.meta.url);
type RGB = [number, number, number];
const hex = (h: string): RGB => {
  let x = h.replace("#", "");
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as RGB;
};
const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top: RGB, bottom: RGB, a: number): RGB => top.map((v, i) => v * a + bottom[i] * (1 - a)) as RGB; // `top` at opacity a over `bottom`

const PAPER = { light: hex("#faf7f0"), dark: hex("#17181c") };
const TEXT = { light: hex("#232017"), dark: hex("#e9e7e0") };
let bad = 0;
let themes = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".css") || f.startsWith("_") || f === "plain.css") continue;
  const slug = f.replace(/\.css$/, "");
  const css = readFileSync(new URL(f, dir), "utf8");
  themes++;
  for (const needed of [`.main-frame[data-reading-theme][data-occasion="${slug}"]`, `.main-frame[data-reading-theme="full"][data-occasion="${slug}"]::before`]) {
    if (!css.includes(needed)) {
      bad++;
      console.log(`FAIL ${slug}: the reading pane is not wired (missing ${needed})`);
    }
  }
  const blocks = {
    light: /\.pv\[data-occasion="[^"]+"\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "",
    dark: /:root\[data-theme="dark"\] \.home-screen\[data-occasion="[^"]+"\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "",
  };
  for (const mode of ["light", "dark"] as const) {
    const bg = /--occ-bg:\s*([^;]+);/.exec(blocks[mode])?.[1];
    if (!bg) {
      bad++;
      console.log(`FAIL ${slug} ${mode}: no --occ-bg`);
      continue;
    }
    const stops = [...bg.matchAll(/#([0-9a-fA-F]{3,6})\b/g)].map((m) => hex(m[0]));
    if (stops.length === 0) {
      bad++;
      console.log(`FAIL ${slug} ${mode}: no colours found in --occ-bg`);
      continue;
    }
    for (const c of stops) {
      // the theme colour with a 30% paper veil over it: what is behind the words at the strongest setting
      const behindText = over(PAPER[mode], c, 0.3);
      const ratio = contrast(behindText, TEXT[mode]);
      if (ratio < 7) {
        bad++;
        console.log(`FAIL ${slug} ${mode}: contrast ${ratio.toFixed(1)}:1 behind the text, 7:1 needed`);
      }
    }
  }
}
console.log(bad ? `${bad} problem(s)` : `reading theme: all checks passed (${themes} themes, light and dark)`);
process.exit(bad ? 1 : 0);
