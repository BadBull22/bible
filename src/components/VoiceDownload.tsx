import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, VoiceStatus } from "../api";
import { confirmAsk } from "../confirm";

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

  const download = () => {
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
  };
  const removeCopy = async (question: string) => {
    if (await confirmAsk(question)) api.voiceRemove().then(refresh).catch((e) => setError(String(e)));
  };

  if (status.available) {
    // the voice built into the app (the Microsoft Store version): nothing to download
    if (status.source === "bundled") {
      return (
        <div className="voice-download voice-ok">
          <p>
            <strong>The natural voice is built into this app.</strong> It reads the Bible aloud and says Hebrew and Greek words. There is nothing to download or update.
          </p>
          {status.unused_old_copy && (
            <p className="voice-note">
              A voice you downloaded with an earlier version of the app is still on this computer. The app no longer uses it (it cannot say Hebrew and Greek words), so you can{" "}
              <button
                className="link-btn"
                onClick={() => void removeCopy("Remove the old natural voice you downloaded earlier? The app keeps using the newer voice built into it.")}
              >
                remove the old copy
              </button>{" "}
              to free {status.download_bytes ? `about ${mb(status.download_bytes * 1.35)}` : "a lot of space"}.
            </p>
          )}
          {error && <p className="status-error">{error}</p>}
        </div>
      );
    }
    // a voice downloaded earlier
    if (status.original_words) {
      return (
        <p className="voice-note" style={{ marginTop: "0.3rem" }}>
          The natural voice is installed. It reads the Bible aloud and says Hebrew and Greek words.{" "}
          <button className="link-btn" onClick={() => void removeCopy("Remove the natural voice? Listen will use the computer's built-in voice until you download it again.")}>
            Remove it
          </button>{" "}
          to free {status.download_bytes ? `about ${mb(status.download_bytes * 1.35)}` : "space"}.
          {error && <span className="status-error"> {error}</span>}
        </p>
      );
    }
    const busyOld = status.downloading || progress !== null;
    return (
      <div className="voice-download voice-old">
        <p>
          <strong>The natural voice you downloaded earlier is an older version.</strong> It still reads the Bible aloud, but it cannot say Hebrew and Greek words (the little ▶ speaker buttons).
        </p>
        {status.update_available ? (
          busyOld ? (
            <div className="voice-progress">
              <progress max={progress?.total || 1} value={progress?.stage === "installing" ? progress.total : progress?.done ?? 0} />
              <span className="muted">{progress?.stage === "installing" ? "Unpacking…" : progress ? `${mb(progress.done)} of ${mb(progress.total)}` : "Starting…"}</span>
              {progress?.stage !== "installing" && (
                <button className="text-btn" onClick={() => api.voiceCancelDownload()}>
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <>
              <p>
                <button className="pill-btn" onClick={download}>
                  Update the natural voice ({status.download_bytes ? mb(status.download_bytes) : "one download"})
                </button>
              </p>
              <p className="voice-note">One step: it downloads the new voice and replaces the old one, so you do not have to remove anything first. It needs the internet once.</p>
            </>
          )
        ) : (
          <p className="voice-note">
            The newer voice comes inside the newest version of the app (for example from the Microsoft Store), so the way to get it is to update the app. You can keep using this one for reading the Bible aloud meanwhile, or{" "}
            <button className="link-btn" onClick={() => void removeCopy("Remove the natural voice? Listen will use the computer's built-in voice until you get the newer one.")}>
              remove it
            </button>{" "}
            to free {status.download_bytes ? `about ${mb(status.download_bytes * 1.35)}` : "space"}.
          </p>
        )}
        {error && <p className="status-error">{error}</p>}
      </div>
    );
  }

  if (!status.download_bytes) {
    return (
      <p className="voice-note" style={{ marginTop: "0.3rem" }}>
        The natural voice isn't available for this computer yet; Listen uses the computer's built-in voice.
      </p>
    );
  }

  const busy = status.downloading || progress !== null;
  return (
    <div className="voice-download">
      <p>
        <strong>Natural voice</strong> — a one-time download of {mb(status.download_bytes)}. After that it works offline. It reads the Bible aloud and says Hebrew and Greek words. Until then,
        Listen uses the computer's built-in voice and the ▶ buttons beside Hebrew and Greek words say nothing.
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
        <button className="pill-btn" onClick={download}>
          Download the natural voice
        </button>
      )}
      {error && <p className="status-error">{error}</p>}
    </div>
  );
}
