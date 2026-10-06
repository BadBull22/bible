import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, VoiceStatus } from "../api";

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** Settings › Read aloud: download (once), or remove, the natural voice. */
export function VoiceDownload({ onChange }: { onChange?: (available: boolean) => void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .voiceStatus()
      .then((s) => {
        setStatus(s);
        onChange?.(s.available);
      })
      .catch(() => setStatus(null));
  }

  useEffect(() => {
    refresh();
    const unProgress = listen<{ stage: string; done: number; total: number }>("voice-progress", (e) => setProgress(e.payload));
    const unChanged = listen("voice-changed", () => {
      setProgress(null);
      refresh();
    });
    return () => {
      unProgress.then((f) => f());
      unChanged.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return null;

  if (status.available) {
    return status.source === "downloaded" ? (
      <p className="search-hint" style={{ marginTop: "0.3rem" }}>
        The natural voice is installed.{" "}
        <button
          className="link-btn"
          onClick={() => {
            if (window.confirm("Remove the natural voice? Listen will use the computer's built-in voice until you download it again.")) {
              api.voiceRemove().then(refresh).catch((e) => setError(String(e)));
            }
          }}
        >
          Remove it
        </button>{" "}
        to free {status.download_bytes ? `about ${mb(status.download_bytes * 1.35)}` : "space"}.
        {error && <span className="status-error"> {error}</span>}
      </p>
    ) : null;
  }

  if (!status.download_bytes) {
    return (
      <p className="search-hint" style={{ marginTop: "0.3rem" }}>
        The natural voice isn't available for this computer yet; Listen uses the computer's built-in voice.
      </p>
    );
  }

  const busy = status.downloading || progress !== null;
  return (
    <div className="voice-download">
      <p>
        <strong>Natural voice</strong> — a one-time download of {mb(status.download_bytes)}. After that it works offline. Until then,
        Listen uses the computer's built-in voice.
      </p>
      {busy ? (
        <div className="voice-progress">
          <progress max={progress?.total || 1} value={progress?.stage === "installing" ? progress.total : progress?.done ?? 0} />
          <span className="muted">
            {progress?.stage === "installing"
              ? "Unpacking…"
              : progress
                ? `${mb(progress.done)} of ${mb(progress.total)}`
                : "Starting…"}
          </span>
          {progress?.stage !== "installing" && (
            <button className="text-btn" onClick={() => api.voiceCancelDownload()}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <button
          className="pill-btn"
          onClick={() => {
            setError(null);
            setProgress({ stage: "downloading", done: 0, total: status.download_bytes ?? 0 });
            api
              .voiceDownload()
              .then(refresh)
              .catch((e) => {
                setProgress(null);
                setError(String(e));
                refresh();
              });
          }}
        >
          Download the natural voice
        </button>
      )}
      {error && <p className="status-error">{error}</p>}
    </div>
  );
}
