import { useState } from "react";
import { copyText } from "../clipboard";
import { CopyIcon } from "./icons";

/** Small "Copy" button; shows "Copied" briefly. `text` may be a function so costly text
 * (e.g. a fetched verse) is only built when the button is actually clicked. */
export function CopyButton({ text, title = "Copy", className = "" }: { text: string | (() => Promise<string> | string); title?: string; className?: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  return (
    <button
      className={"text-btn answer-copy " + className}
      title={title}
      onClick={async (e) => {
        e.stopPropagation();
        const t = typeof text === "function" ? await text() : text;
        setDone(await copyText(t));
        window.setTimeout(() => setDone(null), 1500);
      }}
    >
      <CopyIcon size={13} /> {done === null ? "Copy" : done ? "Copied" : "Couldn't copy"}
    </button>
  );
}
