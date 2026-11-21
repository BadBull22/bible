// Drawing the meanings of a word as a ring (the same helpers as the desktop app's src/semantic.ts, kept small for the phone).

/** The colour of the i-th of `total` meanings. */
export const senseColour = (i: number, total: number): string => `hsl(${(Math.round((i * 360) / Math.max(total, 1)) + 8) % 360} 62% 56%)`;

/** The order meanings are listed in: the most verses first (the dictionary's own order breaks a tie). */
export function senseOrder(verses: number[]): number[] {
  return verses
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .map(([, i]) => i);
}

export interface Arc {
  index: number;
  /** radians, 0 at the top, clockwise */
  from: number;
  to: number;
}

/** The slices of the ring: each meaning gets the share of the circle its verses are of all the verses; a small gap keeps neighbours apart. */
export function senseArcs(verses: number[], gap = 0.012): Arc[] {
  const total = verses.reduce((n, v) => n + v, 0);
  if (total <= 0) return [];
  const many = verses.length > 1;
  let at = 0;
  return verses.map((v, index) => {
    const span = (v / total) * Math.PI * 2;
    const from = at + (many ? gap / 2 : 0);
    const to = Math.max(at + span - (many ? gap / 2 : 0), from + 0.015);
    at += span;
    return { index, from, to: Math.min(to, Math.PI * 2 - 0.0001) };
  });
}

/** The path of a slice of a ring (centre cx,cy; inner radius r0, outer r1; angles in radians from the top, clockwise). */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(x0)},${f(y0)} A${r1},${r1} 0 ${large} 1 ${f(x1)},${f(y1)} L${f(x2)},${f(y2)} A${r0},${r0} 0 ${large} 0 ${f(x3)},${f(y3)} Z`;
}

/** The books a meaning is used in most, as "Romans 20 · John 10": the first `n` books with their verse counts. `counts` is Genesis first. */
export function topBooks(counts: number[], names: readonly string[], n = 5): { book: string; count: number }[] {
  return counts
    .map((count, i) => ({ book: names[i] ?? "", count }))
    .filter((b) => b.count > 0 && b.book)
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
