import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, UpdateInfo } from "../api";
import { CloseIcon } from "./icons";

const AUTO_KEY = "updates:auto";
const LAST_KEY = "updates:lastCheck";
const DAY = 20 * 60 * 60 * 1000;

function autoCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

function dueForCheck(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(LAST_KEY) ?? 0) > DAY;
  } catch {
    return true;
  }
}

function markChecked() {
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    /* not remembered: checks again next start */
  }
}

/** Download progress and the Install button for a found update. */
function InstallUpdate({ info }: { info: UpdateInfo }) {
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const un = listen<{ stage: string; done: number; total: number | null }>("update-progress", (e) => {
      const { stage, done, total } = e.payload;
      setProgress(
        stage === "installing"
          ? "Installing… the app will close and open again."
          : total
            ? `Downloading… ${Math.round((done / total) * 100)}% of ${Math.round(total / 1e6)} MB`
            : `Downloading… ${Math.round(done / 1e6)} MB`,
      );
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  return (
    <>
      {info.notes && (
        <details className="apparatus-key">
          <summary>What's new in {info.version}</summary>
          <p className="update-notes">{info.notes}</p>
        </details>
      )}
      {progress ? (
        <p className="muted" aria-live="polite">
          {progress}
        </p>
      ) : (
        <button
          className="pill-btn"
          onClick={() => {
            setError(null);
            setProgress("Starting the download…");
            api.updateInstall().catch((e) => {
              setProgress(null);
              setError(String(e));
            });
          }}
        >
          Update to {info.version}
        </button>
      )}
      {error && <p className="status-error">{error}</p>}
      <p className="search-hint" style={{ marginTop: "0.4rem" }}>
        Your notes, highlights, Library and pictures are kept. Updates are checked against the app's signature before they're installed.
      </p>
    </>
  );
}

/** A quiet card offering a newer version, after an automatic check (about once a day). */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!autoCheck() || !dueForCheck()) return;
    // not at start-up itself: let the app settle first
    const t = window.setTimeout(() => {
      api
        .updateCheck()
        .then((u) => {
          markChecked();
          setInfo(u);
        })
        .catch(() => undefined); // offline: try again next time
    }, 20_000);
    return () => window.clearTimeout(t);
  }, []);

  if (!info || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <div className="update-banner-head">
        <strong>Version {info.version} is available</strong>
        <button className="icon-round" onClick={() => setHidden(true)} aria-label="Not now" title="Not now">
          <CloseIcon size={12} />
        </button>
      </div>
      <p className="muted">You have {info.current_version}.</p>
      <InstallUpdate info={info} />
    </div>
  );
}

/** Settings: check now, and the automatic-check switch. */
export function UpdateSettings() {
  const [auto, setAuto] = useState(autoCheck);
  const [state, setState] = useState<"idle" | "checking" | "latest" | "error">("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <h4 className="section-label">Updates</h4>
      <label className="read-aloud-check">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            try {
              localStorage.setItem(AUTO_KEY, e.target.checked ? "on" : "off");
            } catch {
              /* ignore */
            }
          }}
        />{" "}
        Check for a new version automatically (about once a day, when online)
      </label>
      {!info && (
        <div className="note-editor-actions" style={{ marginTop: "0.5rem" }}>
          <button
            className="outline-btn"
            disabled={state === "checking"}
            onClick={() => {
              setState("checking");
              setError(null);
              api
                .updateCheck()
                .then((u) => {
                  markChecked();
                  setInfo(u);
                  setState(u ? "idle" : "latest");
                })
                .catch((e) => {
                  setError(String(e));
                  setState("error");
                });
            }}
          >
            {state === "checking" ? "Checking…" : "Check for updates now"}
          </button>
          {state === "latest" && <span className="muted">You have the latest version.</span>}
        </div>
      )}
      {error && <p className="status-error">{error}</p>}
      {info && (
        <div className="update-found">
          <p>
            <strong>Version {info.version}</strong> is available (you have {info.current_version}).
          </p>
          <InstallUpdate info={info} />
        </div>
      )}
    </>
  );
}
