import { useEffect, useState } from "react";
import { api } from "../api";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsPanel({ onClose, onSaved }: Props) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    api.getSettings().then((s) => {
      if (s.api_bible_key) {
        setHasKey(true);
        setKey(s.api_bible_key);
      }
    });
  }, []);

  async function save() {
    setStatus("saving");
    try {
      await api.saveApiBibleKey(key);
      setStatus("saved");
      setHasKey(!!key.trim());
      onSaved();
    } catch (e) {
      setErrorMsg(String(e));
      setStatus("error");
    }
  }

  async function clearKey() {
    setKey("");
    await api.saveApiBibleKey("");
    setHasKey(false);
    setStatus("idle");
    onSaved();
  }

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Settings</h3>
        <button onClick={onClose}>✕</button>
      </div>
      <p className="search-hint" style={{ marginTop: 0 }}>
        This app works fully offline by default with the bundled public-domain texts. If you have your own{" "}
        <strong>api.bible</strong> API key, add it here to also fetch <strong>NIV</strong> and <strong>NKJV</strong> live
        for comparison — those translations are copyrighted, so they're fetched on demand rather than stored offline,
        and require an internet connection.
      </p>
      <div className="search-controls">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your api.bible key"
        />
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button className="pill-btn" onClick={save} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save key"}
          </button>
          {hasKey && (
            <button onClick={clearKey} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
              Remove
            </button>
          )}
        </div>
      </div>
      {status === "saved" && <p style={{ color: "#3a7d44" }}>Saved. NIV/NKJV will now appear in Compare.</p>}
      {status === "error" && <p style={{ color: "#b23b3b" }}>Couldn't save: {errorMsg}</p>}
      <p className="search-hint">
        Your key is stored only on this computer, in the app's local settings file — never bundled into the app or sent
        anywhere except api.bible.
      </p>
    </aside>
  );
}
