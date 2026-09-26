import { requestListen } from "../readAloud";
import { SpeakerIcon } from "./icons";

/** Small "Listen" button: reads `text` aloud with the app's reader (the floating player
 * appears). `text` may be a function so it's only built when clicked. */
export function ListenButton({ text, title = "Read this aloud" }: { text: string | (() => string); title?: string }) {
  return (
    <button
      className="text-btn answer-copy listen-btn"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        const t = typeof text === "function" ? text() : text;
        if (t.trim()) requestListen(t);
      }}
    >
      <SpeakerIcon size={13} /> Listen
    </button>
  );
}
