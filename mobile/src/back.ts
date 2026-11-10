import { useEffect, useRef } from "react";
import { exit, onBackButtonPress } from "@tauri-apps/api/app";

// --- the phone's Back button: each open layer (a sheet, a tab other than Read) is a step
// of browser history, so Back closes the top one instead of leaving the app.
const layers: { close: () => void }[] = [];
let ignorePops = 0;
window.addEventListener("popstate", () => {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  layers.pop()?.close();
});

// Android hands the Back button to the app: close the top layer, or leave from the Read screen.
void onBackButtonPress(() => {
  if (layers.length > 0) history.back();
  else void exit(0);
}).catch(() => undefined);

export function useBack(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const layer = { close: () => closeRef.current() };
    layers.push(layer);
    history.pushState({ layer: layers.length }, "");
    return () => {
      const i = layers.indexOf(layer);
      if (i < 0) return; // closed by Back itself
      layers.splice(i, 1);
      ignorePops++;
      history.back();
    };
  }, [active]);
}
