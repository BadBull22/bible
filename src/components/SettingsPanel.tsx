import { useEffect, useState } from "react";
import { api } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
}

type Status = "idle" | "saving" | "saved" | "removed" | "error";

export function SettingsPanel({ onClose }: Props) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (s.api_bible_key) {
          setHasKey(true);
          setKey(s.api_bible_key);
        }
      })
      .catch((e) => {
        setErrorMsg(String(e));
        setStatus("error");
      });
  }, []);

  async function save() {
    setStatus("saving");
    try {
      await api.saveApiBibleKey(key);
      const stored = key.trim().length > 0;
      setHasKey(stored);
      setStatus(stored ? "saved" : "removed");
    } catch (e) {
      setErrorMsg(String(e));
      setStatus("error");
    }
  }

  async function clearKey() {
    setKey("");
    try {
      await api.saveApiBibleKey("");
      setHasKey(false);
      setStatus("removed");
    } catch (e) {
      setErrorMsg(String(e));
      setStatus("error");
    }
  }

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Settings</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <h4 className="section-label" style={{ marginTop: 0 }}>
        Live NIV / NKJV comparison
      </h4>
      <p className="search-hint" style={{ marginTop: 0 }}>
        This app works fully offline by default with the bundled public-domain texts. If you have your own{" "}
        <strong>api.bible</strong> API key, add it here to also fetch <strong>NIV</strong> and <strong>NKJV</strong> live
        for comparison — those translations are copyrighted, so they're fetched on demand rather than stored offline,
        and require an internet connection.
      </p>
      <form
        className="search-controls"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="key-field">
          <input
            type={reveal ? "text" : "password"}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            placeholder="Paste your api.bible key"
            aria-label="api.bible key"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="outline-btn" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
        <div className="btn-row">
          <button type="submit" className="pill-btn" disabled={status === "saving" || !key.trim()}>
            {status === "saving" ? "Saving…" : "Save key"}
          </button>
          {hasKey && (
            <button type="button" className="outline-btn" onClick={clearKey}>
              Remove
            </button>
          )}
        </div>
      </form>
      {status === "saved" && <p className="status-ok">Saved. NIV and NKJV will now appear in Compare.</p>}
      {status === "removed" && <p className="status-ok">Key removed. Compare will show bundled translations only.</p>}
      {status === "error" && <p className="status-error">Couldn't save: {errorMsg}</p>}
      <p className="search-hint">
        Your key is stored only on this computer, in the app's local settings file — never bundled into the app or sent
        anywhere except api.bible.
      </p>

      <h4 className="section-label">Keyboard shortcuts</h4>
      <ul className="shortcut-list">
        <li>
          <kbd>←</kbd> <kbd>→</kbd> previous / next chapter
        </li>
        <li>
          <kbd>Ctrl</kbd> <kbd>K</kbd> focus the search box
        </li>
        <li>
          <kbd>Esc</kbd> close the side panel
        </li>
      </ul>
      <p className="search-hint">
        Tip: type a reference such as <em>John 3:16</em>, <em>gen 1</em> or <em>1 sam 17</em> into the search box to go
        straight there.
      </p>
    </aside>
  );
}
