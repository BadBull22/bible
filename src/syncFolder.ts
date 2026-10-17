// Keeping in step with the reader's other devices through a shared folder: a sync when the
// app starts, every two minutes while it is open, and when its window comes back to the
// front. The work is in sync.rs; this only says when.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, SyncReport } from "./api";

const EVERY_MS = 2 * 60 * 1000;
/** at most this often when the window keeps coming to the front */
const AT_MOST_MS = 30 * 1000;

let busy: Promise<SyncReport | null> | null = null;
let lastAt = 0;
const listeners = new Set<(r: SyncReport | null, error: string | null) => void>();

/** Hears about every sync (its report, or why it failed). Returns the way to stop. */
export function onSynced(f: (r: SyncReport | null, error: string | null) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** Syncs now (unless one is running: that one's result). Null when no folder is set. */
export function syncNow(): Promise<SyncReport | null> {
  if (busy) return busy;
  busy = (async () => {
    try {
      const st = await api.syncStatus();
      if (!st.folder) return null;
      const r = await api.syncNow();
      lastAt = Date.now();
      listeners.forEach((f) => f(r, null));
      return r;
    } catch (e) {
      lastAt = Date.now();
      listeners.forEach((f) => f(null, String(e)));
      return null;
    } finally {
      busy = null;
    }
  })();
  return busy;
}

/** Starts the automatic syncs; `onChanged` runs when another device's changes arrived. */
export function startAutoSync(onChanged: () => void): () => void {
  const off = onSynced((r) => {
    if (r && r.received > 0) onChanged();
  });
  // a phone synced with this computer over the home Wi-Fi and brought changes
  const offPhone = listen("sync-received", () => onChanged());
  void syncNow();
  const timer = setInterval(() => void syncNow(), EVERY_MS);
  let unfocus: (() => void) | undefined;
  getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (focused && Date.now() - lastAt > AT_MOST_MS) void syncNow();
    })
    .then((u) => (unfocus = u))
    .catch(() => undefined);
  return () => {
    off();
    void offPhone.then((u) => u());
    clearInterval(timer);
    unfocus?.();
  };
}
