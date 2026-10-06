import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, HIGHLIGHT_COLOR_NAMES, HIGHLIGHT_COLORS, HighlightColor } from "../api";
import { CloseIcon } from "./icons";
import { DEFAULT_PREFS, ReadingPrefs } from "../readingPrefs";
import { NATURAL_VOICES, ReadAloudPrefs } from "../readAloud";
import { invoke } from "@tauri-apps/api/core";
import { copyText } from "../clipboard";
import { VoiceDownload } from "./VoiceDownload";
import { UpdateSettings } from "./Updates";

/** Plays a short sample in the chosen voice ("Preparing…" the first time, while the
 * voice starts). */
function TryVoice({ prefs }: { prefs: ReadAloudPrefs }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <button
      className="text-btn"
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          const buf = await invoke<ArrayBuffer>("voice_speak", {
            text: "The Lord is my shepherd; I shall not want.",
            voice: prefs.voice,
            speed: prefs.speed,
          });
          const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
          const a = new Audio(url);
          a.onended = () => URL.revokeObjectURL(url);
          await a.play();
          setState("idle");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "busy" ? "Preparing…" : state === "error" ? "The natural voice isn't available" : "▶ Try this voice"}
    </button>
  );
}

const BUNDLED_SOURCES: { name: string; licence: string }[] = [
  { name: "Berean Standard Bible (BSB)", licence: "Public domain" },
  { name: "King James Version (1769)", licence: "Public domain" },
  { name: "American Standard Version (1901)", licence: "Public domain" },
  { name: "Young's Literal Translation", licence: "Public domain" },
  { name: "World English Bible (eBible.org)", licence: "Public domain" },
  { name: "Westminster Leningrad Codex (Hebrew OT)", licence: "Public domain" },
  { name: "Textus Receptus, Scrivener 1894 (Greek NT)", licence: "Public domain" },
  { name: "Tyndale House Greek New Testament, 2017 (THGNT, Greek NT) — Tyndale House, Cambridge", licence: "CC BY-SA 4.0" },
  { name: "Interlinear word data with grammar: STEPBible TAHOT & TAGNT, Tyndale House, Cambridge (STEPBible.org)", licence: "CC BY 4.0" },
  { name: "Grammar-code explanations: STEPBible TEHMC & TEGMC (STEPBible.org)", licence: "CC BY 4.0" },
  { name: "Easton's Bible Dictionary (1897), Smith's Bible Dictionary (1884), Nave's Topical Bible (1896), Torrey's New Topical Textbook (1897) — via CrossWire SWORD modules", licence: "Public domain" },
  { name: "1 Enoch, Charles & Oesterley 1917 (Project Gutenberg)", licence: "Public domain" },
  { name: "Strong's Hebrew & Greek Dictionaries (openscriptures)", licence: "CC BY-SA" },
  { name: "Cross references (OpenBible.info)", licence: "CC BY 4.0" },
  { name: "Matthew Henry, Jamieson-Fausset-Brown, Adam Clarke, John Gill, Calvin, Keil & Delitzsch (via Free Use Bible API, AO Lab)", licence: "Public domain" },
  { name: "Tyndale Open Study Notes (via Free Use Bible API)", licence: "CC BY-SA 4.0" },
  { name: "John Wesley's Explanatory Notes (1754–65) and Scofield Reference Notes (1917) — via CrossWire SWORD modules", licence: "Public domain" },
  { name: "Theographic Bible Metadata — people, places, events", licence: "CC BY-SA 4.0" },
  { name: "Natural Earth 1:50m coastlines, rivers and lakes (Map)", licence: "Public domain" },
  { name: "Ancient-to-modern place names, OpenBible.info Bible-Geocoding-Data (Map)", licence: "CC BY 4.0" },
  { name: "Kingdom/nation outlines (Map) — hand-drawn for this app, schematic", licence: "Original work" },
  { name: "Adams' Synchronological Chart or Map of History, Sebastian C. Adams 1871 (Timeline facsimile)", licence: "Public domain" },
  { name: "Messianic prophecy pairings (Prophecies tab) — selection from \"FULFILLED\" by thecfelix & Kevin Flerlage", licence: "References credited; verses shown from bundled public-domain texts" },
  { name: "all-MiniLM-L6-v2 embedding model (topic search)", licence: "Apache 2.0" },
  { name: "Library: free modules from the CrossWire Bible Society (crosswire.org), downloaded only when you choose them", licence: "Each item's own licence, shown before installing" },
  { name: "Pictures: Gustave Doré (1866) and James Tissot (1886–1902), via Wikimedia Commons", licence: "Public domain (Tissot OT scans by Phillip Medhurst: CC BY-SA)" },
  { name: "Pictures: Jim Padgett, courtesy of Sweet Publishing and Gospel Light (1984), via Wikimedia Commons", licence: "CC BY-SA 3.0" },
  { name: "Kokoro-82M text-to-speech model and voices, hexgrad (read aloud)", licence: "Apache 2.0" },
  { name: "kokoro-onnx (thewh1teagle) and ONNX Runtime (Microsoft) — read-aloud engine", licence: "MIT" },
  { name: "espeak-ng and phonemizer — pronunciation, inside the separate read-aloud voice program", licence: "GPL-3.0 (source: github.com/espeak-ng/espeak-ng, github.com/bootphon/phonemizer)" },
  { name: "Poppins Regular font (the \"Gospel\" wordmark, opening screen)", licence: "SIL Open Font License 1.1" },
];

interface Props {
  prefs: ReadingPrefs;
  onPrefsChange: (p: ReadingPrefs) => void;
  readPrefs: ReadAloudPrefs;
  onReadPrefsChange: (p: ReadAloudPrefs) => void;
  /** The reader's own names for the highlight colours (e.g. "yellow" -> "Love"), if set. */
  highlightTitles: Record<string, string>;
  onHighlightTitlesChange: (titles: Record<string, string>) => void;
  onOpenHelp: () => void;
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

/** One highlight colour's name field. Uncontrolled (saves on blur/Enter) rather than
 * tracked in state on every keystroke -- simpler, and avoids 11 fields needing to stay
 * in sync with a parent-level map that only ever changes from this same panel anyway. */
function HighlightTitleField({ color, defaultTitle, onSave }: { color: HighlightColor; defaultTitle: string; onSave: (title: string) => void }) {
  return (
    <label className="highlight-title-row">
      <i className={`highlight-swatch swatch-${color}`} aria-hidden="true" />
      <input
        defaultValue={defaultTitle}
        placeholder={HIGHLIGHT_COLOR_NAMES[color]}
        aria-label={`Your name for ${HIGHLIGHT_COLOR_NAMES[color]}`}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function SettingsPanel({ prefs, onPrefsChange, readPrefs, onReadPrefsChange, highlightTitles, onHighlightTitlesChange, onOpenHelp, onClose }: Props) {
  const [apiBibleKey, setApiBibleKey] = useState("");
  const [hasApiBible, setHasApiBible] = useState(false);
  const [esvKey, setEsvKey] = useState("");
  const [hasEsv, setHasEsv] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");
  const [voiceAvailable, setVoiceAvailable] = useState(true);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  async function saveHighlightTitle(color: HighlightColor, title: string) {
    const trimmed = title.trim();
    try {
      await api.saveHighlightTitle(color, trimmed);
      const next = { ...highlightTitles };
      if (trimmed) next[color] = trimmed;
      else delete next[color];
      onHighlightTitlesChange(next);
    } catch (e) {
      setLoadError(String(e));
    }
  }

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

      <button className="pill-btn help-open" onClick={onOpenHelp}>
        Help &amp; user guide — how to use every feature
      </button>

      <h4 className="section-label">Reading comfort</h4>
      <div className="reading-prefs">
        <label>
          <span>Text size</span>
          <input
            type="range"
            min={0.85}
            max={1.6}
            step={0.05}
            value={prefs.fontScale}
            onChange={(e) => onPrefsChange({ ...prefs, fontScale: Number(e.target.value) })}
            aria-label="Reading text size"
          />
          <span className="muted">{Math.round(prefs.fontScale * 100)}%</span>
        </label>
        <label>
          <span>Line spacing</span>
          <input
            type="range"
            min={1.5}
            max={2.2}
            step={0.05}
            value={prefs.lineHeight}
            onChange={(e) => onPrefsChange({ ...prefs, lineHeight: Number(e.target.value) })}
            aria-label="Reading line spacing"
          />
          <span className="muted">{prefs.lineHeight.toFixed(2)}</span>
        </label>
        <label>
          <span>Page width</span>
          <select value={prefs.width} onChange={(e) => onPrefsChange({ ...prefs, width: e.target.value as ReadingPrefs["width"] })} aria-label="Reading page width">
            <option value="normal">Comfortable column</option>
            <option value="wide">Full width</option>
          </select>
        </label>
        <label>
          <span>Words of Jesus</span>
          <select
            value={prefs.redLetter ? "red" : "plain"}
            onChange={(e) => onPrefsChange({ ...prefs, redLetter: e.target.value === "red" })}
            aria-label="Words of Jesus in red"
          >
            <option value="red">In red (red-letter edition)</option>
            <option value="plain">Same colour as the rest</option>
          </select>
        </label>
        <button className="text-btn" onClick={() => onPrefsChange(DEFAULT_PREFS)}>
          Reset to defaults
        </button>
      </div>
      <p className="search-hint" style={{ marginTop: "0.3rem" }}>
        Focus mode (the Focus button, or <kbd>F11</kbd>) shows just the text, full screen. <kbd>Esc</kbd> leaves it.
      </p>

      <h4 className="section-label">Read aloud</h4>
      <div className="reading-prefs">
        <label>
          <span>Voice</span>
          <select value={readPrefs.voice} onChange={(e) => onReadPrefsChange({ ...readPrefs, voice: e.target.value })} aria-label="Read-aloud voice">
            {NATURAL_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Speed</span>
          <select value={readPrefs.speed} onChange={(e) => onReadPrefsChange({ ...readPrefs, speed: Number(e.target.value) })} aria-label="Read-aloud speed">
            {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((s) => (
              <option key={s} value={s}>
                {s === 1 ? "Normal" : `${s}×`}
              </option>
            ))}
          </select>
        </label>
        {voiceAvailable && <TryVoice prefs={readPrefs} />}
      </div>
      <VoiceDownload onChange={setVoiceAvailable} />
      <p className="search-hint" style={{ marginTop: "0.3rem" }}>
        Press <strong>Listen</strong> beside a chapter's title (or ⋯ → <em>Listen from here</em> on a verse) to hear it read in a
        natural voice, fully offline once it's downloaded. The first time after starting the app takes a few seconds while the voice gets ready.
      </p>

      <h4 className="section-label">Name your highlights</h4>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Give each highlight colour its own meaning — Love, Family, Prophecy, Prayer, whatever helps you study. Leave a
        name blank to just use the colour's own name. Your names show next to the colour in My Study → Highlights.
      </p>
      <div className="highlight-titles">
        {HIGHLIGHT_COLORS.map((c) => (
          <HighlightTitleField key={c} color={c} defaultTitle={highlightTitles[c] ?? ""} onSave={(title) => saveHighlightTitle(c, title)} />
        ))}
      </div>

      <h4 className="section-label">Online translations</h4>
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
          <kbd>Esc</kbd> close the side panel / leave focus mode
        </li>
        <li>
          <kbd>F11</kbd> focus mode (full screen, just the text)
        </li>
      </ul>
      <p className="search-hint">
        Tip: type a reference such as <em>John 3:16</em>, <em>gen 1</em> or <em>1 sam 17</em> into the search box to go
        straight there.
      </p>

      <UpdateSettings />

      <Diagnostics />

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
          redistribution, and is used with that permission. The interlinear and grammar data are from STEPBible.org
          (Tyndale House, Cambridge), used under CC BY 4.0. Copyrighted modern translations (NIV, NKJV, ESV) are not
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

/** Where the error log is, and ways to hand it over when reporting a problem. */
function Diagnostics() {
  const [path, setPath] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    api.logPath().then(setPath).catch(() => setPath(null));
  }, []);
  return (
    <>
      <h4 className="section-label">Diagnostics</h4>
      <p className="search-hint" style={{ marginTop: 0 }}>
        If something goes wrong, the app writes the details to a log file on this computer (it is never sent anywhere). When
        reporting a problem, copy the recent log or attach the file.
        {path && (
          <>
            <br />
            <span className="log-path">{path}</span>
          </>
        )}
      </p>
      <div className="note-editor-actions">
        <button className="outline-btn" onClick={() => api.openLogFolder().catch((e) => setStatus(String(e)))}>
          Show log file
        </button>
        <button
          className="outline-btn"
          onClick={async () => {
            const text = await api.logRecent(200).catch(() => "");
            const ok = text ? await copyText(text) : false;
            setStatus(!text ? "The log is empty." : ok ? "Recent log copied." : "Couldn't copy the log.");
          }}
        >
          Copy recent log
        </button>
      </div>
      {status && <p className="muted">{status}</p>}
    </>
  );
}
