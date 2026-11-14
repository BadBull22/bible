// Content Factory: the soft music maker. It composes quiet instrumental music from fixed musical rules (chords, a gentle
// repeating pattern, a slow melody, pads or bells) and plays it through the web engine's own audio, offline. Nothing is
// downloaded, nothing is recorded, so there is no licence to worry about. A "mood" and a "seed" describe a piece: the same
// seed gives exactly the same music again, "Another version" changes the seed. Any length; it fades in and out.

import { clamp } from "./types";

export type MoodId = "calm" | "hopeful" | "reverent" | "bright" | "christmas" | "passover";

export interface Mood {
  id: MoodId;
  label: string;
  blurb: string;
  bpm: number;
  /** MIDI note of the key's tonic (60 = middle C) */
  key: number;
  mode: "maj" | "min" | "dor";
  /** chord roots as scale degrees, one chord a bar */
  prog: number[];
  /** bells instead of piano-like notes */
  bells: boolean;
  /** how many of the pattern's notes sound, 0..1 */
  arp: number;
  /** how often the melody plays, 0..1 */
  mel: number;
  /** the pad's brightness (low-pass, Hz) */
  padLP: number;
}

export const MOODS: Mood[] = [
  { id: "calm", label: "Calm", blurb: "Slow and peaceful", bpm: 58, key: 62, mode: "maj", prog: [0, 4, 5, 3], bells: false, arp: 1, mel: 0.9, padLP: 800 },
  { id: "hopeful", label: "Hopeful", blurb: "Gently rising", bpm: 72, key: 67, mode: "maj", prog: [0, 3, 5, 4], bells: false, arp: 1, mel: 1, padLP: 1100 },
  { id: "reverent", label: "Reverent", blurb: "Quiet and weighty", bpm: 54, key: 57, mode: "min", prog: [0, 5, 2, 6], bells: false, arp: 0.6, mel: 0.8, padLP: 650 },
  { id: "bright", label: "Joyful", blurb: "Light and bright", bpm: 84, key: 60, mode: "maj", prog: [0, 3, 0, 4], bells: false, arp: 1, mel: 1, padLP: 1500 },
  { id: "christmas", label: "Christmas bells", blurb: "Soft bells", bpm: 66, key: 65, mode: "maj", prog: [0, 5, 3, 4], bells: true, arp: 0.5, mel: 1, padLP: 900 },
  { id: "passover", label: "Passover", blurb: "An old minor mode", bpm: 60, key: 62, mode: "dor", prog: [0, 3, 0, 6], bells: false, arp: 0.8, mel: 0.9, padLP: 700 },
];

export const moodById = (id: string): Mood => MOODS.find((m) => m.id === id) ?? MOODS[0];

/** the music that suits the church year */
export function moodForOccasion(occasion: string | null | undefined): MoodId {
  switch (occasion) {
    case "christmas":
    case "advent":
      return "christmas";
    case "lent":
    case "palmsunday":
    case "goodfriday":
      return "reverent";
    case "passover":
      return "passover";
    case "easter":
    case "ascension":
    case "pentecost":
      return "bright";
    case "harvest":
      return "hopeful";
    default:
      return "calm";
  }
}

const SR = 44100;
const SCALES = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10], dor: [0, 2, 3, 5, 7, 9, 10] };
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const degree = (mode: Mood["mode"], key: number, d: number) => key + SCALES[mode][((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How loud the finished music is before the level slider: about -17 LUFS. */
const TARGET_RMS = 0.11;

/** Composes and renders `seconds` of music. The same mood, length and seed always give the same sound. */
export async function renderMusic(moodId: MoodId, seconds: number, seed: number): Promise<AudioBuffer> {
  const M = moodById(moodId);
  const rnd = mulberry32(seed * 2654435761);
  const len = Math.max(2, seconds);
  const ctx = new OfflineAudioContext(2, Math.round(SR * len), SR);
  const beat = 60 / M.bpm;
  const bar = beat * 4;
  const nBars = Math.ceil(len / bar);

  // the room: 3 seconds of softened noise fading away
  const irLen = Math.round(SR * 3.2);
  const ir = ctx.createBuffer(2, irLen, SR);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < irLen; i++) {
      lp += 0.25 * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-(i / SR) / 0.75) * (i < 600 ? i / 600 : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  const dry = ctx.createGain();
  dry.gain.value = 0.75;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26;
  comp.ratio.value = 3;
  comp.attack.value = 0.02;
  comp.release.value = 0.4;
  const bus = ctx.createGain();
  bus.connect(dry);
  bus.connect(conv);
  conv.connect(wet);
  dry.connect(comp);
  wet.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);

  const pluck = (f: number, t: number, vel: number, dur: number) => {
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.type = "sine";
    o.frequency.value = f;
    o2.type = "triangle";
    o2.frequency.value = f * 2.001;
    g2.gain.value = 0.22;
    lp.type = "lowpass";
    lp.frequency.value = 2600 + vel * 1500;
    lp.Q.value = 0.2;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(lp);
    lp.connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.008);
    g.gain.setTargetAtTime(0.0001, t + 0.01, dur / 4.2);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.6);
    o2.stop(t + dur + 0.6);
  };
  const bell = (f: number, t: number, vel: number) => {
    const c = ctx.createOscillator();
    const m = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    c.frequency.value = f;
    m.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.6, t);
    mg.gain.setTargetAtTime(0.01, t, 0.35);
    m.connect(mg);
    mg.connect(c.frequency);
    c.connect(g);
    g.connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085 * vel, t + 0.004);
    g.gain.setTargetAtTime(0.0001, t + 0.005, 0.9);
    c.start(t);
    m.start(t);
    c.stop(t + 4.5);
    m.stop(t + 4.5);
  };
  const pad = (f: number, t: number, dur: number) => {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = M.padLP;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    lp.connect(g);
    g.connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.034, t + 1.3);
    g.gain.setValueAtTime(0.034, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.6);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 1.8);
    }
  };
  const bass = (f: number, t: number, dur: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    o.connect(g);
    g.connect(bus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.08);
    g.gain.setTargetAtTime(0.0001, t + dur - 0.6, 0.35);
    o.start(t);
    o.stop(t + dur + 1.5);
  };

  const penta = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12];
  let pi = 4;
  const arpIdx = [0, 2, 4, 7, 4, 2, 4, 2];
  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar;
    const d = M.prog[b % 4];
    const loop = Math.floor(b / 4);
    [d, d + 2, d + 4, d + 7].forEach((x) => pad(mtof(degree(M.mode, M.key - 12, x)), t0, bar));
    bass(mtof(degree(M.mode, M.key - 24, d)), t0, bar);
    for (let k = 0; k < 8; k++) {
      if (loop === 0 && b % 4 < 1) continue; // the very first bar is the pad alone
      if (rnd() > M.arp + (loop > 0 ? 0 : -0.25)) continue;
      const n = degree(M.mode, M.key, d + arpIdx[k]);
      const t = t0 + (k * beat) / 2 + (rnd() - 0.5) * 0.02;
      if (M.bells) {
        if (k % 2 === 0) bell(mtof(n + 12), t, 0.6 + rnd() * 0.4);
      } else pluck(mtof(n), t, 0.55 + rnd() * 0.45, 2.4);
    }
    if (loop >= 1) {
      // the melody joins from the second round
      let pos = 0;
      while (pos < 4) {
        const dur = [1, 2, 2, 3, 4][Math.floor(rnd() * 5)];
        const rest = rnd() < 0.28;
        const room = Math.min(dur, 4 - pos);
        if (!rest && rnd() < M.mel) {
          pi = clamp(pi + [-2, -1, -1, 0, 1, 1, 2][Math.floor(rnd() * 7)], 0, penta.length - 1);
          const n = degree(M.mode, M.key + 12, penta[pi]);
          const t = t0 + pos * beat;
          if (M.bells) bell(mtof(n + 12), t, 0.8 + rnd() * 0.2);
          else pluck(mtof(n), t, 0.8 + rnd() * 0.2, 3.2);
        }
        pos += room;
      }
    }
  }
  const buf = await ctx.startRendering();
  return finish(buf, 1.5, 3.5);
}

/** Fades the ends and sets the level (so every piece, whatever its mood or source, starts at about the same loudness). */
export function finish(buf: AudioBuffer, fadeIn: number, fadeOut: number): AudioBuffer {
  const n = buf.length;
  const fi = Math.min(Math.round(buf.sampleRate * fadeIn), n >> 1);
  const fo = Math.min(Math.round(buf.sampleRate * fadeOut), n >> 1);
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const g = Math.min(1, fi ? i / fi : 1) * Math.min(1, fo ? (n - i) / fo : 1);
      d[i] *= g;
      peak = Math.max(peak, Math.abs(d[i]));
      sum += d[i] * d[i];
      count++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  const k = rms > 0 ? Math.min(0.9 / Math.max(peak, 1e-6), TARGET_RMS / rms) : 1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return buf;
}

/** A stretch of the reader's own music (or a recording), `seconds` long from `startAt`: repeated if it is shorter, with soft ends. */
export async function segmentOf(source: AudioBuffer, startAt: number, seconds: number): Promise<AudioBuffer> {
  const sr = source.sampleRate;
  const total = Math.round(seconds * sr);
  const ctx = new OfflineAudioContext(2, Math.max(1, total), sr);
  const out = ctx.createBuffer(2, Math.max(1, total), sr);
  const start = clamp(Math.round(startAt * sr), 0, Math.max(0, source.length - 1));
  for (let c = 0; c < 2; c++) {
    const from = source.getChannelData(Math.min(c, source.numberOfChannels - 1));
    const to = out.getChannelData(c);
    let pos = start;
    for (let i = 0; i < total; i++) {
      to[i] = from[pos];
      pos++;
      if (pos >= from.length) pos = 0;
    }
  }
  return finish(out, 1.5, 3.5);
}

/** Decodes a music file (MP3, M4A, WAV, OGG, FLAC) the reader picked. */
export async function decodeMusicFile(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, SR);
  return ctx.decodeAudioData(data.slice(0));
}

/** The music at a chosen level, as a new buffer (the level slider's result). */
export function withLevel(buf: AudioBuffer, level: number): AudioBuffer {
  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const from = buf.getChannelData(c);
    const to = out.getChannelData(c);
    for (let i = 0; i < from.length; i++) to[i] = from[i] * level;
  }
  return out;
}

export interface VoiceClip {
  buffer: AudioBuffer;
  /** seconds from the start of the video */
  at: number;
}

/** The soundtrack of a video: the music (already at its level) lowered while the voice speaks, and the voice clips at their places.
 * Each voice clip is brought to a steady level first. Returns null when there is neither music nor voice. */
export async function mixAudio(opts: { total: number; music: AudioBuffer | null; clips: VoiceClip[]; duck?: number }): Promise<AudioBuffer | null> {
  if (!opts.music && opts.clips.length === 0) return null;
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(opts.total * sr)), sr);
  const clips = [...opts.clips].sort((a, b) => a.at - b.at);
  if (opts.music) {
    const src = ctx.createBufferSource();
    src.buffer = opts.music;
    const g = ctx.createGain();
    g.gain.value = 1;
    const duck = opts.duck ?? 0.28;
    for (const c of clips) {
      // down a little before the voice starts, back up a little after it ends
      g.gain.setTargetAtTime(duck, Math.max(0, c.at - 0.25), 0.12);
      g.gain.setTargetAtTime(1, c.at + c.buffer.duration + 0.2, 0.35);
    }
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0);
  }
  for (const c of clips) {
    let peak = 0;
    for (let ch = 0; ch < c.buffer.numberOfChannels; ch++) {
      const d = c.buffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    const s = ctx.createBufferSource();
    s.buffer = c.buffer;
    const vg = ctx.createGain();
    vg.gain.value = peak > 0 ? 0.9 / peak : 1;
    s.connect(vg);
    vg.connect(ctx.destination);
    s.start(c.at);
  }
  return ctx.startRendering();
}

/** Plays a buffer for the preview. Returns a function that stops it. */
export function playBuffer(buf: AudioBuffer, onEnd?: () => void): () => void {
  const ctx = new AudioContext({ sampleRate: buf.sampleRate });
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  let stopped = false;
  src.onended = () => {
    if (!stopped) onEnd?.();
    void ctx.close().catch(() => undefined);
  };
  src.start();
  return () => {
    stopped = true;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    void ctx.close().catch(() => undefined);
  };
}
