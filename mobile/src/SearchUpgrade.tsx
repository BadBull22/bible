// The Advanced search upgrade (offline): a one-time download that lets the search find verses by
// what is meant, not only by the words typed -- as the desktop app does. The work is in
// bible_core::meaning; this offers it, shows the download, and lets it be removed.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";

export interface SearchUpgrade {
  /** null until known */
  installed: boolean | null;
  size: number;
  /** the percentage downloaded, while downloading */
  downloading: number | null;
  error: string | null;
  install: () => Promise<void>;
  remove: () => Promise<void>;
}

const listeners = new Set<() => void>();

export function useSearchUpgrade(): SearchUpgrade {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [size, setSize] = useState(31);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    api
      .searchUpgradeStatus()
      .then((s) => {
        setInstalled(s.installed);
        setSize(s.size_mb);
      })
      .catch(() => setInstalled(false));
  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    return () => void listeners.delete(refresh);
  }, []);
  return {
    installed,
    size,
    downloading,
    error,
    install: async () => {
      setError(null);
      setDownloading(0);
      const un = await listen<number>("search-upgrade-progress", (e) => setDownloading(e.payload));
      try {
        await api.searchUpgradeInstall();
      } catch (e) {
        setError(String(e));
      } finally {
        un();
        setDownloading(null);
        listeners.forEach((f) => void f());
      }
    },
    remove: async () => {
      await api.searchUpgradeRemove();
      listeners.forEach((f) => void f());
    },
  };
}

function Progress({ pct }: { pct: number }) {
  return (
    <>
      <div className="bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="hint">Downloading… {pct}%</p>
    </>
  );
}

/** Under the search results while the upgrade isn't there. */
export function SearchUpgradeOffer({ upgrade }: { upgrade: SearchUpgrade }) {
  if (upgrade.installed !== false) return null;
  return (
    <div className="card upgrade-offer">
      <strong>Find more with the Advanced search upgrade</strong>
      <p className="hint">Finds verses by what you mean, not only by the words you type (“Daniel’s prayer delayed”). A one-time {upgrade.size} MB download; then it works offline.</p>
      {upgrade.downloading != null ? (
        <Progress pct={upgrade.downloading} />
      ) : (
        <div className="actions">
          <button className="primary" onClick={() => void upgrade.install()}>
            Get it ({upgrade.size} MB)
          </button>
        </div>
      )}
      {upgrade.error && <p className="hint status">{upgrade.error}</p>}
    </div>
  );
}

/** In More. */
export function SearchUpgradeSettings({ upgrade }: { upgrade: SearchUpgrade }) {
  return (
    <>
      <h2>Advanced search upgrade (offline)</h2>
      <p className="hint">
        Lets the search find verses by what you mean, not only by the words you type, as the computer app does. It stays on this phone and works without the internet; nothing you
        search for is sent anywhere.
      </p>
      {upgrade.installed ? (
        <>
          <p className="hint status">Installed.</p>
          <div className="actions">
            <button onClick={() => void upgrade.remove()}>Remove it ({upgrade.size} MB)</button>
          </div>
        </>
      ) : upgrade.downloading != null ? (
        <Progress pct={upgrade.downloading} />
      ) : (
        <div className="actions">
          <button className="primary" onClick={() => void upgrade.install()}>
            Get it ({upgrade.size} MB)
          </button>
        </div>
      )}
      {upgrade.error && <p className="hint status">{upgrade.error}</p>}
    </>
  );
}
