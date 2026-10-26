// A moving background in a PowerPoint file: PowerPoint can't hold a looping background video the way the show does, so a slide
// gets a still picture taken from it (a frame a moment in), kept in the app's media folder like any other picture. The same
// still is used again for every slide with that background.

import { api } from "./api";
import { kindOfName } from "./sermonMedia";

const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg" };

/** What each file already gave (a file name -> the file name of its still, or none when no picture could be taken). */
const done = new Map<string, Promise<string | undefined>>();

/** A frame of a video as a picture file in the media folder, or undefined when it could not be taken. */
async function frameOf(file: string): Promise<string | undefined> {
  let url: string | null = null;
  try {
    const bytes = await api.sermonMediaBytes(file);
    url = URL.createObjectURL(new Blob([bytes], { type: MIME[file.split(".").pop()?.toLowerCase() ?? ""] ?? "video/mp4" }));
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    const ready = (ev: "loadeddata" | "seeked") =>
      new Promise<void>((ok, no) => {
        const timer = window.setTimeout(() => no(new Error("the video would not open")), 20000);
        v.addEventListener(ev, () => (window.clearTimeout(timer), ok()), { once: true });
        v.addEventListener("error", () => (window.clearTimeout(timer), no(new Error("the video would not open"))), { once: true });
      });
    await ready("loadeddata");
    // a moment in, not the very first frame (often black)
    const at = Math.min(1, Math.max(0, (v.duration || 1) / 4));
    const seeked = ready("seeked");
    v.currentTime = at;
    await seeked;
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const g = canvas.getContext("2d");
    if (!g) return undefined;
    // the frame fills the slide (cropped, not stretched), as the show does
    const scale = Math.max(1280 / (v.videoWidth || 1280), 720 / (v.videoHeight || 720));
    const w = (v.videoWidth || 1280) * scale;
    const h = (v.videoHeight || 720) * scale;
    g.drawImage(v, (1280 - w) / 2, (720 - h) / 2, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
    if (!blob) return undefined;
    const saved = await api.sermonMediaAdd(new Uint8Array(await blob.arrayBuffer()), `still of ${file}.jpg`);
    return saved.file;
  } catch {
    return undefined;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** A background as a PowerPoint file can hold it: a picture as it is, a moving background as a still taken from it. */
export function stillFor(file: string | null | undefined): Promise<string | undefined> {
  if (!file) return Promise.resolve(undefined);
  if (kindOfName(file) !== "video") return Promise.resolve(file);
  let got = done.get(file);
  if (!got) {
    got = frameOf(file);
    done.set(file, got);
  }
  return got;
}
