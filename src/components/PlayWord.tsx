// A round speaker button that says a Hebrew or Greek word aloud with the natural voice (see speakWord.ts). It goes beside every Hebrew or Greek word in the app.
// `compact` is the small one for cards and lists: a problem shows as a "!" with the reason on hover and in a small note under the button.

import { languageOf, speakable, useOriginalSpeech } from "../speakWord";

export function PlayWord({ text, label, compact = false }: { text: string; label: string; compact?: boolean }) {
  const speech = useOriginalSpeech();
  const say = speakable(text);
  if (!languageOf(say)) return null;
  const state = speech.busy ? "busy" : speech.playing ? "playing" : speech.error ? "error" : "idle";
  return (
    <span className={"play-word-wrap" + (compact ? " compact" : "")}>
      <button
        type="button"
        className={"play-word " + state + (compact ? " compact" : "")}
        aria-label={`Hear ${label}`}
        title={speech.error ?? `Hear ${label}`}
        disabled={state === "busy"}
        onClick={(e) => {
          e.stopPropagation();
          void speech.play("one", say);
        }}
      >
        {state === "busy" ? "…" : state === "playing" ? "❚❚" : state === "error" ? "!" : "▶"}
      </button>
      {speech.error && (
        <span className="play-word-error" role="alert">
          {speech.error}
        </span>
      )}
    </span>
  );
}
