import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../api";
import { CloseIcon } from "./icons";

const BUNDLED_SOURCES: { name: string; licence: string }[] = [
  { name: "Berean Standard Bible (BSB)", licence: "Public domain" },
  { name: "King James Version (1769)", licence: "Public domain" },
  { name: "American Standard Version (1901)", licence: "Public domain" },
  { name: "Young's Literal Translation", licence: "Public domain" },
  { name: "World English Bible (eBible.org)", licence: "Public domain" },
  { name: "Westminster Leningrad Codex (Hebrew OT)", licence: "Public domain" },
  { name: "Textus Receptus, Scrivener 1894 (Greek NT)", licence: "Public domain" },
  { name: "1 Enoch, Charles & Oesterley 1917 (Project Gutenberg)", licence: "Public domain" },
  { name: "Strong's Hebrew & Greek Dictionaries (openscriptures)", licence: "CC BY-SA" },
  { name: "Cross references (OpenBible.info)", licence: "CC BY 4.0" },
  { name: "Matthew Henry, Jamieson-Fausset-Brown, Adam Clarke, John Gill, Calvin, Keil & Delitzsch (via Free Use Bible API, AO Lab)", licence: "Public domain" },
  { name: "Tyndale Open Study Notes (via Free Use Bible API)", licence: "CC BY-SA 4.0" },
  { name: "Theographic Bible Metadata — people, places, events", licence: "CC BY-SA 4.0" },
  { name: "all-MiniLM-L6-v2 embedding model (topic search)", licence: "Apache 2.0" },
];

interface Props {
  onClose: () => void;
}

type Status = "idle" | "saving" | "saved" | "removed" | "error";

interface KeyFieldProps {
  label: string;
  placeholder: string;
  value: string;
  hasKey: boolean;
  onChange: (v: string) => void;
  onSave: () => Promise<void>;
  onRemove: () => Promise<void>;
}

/** One provider key: masked input with Show toggle, Save and Remove, and a status line. */
function KeyField({ label, placeholder, value, hasKey, onChange, onSave, onRemove }: KeyFieldProps) {
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function run(action: () => Promise<void>, ok: Status) {
    setStatus("saving");
    try {
      await action();
      setStatus(ok);
    } catch (e) {
      setErrorMsg(String(e));
      setStatus("error");
    }
  }

  return (
    <form
      className="search-controls"
      onSubmit={(e) => {
        e.preventDefault();
        run(onSave, value.trim() ? "saved" : "removed");
      }}
    >
      <div className="key-field">
        <input
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (status !== "idle") setStatus("idle");
          }}
          placeholder={placeholder}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="outline-btn" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
          {reveal ? "Hide" : "Show"}
        </button>
      </div>
      <div className="btn-row">
        <button type="submit" className="pill-btn" disabled={status === "saving" || !value.trim()}>
          {status === "saving" ? "Saving…" : "Save key"}
        </button>
        {hasKey && (
          <button type="button" className="outline-btn" onClick={() => run(onRemove, "removed")}>
            Remove
          </button>
        )}
      </div>
      {status === "saved" && <p className="status-ok">Saved. {label} will now appear in Compare.</p>}
      {status === "removed" && <p className="status-ok">Key removed.</p>}
      {status === "error" && <p className="status-error">Couldn't save: {errorMsg}</p>}
    </form>
  );
}

export function SettingsPanel({ onClose }: Props) {
  const [apiBibleKey, setApiBibleKey] = useState("");
  const [hasApiBible, setHasApiBible] = useState(false);
  const [esvKey, setEsvKey] = useState("");
  const [hasEsv, setHasEsv] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (s.api_bible_key) {
          setHasApiBible(true);
          setApiBibleKey(s.api_bible_key);
        }
        if (s.esv_api_key) {
          setHasEsv(true);
          setEsvKey(s.esv_api_key);
        }
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Settings</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      {loadError && <p className="status-error">{loadError}</p>}
      <p className="search-hint" style={{ marginTop: 0 }}>
        Everything in this app works offline: the bundled public-domain translations, Strong's dictionaries, cross
        references, commentaries and people/places data. The options below add <strong>online-only</strong> copyrighted
        translations to the Compare view. Each needs your own key from that provider, an internet connection, and is
        fetched on demand rather than stored.
      </p>

      <h4 className="section-label">
        NIV &amp; NKJV <span className="xref-tag">online</span>
      </h4>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Uses your <strong>api.bible</strong> key (scripture.api.bible). ESV is not offered on that platform.
      </p>
      <KeyField
        label="NIV / NKJV (api.bible)"
        placeholder="Paste your api.bible key"
        value={apiBibleKey}
        hasKey={hasApiBible}
        onChange={setApiBibleKey}
        onSave={async () => {
          await api.saveApiBibleKey(apiBibleKey);
          setHasApiBible(!!apiBibleKey.trim());
        }}
        onRemove={async () => {
          await api.saveApiBibleKey("");
          setApiBibleKey("");
          setHasApiBible(false);
        }}
      />

      <h4 className="section-label">
        ESV <span className="xref-tag">online</span>
      </h4>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Uses a free Crossway key from <strong>api.esv.org</strong> (non-commercial use; Crossway's terms apply, and the
        text is shown with its required "(ESV)" attribution).
      </p>
      <KeyField
        label="ESV (api.esv.org)"
        placeholder="Paste your ESV API key"
        value={esvKey}
        hasKey={hasEsv}
        onChange={setEsvKey}
        onSave={async () => {
          await api.saveEsvApiKey(esvKey);
          setHasEsv(!!esvKey.trim());
        }}
        onRemove={async () => {
          await api.saveEsvApiKey("");
          setEsvKey("");
          setHasEsv(false);
        }}
      />
      <p className="search-hint">
        Keys are stored only on this computer, in the app's local settings file — never bundled into the app or sent
        anywhere except the provider they belong to.
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

      <h4 className="section-label">About</h4>
      <div className="about">
        <p>
          <strong>Bible Concordance</strong>
          {version && <span className="muted"> · version {version}</span>}
          <br />
          Made by <strong>Erich P. Tonsing</strong> as a personal Bible study tool.
        </p>
        <p>
          This app is <strong>free to use by anyone</strong>. You may install it, use it, copy it and share it with
          others at no cost, for personal, educational, church or ministry use. <strong>It must never be sold, licensed
          for a fee, or charged for in any form</strong>, and it may not be used to sell the texts it contains.
        </p>
        <p>
          Every text and dataset bundled in the app is public domain or released under an open licence that permits
          redistribution, and is used with that permission. Copyrighted modern translations (NIV, NKJV, ESV) are not
          bundled: they can only be viewed live over the internet with your own key, and remain the property of their
          publishers.
        </p>
        <p>
          Provided "as is", without warranty of any kind. Scripture text is reproduced faithfully from its sources;
          commentaries and study data reflect the views of their original authors, not necessarily the app's author.
        </p>
        <details className="apparatus-key">
          <summary>Bundled sources &amp; licences</summary>
          <ul className="credits">
            {BUNDLED_SOURCES.map((s) => (
              <li key={s.name}>
                <span>{s.name}</span>
                <span className="votes">{s.licence}</span>
              </li>
            ))}
          </ul>
          <p className="search-hint" style={{ marginTop: "0.5rem" }}>
            Online only, with your own key: NIV and NKJV via api.bible; ESV via api.esv.org (© Crossway, non-commercial
            use). Built with Tauri, Rust, React, SQLite, candle and Cytoscape (MIT / Apache 2.0). Full details in
            NOTICE.md alongside the app's source.
          </p>
        </details>
      </div>
    </aside>
  );
}
