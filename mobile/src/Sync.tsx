// Keeping the phone's bookmarks, highlights, notes and reading plans the same as on the
// computers, through a folder they share (the same as the desktop app's Settings → Keep in
// step). The work is in bible_core::sync; this says when, and shows how it went.

import { useEffect, useState } from "react";
import { api, FoundComputer, phone, SyncReport, SyncStatus } from "./api";

const EVERY_MS = 2 * 60 * 1000;
const listeners = new Set<(r: SyncReport | null, error: string | null) => void>();
let busy: Promise<SyncReport | null> | null = null;
let lastAt = 0;

/** Syncs now (unless one is running). Null when no folder is chosen. */
export function syncNow(): Promise<SyncReport | null> {
  if (busy) return busy;
  busy = (async () => {
    try {
      const st = await api.syncStatus();
      if (!st.folder && !st.computer) return null;
      const r = await api.syncNow();
      listeners.forEach((f) => f(r, null));
      return r;
    } catch (e) {
      listeners.forEach((f) => f(null, String(e)));
      return null;
    } finally {
      lastAt = Date.now();
      busy = null;
    }
  })();
  return busy;
}

/** Syncs when the app opens, every two minutes while it is on screen, and when it comes back
 * to the front; `onChanged` runs when changes from another device arrived. */
export function useAutoSync(onChanged: () => void) {
  useEffect(() => {
    const hear = (r: SyncReport | null) => {
      if (r && r.received > 0) onChanged();
    };
    listeners.add(hear);
    // a moment after opening, once the databases are open
    const first = setTimeout(() => void syncNow(), 3000);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void syncNow();
    }, EVERY_MS);
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAt > 30 * 1000) void syncNow();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      listeners.delete(hear);
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SyncSettings({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .syncStatus()
      .then((s) => {
        setSt(s);
        setName(s.name);
        setError(s.error);
      })
      .catch(() => undefined);
    const hear = (r: SyncReport | null, e: string | null) => {
      setError(e);
      if (r) setSt((s) => (s ? { ...s, last: r, error: null } : s));
    };
    listeners.add(hear);
    return () => void listeners.delete(hear);
  }, []);

  const choose = async () => {
    setError(null);
    try {
      const f = await phone.pickFolder();
      if (!f.uri) return;
      setSt(await api.syncSetFolder(f.uri, f.name));
      setWorking(true);
      const r = await syncNow();
      if (r && r.received > 0) onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const now = async () => {
    setWorking(true);
    const r = await syncNow();
    if (r && r.received > 0) onChanged();
    setWorking(false);
  };

  const last = st?.last;
  return (
    <>
      <p className="hint">
        Keep your bookmarks, highlights, notes and reading plans the same here and in the desktop app. At home on your Wi-Fi, the phone and the computer talk straight to
        each other: no cloud, no account, nothing leaves the house. Away from home the phone keeps its changes and sends them when it is back.
      </p>
      <Computer st={st} onPaired={setSt} />
      {(st?.computer || st?.folder) && (
        <div className="actions">
          <button onClick={() => void now()} disabled={working}>
            {working ? "Keeping in step…" : "Sync now"}
          </button>
        </div>
      )}
      {last && (st?.computer || st?.folder) && (
        <p className="hint status">
          Last synced {ago(last.at)}
          {last.received + last.sent > 0 ? `: ${last.received} change${last.received === 1 ? "" : "s"} came in, ${last.sent} went out.` : ": nothing had changed."}
          {last.devices.length > 0 && ` With ${last.devices.map((d) => d.name).join(", ")}.`}
        </p>
      )}
      {last?.notes?.map((n, i) => (
        <p key={i} className="hint status">
          {n}
        </p>
      ))}
      {last?.conflicts.map((c, i) => (
        <p key={i} className="hint status">
          {c}
        </p>
      ))}
      <h3>Or through a shared folder</h3>
      <p className="hint">For when the phone can open the same folder as the computer (a folder a sync app keeps in step with your cloud storage).</p>
      {st?.folder ? (
        <>
          <p className="hint">
            Keeping in step through <strong>{st.folder}</strong>
          </p>
          <div className="actions">
            <button onClick={() => void choose()} disabled={working}>
              Another folder
            </button>
            <button onClick={() => void api.syncSetFolder(null, null).then(setSt)} disabled={working}>
              Stop using the folder
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button onClick={() => void choose()} disabled={working}>
            Choose a shared folder
          </button>
        </div>
      )}
      {error && <p className="hint status">{error}</p>}
      <h3>This phone's name, as your computer shows it</h3>
      <input
        className="sync-name"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name.trim() !== st?.name) void api.syncSetName(name.trim()).then(setSt);
        }}
      />
    </>
  );
}

/** The computer over the home Wi-Fi: found (or its address typed) and paired once with the
 * code the computer shows (desktop app: Settings → Keep in step → Pair a phone). */
function Computer({ st, onPaired }: { st: SyncStatus | null; onPaired: (s: SyncStatus) => void }) {
  const [found, setFound] = useState<FoundComputer[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const look = async () => {
    setError(null);
    setLooking(true);
    try {
      const f = await api.lanFind();
      setFound(f);
      if (f.length === 1) setAddress(f[0].address);
    } catch (e) {
      setError(String(e));
    } finally {
      setLooking(false);
    }
  };
  const pair = async () => {
    setError(null);
    setBusy(true);
    try {
      onPaired(await api.lanPair(address, code));
      setCode("");
      setFound(null);
      const r = await syncNow();
      if (r) setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (st?.computer)
    return (
      <>
        <p className="hint">
          Paired with <strong>{st.computer}</strong> over the home Wi-Fi.
        </p>
        <div className="actions">
          <button onClick={() => void api.lanForget().then(onPaired)}>Unpair</button>
        </div>
      </>
    );
  return (
    <>
      <h3>Your computer, over the home Wi-Fi</h3>
      <ol className="hint steps">
        <li>On the computer, in Bible Concordance: Settings → Keep in step → tick “Let my phone sync with this computer”, then press “Pair a phone”. It shows a code.</li>
        <li>With this phone on the same Wi-Fi, press “Find my computer” below.</li>
        <li>Type the code and press “Pair”.</li>
      </ol>
      <div className="actions">
        <button onClick={() => void look()} disabled={looking}>
          {looking ? "Looking…" : "Find my computer"}
        </button>
      </div>
      {found && found.length === 0 && (
        <p className="hint status">No computer answered. Check that the phone is on the home Wi-Fi and the computer allows phones (and that Windows allowed the app). Or type the computer's address, shown in its Settings:</p>
      )}
      {found && found.length > 1 && (
        <div className="actions">
          {found.map((c) => (
            <button key={c.id} className={address === c.address ? "on" : undefined} onClick={() => setAddress(c.address)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {found && found.length === 1 && <p className="hint">Found: {found[0].name}</p>}
      {found && (
        <div className="pair-form">
          {found.length === 0 && <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20" inputMode="decimal" aria-label="The computer's address" />}
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" inputMode="numeric" maxLength={7} aria-label="The code the computer shows" />
          <button onClick={() => void pair()} disabled={busy || !address.trim() || code.replace(/\D/g, "").length !== 6}>
            {busy ? "Pairing…" : "Pair"}
          </button>
        </div>
      )}
      {error && <p className="hint status">{error}</p>}
    </>
  );
}

