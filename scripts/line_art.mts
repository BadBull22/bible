// The colouring-in version of a children's picture: every light or coloured fill becomes white, the dark outlines (and dark fills, such as eyes)
// stay. Every shape in a picture must have a dark stroke, or it disappears in the outline version.

/** brightness of #rgb or #rrggbb, 0 (black) to 255 (white); null for anything else */
function brightness(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const keepFill = (v: string) => /^(none|transparent|#fff(fff)?|white)$/i.test(v.trim()) || (brightness(v) ?? 255) < 70;

export function lineArt(svg: string): string {
  // fill="..." attributes, then fill: ... inside style attributes and <style> blocks
  let out = svg.replace(/\bfill="([^"]*)"/g, (all, v: string) => (keepFill(v) ? all : 'fill="#ffffff"'));
  out = out.replace(/\bfill:\s*([^;"}]+)/g, (all, v: string) => (keepFill(v) ? all : "fill:#ffffff"));
  return out;
}
