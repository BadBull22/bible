import { useEffect } from "react";
import { WhatsNewEntry } from "../whatsNew";
import { CloseIcon } from "./icons";

interface Props {
  entry: WhatsNewEntry;
  onClose: () => void;
}

/** The changes in this version, shown once after an update (the same look as the Getting started window). */
export function WhatsNewWindow({ entry, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title">
      <div className="welcome-window">
        <div className="welcome-head">
          <h2 id="whatsnew-title">What's new in version {entry.version}</h2>
          <button className="icon-btn welcome-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <ul className="whatsnew-list">
          {entry.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="welcome-foot">
          <span className="muted">You can read this again in Settings &#9656; About.</span>
          <button className="pill-btn" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
