// Read-aloud: plays a chapter verse by verse with the natural Kokoro voice (Rust
// `voice.rs` + the voice sidecar), preparing the next two verses while one plays so there
// are no gaps. If this build has no natural voice, Windows' own voices are used instead
// (Web Speech API). The reader's choices are remembered per viewer (localStorage).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tidyPunctuation } from "./verseSegments";

export interface ReadItem {
  /** verse number, 0 for the "John, chapter 3" announcement, -1 for text that isn't a
   * verse (a commentary note, a word study... read from a selection) */
  verse: number;
  text: string;
  /** Where this piece is on the page, "group#sentence": the group is a paragraph of a book
   * ("412|7") or a verse ("v16"), so the page can tint the sentence being spoken and the
   * player can skip by paragraph. Absent for text with no place on the page. */
  tag?: string;
}

/** The paragraph or verse a tag belongs to (everything before its "#sentence"). */
export function tagGroup(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const at = tag.lastIndexOf("#");
  return at < 0 ? tag : tag.slice(0, at);
}

/** Splits longer prose (a commentary note, a dictionary entry) into sentence-sized pieces
 * of up to ~350 characters, so reading starts at once and the next piece is prepared
 * while one plays. */
export function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?;:\n]+[.!?;:]*["”’)\]]*\s*|\n+/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (/^\n+$/.test(s)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    if (cur && (cur + s).length > 350) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((t) => /[\p{L}\p{N}]/u.test(t));
}

export type ReaderStatus = "idle" | "preparing" | "playing" | "paused" | "error";

export interface ReaderState {
  status: ReaderStatus;
  verse: number | null;
  /** the tag of the piece being read, if it has one */
  tag: string | null;
  message: string | null;
  engine: "natural" | "windows";
}

/** The reader's state, sent to the page whenever it changes (detail: ReaderState), so a
 * book or chapter can show what is being read. */
export const READ_STATE_EVENT = "read-aloud-state";

/** What a page asks the reader to read: plain text, or pieces with their places on the page. */
export type ListenRequest = string | { items: { tag: string; text: string }[]; /** what is being read, for the player */ label?: string };

export interface ReadAloudPrefs {
  voice: string;
  speed: number;
  /** carry on into the next chapter at the end of this one */
  continueChapters: boolean;
}

// The 28 English Kokoro voices bundled (voice-sidecar/make_voices.py).
export const NATURAL_VOICES: { id: string; label: string }[] = [
  ...["alloy", "aoede", "bella", "heart", "jessica", "kore", "nicole", "nova", "river", "sarah", "sky"].map((n) => ({ id: `af_${n}`, label: `${cap(n)} — American, female` })),
  ...["adam", "echo", "eric", "fenrir", "liam", "michael", "onyx", "puck", "santa"].map((n) => ({ id: `am_${n}`, label: `${cap(n)} — American, male` })),
  ...["alice", "emma", "isabella", "lily"].map((n) => ({ id: `bf_${n}`, label: `${cap(n)} — British, female` })),
  ...["daniel", "fable", "george", "lewis"].map((n) => ({ id: `bm_${n}`, label: `${cap(n)} — British, male` })),
];

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

const PREFS_KEY = "readAloud:prefs";
// Sarah is the voice the user already chose for their Ghost Claw assistant.
export const DEFAULT_READ_PREFS: ReadAloudPrefs = { voice: "af_sarah", speed: 1, continueChapters: true };

export function loadReadPrefs(): ReadAloudPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<ReadAloudPrefs>;
    return {
      voice: NATURAL_VOICES.some((v) => v.id === p.voice) ? p.voice! : DEFAULT_READ_PREFS.voice,
      speed: typeof p.speed === "number" && p.speed >= 0.5 && p.speed <= 2 ? p.speed : 1,
      continueChapters: p.continueChapters !== false,
    };
  } catch {
    return DEFAULT_READ_PREFS;
  }
}

export function saveReadPrefs(p: ReadAloudPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* per-viewer convenience only */
  }
}

/** Verse text as it should be heard: the reader's punctuation tidy-up, editorial marks
 * (the Enoch apparatus, brackets) dropped, and small-caps LORD/GOD read as words. */
export function speechText(text: string): string {
  return tidyPunctuation(text)
    .replace(/⟦[^|⟧]*\|[^|⟧]*\|[^|⟧]*\|[^|⟧]*\|([^⟧]*)⟧/g, "$1") // dictionary reference markers -> their label
    .replace(/[⌜⌝〚〛‹›†[\]]/g, "")
    .replace(/=([^=]+)=/g, "$1")
    .replace(/\bLORD\b/g, "Lord")
    .replace(/\bGOD\b/g, "God")
    .replace(/\s+/g, " ")
    .trim();
}

/** Asks the app's reader to read `text` aloud (App listens for this; used by the 🔊
 * buttons in side panels, which don't have the reader themselves). */
export const LISTEN_EVENT = "read-aloud-request";

/** Sent when a reading asked for with `requestListen` reaches its end by itself (not when
 * it is stopped), so a book can carry on into its next chapter. */
export const LISTEN_FINISHED_EVENT = "read-aloud-finished";

export function requestListen(what: ListenRequest) {
  window.dispatchEvent(new CustomEvent<ListenRequest>(LISTEN_EVENT, { detail: what }));
}

/** "Listen from here", chosen from the right-click menu on a paragraph or a verse
 * (detail: { book?: { section, para }, verse?: number }). */
export const LISTEN_FROM_EVENT = "read-aloud-from-here";

/** "Bookmark this place", chosen from the right-click menu on a paragraph of a book
 * (detail: { para }). */
export const BOOKMARK_HERE_EVENT = "book-bookmark-here";

export function chapterAnnouncement(book: string, chapter: number): string {
  if (book === "Psalms") return `Psalm ${chapter}.`;
  return `${book}, chapter ${chapter}.`;
}

interface VoiceStatus {
  available: boolean;
  running: boolean;
}

export class ReadAloud {
  private items: ReadItem[] = [];
  private index = 0;
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private cache = new Map<number, Promise<string>>();
  private prefs: ReadAloudPrefs = loadReadPrefs();
  private natural: boolean | null = null;
  state: ReaderState = { status: "idle", verse: null, tag: null, message: null, engine: "natural" };

  constructor(
    private onChange: (s: ReaderState) => void,
    /** called when the last item finishes (not when stopped) */
    private onFinished: () => void,
  ) {
    // downloaded or removed in Settings: look again next time
    listen("voice-changed", () => {
      this.natural = null;
    }).catch(() => undefined);
  }

  private set(s: Partial<ReaderState>) {
    this.state = { ...this.state, ...s };
    this.onChange(this.state);
  }

  private async useNatural(): Promise<boolean> {
    if (this.natural === null) {
      const s = await invoke<VoiceStatus>("voice_status").catch(() => ({ available: false, running: false }));
      this.natural = s.available;
    }
    return this.natural;
  }

  setPrefs(p: ReadAloudPrefs) {
    const changedSound = p.voice !== this.prefs.voice || p.speed !== this.prefs.speed;
    this.prefs = p;
    saveReadPrefs(p);
    if (changedSound && (this.state.status === "playing" || this.state.status === "paused" || this.state.status === "preparing")) {
      // re-read the current verse in the new voice/speed
      this.playFrom(this.index);
    }
  }

  get prefsNow() {
    return this.prefs;
  }

  async start(items: ReadItem[], startIndex = 0) {
    this.items = items;
    await this.playFrom(Math.max(0, Math.min(startIndex, items.length - 1)));
  }

  private revokeCache() {
    for (const p of this.cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
    this.cache.clear();
  }

  private haltAudio() {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      this.audio = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  private fetchAudio(i: number): Promise<string> {
    let p = this.cache.get(i);
    if (!p) {
      const { voice, speed } = this.prefs;
      p = invoke<ArrayBuffer>("voice_speak", { text: this.items[i].text, voice, speed }).then((buf) =>
        URL.createObjectURL(new Blob([buf], { type: "audio/wav" })),
      );
      this.cache.set(i, p);
    }
    return p;
  }

  private async playFrom(i: number) {
    const gen = ++this.generation;
    this.haltAudio();
    this.revokeCache();
    this.index = i;
    const natural = await this.useNatural();
    if (gen !== this.generation) return;
    this.set({ engine: natural ? "natural" : "windows", message: null });
    if (natural) {
      const s = await invoke<VoiceStatus>("voice_status").catch(() => null);
      if (!s?.running) this.set({ status: "preparing", verse: this.items[i]?.verse ?? null, tag: this.items[i]?.tag ?? null });
    }
    this.playIndex(i, gen);
  }

  private async playIndex(i: number, gen: number) {
    if (gen !== this.generation) return;
    if (i >= this.items.length) {
      this.set({ status: "idle", verse: null, tag: null });
      this.onFinished();
      return;
    }
    this.index = i;
    const item = this.items[i];
    if (this.state.engine === "windows") return this.speakWindows(item, i, gen);
    try {
      const url = await this.fetchAudio(i);
      // prepare the next two while this one plays
      for (const j of [i + 1, i + 2]) if (j < this.items.length) this.fetchAudio(j).catch(() => undefined);
      if (gen !== this.generation) return;
      const audio = new Audio(url);
      this.audio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.cache.delete(i);
        this.playIndex(i + 1, gen);
      };
      this.set({ status: "playing", verse: item.verse, tag: item.tag ?? null });
      await audio.play();
    } catch (e) {
      if (gen !== this.generation) return;
      // natural voice failed: say why, and fall back to the Windows voice from here on
      this.natural = false;
      this.set({ engine: "windows", message: `The natural voice isn't working (${e}); using the Windows voice instead.` });
      this.speakWindows(item, i, gen);
    }
  }

  private speakWindows(item: ReadItem, i: number, gen: number) {
    if (!("speechSynthesis" in window)) {
      this.set({ status: "error", message: "No voice is available on this computer." });
      return;
    }
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = this.prefs.speed;
    const en = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("en"));
    if (en) u.voice = en;
    u.onend = () => gen === this.generation && this.playIndex(i + 1, gen);
    this.set({ status: "playing", verse: item.verse, tag: item.tag ?? null });
    window.speechSynthesis.speak(u);
  }

  pause() {
    if (this.state.status !== "playing") return;
    if (this.audio) this.audio.pause();
    else window.speechSynthesis.pause();
    this.set({ status: "paused" });
  }

  resume() {
    if (this.state.status !== "paused") return;
    if (this.audio) this.audio.play().catch(() => undefined);
    else window.speechSynthesis.resume();
    this.set({ status: "playing" });
  }

  stop() {
    this.generation++;
    this.haltAudio();
    this.revokeCache();
    this.set({ status: "idle", verse: null, tag: null, message: null });
  }

  /** Back or forward a whole paragraph (or verse): to the start of this one first when
   * going back from its middle, like a music player's "previous". */
  skipGroup(direction: -1 | 1) {
    const group = (i: number) => tagGroup(this.items[i]?.tag) ?? `#${i}`;
    const here = group(this.index);
    let i = this.index;
    if (direction > 0) {
      while (i < this.items.length && group(i) === here) i++;
      if (i >= this.items.length) return;
    } else {
      while (i > 0 && group(i - 1) === here) i--; // start of this paragraph
      if (i === this.index && i > 0) {
        const before = group(i - 1);
        i--;
        while (i > 0 && group(i - 1) === before) i--;
      }
    }
    this.playFrom(i);
  }

  next() {
    if (this.index + 1 < this.items.length) this.playFrom(this.index + 1);
  }

  prev() {
    this.playFrom(Math.max(0, this.index - 1));
  }

  /** Starts the natural voice in the background so pressing Listen is instant. */
  static warmUp() {
    invoke<VoiceStatus>("voice_status")
      .then((s) => s.available && !s.running && invoke("voice_start"))
      .catch(() => undefined);
  }
}
