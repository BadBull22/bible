// Content Factory: makes a short video (MP4, H.264 and AAC) from a set of cards, with slow movement, soft cross-fades and
// the music. The window engine's own encoder does the work (WebCodecs); a small library puts the result in an MP4 file.
// The same drawing code as the still pictures, so what was previewed is what is saved.

import { Card, clamp, Credit, FooterSettings, SizeInfo } from "./types";
import { drawCard, PictureBank } from "./draw";

export type Motion = "still" | "zoom" | "drift";
export type Quality = "small" | "best";

export interface VideoPlan {
  size: SizeInfo;
  cards: Card[];
  /** how long each card shows, in seconds (when `durations` is not given) */
  secondsPerCard: number;
  /** how long each card shows, one number for each (a card read aloud shows as long as it takes to read) */
  durations?: number[];
  motion: Motion;
  /** cross-fade between cards, in seconds (0 = a cut) */
  fade: number;
  quality: Quality;
  footer: FooterSettings;
  bank: PictureBank;
  creditFor: (card: Card) => Credit | null;
  /** the music, already cut to the video's length and set to its level (null = silent video) */
  music: AudioBuffer | null;
  /** the music's credit line, shown for the first and last five seconds (empty: none needed) */
  musicCredit?: string | null;
}

export const FPS = 30;

export const durationsOf = (p: Pick<VideoPlan, "cards" | "secondsPerCard" | "durations">): number[] => p.durations ?? p.cards.map(() => p.secondsPerCard);
export const totalSeconds = (p: Pick<VideoPlan, "cards" | "secondsPerCard" | "durations">) => durationsOf(p).reduce((a, b) => a + b, 0);

/** the picture size of the video: "small" is 720 on the short side (WhatsApp, slow connections), "best" the full size. */
export function videoSize(size: SizeInfo, quality: Quality): { w: number; h: number } {
  const k = quality === "small" ? Math.min(1, 720 / Math.min(size.w, size.h)) : 1;
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { w: even(size.w), h: even(size.h) };
}

/** Is video making available in this window (needs the engine's H.264 encoder)? */
export async function videoSupported(): Promise<boolean> {
  try {
    if (typeof VideoEncoder === "undefined") return false;
    const s = await VideoEncoder.isConfigSupported({ codec: "avc1.640028", width: 1080, height: 1920, bitrate: 4_000_000, framerate: FPS });
    return !!s.supported;
  } catch {
    return false;
  }
}

/** Draws frame `f` of the plan onto the canvas. */
export function drawFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, plan: VideoPlan, f: number, w: number, h: number, inks: ("light" | "dark")[]) {
  const durs = durationsOf(plan);
  const t = f / FPS;
  const n = plan.cards.length;
  let i = 0;
  let begin = 0;
  while (i < n - 1 && t >= begin + durs[i]) begin += durs[i++];
  const spc = durs[i];
  const lt = t - begin;
  const sx = w / plan.size.w;
  const total = durs.reduce((a, b) => a + b, 0);
  const showMusicCredit = !!plan.musicCredit && (t < 5 || t > total - 5);
  const motionAt = (local: number) => {
    const p = clamp(local / spc, 0, 1);
    if (plan.motion === "zoom") return { zoom: 1 + 0.08 * p, panX: 0 };
    if (plan.motion === "drift") return { zoom: 1.1, panX: -p * plan.size.w * 0.05 * sx };
    return { zoom: 1, panX: 0 };
  };
  const one = (idx: number, local: number, alpha: number) => {
    const m = motionAt(local);
    ctx.save();
    ctx.scale(sx, sx);
    drawCard(ctx, plan.cards[idx], plan.size.w, plan.size.h, {
      footer: plan.footer,
      credit: plan.creditFor(plan.cards[idx]),
      extraCredit: showMusicCredit ? plan.musicCredit : null,
      reserveCredit: !!plan.musicCredit,
      bank: plan.bank,
      zoom: m.zoom,
      panX: m.panX / sx,
      textAlpha: clamp((local - 0.15) / 0.8, 0, 1),
      textRise: plan.size.h * 0.012,
      alpha,
      footerAlpha: idx === 0 ? clamp(local / 0.8, 0, 1) : 1,
      footerInk: inks[idx],
    });
    ctx.restore();
  };
  ctx.clearRect(0, 0, w, h);
  one(i, lt, 1);
  // the next card fades in over the end of this one
  if (plan.fade > 0 && i < n - 1 && lt > spc - plan.fade) {
    const a = (lt - (spc - plan.fade)) / plan.fade;
    one(i + 1, 0, clamp(a, 0, 1));
  }
}

/** The footer text colour of each card, worked out once from a still of it (not per frame). */
export function footerInks(plan: VideoPlan): ("light" | "dark")[] {
  const c = document.createElement("canvas");
  c.width = plan.size.w;
  c.height = plan.size.h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  return plan.cards.map((card) => {
    ctx.clearRect(0, 0, c.width, c.height);
    return drawCard(ctx, card, c.width, c.height, { footer: plan.footer, credit: plan.creditFor(card), extraCredit: plan.musicCredit, bank: plan.bank });
  });
}

/** Makes the MP4. `onProgress` gets 0..1. Throws "cancelled" if `signal` is aborted. */
export async function makeVideo(plan: VideoPlan, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const { Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource } = await import("mediabunny");
  const { w, h } = videoSize(plan.size, plan.quality);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const inks = footerInks(plan);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const bitrate = plan.quality === "small" ? 2_500_000 : 6_000_000;
  const video = new CanvasSource(canvas, { codec: "avc", bitrate });
  output.addVideoTrack(video, { frameRate: FPS });
  let audio: InstanceType<typeof AudioBufferSource> | null = null;
  if (plan.music) {
    audio = new AudioBufferSource({ codec: "aac", bitrate: 128_000 });
    output.addAudioTrack(audio);
  }
  await output.start();
  const frames = Math.round(totalSeconds(plan) * FPS);
  try {
    if (audio && plan.music) await audio.add(plan.music);
    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) throw new Error("cancelled");
      drawFrame(ctx, plan, f, w, h, inks);
      await video.add(f / FPS, 1 / FPS);
      if (f % 6 === 0) {
        onProgress(f / frames);
        // let the page breathe (the progress bar, the Cancel button)
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await output.finalize();
  } catch (e) {
    try {
      await output.cancel();
    } catch {
      /* already stopped */
    }
    throw e;
  }
  onProgress(1);
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video could not be made.");
  return new Blob([buffer], { type: "video/mp4" });
}

/** The music on its own as an M4A file (for the pre-service screen, the sound desk, or another video). */
export async function makeAudioFile(music: AudioBuffer): Promise<Blob> {
  const { Output, BufferTarget, Mp4OutputFormat, AudioBufferSource } = await import("mediabunny");
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const audio = new AudioBufferSource({ codec: "aac", bitrate: 160_000 });
  output.addAudioTrack(audio);
  await output.start();
  await audio.add(music);
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The music could not be saved.");
  return new Blob([buffer], { type: "audio/mp4" });
}
