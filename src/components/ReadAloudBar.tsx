import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { NATURAL_VOICES, ReadAloudPrefs, ReaderState } from "../readAloud";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, GripIcon, PauseIcon, PlayIcon } from "./icons";

interface Props {
  state: ReaderState;
  prefs: ReadAloudPrefs;
  /** "2 Kings 1", or "the selection" */
  label: string;
  /** offer "Carry on to the next chapter" (not when reading a selection) */
  showContinue: boolean;
  onPrefs: (p: ReadAloudPrefs) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** back / forward a whole paragraph or verse */
  onPrevGroup: () => void;
  onNextGroup: () => void;
  /** what a group is called here: "paragraph" or "verse" */
  groupName: string;
  /** minutes left to choose from (0 = off), or "end" = stop where this chapter ends */
  sleep: number | "end";
  onSleep: (v: number | "end") => void;
}

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const POS_KEY = "readAloud:barPos";

type Pos = { x: number; y: number } | null;

function readPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    return p && typeof p.x === "number" && typeof p.y === "number" ? p : null;
  } catch {
    return null;
  }
}

function savePos(p: Pos) {
  try {
    if (p) localStorage.setItem(POS_KEY, JSON.stringify(p));
    else localStorage.removeItem(POS_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}

/** The read-aloud controls: a floating panel that can be dragged anywhere by its grip
 * (the position is remembered; double-click the grip to put it back at the bottom). */
export function ReadAloudBar({ state, prefs, label, showContinue, onPrefs, onPause, onResume, onStop, onPrev, onNext, onPrevGroup, onNextGroup, groupName, sleep, onSleep }: Props) {
  const playing = state.status === "playing";
  const [pos, setPos] = useState<Pos>(readPos);
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // keep it on screen if the window is made smaller
  useEffect(() => {
    const fit = () =>
      setPos((p) => {
        const el = barRef.current;
        if (!p || !el) return p;
        const x = Math.max(4, Math.min(p.x, window.innerWidth - el.offsetWidth - 4));
        const y = Math.max(4, Math.min(p.y, window.innerHeight - el.offsetHeight - 4));
        return x === p.x && y === p.y ? p : { x, y };
      });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function moveDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const el = barRef.current;
    if (!drag.current || !el) return;
    const x = Math.max(4, Math.min(e.clientX - drag.current.dx, window.innerWidth - el.offsetWidth - 4));
    const y = Math.max(4, Math.min(e.clientY - drag.current.dy, window.innerHeight - el.offsetHeight - 4));
    setPos({ x, y });
  }

  function endDrag() {
    if (!drag.current) return;
    drag.current = null;
    setPos((p) => {
      savePos(p);
      return p;
    });
  }

  const where = state.verse && state.verse > 0 ? `${label}:${state.verse}` : label;

  return (
    <div
      ref={barRef}
      className={"read-aloud-bar" + (pos ? " is-placed" : "")}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      role="region"
      aria-label="Read aloud"
    >
      <div className="read-aloud-main">
        <div
          className="read-aloud-grip"
          title="Drag to move · double-click to put back"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => {
            setPos(null);
            savePos(null);
          }}
        >
          <GripIcon size={16} />
        </div>
        <button className="icon-round skip-group" onClick={onPrevGroup} title={`Back to the start of this ${groupName}, then the one before`} aria-label={`Previous ${groupName}`}>
          <ChevronLeftIcon size={13} />
          <ChevronLeftIcon size={13} />
        </button>
        <button className="icon-round" onClick={onPrev} title="Back one sentence (←)" aria-label="Previous sentence">
          <ChevronLeftIcon size={16} />
        </button>
        <button
          className="icon-round primary"
          onClick={playing ? onPause : onResume}
          disabled={state.status === "preparing"}
          title={playing ? "Pause (Space)" : "Continue (Space)"}
          aria-label={playing ? "Pause" : "Continue"}
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
        <button className="icon-round" onClick={onNext} title="Skip ahead one sentence (→)" aria-label="Next sentence">
          <ChevronRightIcon size={16} />
        </button>
        <button className="icon-round skip-group" onClick={onNextGroup} title={`Skip to the next ${groupName}`} aria-label={`Next ${groupName}`}>
          <ChevronRightIcon size={13} />
          <ChevronRightIcon size={13} />
        </button>
        <span className="read-aloud-label" aria-live="polite">
          {state.status === "preparing" ? "Preparing the voice…" : `${state.status === "paused" ? "Paused" : "Reading"} ${where}`}
        </span>
        <button className="icon-round" onClick={onStop} title="Stop reading" aria-label="Stop reading">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="read-aloud-options">
        {state.engine === "natural" ? (
          <select value={prefs.voice} onChange={(e) => onPrefs({ ...prefs, voice: e.target.value })} aria-label="Voice">
            {NATURAL_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted" title="The natural voice can be downloaded in Settings › Read aloud">
            Built-in voice
          </span>
        )}
        <select value={prefs.speed} onChange={(e) => onPrefs({ ...prefs, speed: Number(e.target.value) })} aria-label="Reading speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s === 1 ? "Normal speed" : `${s}×`}
            </option>
          ))}
        </select>
        <select
          value={sleep}
          onChange={(e) => onSleep(e.target.value === "end" ? "end" : Number(e.target.value))}
          aria-label="Sleep timer"
          title="Stop reading by itself after a while"
        >
          <option value={0}>No sleep timer</option>
          {[15, 30, 60].map((m) => (
            <option key={m} value={m}>
              Stop after {m} min
            </option>
          ))}
          <option value="end">Stop at the end of this chapter</option>
        </select>
        {showContinue && (
          <label className="read-aloud-check">
            <input type="checkbox" checked={prefs.continueChapters} onChange={(e) => onPrefs({ ...prefs, continueChapters: e.target.checked })} />{" "}
            Carry on to the next chapter
          </label>
        )}
      </div>
      {state.message && <p className="read-aloud-message">{state.message}</p>}
    </div>
  );
}
