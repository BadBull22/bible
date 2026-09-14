import { useEffect, useRef, useState } from "react";
import "./SplashScreen.css";

const VISIBLE_MS = 3000;
const FADE_MS = 400;

interface Props {
  /** John 3:16 as it reads in the bundled text, or null if it couldn't be read. The verse
   * is deliberately never hardcoded here: a second copy in source could drift from the
   * bundled Bible, so on failure the reference is shown alone rather than a stale quote. */
  verse: string | null;
  onDone: () => void;
}

/** Shown when the close button is pressed, for three seconds, before the process exits.
 * Mirrors the launch splash's black ground and edge-fade so leaving matches arriving. */
export function ClosingSplash({ verse, onDone }: Props) {
  const [fading, setFading] = useState(false);
  // Read through a ref so a re-render in App (a state update landing mid-farewell) can't
  // reset the timers and leave the app hanging on a splash that never finishes.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), VISIBLE_MS);
    const doneTimer = setTimeout(() => onDoneRef.current(), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div
      className={`splash-screen closing-splash${fading ? " splash-screen--fading" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="closing-splash-inner">
        {verse && <blockquote className="closing-verse">{verse}</blockquote>}
        <p className="closing-ref">John 3:16</p>
      </div>
    </div>
  );
}
