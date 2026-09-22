import { useEffect, useRef } from "react";
import "./SplashScreen.css";

const VISIBLE_MS = 3000;

interface Props {
  /** John 3:16 as it reads in the bundled text, or null if it couldn't be read. The verse
   * is deliberately never hardcoded here: a second copy in source could drift from the
   * bundled Bible, so on failure the reference is shown alone rather than a stale quote. */
  verse: string | null;
  onDone: () => void;
}

/** Shown when the close button is pressed, for three seconds, before the process exits.
 * Mirrors the launch splash's black ground, but deliberately does NOT reuse its fade-OUT:
 * `.splash-screen` is an overlay on top of the still-mounted reading view, and fading its
 * opacity to 0 makes it transparent rather than hiding it -- so a fade-out here briefly
 * reveals the normal app underneath, right before the window closes, reading as a visible
 * flicker/stutter rather than a clean exit. Simpler and correct: stay fully opaque for the
 * whole visible duration, then call onDone immediately with no transition to wait out --
 * whatever the window's own close latency is, the verse stays the last thing on screen
 * throughout it, instead of a flash of the reader view first. */
export function ClosingSplash({ verse, onDone }: Props) {
  // Read through a ref so a re-render in App (a state update landing mid-farewell) can't
  // reset the timer and leave the app hanging on a splash that never finishes.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="splash-screen closing-splash" role="status" aria-live="polite">
      <div className="closing-splash-inner">
        {verse && <blockquote className="closing-verse">{verse}</blockquote>}
        <p className="closing-ref">John 3:16</p>
      </div>
    </div>
  );
}
