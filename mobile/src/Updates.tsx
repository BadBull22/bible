import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { api, phone, UpdateOffer } from "./api";
import { todayIso } from "./plans";

// A newer version of the app (since 0.3.1). The app is not on the Play Store, so it looks
// for one itself: at most once a day, when it is opened, and only while the reader leaves
// this on (More > Updates). Installing is always the reader's choice, and Android asks too.

const CHECKED_KEY = "pocket:update-checked";
const onPhone = /Android/i.test(navigator.userAgent);

const megabytes = (bytes: number) => (bytes > 0 ? `${Math.round(bytes / 1048576)} MB` : "");

export interface Updates {
  /** this copy's version */
  current: string;
  /** the newer version on offer, if one was found */
  offer: UpdateOffer | null;
  /** hidden for now ("Later") */
  hidden: boolean;
  /** null, or the percentage downloaded */
  downloading: number | null;
  /** something to tell the reader (a failure, or what to do next) */
  message: string | null;
  checking: boolean;
  /** looks now, whatever the day; resolves to what it found */
  check: () => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
}

export function useUpdates(enabled: boolean): Updates {
  const [current, setCurrent] = useState("");
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [hidden, setHidden] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    getVersion()
      .then(setCurrent)
      .catch(() => undefined);
    const un = listen<number>("update-progress", (e) => setDownloading((d) => (d == null ? d : e.payload)));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // once a day, quietly: no connection or no answer is not something to trouble the reader with
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(CHECKED_KEY);
    } catch {
      /* then it looks again */
    }
    if (!enabled || !onPhone || last === todayIso()) return;
    api
      .updateCheck()
      .then((found) => {
        try {
          localStorage.setItem(CHECKED_KEY, todayIso());
        } catch {
          /* a convenience only */
        }
        setOffer(found);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check() {
    setChecking(true);
    setMessage(null);
    try {
      const found = await api.updateCheck();
      setOffer(found);
      setHidden(false);
      setMessage(found ? null : "You have the newest version.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setChecking(false);
    }
  }

  async function install() {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    setDownloading(0);
    try {
      const path = await api.updateDownload();
      setDownloading(null);
      const r = await phone.installUpdate(path);
      if (r.allow) setMessage("Android needs your permission first: switch on “Allow from this source” for Bible Concordance, come back, and tap Install again.");
    } catch (e) {
      setDownloading(null);
      setMessage(String(e));
    } finally {
      busy.current = false;
    }
  }

  return { current, offer, hidden, downloading, message, checking, check, install, later: () => setHidden(true) };
}

/** Shown at the top of the app while a newer version is on offer. */
export function UpdateBanner({ updates }: { updates: Updates }) {
  const { offer, hidden, downloading, message } = updates;
  if (!offer || hidden) return null;
  return (
    <aside className="update" role="status">
      <p>
        <strong>Version {offer.version} is ready.</strong> {offer.notes}
      </p>
      {message && <p className="update-message">{message}</p>}
      {downloading != null ? (
        <div className="update-progress">
          <div className="bar" aria-hidden>
            <i style={{ width: `${downloading}%` }} />
          </div>
          <span>Downloading… {downloading}%</span>
        </div>
      ) : (
        <div className="actions">
          <button onClick={updates.later}>Later</button>
          <button className="primary" onClick={() => void updates.install()}>
            Install{megabytes(offer.size) ? ` (${megabytes(offer.size)})` : ""}
          </button>
        </div>
      )}
      <p className="update-note">Your bookmarks, highlights and notes are kept. Android will ask you to confirm.</p>
    </aside>
  );
}

/** More > Updates: this copy's version, the daily check's switch, and "Check now". */
export function UpdateSettings({ updates, enabled, onEnabled }: { updates: Updates; enabled: boolean; onEnabled: (on: boolean) => void }) {
  return (
    <>
      <h2>Updates</h2>
      <p className="hint">
        This is version {updates.current || "…"}.{" "}
        {onPhone ? "The app is not on the Play Store, so it looks for a newer version itself and offers it to you. Nothing about you or your phone is sent." : "Updates are offered on a phone."}
      </p>
      {onPhone && (
        <>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} /> Look for a new version once a day
          </label>
          <div className="actions">
            <button disabled={updates.checking} onClick={() => void updates.check()}>
              {updates.checking ? "Checking…" : "Check now"}
            </button>
          </div>
          {updates.message && (!updates.offer || updates.hidden) && <p className="hint status">{updates.message}</p>}
          {updates.offer && updates.hidden && (
            <p className="hint status">
              Version {updates.offer.version} is ready. <button className="link" onClick={() => void updates.check()}>Show it</button>
            </p>
          )}
        </>
      )}
    </>
  );
}
