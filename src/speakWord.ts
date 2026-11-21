// Says a Hebrew or Greek word aloud with the natural voice (the same one that reads the Bible), so its pronunciation can be heard. The voice program turns the
// word into sounds first (Greek the classical way it is taught, Hebrew the modern way, from the vowel points) and says them in the reader's chosen voice,
// a little slower than speech. One word plays at a time, and a word already heard is kept so it plays at once the next time.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { loadReadPrefs } from "./readAloud";

import { hasHebrewPoints, languageOf, speakable, tidyOriginal, type OriginalLang } from "./originalText";
export { hasHebrewPoints, languageOf, speakable, tidyOriginal };
export type { OriginalLang };

const SPEED_FACTOR = 0.85;
const heard = new Map<string, string>(); // voice|speed|lang|text -> a blob address
let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  if (current) {
    current.pause();
    current = null;
  }
}

/** True when the reason is the voice itself (not installed, or an older one), which the person can fix in Settings > Read aloud. */
export const voiceNeedsSettings = (reason: string | null | undefined): boolean => !!reason && /natural voice/i.test(reason) && /older one|not installed/i.test(reason);

/** Opens Settings at Read aloud (the voice) from anywhere: the app listens for this. */
export const openVoiceSettings = () => window.dispatchEvent(new CustomEvent("open-voice-settings"));

/** The reason in plain words, for the person who pressed the button. */
function friendly(e: unknown): string {
  const t = String(e);
  if (/vowel points/i.test(t)) return "This Hebrew word has no vowel marks in the dictionary, so its sound is not known.";
  if (/voice program|isn't available|not installed|No natural voice|available/i.test(t) && !/couldn't read/i.test(t)) return "The natural voice is not installed. Settings > Read aloud has it.";
  if (/older version/i.test(t)) return "The natural voice on this computer is an older one: it reads the Bible but cannot say Hebrew or Greek words.";
  if (/no sounds/i.test(t)) return "No sound could be made for this word.";
  return "The natural voice could not say this word. " + t.replace(/^Error:\s*/, "").slice(0, 120);
}

/** `onStart` is called when the sound is ready and about to play. */
export async function speakOriginal(text: string, lang: OriginalLang, onStart?: () => void): Promise<void> {
  stopSpeaking();
  const prefs = loadReadPrefs();
  const speed = Math.max(0.5, Math.min(2, prefs.speed * SPEED_FACTOR));
  const key = `${prefs.voice}|${speed}|${lang}|${text}`;
  let url = heard.get(key);
  if (!url) {
    const buf = await api.voiceSpeak(text, prefs.voice, speed, lang);
    url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    heard.set(key, url);
    if (heard.size > 60) {
      const first = heard.keys().next().value;
      if (first) {
        URL.revokeObjectURL(heard.get(first)!);
        heard.delete(first);
      }
    }
  }
  const a = new Audio(url);
  current = a;
  onStart?.();
  await new Promise<void>((resolve, reject) => {
    a.onended = () => resolve();
    a.onerror = () => reject(new Error("the sound could not be played"));
    a.play().catch(reject);
  });
  if (current === a) current = null;
}

/** For a screen with many words: which one is being prepared or played, and the last problem. */
export function useOriginalSpeech() {
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stopSpeaking();
    };
  }, []);
  const play = useCallback(async (id: string, text: string) => {
    const lang = languageOf(text);
    if (!lang) return;
    setError(null);
    if (lang === "he" && !hasHebrewPoints(text)) {
      setError("This Hebrew word has no vowel marks in the dictionary, so its sound is not known.");
      return;
    }
    setBusy(id);
    try {
      // the sound is made first (the first word of a session also starts the voice), then it plays
      await speakOriginal(text, lang, () => {
        if (!live.current) return;
        setBusy(null);
        setPlaying(id);
      });
    } catch (e) {
      if (live.current) setError(friendly(e));
    } finally {
      if (live.current) {
        setBusy((b) => (b === id ? null : b));
        setPlaying((p) => (p === id ? null : p));
      }
    }
  }, []);
  return { busy, playing, error, play };
}
