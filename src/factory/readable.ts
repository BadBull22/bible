// Content Factory: helping the words stand out from a photo, and colours to take from a picture. Pure arithmetic on RGBA pixels (no canvas), so it can be
// tested under Node (scripts/test_factory.mts); the screen code gives it the pixels.

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** how bright (0 black to 1 white) the region is on average, and how much it varies (0 even to about 0.5 very busy) */
export function regionStats(d: Uint8ClampedArray, w: number, h: number, r: Region): { mean: number; spread: number } {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(r.x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(r.y)));
  const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil(r.x + r.w)));
  const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil(r.y + r.h)));
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      sum += l;
      sq += l * l;
      n++;
    }
  }
  const mean = n ? sum / n : 0.5;
  return { mean, spread: Math.sqrt(Math.max(0, (n ? sq / n : 0) - mean * mean)) };
}

/** How much to darken a photo, and how much to soften it, so that light words stand out from it. `mean` and `spread` are those of the part of the photo under the
 * words. A bright photo is darkened more, a busy one is also softened; a photo that is dark and even is left alone. */
export function suggestReadable(mean: number, spread: number): { darken: number; blur: number } {
  const target = 0.27;
  let darken = mean > target ? 1 - target / mean : 0;
  let blur = 0;
  if (spread > 0.16) {
    darken += 0.06;
    blur = Math.min(0.6, (spread - 0.12) * 3);
  }
  // never so dark that the picture is lost, never so little that it is not worth it
  darken = Math.min(0.75, Math.max(0, darken));
  if (darken < 0.08) darken = mean > 0.2 ? 0.1 : 0;
  return { darken: Math.round(darken * 100) / 100, blur: Math.round(blur * 100) / 100 };
}

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
export const toHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`;

/** A few colours that belong to a picture (its main colours, vivid ones first), as hex, for the text to match. */
export function pictureColours(d: Uint8ClampedArray, w: number, h: number, count = 5): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < w * h * 4; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = buckets.get(key);
    if (b) {
      b.n++;
      b.r += d[i];
      b.g += d[i + 1];
      b.b += d[i + 2];
    } else buckets.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  const list = [...buckets.values()].map((b) => {
    const r = b.r / b.n;
    const g = b.g / b.n;
    const bl = b.b / b.n;
    const mx = Math.max(r, g, bl);
    const sat = mx ? (mx - Math.min(r, g, bl)) / mx : 0;
    return { r, g, b: bl, score: b.n * (0.4 + sat) };
  });
  list.sort((a, b) => b.score - a.score);
  const out: { r: number; g: number; b: number }[] = [];
  for (const c of list) {
    if (out.every((o) => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) > 70)) out.push(c);
    if (out.length >= count) break;
  }
  return out.map((c) => toHex(c.r, c.g, c.b));
}

/** A colour mixed with white (`k` 0 to 1 of the way), for a light version that reads on a dark picture. */
export function lighten(colour: string, k: number): string {
  const m = colour.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return colour;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => c + (255 - c) * k;
  return toHex(mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255));
}
