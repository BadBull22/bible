import { useEffect, useState } from "react";
import "./SplashScreen.css";

const VISIBLE_MS = 2600;
const FADE_MS = 400;

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), VISIBLE_MS);
    const doneTimer = setTimeout(onDone, VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div className={`splash-screen${fading ? " splash-screen--fading" : ""}`}>
      <img className="splash-image" src="/splashscreen.jpg" alt="EPT — Bible Research Study" />
    </div>
  );
}
