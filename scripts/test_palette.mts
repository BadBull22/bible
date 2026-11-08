// The colour for the whole app: any colour becomes a pastel tint (clearly visible in the light appearance, deep and muted in the dark one) and the text
// stays readable. Run: node --no-warnings scripts/test_palette.mts
import { APP_VAR_NAMES, appTones, appVars, contrast, darkenUntil, hslToRgb, isHexColour, luminance, PALETTE, parseHex, STANDARD_SURFACES, STANDARD_TEXT, toHex, toHsl } from "../src/themes/palette.ts";

let bad = 0;
const fail = (m: string) => {
  bad++;
  console.log("FAIL " + m);
};
const chroma = (hex: string) => {
  const c = parseHex(hex);
  return Math.max(...c) - Math.min(...c);
};

// the palette itself
const ids = new Set<string>();
for (const s of PALETTE) {
  if (!isHexColour(s.hex)) fail(`${s.id}: ${s.hex} is not #rrggbb`);
  if (ids.has(s.id)) fail(`${s.id}: used twice`);
  ids.add(s.id);
  const [, sat, light] = toHsl(parseHex(s.hex));
  if (light < 0.78 || light > 0.95) fail(`${s.id}: lightness ${light.toFixed(2)} is not a pastel (0.78 to 0.95)`);
  if (sat > 0.8) fail(`${s.id}: saturation ${sat.toFixed(2)} is too strong for a pastel`);
}
if (PALETTE.length < 10) fail("the palette should offer at least ten colours");

// reading and converting colours
if (isHexColour("#abc") || isHexColour("red") || isHexColour("#GGGGGG") || isHexColour(undefined)) fail("isHexColour accepted something that is not #rrggbb");
if (parseHex("#ff0000").join() !== "255,0,0") fail("parseHex #ff0000");
if (parseHex("nonsense").join() !== "128,128,128") fail("rubbish should read as a neutral grey");
if (toHex([255, 0, 128]) !== "#ff0080") fail("toHex");
if (hslToRgb(120, 1, 0.5).join() !== "0,255,0") fail("hslToRgb of green");
{
  const [h, s, l] = toHsl([255, 0, 0]);
  if (h !== 0 || Math.abs(s - 1) > 1e-9 || Math.abs(l - 0.5) > 1e-9) fail("toHsl of red");
}
{
  // darkenUntil: a colour is made darker until it has the contrast asked for, and left alone if it already has it
  const surf = ["#d8d0e8"];
  const d = darkenUntil("#756e5f", surf, 4.6);
  if (contrast(parseHex(d), parseHex(surf[0])) < 4.6) fail("darkenUntil did not reach the contrast");
  if (darkenUntil("#000000", surf, 4.6) !== "#000000") fail("darkenUntil should leave a colour that is dark enough");
}

const TEXTS_LIGHT = ["#232017", "#000000"].map(parseHex); // the main text colours (standard and strong)
const TEXTS_DARK = ["#e9e7e0", "#a8a49a", "#9a958b", "#ffffff"].map(parseHex);
const CARRIERS = ["paper", "raised", "chrome", "accent100"] as const;
let tried = 0;
for (let hue = 0; hue < 360; hue += 15) {
  for (const sat of [0, 0.3, 0.6, 1]) {
    for (const light of [0.05, 0.3, 0.5, 0.7, 0.95]) {
      const hex = toHex(hslToRgb(hue, sat, light));
      const t = appTones(hex);
      tried++;

      // LIGHT: clear pastels, with every text colour readable on every surface that carries text
      for (const name of CARRIERS) {
        const bg = parseHex(t.light[name]);
        for (const text of TEXTS_LIGHT) if (contrast(bg, text) < 7) fail(`${hex} light ${name}: the main text has ${contrast(bg, text).toFixed(1)}:1 (7:1 wanted)`);
        if (contrast(bg, parseHex(t.light.muted)) < 4.5) fail(`${hex} light ${name}: the grey labels have ${contrast(bg, parseHex(t.light.muted)).toFixed(2)}:1 (4.5 wanted)`);
        if (contrast(bg, parseHex(t.light.faint)) < 4.5) fail(`${hex} light ${name}: the faint hints have ${contrast(bg, parseHex(t.light.faint)).toFixed(2)}:1 (4.5 wanted)`);
      }
      const [, ps, pl] = toHsl(parseHex(t.light.paper));
      if (pl < 0.9 || pl > 0.95 || ps > 0.8) fail(`${hex} light paper: not a pastel (lightness ${pl.toFixed(2)}, saturation ${ps.toFixed(2)})`);
      // the grey labels only get darker, never lighter, than the standard ones
      if (luminance(parseHex(t.light.muted)) > luminance(parseHex(STANDARD_TEXT.muted)) + 1e-6) fail(`${hex}: the grey labels got lighter`);
      // a colourful choice is clearly visible on the page, the panels and the bars
      if (sat >= 0.6 && light >= 0.3 && light <= 0.7) {
        if (chroma(t.light.paper) < 16) fail(`${hex} light paper: tint is too faint (chroma ${chroma(t.light.paper)}, 16 wanted)`);
        if (chroma(t.light.chrome) < 20) fail(`${hex} light chrome: tint is too faint (chroma ${chroma(t.light.chrome)}, 20 wanted)`);
      }

      // DARK: deep and muted, each as bright as the standard surface (so every text colour keeps its contrast)
      for (const name of ["paper", "raised", "chrome"] as const) {
        const std = parseHex(STANDARD_SURFACES.dark[name]);
        const mine = parseHex(t.dark[name]);
        for (const text of TEXTS_DARK) {
          const was = contrast(std, text);
          const now = contrast(mine, text);
          if (now < was * 0.985) fail(`${hex} dark ${name}: contrast with ${toHex(text)} fell from ${was.toFixed(2)} to ${now.toFixed(2)}`);
        }
        const [, s2, l2] = toHsl(mine);
        if (l2 > 0.25 || s2 > 0.4) fail(`${hex} dark ${name}: not deep and muted (lightness ${l2.toFixed(2)}, saturation ${s2.toFixed(2)})`);
      }
      for (const name of ["border", "accent100"] as const) {
        const d = Math.abs(luminance(parseHex(t.dark[name])) - luminance(parseHex(STANDARD_SURFACES.dark[name])));
        if (d > 0.02) fail(`${hex} dark ${name}: brightness moved by ${d.toFixed(3)}`);
      }
    }
  }
}

// a grey stays grey; a colour keeps its hue; the swatches are clearly visible against the standard paper
{
  const g = parseHex(appTones("#808080").light.paper);
  if (Math.max(...g) - Math.min(...g) > 2) fail("a grey should stay grey");
  const [h] = toHsl(parseHex(appTones("#3366ff").light.paper));
  if (Math.abs(h - toHsl(parseHex("#3366ff"))[0]) > 6) fail("the tint should keep the hue of the colour");
  for (const s of PALETTE) {
    if (s.id === "stone" || s.id === "sand") continue; // quiet colours, close to the warm paper on purpose
    const paper = parseHex(appTones(s.hex).light.paper);
    const std = parseHex(STANDARD_SURFACES.light.paper);
    const d = Math.hypot(paper[0] - std[0], paper[1] - std[1], paper[2] - std[2]);
    if (d < 16) fail(`${s.id}: the page is only ${d.toFixed(0)} away from the standard paper in colour (16 wanted)`);
  }
}

// the CSS variables
const v = appVars("#cfe3f6");
if (Object.keys(v).length !== 12 || APP_VAR_NAMES.length !== 12) fail("appVars should give twelve variables (five surfaces and two greys in light, five surfaces in dark)");
for (const [k, val] of Object.entries(v)) if (!isHexColour(val)) fail(`${k} is not #rrggbb: ${val}`);

console.log(bad ? `${bad} problem(s)` : `palette: all checks passed (${PALETTE.length} colours, ${tried} colours tried: clear pastels in light with readable text, deep muted shades in dark)`);
process.exit(bad ? 1 : 0);
