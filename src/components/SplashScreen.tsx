import { useCallback, useEffect, useRef, useState } from "react";
import "./SplashScreen.css";

// The launch splash is a short video that plays to its end before the app appears. The
// file has an audio track (editors add a silent one) but the splash is meant to be
// picture-only, so it is always played muted -- which also means the browser's autoplay
// policy can never block it.
const VIDEO_URL = encodeURI("/Video Project 1.mp4");
const FADE_MS = 400;
// A broken or missing video must never leave the user staring at a black screen.
const START_FAILSAFE_MS = 6000;
const END_GRACE_MS = 2500;
// When the video can't play, say why on screen for a moment before opening the app: the
// console is invisible in an installed build, so otherwise a failure is undiagnosable.
const FAILURE_HOLD_MS = 4000;

// Every way the splash can end early is logged with its reason: the fail-safes below turn a
// broken video into a silent skip, and without a trace that is impossible to diagnose.
const log = (...args: unknown[]) => console.warn("[splash]", ...args);

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const finished = useRef(false);
  const startFailsafe = useRef<number | undefined>(undefined);
  const endFailsafe = useRef<number | undefined>(undefined);
  const holdTimer = useRef<number | undefined>(undefined);
  const doneTimer = useRef<number | undefined>(undefined);
  // App hands over a fresh inline callback on every render; reading it through a ref means
  // an App re-render while the video plays can't restart playback or any of the timers.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((reason: string, played = false) => {
    if (finished.current) return;
    finished.current = true;
    log("finished:", reason);
    window.clearTimeout(startFailsafe.current);
    window.clearTimeout(endFailsafe.current);
    const fadeOut = () => {
      setFading(true);
      doneTimer.current = window.setTimeout(() => onDoneRef.current(), FADE_MS);
    };
    if (played) {
      fadeOut();
    } else {
      setFailure(reason);
      holdTimer.current = window.setTimeout(fadeOut, FAILURE_HOLD_MS);
    }
  }, []);

  // The clip's index (moov box) sits at the END of the file, so it isn't a "fast-start" MP4.
  // Fetching it whole and playing it from a blob URL means playback doesn't depend on the
  // app's asset server answering byte-range requests, which a non-fast-start file needs.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    startFailsafe.current = window.setTimeout(() => finish("video never started playing"), START_FAILSAFE_MS);
    log("canPlayType H.264+AAC:", JSON.stringify(document.createElement("video").canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"')));
    fetch(VIDEO_URL)
      .then((r) => {
        log("fetch", r.status, r.headers.get("content-type"), r.headers.get("content-length"));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        log("blob", blob.size, "bytes");
        objectUrl = URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));
        setSrc(objectUrl);
      })
      .catch((e) => finish(`fetch failed: ${e}`));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.clearTimeout(startFailsafe.current);
      window.clearTimeout(endFailsafe.current);
      window.clearTimeout(holdTimer.current);
      window.clearTimeout(doneTimer.current);
    };
  }, [finish]);

  useEffect(() => {
    const v = videoRef.current;
    if (!src || !v) return;
    v.muted = true;
    v.play().then(
      () => log("play() resolved"),
      (e) => finish(`play() rejected: ${e}`),
    );
  }, [src, finish]);

  // Once it is actually playing, `ended` should arrive right on the clip's duration; this
  // only covers the case where it never does.
  function handlePlaying() {
    window.clearTimeout(startFailsafe.current);
    window.clearTimeout(endFailsafe.current);
    const seconds = videoRef.current?.duration;
    const ms = seconds !== undefined && Number.isFinite(seconds) ? seconds * 1000 : 5000;
    log("playing, duration", seconds);
    endFailsafe.current = window.setTimeout(() => finish("ended event never arrived"), ms + END_GRACE_MS);
  }

  function handleError() {
    const err = videoRef.current?.error;
    finish(`video element error: code ${err?.code} ${err?.message ?? ""}`);
  }

  return (
    <div className={`splash-screen${fading ? " splash-screen--fading" : ""}`}>
      {src && (
        <video
          ref={videoRef}
          className="splash-video"
          src={src}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-label="EPT — Bible Research Study"
          onLoadedMetadata={(e) => log("metadata", e.currentTarget.videoWidth, "x", e.currentTarget.videoHeight, "duration", e.currentTarget.duration)}
          onPlaying={handlePlaying}
          onEnded={() => finish("ended", true)}
          onError={handleError}
        />
      )}
      {failure && <p className="splash-failure">The launch video could not be played ({failure}).</p>}
    </div>
  );
}
