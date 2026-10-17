import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, LanStatus, SyncReport, SyncStatus } from "../api";
import { onSynced, syncNow } from "../syncFolder";

/** "5 minutes ago", "yesterday at 18:20". */
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(ms);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (s < 20 * 3600 && d.getDate() === new Date().getDate()) return `today at ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${time}`;
}

/** Settings: keep notes, highlights, bookmarks, reading plans and sermons the same on this
 * computer, other computers and the phone, through a folder they already share. */
export function SyncSettings() {
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .syncStatus()
      .then((s) => {
        setSt(s);
        setName(s.name);
        setError(s.error);
      })
      .catch((e) => setError(String(e)));
    return onSynced((r, e) => {
      setError(e);
      if (r) setSt((s) => (s ? { ...s, last: r, error: null } : s));
    });
  }, []);

  const choose = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const folder = await open({ directory: true, title: "The folder to keep in step through (OneDrive, Google Drive, Dropbox, Synology…)" });
    if (typeof folder !== "string") return;
    setBusy(true);
    try {
      setSt(await api.syncSetFolder(folder));
      await syncNow();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => setSt(await api.syncSetFolder(null));
  const now = async () => {
    setBusy(true);
    await syncNow();
    setBusy(false);
  };

  const last: SyncReport | null = st?.last ?? null;
  return (
    <div className="sync-settings">
      <PhoneOverWifi />
      <h5 className="sync-sub">Your other computers, through a shared folder</h5>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Keep your notes, highlights, bookmarks, reading plans, sermons, sermon templates and basket the same on your computers.
        Choose a folder they all share — in OneDrive, Google Drive, Dropbox or on your Synology drive — and choose the same folder
        on the other computers. Each one keeps its own file there; there is no account, and nothing goes anywhere else. The newest
        change wins; a deletion stays deleted.
      </p>
      {st?.folder ? (
        <>
          <p className="sync-folder">
            <span className="muted">Keeping in step through</span> <strong>{st.folder}</strong>
          </p>
          <div className="note-editor-actions">
            <button className="pill-btn" onClick={() => void now()} disabled={busy}>
              {busy ? "Keeping in step…" : "Sync now"}
            </button>
            <button className="outline-btn" onClick={() => void choose()} disabled={busy}>
              Another folder…
            </button>
            <button className="text-btn" onClick={() => void stop()} disabled={busy}>
              Stop keeping in step
            </button>
          </div>
          {last && (
            <div className="sync-last">
              <p>
                Last synced {ago(last.at)}
                {last.received + last.sent > 0
                  ? ` — ${last.received} change${last.received === 1 ? "" : "s"} came in, ${last.sent} went out`
                  : " — nothing had changed"}
                {last.media ? `, ${last.media} sermon picture${last.media === 1 ? "" : "s"} or video${last.media === 1 ? "" : "s"} copied` : ""}.
              </p>
              {last.devices.length > 0 ? (
                <ul className="sync-devices">
                  {last.devices.map((d) => (
                    <li key={d.name + d.written}>
                      {d.kind === "phone" ? "📱" : "💻"} {d.name} <span className="muted">— last synced {ago(d.written)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No other device has synced with this folder yet. Choose the same folder on them.</p>
              )}
              {last.conflicts.map((c, i) => (
                <p key={i} className="sync-conflict">
                  {c}
                </p>
              ))}
              {last.skipped.length > 0 && <p className="muted">Not read this time (still being copied, or from a newer version of the app): {last.skipped.join(", ")}</p>}
            </div>
          )}
        </>
      ) : (
        <button className="pill-btn" onClick={() => void choose()} disabled={busy}>
          Choose the shared folder…
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <label className="sync-name">
        <span className="muted">This computer's name, as your other devices show it</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== st?.name) void api.syncSetName(name.trim()).then(setSt);
          }}
          maxLength={40}
        />
      </label>
      <p className="search-hint">
        Downloaded Bibles, books and modules are not copied between devices (they can be large): add them on each one. The phone
        keeps notes, highlights, bookmarks and reading plans in step; sermons stay on the computers.
      </p>
    </div>
  );
}

/** The phone, straight to this computer over the home Wi-Fi: turned on here, paired once
 * with a code typed into the phone. */
function PhoneOverWifi() {
  const [lan, setLan] = useState<LanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api
      .lanStatus()
      .then(setLan)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
    const offs = [listen("lan-paired", () => void load()), listen("sync-received", () => void load())];
    // the code's ten minutes, and "last synced" times, kept current
    const t = setInterval(() => void load(), 15000);
    return () => {
      clearInterval(t);
      offs.forEach((p) => void p.then((u) => u()));
    };
  }, []);
  const run = (p: Promise<LanStatus>) => {
    setError(null);
    p.then(setLan).catch((e) => setError(String(e)));
  };
  if (!lan) return null;
  return (
    <div className="sync-phone">
      <h5 className="sync-sub">Your phone, over the home Wi-Fi</h5>
      <p className="search-hint" style={{ marginTop: 0 }}>
        The phone app keeps its bookmarks, highlights, notes and reading plans in step with this computer whenever both are on your
        home Wi-Fi and this app is open here. They talk straight to each other: no cloud, no account, nothing leaves the house. Away
        from home the phone keeps its changes and sends them when it is back.
      </p>
      <label className="sb-inline">
        <input type="checkbox" checked={lan.enabled} onChange={(e) => run(api.lanEnable(e.target.checked))} />
        <span>Let my phone sync with this computer over the home Wi-Fi</span>
      </label>
      {lan.enabled && (
        <>
          {lan.running ? (
            <p className="muted">
              Listening on the home network{lan.address ? ` at ${lan.address}` : ""}. If Windows asks, allow Bible Concordance on <em>private</em> networks.
            </p>
          ) : (
            <p className="error">Not listening{lan.error ? `: ${lan.error}` : "."}</p>
          )}
          {lan.code ? (
            <div className="sync-code">
              <span className="muted">On the phone: More → Keep in step → Find my computer, then type</span>
              <strong>{lan.code.slice(0, 3)} {lan.code.slice(3)}</strong>
              <span className="muted">The code works for ten minutes.</span>
            </div>
          ) : (
            <div className="note-editor-actions">
              <button className="pill-btn" onClick={() => run(api.lanPairCode())} disabled={!lan.running}>
                Pair a phone…
              </button>
            </div>
          )}
          {lan.phones.length > 0 && (
            <ul className="sync-devices">
              {lan.phones.map((p) => (
                <li key={p.id}>
                  📱 {p.name} <span className="muted">— {p.last ? `last synced ${ago(p.last)}` : "paired, not synced yet"}</span>{" "}
                  <button className="link-btn" onClick={() => run(api.lanForget(p.id))} title="It can't sync with this computer until it is paired again">
                    Unpair
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

