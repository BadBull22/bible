// Content Factory: a logo the reader chose, made ready for the header or the footer: shrunk to a size that is kept with the settings, and with its plain
// black or white background taken off if the reader wants (see cutout.ts for the arithmetic). These parts need the window's canvas, so they are not tested under Node.

import { edgeColour, hasPlainEdge, removeBackground } from "./cutout";
import type { LogoCut } from "./types";

/** A picture chosen for a band, made small enough to keep with the settings: a logo as PNG (at most 400 px high or wide), a banner as JPEG (at most 1600 px wide). */
export async function shrinkImage(file: File, kind: "logo" | "picture"): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const k = kind === "logo" ? Math.min(1, 400 / Math.max(bmp.width, bmp.height)) : Math.min(1, 1600 / bmp.width);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return kind === "logo" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
  } catch {
    return null;
  }
}

async function pixelsOf(dataUrl: string): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData }> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return { canvas, ctx, image: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

/** Does this logo have a plain background (white, black or one colour round its edge) that can be taken off? Which colour? */
export async function inspectLogo(dataUrl: string): Promise<{ plain: boolean; colour: string }> {
  try {
    const { image } = await pixelsOf(dataUrl);
    if (!hasPlainEdge(image.data, image.width, image.height)) return { plain: false, colour: "" };
    const c = edgeColour(image.data, image.width, image.height)!;
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const name = Math.max(...c) - Math.min(...c) < 40 ? (lum > 0.8 ? "white" : lum < 0.2 ? "black" : "grey") : "one colour";
    return { plain: true, colour: name };
  } catch {
    return { plain: false, colour: "" };
  }
}

/** The logo with its background taken off (a PNG with see-through pixels). */
export async function cutLogo(dataUrl: string, cut: LogoCut): Promise<string> {
  const { canvas, ctx, image } = await pixelsOf(dataUrl);
  removeBackground(image.data, canvas.width, canvas.height, { tolerance: cut.tolerance, holes: cut.holes });
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/** A photograph the reader added, made a sensible size to keep and to put behind words: at most `maxSide` pixels on its longest side (never made larger), as a JPEG. */
export async function shrinkPhoto(file: Blob, maxSide = 2400, quality = 0.86): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", quality));
  } catch {
    return null;
  }
}
