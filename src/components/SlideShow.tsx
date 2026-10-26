// The slide show: the slides full screen on the second screen (the projector or TV), and on the
// presenter's own screen "Present from this laptop" -- a screen laid out like ProPresenter's: the
// sermon's slides as a grid (a coloured strip under each with its number and group, the live one
// outlined in orange), a preview of what the room sees, the notes, the clock and a timer, and the
// buttons a speaker needs (next, back, black, play a clip). The two windows talk by events: the
// presenter sends what to show, the slide screen sends back the keys pressed on it and how far a
// clip has played. With one screen it is a rehearsal: the preview is the room.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors, currentMonitor, getCurrentWindow, type Monitor } from "@tauri-apps/api/window";
import type { BookInfo, Version } from "../api";
import type { SlideSpec } from "../sermonOutputs";
import { kindOfName, mediaUrl, youtubeId } from "../sermonMedia";
import { groupsOf, slideForLetter, STRIP_LABEL, stripKind } from "../presentGroups";
import { targetOf } from "../countdown";
import { KIND_NAME, PresenterDeck } from "../service";
import { LiveAdd } from "./LiveAdd";
import { Preview } from "./SlidesEditor";

/** Whether a video or music clip on the slide is playing. */
type Clip = "stopped" | "playing" | "paused";

interface ShowState {
  slides: SlideSpec[];
  background: string | null;
  index: number;
  /** the screen blacked out */
  black: boolean;
  /** the words taken off (the background stays), as ProPresenter's Clear */
  clear: boolean;
  /** a line over the foot of the slide (a name, a verse reference), or none */
  lower: string | null;
  /** how loud a clip plays, 0 to 1 */
  volume: number;
  /** a see-through picture over the background */
  overlay: string | null;
  /** when a countdown slide reaches zero (ms since 1970) */
  countTo: number | null;
  clip: Clip;
  /** jump a clip to this time (a new `n` each time it is asked) */
  seek: { n: number; to: number } | null;
  /** a test pattern naming the screen, shown for a few seconds */
  test: string | null;
}

/** What a "link" slide plays on the slide screen: a kept video or music file, a video or music file at a web
 * address, a YouTube, Vimeo or Facebook video, or a web page; nothing for what is not a web address. */
type ClipSource =
  | { kind: "video" | "audio"; file: string }
  | { kind: "url-video" | "url-audio"; url: string }
  | { kind: "youtube"; id: string }
  | { kind: "embed"; src: string; label: string; control: "vimeo" | null }
  | { kind: "page"; url: string };

function clipOf(s: SlideSpec | undefined): ClipSource | null {
  if (!s || s.kind !== "link" || !s.link) return null;
  const link = s.link.trim();
  if (link.startsWith("media:")) {
    const file = link.slice(6);
    const k = kindOfName(file);
    return k === "video" || k === "audio" ? { kind: k, file } : null;
  }
  if (!/^https?:\/\//i.test(link)) return null; // a file on this computer: opened outside the show
  const yt = youtubeId(link);
  if (yt) return { kind: "youtube", id: yt };
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/.exec(link)?.[1];
  if (vimeo) return { kind: "embed", label: "Vimeo", src: `https://player.vimeo.com/video/${vimeo}?autoplay=1`, control: "vimeo" };
  if (/facebook\.com\/|fb\.watch\//i.test(link)) {
    return { kind: "embed", label: "Facebook", src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(link)}&show_text=false&autoplay=true`, control: null };
  }
  if (/\.(mp4|m4v|mov|webm|ogv)([?#]|$)/i.test(link)) return { kind: "url-video", url: link };
  if (/\.(mp3|m4a|wav|ogg|aac)([?#]|$)/i.test(link)) return { kind: "url-audio", url: link };
  return { kind: "page", url: link };
}

/** What can be done to a clip: stop and start always; pause and carry on, and jump about in it, only where the player allows. */
const canPause = (c: ClipSource) => c.kind !== "page" && !(c.kind === "embed" && !c.control);
const canSeek = (c: ClipSource) => ["video", "audio", "url-video", "url-audio"].includes(c.kind);
const clipWord = (c: ClipSource) => (c.kind === "audio" || c.kind === "url-audio" ? "the music" : c.kind === "page" ? "the page" : "the video");
const needsInternet = (c: ClipSource) => !(c.kind === "video" || c.kind === "audio");
/** For the grid's strip: a link that plays a video or music. */
const clipType = (c: ClipSource | null): "video" | "audio" | null => (!c || c.kind === "page" ? null : c.kind === "audio" || c.kind === "url-audio" ? "audio" : "video");

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
  if (st?.test)
    return (
      <div className="show-screen show-test">
        <div>
          <strong>{st.test}</strong>
          <span>This is the screen the room sees.</span>
        </div>
      </div>
    );
  if (!st || !s || st.black) return <div className="show-screen" />;
  return (
    <div className="show-screen">
      <div className="show-slide" key={st.index}>
        {/* the title and "Play" are taken off while a clip plays or is paused: the video or the album picture is the slide */}
        <Preview s={s} background={st.background} overlay={st.overlay} bare={st.clear || (!!clipOf(s) && st.clip !== "stopped")} live countTo={st.countTo} />
        <ClipPlayer s={s} clip={st.clip} seek={st.seek} volume={st.volume} />
        {st.lower && (
          <div className="show-lower">
            <span>{st.lower}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A video over the slide (or music behind it, or a page) on the slide screen, started and paused from
 * the presenter view; a clip's file, its length and how far it has played are told back. */
function ClipPlayer({ s, clip, seek, volume }: { s: SlideSpec; clip: Clip; seek: ShowState["seek"]; volume: number }) {
  const c = clipOf(s);
  const [url, setUrl] = useState<string | null>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const lastSeek = useRef(0);
  const lastTime = useRef(0);
  const file = c && (c.kind === "video" || c.kind === "audio") ? c.file : null;
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (file) mediaUrl(file).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file]);
  const src = c && (c.kind === "url-video" || c.kind === "url-audio") ? c.url : url;
  useEffect(() => {
    const m = media.current;
    if (m) {
      if (clip === "playing") m.play().catch(() => void emitTo("main", "show:blocked", ""));
      else m.pause();
      if (clip === "stopped") m.currentTime = 0;
    }
    // a YouTube or Vimeo video is told through its player's messages
    const w = frame.current?.contentWindow;
    if (w && c?.kind === "youtube") w.postMessage(JSON.stringify({ event: "command", func: clip === "playing" ? "playVideo" : "pauseVideo", args: [] }), "*");
    if (w && c?.kind === "embed" && c.control === "vimeo") w.postMessage(JSON.stringify({ method: clip === "playing" ? "play" : "pause" }), "*");
  }, [clip, src]); // eslint-disable-line react-hooks/exhaustive-deps
  // how loud: a file by its player's volume, a YouTube or Vimeo video through its player's messages
  useEffect(() => {
    if (media.current) media.current.volume = Math.max(0, Math.min(1, volume));
    const w = frame.current?.contentWindow;
    if (w && c?.kind === "youtube") w.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(volume * 100)] }), "*");
    if (w && c?.kind === "embed" && c.control === "vimeo") w.postMessage(JSON.stringify({ method: "setVolume", value: volume }), "*");
  }, [volume, src, clip]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (seek && seek.n !== lastSeek.current && media.current) {
      lastSeek.current = seek.n;
      media.current.currentTime = seek.to;
    }
  }, [seek]);
  if (!c || clip === "stopped") return null;
  const ended = () => void emitTo("main", "show:ended", "");
  const tell = () => {
    const m = media.current;
    const now = Date.now();
    if (m && now - lastTime.current > 250) {
      lastTime.current = now;
      void emitTo("main", "show:time", { t: m.currentTime, d: Number.isFinite(m.duration) ? m.duration : 0 });
    }
  };
  if (c.kind === "youtube")
    return <iframe ref={frame} className="show-clip" src={`https://www.youtube.com/embed/${c.id}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1`} allow="autoplay; encrypted-media; fullscreen" title={s.title} />;
  if (c.kind === "embed") return <iframe ref={frame} className="show-clip" src={c.src} allow="autoplay; encrypted-media; fullscreen" title={s.title} />;
  if (c.kind === "page") return <iframe className="show-clip show-page" src={c.url} title={s.title} />;
  if (!src) return null;
  return c.kind === "video" || c.kind === "url-video" ? (
    <video ref={media} className="show-clip" src={src} onEnded={ended} onTimeUpdate={tell} onLoadedMetadata={tell} />
  ) : (
    <audio ref={media} src={src} onEnded={ended} onTimeUpdate={tell} onLoadedMetadata={tell} />
  );
}

const SCREEN_KEY = "bc-slides-screen";
const VIEW_KEY = "bc-present-view";
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

/** Opens the slide screen: full screen on another screen if there is one (the one chosen last time, if it is
 * still there). With no other screen nothing is opened (a rehearsal), unless `force`: then on this one. */
async function openShowWindow(force: boolean): Promise<{ win: WebviewWindow | null; second: boolean; screen: Monitor | null; others: Monitor[] }> {
  const [others, here] = await Promise.all([otherScreens(), currentMonitor()]);
  let last: string | null = null;
  try {
    last = localStorage.getItem(SCREEN_KEY);
  } catch {
    /* no storage: the first other screen */
  }
  const other = others.find((m) => m.name === last) ?? others[0];
  if (!other && !force) return { win: null, second: false, screen: null, others };
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
  return { win, second: !!other, screen: other ?? null, others };
}

const two = (n: number) => String(n).padStart(2, "0");
const clockOf = (d: Date) => `${d.getHours()}:${two(d.getMinutes())}`;
const lengthOf = (secs: number) => {
  const s = Math.abs(Math.round(secs));
  const t = s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
  return secs < 0 ? `-${t}` : t;
};

interface PresenterProps {
  /** the parts of the show (notices, music, sermon: one or more), each with a tab to switch to it */
  decks: PresenterDeck[];
  /** the slide to start on, in the first part */
  start?: number;
  /** for adding a verse while presenting: the Bibles, the books, and the Bible to start with */
  versions: Version[];
  books: BookInfo[];
  versionCode: string;
  onEnd: () => void;
}

const savedAt = (key: string): number => {
  try {
    return Number(localStorage.getItem(`bc-present:${key}`)) || 0;
  } catch {
    return 0;
  }
};

/** "Present from this laptop": over the whole app window. */
export function Presenter({ decks, start = 0, versions, books, versionCode, onEnd }: PresenterProps) {
  // the slides of each part (more can be added while presenting), the part showing, and where each one is
  const [lists, setLists] = useState<SlideSpec[][]>(() => decks.map((d) => d.slides));
  const [active, setActive] = useState(0);
  const [indexes, setIndexes] = useState<number[]>(() => decks.map((d, i) => (i === 0 ? Math.max(0, Math.min(start, d.slides.length - 1)) : 0)));
  const [adding, setAdding] = useState(false);
  const [addTab, setAddTab] = useState<"verse" | "song" | "media" | "picture">("verse");
  const deck = decks[active];
  const slides = lists[active] ?? [];
  const index = indexes[active] ?? 0;
  const background = deck?.background ?? null;
  const overlay = deck?.overlay ?? null;
  const resumeKey = deck?.resumeKey ?? "";
  const [black, setBlack] = useState(false);
  const [clear, setClear] = useState(false);
  const [songEnd, setSongEnd] = useState(false);
  const [lower, setLower] = useState<string | null>(null);
  const [lowerText, setLowerText] = useState("");
  const [volume, setVolume] = useState(1);
  const [countTo, setCountTo] = useState<number | null>(null);
  const [railQuery, setRailQuery] = useState("");
  const [railSort, setRailSort] = useState<"order" | "az">("order");
  const [clip, setClip] = useState<Clip>("stopped");
  const [seek, setSeek] = useState<ShowState["seek"]>(null);
  const [test, setTest] = useState<string | null>(null);
  const [time, setTime] = useState<{ t: number; d: number } | null>(null);
  const [win, setWin] = useState<WebviewWindow | null>(null);
  const [mode, setMode] = useState<"opening" | "screen" | "rehearsal">("opening");
  const [screens, setScreens] = useState<Monitor[]>([]);
  const [screen, setScreen] = useState<Monitor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [began, setBegan] = useState(() => Date.now());
  const [countdown, setCountdown] = useState<number | null>(null);
  const [askCount, setAskCount] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}").view === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [size, setSize] = useState<number>(() => {
    try {
      return Math.min(320, Math.max(120, Number(JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}").size) || 190));
    } catch {
      return 190;
    }
  });
  // where each part stopped last time (offered, not forced; starting from a chosen slide skips the offer)
  const [resumes] = useState<number[]>(() => decks.map((d, i) => (i === 0 && start > 0 ? 0 : savedAt(d.resumeKey))));
  const [resumeSeen, setResumeSeen] = useState<boolean[]>(() => decks.map(() => false));
  const resume = resumes[active] ?? 0;
  const resumeShown = resume > 0 && resume < slides.length && !resumeSeen[active];
  const seenResume = (a: number) => setResumeSeen((r) => r.map((v, i) => (i === a ? true : v)));
  const grid = useRef<HTMLOListElement>(null);
  const winRef = useRef<WebviewWindow | null>(null);
  const alive = useRef(true);

  // the slide screen: opened once (on another screen if there is one), closed when the show ends
  const attach = useCallback(
    (r: { win: WebviewWindow | null; second: boolean; screen: Monitor | null; others: Monitor[] }) => {
      setScreens(r.others);
      if (!r.win) {
        setMode("rehearsal");
        return;
      }
      winRef.current = r.win;
      setWin(r.win);
      setMode("screen");
      setScreen(r.screen);
      // closed some other way (Alt+F4): the show is over
      void r.win.once("tauri://destroyed", () => alive.current && onEnd());
    },
    [onEnd],
  );
  useEffect(() => {
    alive.current = true;
    // a flag of this run alone: React may run this twice at the start, and the first run's window must be closed
    let live = true;
    openShowWindow(false)
      .then((r) => (live ? attach(r) : void r.win?.close()))
      .catch((e) => live && setError(`The slide screen couldn't be opened: ${e}`));
    return () => {
      live = false;
      alive.current = false;
      void winRef.current?.close();
      winRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const findScreens = async () => {
    setError(null);
    try {
      if (winRef.current) setScreens(await otherScreens());
      else attach(await openShowWindow(false));
    } catch (e) {
      setError(`The screens couldn't be looked for: ${e}`);
    }
  };
  const showHere = async () => {
    setError(null);
    try {
      attach(await openShowWindow(true));
    } catch (e) {
      setError(`The slide screen couldn't be opened: ${e}`);
    }
  };

  const go = useCallback(
    (to: number) => {
      const n = Math.max(0, Math.min(slides.length - 1, to));
      if (n !== index) {
        setClip("stopped");
        setTime(null);
      }
      setIndexes((p) => p.map((v, i) => (i === active ? n : v)));
      // the next slide brings the words and the picture back
      setBlack(false);
      setClear(false);
      setSongEnd(false);
      setResumeSeen((r) => r.map((v, i) => (i === active ? true : v)));
    },
    [slides.length, index, active],
  );
  /** another part of the show: it shows where it was left */
  const switchTo = useCallback(
    (a: number) => {
      if (a === active || !decks[a]) return;
      setActive(a);
      setClip("stopped");
      setTime(null);
      setBlack(false);
      setClear(false);
      setSongEnd(false);
    },
    [active, decks],
  );
  /** slides put in after the one showing; shown at once if asked. They are for this show only. */
  const addSlides = (add: SlideSpec[], show: boolean) => {
    if (add.length === 0) return;
    // a song goes after the end of the song showing, not into the middle of it
    const at = add[0].song && slides[index]?.song ? (groups[groupOf[index]]?.to ?? index + 1) - 1 : index;
    setLists((l) => l.map((list, i) => (i === active ? [...list.slice(0, at + 1), ...add, ...list.slice(at + 1)] : list)));
    if (show) {
      setIndexes((p) => p.map((v, i) => (i === active ? at + 1 : v)));
      setClip("stopped");
      setTime(null);
      setBlack(false);
    }
    seenResume(active);
    setAdding(false);
  };
  const { groups, groupOf } = useMemo(() => groupsOf(slides), [slides]);
  const toggleBlack = useCallback(() => {
    setBlack((b) => !b);
    setSongEnd(false);
  }, []);
  // In the music, the end of a song stops there: the screen goes black ("end of the song") and the next press, or a
  // click on the next song, starts the next one. (Otherwise every song would run into the next, one long show.)
  const atSongEnd = deck?.kind === "music" && !!groups[groupOf[index]] && groups[groupOf[index]].to === index + 1 && index + 1 < slides.length;
  const step = useCallback(
    (d: number) => {
      if (d > 0 && atSongEnd && !black) {
        setBlack(true);
        setSongEnd(true);
        setClip("stopped");
        return;
      }
      go(index + d);
    },
    [go, index, atSongEnd, black],
  );

  const end = useCallback(() => {
    void winRef.current?.close();
    onEnd();
  }, [onEnd]);

  const cur = slides[index];
  // a countdown slide starts counting when it comes on the screen
  const curKind = cur?.kind;
  const curBody = cur?.body ?? "";
  useEffect(() => {
    setCountTo(curKind === "countdown" ? targetOf(curBody, Date.now()) : null);
  }, [index, active, curKind, curBody]);
  const next = slides[index + 1];
  const c = clipOf(cur);
  const playPause = useCallback(() => {
    setBlocked(false);
    setClip((k) => (k === "playing" ? (c && canPause(c) ? "paused" : "stopped") : "playing"));
  }, [c]);

  const key = useCallback(
    (k: string) => {
      const jump = slideForLetter(groups, k);
      if (/^[1-9]$/.test(k)) switchTo(Number(k) - 1);
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "n", "N"].includes(k)) step(1);
      else if (k === "Enter") {
        if (c) playPause();
        else step(1);
      }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(k)) step(-1);
      else if (k === "Home") go(0);
      else if (k === "End") go(slides.length - 1);
      else if (k === "b" || k === "B" || k === ".") toggleBlack();
      else if (k === "Escape") setClear((c) => !c);
      else if (jump !== null) go(jump);
    },
    [step, go, slides.length, groups, c, playPause, switchTo, toggleBlack],
  );

  // keys pressed here, and on the slide screen (sent across)
  const addingNow = useRef(false);
  addingNow.current = adding;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (addingNow.current) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      key(e.key);
    };
    window.addEventListener("keydown", down);
    const offs = [
      listen<string>("show:key", (e) => !addingNow.current && key(e.payload)),
      listen("show:ended", () => setClip("stopped")),
      listen("show:blocked", () => setBlocked(true)),
      listen<{ t: number; d: number }>("show:time", (e) => setTime(e.payload)),
    ];
    return () => {
      window.removeEventListener("keydown", down);
      offs.forEach((p) => void p.then((un) => un()));
    };
  }, [key]);

  // what the slide screen shows: sent on every change, and when it says it is ready
  const state: ShowState = { slides, background, index, black, clear, lower, volume, overlay, countTo, clip, seek, test };
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    if (win) void emitTo(win.label, "show:state", state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, slides, background, index, black, clear, lower, volume, overlay, countTo, clip, seek, test]);
  useEffect(() => {
    const off = listen<string>("show:ready", (e) => void emitTo(e.payload, "show:state", latest.current));
    return () => void off.then((un) => un());
  }, []);

  // the place is kept, so a show stopped by accident can be taken up again
  // (not while the offer is still showing, or an offer ignored would wipe the place it was offering)
  useEffect(() => {
    if (resumeShown || !resumeKey) return;
    try {
      localStorage.setItem(`bc-present:${resumeKey}`, String(index));
    } catch {
      /* not remembered */
    }
  }, [index, resumeKey, resumeShown]);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ view, size }));
    } catch {
      /* not remembered */
    }
  }, [view, size]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    grid.current?.querySelector(".live")?.scrollIntoView({ block: "nearest" });
  }, [index, view]);
  useEffect(() => {
    if (!test) return;
    const t = setTimeout(() => setTest(null), 4000);
    return () => clearTimeout(t);
  }, [test]);
  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), 4000);
    return () => clearTimeout(t);
  }, [confirmEnd]);

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

  const openOutside = async () => {
    if (!cur?.link) return;
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const { api } = await import("../api");
    if (cur.link.startsWith("media:")) await api.sermonMediaOpen(cur.link.slice(6));
    else await openUrl(cur.link);
  };
  const jumpTo = (to: number) => setSeek({ n: Date.now(), to: Math.max(0, time?.d ? Math.min(to, time.d) : to) });

  const elapsed = Math.max(0, Math.floor((now.getTime() - began) / 1000));
  const remaining = countdown !== null ? countdown - elapsed : null;
  const thumbStyle = { "--thumb": `${size}px` } as React.CSSProperties;
  const light = black ? "red" : mode === "screen" ? "green" : mode === "rehearsal" ? "amber" : "grey";

  return (
    <div className="presenter pr" role="dialog" aria-modal="true" aria-label="Present from this laptop">
      <header className="pr-top">
        <strong className="pr-title">{deck?.title || (deck ? KIND_NAME[deck.kind] : "")}</strong>
        <span className="pr-status" title={mode === "screen" ? "The slides are on the projector or second screen" : mode === "rehearsal" ? "Only one screen: the preview is the room" : "Opening the slide screen"}>
          <i className={"pr-light " + light} /> Audience
          <span className="muted">{black ? "black" : mode === "screen" ? screen ? screenName(screen) : "this screen" : mode === "rehearsal" ? "rehearsal" : "…"}</span>
        </span>
        <span className="pr-clock" title="The time now">
          {clockOf(now)}
        </span>
        <span className="pr-timer" title={remaining !== null ? "Time left" : "How long the show has been going"}>
          <span className={remaining !== null && remaining < 60 ? "warn" : undefined}>{lengthOf(remaining !== null ? remaining : elapsed)}</span>
          <button className="link-btn" onClick={() => setBegan(Date.now())}>
            restart
          </button>
          {askCount ? (
            <form
              className="pr-count"
              onSubmit={(e) => {
                e.preventDefault();
                const m = Number((e.currentTarget.elements.namedItem("mins") as HTMLInputElement).value);
                if (m > 0) {
                  setCountdown(Math.round(m * 60));
                  setBegan(Date.now());
                }
                setAskCount(false);
              }}
            >
              <input name="mins" type="number" min="1" max="180" placeholder="minutes" autoFocus aria-label="Minutes to count down from" />
              <button className="link-btn" type="submit">
                start
              </button>
            </form>
          ) : (
            <button className="link-btn" onClick={() => (countdown !== null ? setCountdown(null) : setAskCount(true))}>
              {countdown !== null ? "count up" : "count down…"}
            </button>
          )}
        </span>
        <span className="pr-tools">
          <button
            className="outline-btn"
            onClick={() => {
              setAddTab("verse");
              setAdding(true);
            }}
            title="Add a verse, a song, music, a video, a link or a picture after this slide"
          >
            + Add
          </button>
          <button className={"outline-btn" + (clear ? " on" : "")} onClick={() => setClear((c) => !c)} title="Take the words off the screen and leave the background (Esc). The next slide brings them back.">
            {clear ? "Words back" : "Clear"}
          </button>
          <button className={"outline-btn" + (black ? " on" : "")} onClick={toggleBlack} title="Black out the whole screen the room sees (B or full stop)">
            {black ? "Show the screen" : "Black"}
          </button>
          <button className={"pill-btn" + (confirmEnd ? " danger" : "")} onClick={() => (confirmEnd ? end() : setConfirmEnd(true))} title="End the show">
            {confirmEnd ? "Click again to end" : "End the show"}
          </button>
        </span>
      </header>
      {error && <p className="error pr-msg">{error}</p>}
      {mode === "rehearsal" && (
        <p className="pr-msg pr-rehearsal">
          <strong>Rehearsal.</strong> Only one screen was found, so the preview on the right is what the room would see. Connect the projector (Windows key + P, then Extend), then{" "}
          <button className="link-btn" onClick={() => void findScreens()}>
            find the screen
          </button>
          , or{" "}
          <button className="link-btn" onClick={() => void showHere()}>
            show the slides full screen here
          </button>
          .
        </p>
      )}
      {decks.length > 1 && (
        <nav className="pr-tabs" aria-label="The parts of the service">
          {decks.map((d, i) => (
            <button key={i} className={i === active ? "on" : undefined} onClick={() => switchTo(i)} aria-current={i === active ? "true" : undefined} title={`Show ${d.title} (key ${i + 1})`}>
              <b>{KIND_NAME[d.kind]}</b>
              <span>{d.title}</span>
              <i>
                {(indexes[i] ?? 0) + 1}/{lists[i]?.length ?? 0}
              </i>
            </button>
          ))}
        </nav>
      )}
      {resumeShown && (
        <div className="pr-msg pr-resume" role="status">
          <span>
            Last time you stopped at <strong>slide {resume + 1}</strong>.
          </span>
          <button className="pill-btn" onClick={() => go(resume)} autoFocus>
            Continue from slide {resume + 1}
          </button>
          <button className="outline-btn" onClick={() => seenResume(active)}>
            Start at slide 1
          </button>
        </div>
      )}

      <div className={"pr-body" + (deck?.kind === "music" ? " with-rail" : "")}>
        {deck?.kind === "music" && (
          <aside className="pr-rail" aria-label="The songs: click one to start it">
            <div className="pr-rail-head">
              <strong>Songs</strong>
              <span className="muted">{groups.length}</span>
            </div>
            <div className="pr-rail-tools">
              <input value={railQuery} onChange={(e) => setRailQuery(e.target.value)} placeholder="Find a song…" aria-label="Find a song in this list" />
              <select value={railSort} onChange={(e) => setRailSort(e.target.value as "order" | "az")} aria-label="Sort the songs" title="Sort the songs">
                <option value="order">In order</option>
                <option value="az">A to Z</option>
              </select>
            </div>
            <ol className="pr-rail-list">
              {groups
                .map((g, gi) => ({ g, gi }))
                .filter(({ g }) => g.name.toLowerCase().includes(railQuery.trim().toLowerCase()))
                .sort((a, b) => (railSort === "az" ? a.g.name.localeCompare(b.g.name) || a.gi - b.gi : a.gi - b.gi))
                .map(({ g, gi }) => (
                  <li key={gi} className={gi === groupOf[index] ? "live" : undefined}>
                    <button onClick={() => go(g.from)} aria-current={gi === groupOf[index] ? "true" : undefined} title={`Start ${g.name}`}>
                      <b>{gi + 1}</b>
                      <span>{g.name}</span>
                      <i>{g.to - g.from}</i>
                      {g.letter && <kbd>{g.letter}</kbd>}
                    </button>
                  </li>
                ))}
              {groups.length === 0 && <li className="muted">No songs yet.</li>}
            </ol>
            <button
              className="outline-btn"
              onClick={() => {
                setAddTab("song");
                setAdding(true);
              }}
              title="Choose more songs from your saved ones, or look one up"
            >
              + More songs
            </button>
          </aside>
        )}
        <section className="pr-slides" aria-label="The slides: click one to show it">
          {view === "grid" ? (
            <ol className="pr-grid" ref={grid} style={thumbStyle}>
              {slides.map((s, i) => {
                const g = groups[groupOf[i]];
                const first = g.from === i;
                const cl = clipOf(s);
                const kind = stripKind(s, clipType(cl));
                return (
                  <Fragment key={i}>
                    {first && deck?.kind === "music" && (
                      <li className="pr-group-head">
                        <button onClick={() => go(g.from)} title="Start this song">
                          <b>{groupOf[i] + 1}</b>
                          <span>{g.name}</span>
                          <i>{g.to - g.from} slides</i>
                          {g.letter && <kbd>{g.letter}</kbd>}
                        </button>
                      </li>
                    )}
                  <li className={(i === index ? "live " : i === index + 1 ? "next " : "") + "k-" + kind}>
                    <button
                      onClick={() => go(i)}
                      onDoubleClick={() => {
                        go(i);
                        if (cl) setClip("playing");
                      }}
                      aria-label={`Slide ${i + 1}: ${s.title}`}
                      aria-current={i === index ? "true" : undefined}
                    >
                      <span className="pr-thumb">
                        <Preview s={s} background={background} overlay={overlay} />
                        {first && g.letter && <b className="pr-letter">{g.letter}</b>}
                        {s.kind === "link" && <b className="pr-play">{cl ? "▶" : "↗"}</b>}
                      </span>
                      <span className="pr-strip">
                        <b>{i + 1}</b>
                        <span>{first ? g.name : s.section ?? STRIP_LABEL[kind]}</span>
                      </span>
                    </button>
                  </li>
                  </Fragment>
                );
              })}
            </ol>
          ) : (
            <ol className="pr-list" ref={grid}>
              {slides.map((s, i) => {
                const g = groups[groupOf[i]];
                const kind = stripKind(s, clipType(clipOf(s)));
                return (
                  <li key={i} className={(i === index ? "live " : i === index + 1 ? "next " : "") + "k-" + kind}>
                    <button onClick={() => go(i)} aria-current={i === index ? "true" : undefined}>
                      <b className="pr-n">{i + 1}</b>
                      <span className="pr-chip">{g.from === i ? g.name : s.section ?? STRIP_LABEL[kind]}</span>
                      <span className="pr-text">
                        <strong>{s.title}</strong> {s.kind === "scripture" ? s.body.slice(0, 120) : s.body.slice(0, 100)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <footer className="pr-foot">
            <span className="muted">
              {slides.length} slides · {groups.length} groups
            </span>
            <span className="pr-views" role="group" aria-label="How the slides are shown">
              <button className={view === "grid" ? "on" : undefined} onClick={() => setView("grid")} aria-label="Grid" title="Grid of slides">
                ▦
              </button>
              <button className={view === "list" ? "on" : undefined} onClick={() => setView("list")} aria-label="List" title="List of slides">
                ☰
              </button>
              <input type="range" min="120" max="320" value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Slide size" title="Slide size" disabled={view === "list"} />
            </span>
          </footer>
        </section>

        <aside className="pr-side">
          <div className="pr-preview-head">
            <span className="muted">Slide {index + 1} of {slides.length}</span>
            {screens.length > 1 && win && (
              <select
                value={screen ? `${screen.position.x},${screen.position.y}` : ""}
                onChange={(e) => {
                  const m = screens.find((s) => `${s.position.x},${s.position.y}` === e.target.value);
                  if (m) void moveTo(m);
                }}
                aria-label="Which screen shows the slides"
              >
                {screens.map((m) => (
                  <option key={`${m.position.x},${m.position.y}`} value={`${m.position.x},${m.position.y}`}>
                    {screenName(m)}
                  </option>
                ))}
              </select>
            )}
            <button className="link-btn" onClick={() => (screen ? setTest(screenName(screen)) : void findScreens())} title={screen ? "Show a test pattern on the screen the room sees" : "Look for the projector"}>
              {screen ? "Test screen" : "Find screen"}
            </button>
          </div>
          <div className={"pr-preview" + (black ? " black" : "")}>
            {cur && <Preview s={cur} background={background} overlay={overlay} bare={clear || (!!clipOf(cur) && clip !== "stopped")} live countTo={countTo} />}
            {mode === "rehearsal" && !black && cur && <ClipPlayer s={cur} clip={clip} seek={seek} volume={volume} />}
            {lower && (
              <div className="show-lower">
                <span>{lower}</span>
              </div>
            )}
            {black && <span className="pr-blackmsg">{songEnd ? "End of the song: press Next, or choose the next song" : "Black: the room sees nothing"}</span>}
          </div>

          {c && cur?.kind === "link" && (
            <div className="pr-clip">
              <div className="pr-clip-btns">
                <button className="pill-btn" onClick={playPause}>
                  {clip === "playing" ? (canPause(c) ? "❚❚ Pause" : "■ Stop") : clip === "paused" ? "▶ Carry on" : `▶ Play ${clipWord(c)} on the screen`}
                </button>
                {clip !== "stopped" && (
                  <button className="outline-btn" onClick={() => setClip("stopped")}>
                    ■ Stop
                  </button>
                )}
              </div>
              {canSeek(c) && clip !== "stopped" && (
                <div className="pr-transport">
                  <button className="text-btn" onClick={() => jumpTo((time?.t ?? 0) - 15)} aria-label="Back 15 seconds" title="Back 15 seconds">
                    ⟲ 15
                  </button>
                  <input type="range" min="0" max={Math.max(1, Math.floor(time?.d ?? 0))} value={Math.floor(time?.t ?? 0)} onChange={(e) => jumpTo(Number(e.target.value))} aria-label="How far it has played" />
                  <button className="text-btn" onClick={() => jumpTo((time?.t ?? 0) + 15)} aria-label="Forward 15 seconds" title="Forward 15 seconds">
                    15 ⟳
                  </button>
                  <span className="muted pr-times">
                    {lengthOf(time?.t ?? 0)} / {lengthOf(time?.d ?? 0)}
                  </span>
                </div>
              )}
              <label className="pr-volume" title="How loud it plays on the screen">
                <span className="muted">Volume</span>
                <input type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} aria-label="Volume" />
              </label>
              {needsInternet(c) && <span className="muted">Plays from the web: needs the internet. {c.kind === "page" ? "If the page stays blank, that site will not be shown inside another page." : ""}</span>}
              {blocked && <span className="error">Windows didn't let it start: click the slide screen once, then press Play again.</span>}
            </div>
          )}
          {cur?.kind === "link" && !c && (
            <div className="pr-clip">
              <button className="outline-btn" onClick={() => void openOutside()}>
                Open it on this laptop
              </button>
              <span className="muted">This is a file or address that cannot play on the screen; it opens here, not for the room.</span>
            </div>
          )}

          <form
            className="pr-lower"
            onSubmit={(e) => {
              e.preventDefault();
              setLower(lowerText.trim() || null);
            }}
          >
            <input value={lowerText} onChange={(e) => setLowerText(e.target.value)} placeholder="A line for the foot of the screen: a name, a verse" aria-label="A line for the foot of the screen" />
            <button className="outline-btn" type="submit" disabled={!lowerText.trim()}>
              Show
            </button>
            {lower && (
              <button
                className="outline-btn"
                type="button"
                onClick={() => {
                  setLower(null);
                }}
              >
                Hide
              </button>
            )}
          </form>
          <div className="pr-steps">
            <button className="outline-btn" onClick={() => step(-1)} disabled={index === 0}>
              ← Back
            </button>
            <button className="pill-btn" onClick={() => step(1)} disabled={index >= slides.length - 1}>
              Next →
            </button>
          </div>
          <div className="pr-info">
            <span className="muted">Your notes</span>
            <div className="pr-notes">{cur?.notes?.trim() || <span className="muted">No notes for this slide.</span>}</div>
            <span className="muted">Next</span>
            {next ? <div className="pr-next"><Preview s={next} background={background} overlay={overlay} /></div> : <div className="pr-end">The end of the slides</div>}
          </div>
          <p className="pr-keys muted">
            → Space next · ← back · Enter plays a video or link · B or . black · Esc clears the words · a letter on a group jumps to it{decks.length > 1 ? " · 1 2 3 switch part" : ""} · click a slide to show it
          </p>
        </aside>
      </div>
      {adding && <LiveAdd versions={versions} books={books} versionCode={versionCode} start={addTab} onUse={addSlides} onClose={() => setAdding(false)} />}
    </div>
  );
}
