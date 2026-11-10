import { useEffect, useRef } from "react";
import { exit, onBackButtonPress } from "@tauri-apps/api/app";

// --- the phone's Back button: each open layer (a sheet, a tab other than Read) is a step
// of browser history, so Back closes the top one instead of leaving the app.
//
// History steps are done one at a time. A layer that closes by itself takes a step back, which the browser carries out a moment later; a layer opened
// in the same instant (following a link from a story to the Bible closes three layers and opens one) is added only after those steps are done, or the
// steps back would run after it and undo the wrong entries.
const layers: { close: () => void }[] = [];
let ignorePops = 0;
const waiting: (() => void)[] = [];
let settleTimer: number | undefined;

/** Adds the layers that waited for the steps back to finish (when none is left under way). */
function settle() {
  if (ignorePops > 0) return;
  window.clearTimeout(settleTimer);
  while (waiting.length > 0) waiting.shift()?.();
}

window.addEventListener("popstate", () => {
  if (ignorePops > 0) {
    ignorePops--;
    settle();
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
    let cancelled = false;
    let added = false;
    const add = () => {
      if (cancelled) return;
      added = true;
      layers.push(layer);
      history.pushState({ layer: layers.length }, "");
    };
    if (ignorePops > 0) {
      waiting.push(add);
      // if a step back never reports (nothing to go back to), do not wait for ever
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        ignorePops = 0;
        settle();
      }, 500);
    } else add();
    return () => {
      cancelled = true;
      if (!added) return;
      const i = layers.indexOf(layer);
      if (i < 0) return; // closed by Back itself
      layers.splice(i, 1);
      ignorePops++;
      history.back();
    };
  }, [active]);
}

/** Takes one step back, as the phone's Back button does, when a layer is open (true); false when there is none. Used by buttons that mean "Back". */
export function stepBack(): boolean {
  if (layers.length === 0) return false;
  history.back();
  return true;
}
