// Makes the colouring-in version of each children's picture: src/browse/pictures/kids/<id>.svg becomes <id>-line.svg.
// Usage: node --no-warnings scripts/make_line_art.mts

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { lineArt } from "./line_art.mts";

const dir = new URL("../src/browse/pictures/kids/", import.meta.url);
let n = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".svg") || name.endsWith("-line.svg")) continue;
  writeFileSync(new URL(name.replace(/\.svg$/, "-line.svg"), dir), lineArt(readFileSync(new URL(name, dir), "utf8")));
  n++;
}
console.log(`made ${n} outline picture(s)`);
