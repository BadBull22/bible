// Content Factory: takes the plain background (white, black or any one colour) off a logo, so the logo sits cleanly on the footer bar or the picture.
// Pure arithmetic on RGBA pixels (no canvas), so it can be tested under Node (scripts/test_factory.mts); the screen code gives it the pixels of the logo.

export interface CutOptions {
  /** 0 to 100: how different from the background colour a pixel may be and still count as background */
  tolerance: number;
  /** also take away the background colour inside the logo (the holes in letters), not only what joins the edge */
  holes: boolean;
  /** the background colour; left out, it is read from the edge of the picture */
  colour?: [number, number, number];
}

export interface CutResult {
  background: [number, number, number];
  /** how many pixels were made see-through */
  removed: number;
}

type Rgb = [number, number, number];

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** The colour round the edge of the picture (the middle value of its border), or null when the edge is already see-through. */
export function edgeColour(d: Uint8ClampedArray, w: number, h: number): Rgb | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 200) return;
    r.push(d[i]);
    g.push(d[i + 1]);
    b.push(d[i + 2]);
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    take(w - 1, y);
  }
  if (r.length < (2 * (w + h)) / 4) return null;
  return [median(r), median(g), median(b)];
}

/** Does the edge of the picture look like one plain colour (so that taking the background off makes sense)? */
export function hasPlainEdge(d: Uint8ClampedArray, w: number, h: number): boolean {
  const c = edgeColour(d, w, h);
  if (!c) return false;
  let near = 0;
  let all = 0;
  const look = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    all++;
    if (Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2])) <= 48) near++;
  };
  for (let x = 0; x < w; x++) {
    look(x, 0);
    look(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    look(0, y);
    look(w - 1, y);
  }
  return all > 0 && near / all >= 0.85;
}

/** Makes the background see-through, in place. What joins the edge and is near the background colour goes (all of that colour, with `holes`); the pixels
 * along the cut are made partly see-through and cleaned of the background's colour, so there is no white or black fringe round the logo. */
export function removeBackground(d: Uint8ClampedArray, w: number, h: number, o: CutOptions): CutResult {
  const bg: Rgb = o.colour ?? edgeColour(d, w, h) ?? [255, 255, 255];
  const T = Math.max(0, Math.min(100, o.tolerance)) * 2;
  const dist = (i: number) => Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
  const isBg = (p: number) => {
    const i = p * 4;
    return d[i + 3] < 10 || dist(i) <= T;
  };

  const mask = new Uint8Array(w * h);
  if (o.holes) {
    for (let p = 0; p < w * h; p++) mask[p] = isBg(p) ? 1 : 0;
  } else {
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    const push = (p: number) => {
      if (mask[p] || !isBg(p)) return;
      mask[p] = 1;
      queue[tail++] = p;
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
  }

  // the pixels along the cut (two rings): each is a blend of the logo's colour and the background, so work out how much of it is logo
  // (from the colour of the solid logo nearby) and make the rest see-through, with the background's colour taken out
  const ring = new Uint8Array(w * h);
  const near = (p: number, test: (q: number) => boolean) => {
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && test(ny * w + nx)) return true;
      }
    }
    return false;
  };
  for (let p = 0; p < w * h; p++) if (!mask[p] && near(p, (q) => mask[q] === 1)) ring[p] = 1;
  const first = ring.slice();
  for (let p = 0; p < w * h; p++) if (!mask[p] && !first[p] && near(p, (q) => first[q] === 1)) ring[p] = 2;

  const next = new Uint8ClampedArray(d);
  let removed = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (mask[p]) {
      next[i + 3] = 0;
      removed++;
      continue;
    }
    if (!ring[p]) continue;
    // the solid logo colour round here: the mean of the pixels within three that are not on a ring
    const x = p % w;
    const y = (p - x) / w;
    let n = 0;
    const f = [0, 0, 0];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] || ring[q]) continue;
        f[0] += d[q * 4];
        f[1] += d[q * 4 + 1];
        f[2] += d[q * 4 + 2];
        n++;
      }
    }
    const fg: Rgb = n ? [f[0] / n, f[1] / n, f[2] / n] : [d[i], d[i + 1], d[i + 2]];
    const v = [fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]];
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (vv < 400) continue; // the logo's colour is the background's own: nothing to tell them apart by
    const dot = (d[i] - bg[0]) * v[0] + (d[i + 1] - bg[1]) * v[1] + (d[i + 2] - bg[2]) * v[2];
    const a = Math.max(0, Math.min(1, dot / vv));
    if (a > 0.97) continue;
    if (a < 0.04) {
      next[i + 3] = 0;
      removed++;
      continue;
    }
    for (let c = 0; c < 3; c++) next[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - bg[c] * (1 - a)) / a)));
    next[i + 3] = Math.round(d[i + 3] * a);
  }
  d.set(next);
  return { background: bg, removed };
}
