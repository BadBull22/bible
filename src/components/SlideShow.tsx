// The slide show: the slides full screen on the second screen (the projector or TV), and on
// the preacher's own screen a presenter view -- this slide, the next one, the notes, a clock
// and a timer. The two windows talk by events: the presenter sends what to show, the slide
// screen sends back the keys pressed on it (with one screen, the slides cover it).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor, getCurrentWindow, type Monitor } from "@tauri-apps/api/window";
import type { SlideSpec } from "../sermonOutputs";
import { kindOfName, mediaUrl, youtubeId } from "../sermonMedia";
import { Preview } from "./SlidesEditor";

/** Whether a video or music clip on the slide is playing. */
type Clip = "stopped" | "playing" | "paused";

interface ShowState {
  slides: SlideSpec[];
  background: string | null;
  index: number;
  /** the screen blacked out (B) */
  black: boolean;
  clip: Clip;
}

/** What a "link" slide plays in the show: a kept video or music file, a YouTube video, or
 * nothing (a web page or other file: the presenter opens it in the browser). */
function clipOf(s: SlideSpec | undefined): { kind: "video" | "audio"; file: string } | { kind: "youtube"; id: string } | null {
  if (!s || s.kind !== "link" || !s.link) return null;
  if (s.link.startsWith("media:")) {
    const file = s.link.slice(6);
    const k = kindOfName(file);
    return k === "video" || k === "audio" ? { kind: k, file } : null;
  }
  const id = youtubeId(s.link);
  return id ? { kind: "youtube", id } : null;
}

/** The window label of a slide screen ("show-<time>": each show its own window). */
export const isShowWindow = () => {
  try {
    return getCurrentWindow().label.startsWith("show-");
  } catch {
    return false;
  }
};

/** The slide screen: one slide filling the window, black around it, no pointer. */
export function ShowScreen() {
  const [st, setSt] = useState<ShowState | null>(null);
  useEffect(() => {
    document.body.classList.add("show-body");
    let stop: (() => void) | undefined;
    listen<ShowState>("show:state", (e) => setSt(e.payload)).then((un) => {
      stop = un;
      void emitTo("main", "show:ready", getCurrentWindow().label);
    });
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      void emitTo("main", "show:key", e.key);
    };
    const click = () => void emitTo("main", "show:key", "ArrowRight");
    window.addEventListener("keydown", key);
    window.addEventListener("click", click);
    return () => {
      stop?.();
      window.removeEventListener("keydown", key);
      window.removeEventListener("click", click);
    };
  }, []);
  const s = st?.slides[st.index];
  if (!st || !s || st.black) return <div className="show-screen" />;
  return (
    <div className="show-screen">
      <div className="show-slide">
        <Preview s={s} background={st.background} />
        <ClipPlayer s={s} clip={st.clip} />
      </div>
    </div>
  );
}

/** A video over the slide (or music behind it) on the slide screen, started and paused from
 * the presenter view. */
function ClipPlayer({ s, clip }: { s: SlideSpec; clip: Clip }) {
  const c = clipOf(s);
  const [url, setUrl] = useState<string | null>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const tube = useRef<HTMLIFrameElement>(null);
  const file = c && c.kind !== "youtube" ? c.file : null;
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (file) mediaUrl(file).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file]);
  useEffect(() => {
    const m = media.current;
    if (m) {
      if (clip === "playing") m.play().catch(() => void emitTo("main", "show:blocked", ""));
      else m.pause();
      if (clip === "stopped") m.currentTime = 0;
    }
    // a YouTube video is told through its player's messages
    const w = tube.current?.contentWindow;
    if (w) w.postMessage(JSON.stringify({ event: "command", func: clip === "playing" ? "playVideo" : "pauseVideo", args: [] }), "*");
  }, [clip, url]);
  if (!c || clip === "stopped") return null;
  const ended = () => void emitTo("main", "show:ended", "");
  if (c.kind === "youtube")
    return (
      <iframe
        ref={tube}
        className="show-clip"
        src={`https://www.youtube.com/embed/${c.id}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1`}
        allow="autoplay; encrypted-media; fullscreen"
        title={s.title}
      />
    );
  if (!url) return null;
  return c.kind === "video" ? <video ref={media} className="show-clip" src={url} onEnded={ended} /> : <audio ref={media} src={url} onEnded={ended} />;
}

const SCREEN_KEY = "bc-slides-screen";
const sameScreen = (a: Monitor | null | undefined, b: Monitor | null | undefined) => !!a && !!b && a.position.x === b.position.x && a.position.y === b.position.y;
/** The screens other than the one the app is on, left to right. */
async function otherScreens(): Promise<Monitor[]> {
  const [all, here] = await Promise.all([availableMonitors(), currentMonitor()]);
  return all.filter((m) => !sameScreen(m, here)).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
}
/** A screen's name for the reader: "Screen 2 · 1920×1080", from Windows' own numbering. */
const screenName = (m: Monitor) => {
  const n = /(\d+)$/.exec(m.name ?? "")?.[1];
  return `${n ? `Screen ${n}` : "A screen"} · ${m.size.width}×${m.size.height}`;
};

/** Opens the slide screen: full screen on another screen if there is one (the one chosen
 * last time, if it is still there), otherwise on this one (covering the presenter view). */
async function openShowWindow(): Promise<{ win: WebviewWindow; second: boolean; screen: Monitor | null }> {
  const [others, here] = await Promise.all([otherScreens(), currentMonitor()]);
  let last: string | null = null;
  try {
    last = localStorage.getItem(SCREEN_KEY);
  } catch {
    /* no storage: the first other screen */
  }
  const other = others.find((m) => m.name === last) ?? others[0];
  const target = other ?? here;
  const label = await invoke<string>("show_window_open", {
    x: target?.position.x ?? 0,
    y: target?.position.y ?? 0,
    width: target?.size.width ?? 1280,
    height: target?.size.height ?? 720,
  });
  const win = await WebviewWindow.getByLabel(label);
  if (!win) throw new Error("the window went away");
  if (other) await getCurrentWindow().setFocus();
  return { win, second: !!other, screen: other ?? null };
}

const two = (n: number) => String(n).padStart(2, "0");
const clockOf = (d: Date) => `${d.getHours()}:${two(d.getMinutes())}`;
const lengthOf = (secs: number) => (secs >= 3600 ? `${Math.floor(secs / 3600)}:${two(Math.floor(secs / 60) % 60)}:${two(secs % 60)}` : `${Math.floor(secs / 60)}:${two(secs % 60)}`);

interface PresenterProps {
  slides: SlideSpec[];
  background: string | null;
  /** the slide to start on */
  start?: number;
  onEnd: () => void;
}

/** The presenter view, over the whole app window: this slide, the next, the notes, a clock
 * and a timer, and every slide along the bottom to jump to. */
export function Presenter({ slides, background, start = 0, onEnd }: PresenterProps) {
  const [index, setIndex] = useState(Math.min(start, slides.length - 1));
  const [black, setBlack] = useState(false);
  const [clip, setClip] = useState<Clip>("stopped");
  const [win, setWin] = useState<WebviewWindow | null>(null);
  const [second, setSecond] = useState(true);
  // with three or more screens: which one shows the slides
  const [screens, setScreens] = useState<Monitor[]>([]);
  const [screen, setScreen] = useState<Monitor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [began, setBegan] = useState(() => Date.now());
  const strip = useRef<HTMLOListElement>(null);

  // the slide screen: opened once, closed when the show ends
  useEffect(() => {
    let live = true;
    let opened: WebviewWindow | null = null;
    openShowWindow()
      .then(({ win, second, screen }) => {
        opened = win;
        if (!live) {
          void win.close();
          return;
        }
        setWin(win);
        setSecond(second);
        setScreen(screen);
        void otherScreens().then((s) => live && setScreens(s));
        // closed some other way (Alt+F4): the show is over
        void win.once("tauri://destroyed", () => live && onEnd());
      })
      .catch((e) => live && setError(`The slide screen couldn't be opened: ${e}`));
    return () => {
      live = false;
      void opened?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback(
    (to: number) => {
      setIndex((i) => {
        const n = Math.max(0, Math.min(slides.length - 1, to));
        if (n !== i) setClip("stopped");
        return n;
      });
      setBlack(false);
    },
    [slides.length],
  );
  const step = useCallback(
    (d: number) => {
      setIndex((i) => {
        const n = Math.max(0, Math.min(slides.length - 1, i + d));
        if (n !== i) setClip("stopped");
        return n;
      });
      setBlack(false);
    },
    [slides.length],
  );

  const end = useCallback(() => {
    void win?.close();
    onEnd();
  }, [win, onEnd]);

  const key = useCallback(
    (k: string) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(k)) step(1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(k)) step(-1);
      else if (k === "Home") go(0);
      else if (k === "End") go(slides.length - 1);
      else if (k === "b" || k === "B" || k === "." || k === "w" || k === "W") setBlack((b) => !b);
      else if (k === "Escape") end();
    },
    [step, go, end, slides.length],
  );

  // keys pressed here, and on the slide screen (sent across)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      e.preventDefault();
      key(e.key);
    };
    window.addEventListener("keydown", down);
    const offs = [
      listen<string>("show:key", (e) => key(e.payload)),
      listen("show:ended", () => setClip("stopped")),
      listen("show:blocked", () => setBlocked(true)),
    ];
    return () => {
      window.removeEventListener("keydown", down);
      offs.forEach((p) => void p.then((un) => un()));
    };
  }, [key]);

  // what the slide screen shows: sent on every change, and when it says it is ready
  const state: ShowState = { slides, background, index, black, clip };
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (win) void emitTo(win.label, "show:state", state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, slides, background, index, black, clip]);
  useEffect(() => {
    const off = listen<string>("show:ready", (e) => void emitTo(e.payload, "show:state", latest.current));
    return () => void off.then((un) => un());
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    strip.current?.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  const moveTo = async (m: Monitor) => {
    if (!win) return;
    try {
      await invoke("show_window_move", { label: win.label, x: m.position.x, y: m.position.y, width: m.size.width, height: m.size.height });
      setScreen(m);
      try {
        localStorage.setItem(SCREEN_KEY, m.name ?? "");
      } catch {
        /* remembered for this show only */
      }
      await getCurrentWindow().setFocus();
    } catch (e) {
      setError(`The slides couldn't be moved: ${e}`);
    }
  };

  const cur = slides[index];
  const next = slides[index + 1];
  const c = clipOf(cur);
  const openLink = async () => {
    if (!cur?.link) return;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const { api } = await import("../api");
    if (cur.link.startsWith("media:")) await api.sermonMediaOpen(cur.link.slice(6));
    else await openUrl(cur.link);
  };

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Presenter view">
      <div className="presenter-bar">
        <strong>
          Slide {index + 1} of {slides.length}
        </strong>
        <span className="presenter-clock" title="The time now">
          {clockOf(now)}
        </span>
        <span className="presenter-timer" title="How long the show has been going">
          {lengthOf(Math.max(0, Math.floor((now.getTime() - began) / 1000)))}
          <button className="link-btn" onClick={() => setBegan(Date.now())}>
            restart
          </button>
        </span>
        {screens.length > 1 && (
          <label className="presenter-screen">
            <span className="muted">Slides on</span>
            <select
              value={screen ? `${screen.position.x},${screen.position.y}` : ""}
              onChange={(e) => {
                const m = screens.find((s) => `${s.position.x},${s.position.y}` === e.target.value);
                if (m) void moveTo(m);
              }}
            >
              {screens.map((m) => (
                <option key={`${m.position.x},${m.position.y}`} value={`${m.position.x},${m.position.y}`}>
                  {screenName(m)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="presenter-tools">
          <button className={"outline-btn" + (black ? " on" : "")} onClick={() => setBlack((b) => !b)} title="Black out the slide screen (B)">
            {black ? "Show the slide" : "Black screen"}
          </button>
          <button className="pill-btn" onClick={end} title="End the show (Esc)">
            End the show
          </button>
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      {!win && !error && <p className="presenter-note">Opening the slide screen…</p>}
      {win && !second && (
        <p className="presenter-note">
          Only one screen was found, so the slides cover this one. Keys: → or Space next, ← back, B black screen, Esc end. Connect the projector or TV (Windows key + P → Extend) and start the show again for this presenter view.
        </p>
      )}
      <div className="presenter-main">
        <div className="presenter-current">
          {cur && <Preview s={cur} background={background} />}
          {black && <span className="presenter-black">The slide screen is black</span>}
          {cur?.kind === "link" && (
            <div className="presenter-clip">
              {c ? (
                <>
                  {clip !== "playing" ? (
                    <button className="pill-btn" onClick={() => (setBlocked(false), setClip("playing"))}>
                      ▶ {clip === "paused" ? "Carry on" : c.kind === "audio" ? "Play the music" : "Play the video"}
                    </button>
                  ) : (
                    <button className="pill-btn" onClick={() => setClip("paused")}>
                      ❚❚ Pause
                    </button>
                  )}
                  {clip !== "stopped" && (
                    <button className="outline-btn" onClick={() => setClip("stopped")}>
                      ■ Stop
                    </button>
                  )}
                  {c.kind === "youtube" && <span className="muted">Needs the internet.</span>}
                </>
              ) : (
                <button className="outline-btn" onClick={() => void openLink()}>
                  Open it in the browser
                </button>
              )}
              {blocked && <span className="error">Windows didn't let it start: click the slide screen once, then press Play again.</span>}
            </div>
          )}
        </div>
        <div className="presenter-side">
          <span className="muted">Next</span>
          {next ? <Preview s={next} background={background} /> : <div className="presenter-end">The end of the slides</div>}
          <span className="muted">Your notes</span>
          <div className="presenter-notes">{cur?.notes?.trim() || <span className="muted">No notes for this slide.</span>}</div>
          <div className="presenter-steps">
            <button className="outline-btn" onClick={() => step(-1)} disabled={index === 0}>
              ← Back
            </button>
            <button className="pill-btn" onClick={() => step(1)} disabled={index >= slides.length - 1}>
              Next →
            </button>
          </div>
        </div>
      </div>
      <ol className="presenter-strip" ref={strip} aria-label="Every slide: click one to show it">
        {slides.map((s, i) => (
          <li key={i} className={i === index ? "on" : undefined}>
            <button onClick={() => go(i)} aria-label={`Slide ${i + 1}: ${s.title}`}>
              <span className="slides-n">{i + 1}</span>
              <Preview s={s} background={background} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
