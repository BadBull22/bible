import { useEffect, useState } from "react";
import { api } from "../api";
import { VoiceDownload } from "./VoiceDownload";
import { CloseIcon } from "./icons";

export const WELCOME_SEEN_KEY = "welcome:seen";
export const WELCOME_OFF_KEY = "welcome:off";
/** how many times it has opened by itself; it stops after WELCOME_MAX_AUTO */
export const WELCOME_COUNT_KEY = "welcome:count";
export const WELCOME_MAX_AUTO = 3;

interface Props {
  onClose: (dontShowAgain: boolean) => void;
  onShowLibrary: () => void;
  onShowPictures: () => void;
  onShowKeys: () => void;
}

/** Getting started: the optional extras that each live somewhere different (Settings,
 * the Study menu, the Explore menu), with what's already set up and a way straight there. */
export function WelcomeWindow({ onClose, onShowLibrary, onShowPictures, onShowKeys }: Props) {
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);
  const [pictures, setPictures] = useState<{ done: number; total: number } | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    api.libraryInstalled().then((m) => setLibraryCount(m.length)).catch(() => setLibraryCount(null));
    api
      .picturesCollections()
      .then((c) => setPictures({ done: c.filter((x) => x.downloaded > 0).length, total: c.length }))
      .catch(() => setPictures(null));
    api
      .getSettings()
      .then((s) => setHasKey(!!(s.api_bible_key || s.esv_api_key)))
      .catch(() => setHasKey(null));
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose(dontShow);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [dontShow, onClose]);

  const state = (ok: boolean | null, okText: string, notText: string) =>
    ok === null ? null : <span className={ok ? "welcome-state ok" : "welcome-state"}>{ok ? `✓ ${okText}` : notText}</span>;

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-window">
        <div className="welcome-head">
          <h2 id="welcome-title">Welcome to Bible Concordance</h2>
          <button className="icon-btn welcome-close" onClick={() => onClose(dontShow)} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <p className="muted">
          Everything you need to read and study works straight away, offline. These extras are optional and free — and each
          one lives in a different place, so here's where to find them.
        </p>

        <section className="welcome-item">
          <div className="welcome-item-head">
            <h3>🔊 Natural reading voice</h3>
            {state(voiceReady, "Installed", "Not installed")}
          </div>
          <p>Reads chapters and commentaries aloud in a natural voice, offline. Until it's downloaded, Listen uses the computer's built-in voice.</p>
          <p className="welcome-where">Also in: Settings ▸ Read aloud</p>
          <VoiceDownload onChange={setVoiceReady} />
        </section>

        <section className="welcome-item">
          <div className="welcome-item-head">
            <h3>📚 Library</h3>
            {state(libraryCount === null ? null : libraryCount > 0, `${libraryCount} installed`, "Nothing added yet")}
          </div>
          <p>About 400 free Bibles, commentaries, dictionaries, devotionals and books to add. Installed items appear in the normal panels.</p>
          <div className="welcome-actions">
            <span className="welcome-where">Study ▸ Library ▸ Get more</span>
            <button className="outline-btn" onClick={onShowLibrary}>
              Show me
            </button>
          </div>
        </section>

        <section className="welcome-item">
          <div className="welcome-item-head">
            <h3>🖼️ Bible pictures</h3>
            {state(
              pictures === null ? null : pictures.done > 0,
              `${pictures?.done} of ${pictures?.total} collections`,
              "None downloaded yet",
            )}
          </div>
          <p>Doré, Tissot and Sweet Publishing art, each linked to its passage. Download only the collections you want.</p>
          <div className="welcome-actions">
            <span className="welcome-where">Explore ▸ Pictures ▸ Download</span>
            <button className="outline-btn" onClick={onShowPictures}>
              Show me
            </button>
          </div>
        </section>

        <section className="welcome-item">
          <div className="welcome-item-head">
            <h3>🔑 NIV, NKJV and ESV</h3>
            {state(hasKey, "Key added", "No key yet")}
          </div>
          <p>These copyrighted translations can't be bundled. With your own free key they appear in Compare, online only.</p>
          <div className="welcome-actions">
            <span className="welcome-where">Settings ▸ Online translations</span>
            <button className="outline-btn" onClick={onShowKeys}>
              Show me
            </button>
          </div>
        </section>

        <div className="welcome-foot">
          <label>
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} /> Don't show this again
          </label>
          <span className="muted">You can reopen this from Settings ▸ Getting started.</span>
          <button className="pill-btn" onClick={() => onClose(dontShow)}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
