// A picture (SVG, JPEG or PNG) as a PNG, for the printed sheet, the Word document and the preview. Needs a screen (a canvas).

import type { Picture } from "./sheets";

/**
 * The picture at `url` drawn inside a box of `width` by `maxHeight` pixels with its own proportions kept, or null if it cannot be loaded.
 * A drawing (SVG) can be made as large as the box; a painting or photograph is never made larger than it is. The box keeps a tall painting
 * from becoming a page-high file, and a Word document from running a picture off the page.
 */
export async function rasterize(url: string, width = 1000, maxHeight = 760): Promise<Picture | null> {
  try {
    const img = new Image();
    const vector = /\.svg(\?|$)/i.test(url);
    if (vector) {
      const svg = await (await fetch(url)).text();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    } else {
      img.src = url;
    }
    await img.decode();
    const nw = img.naturalWidth || 4;
    const nh = img.naturalHeight || 3;
    const scale = Math.min(width / nw, maxHeight / nh, vector ? Infinity : 1);
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { src: canvas.toDataURL("image/png"), width: w, height: h };
  } catch {
    return null;
  }
}
