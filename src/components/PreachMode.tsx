import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type SheetBlock, type SheetRun } from "../api";

interface Props {
  /** the sermon as a document (sermonBlocks, without blank lines or questions) */
  blocks: SheetBlock[];
  /** minutes the sermon should take (0: no target) */
  targetMinutes: number;
  onClose: () => void;
}

const PREFS_KEY = "preach:prefs";

function loadPrefs(): { size: number; dark: boolean; paged: boolean } {
  try {
    return { size: 1.6, dark: true, paged: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { size: 1.6, dark: true, paged: false };
  }
}

/** Opens a run's link: a web address in the browser, a kept file in its program. */
function follow(link: string) {
  if (link.startsWith("media:")) void api.sermonMediaOpen(link.slice(6)).catch(() => undefined);
  else if (/^https?:/.test(link)) void openUrl(link).catch(() => undefined);
}

const runs = (rs: SheetRun[]) =>
  rs.map((r, i) =>
    r.link ? (
      <button
        key={i}
        className="preach-link"
        onClick={(e) => {
          e.stopPropagation();
          follow(r.link!);
        }}
      >
        {r.text}
      </button>
    ) : (
      <span key={i} style={{ fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? "italic" : undefined }}>
        {r.text}
      </span>
    ),
  );

function Block({ b }: { b: SheetBlock }) {
  switch (b.kind) {
    case "title":
      return <h1>{b.text}</h1>;
    case "subtitle":
      return <p className="preach-sub">{b.text}</p>;
    case "heading":
      return <h2>{b.text}</h2>;
    case "subheading":
      return <h3>{b.text}</h3>;
    case "quote":
      return <blockquote>{runs(b.runs)}</blockquote>;
    case "para":
      return <p>{runs(b.runs)}</p>;
    case "image":
      return (
        <figure className="preach-picture">
          <img src={b.src} alt={b.caption} />
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
    default:
      return null;
  }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The sermon full screen, for the pulpit: large text that scrolls, or one section at a
 * time (← → or Space), a clock against the target length, and light or dark. */
export function PreachMode({ blocks, targetMinutes, onClose }: Props) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [page, setPage] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // only what has something in it: a heading with nothing under it (a section not written
  // yet) is left out
  const shownBlocks = useMemo(() => {
    const rank = (b: SheetBlock) => (b.kind === "heading" ? 1 : b.kind === "subheading" ? 2 : 0);
    return blocks.filter((b, i) => {
      if (b.kind === "lines") return false;
      const r = rank(b);
      if (r === 0) return true;
      for (let j = i + 1; j < blocks.length; j++) {
        const rj = rank(blocks[j]);
        if (blocks[j].kind === "lines") continue;
        if (rj === 0) return true;
        if (rj <= r) return false;
      }
      return false;
    });
  }, [blocks]);

  // one page per heading; the title and big idea are the first page
  const pages = useMemo(() => {
    const out: SheetBlock[][] = [[]];
    for (const b of shownBlocks) {
      if (b.kind === "lines") continue;
      if (b.kind === "heading" && out[out.length - 1].length) out.push([]);
      out[out.length - 1].push(b);
    }
    return out;
  }, [shownBlocks]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* a convenience only */
    }
  }, [prefs]);

  useEffect(() => {
    const w = getCurrentWindow();
    void w.setFullscreen(true).catch(() => undefined);
    return () => void w.setFullscreen(false).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!running) return;
    const started = Date.now() - elapsed * 1000;
    const t = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (prefs.paged && (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")) {
        e.preventDefault();
        setPage((p) => Math.min(pages.length - 1, p + 1));
      } else if (prefs.paged && (e.key === "ArrowLeft" || e.key === "PageUp")) {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      } else if (e.key === "+" || e.key === "=") setPrefs((p) => ({ ...p, size: Math.min(3, Math.round((p.size + 0.1) * 10) / 10) }));
      else if (e.key === "-") setPrefs((p) => ({ ...p, size: Math.max(1, Math.round((p.size - 0.1) * 10) / 10) }));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.paged, pages.length, onClose]);

  const over = targetMinutes > 0 && elapsed > targetMinutes * 60;
  const shown = prefs.paged ? pages[Math.min(page, pages.length - 1)] ?? [] : shownBlocks;

  return (
    <div className={"preach" + (prefs.dark ? " dark" : "")} role="dialog" aria-label="Preach mode">
      <div className="preach-bar">
        <button className={"preach-clock" + (over ? " over" : "")} onClick={() => setRunning((r) => !r)} title={running ? "Pause the clock" : "Start the clock"}>
          {running ? "❚❚" : "▶"} {clock(elapsed)}
          {targetMinutes > 0 && <span> / {targetMinutes}:00</span>}
        </button>
        <button className="text-btn" onClick={() => setElapsed(0)} title="Reset the clock">
          Reset
        </button>
        <span className="preach-spacer" />
        {prefs.paged && (
          <span className="preach-pages">
            <button className="text-btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              ‹ Back
            </button>
            {page + 1} / {pages.length}
            <button className="text-btn" onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))} disabled={page >= pages.length - 1}>
              Next ›
            </button>
          </span>
        )}
        <button className="text-btn" onClick={() => setPrefs((p) => ({ ...p, paged: !p.paged }))}>
          {prefs.paged ? "Scroll it all" : "One section at a time"}
        </button>
        <button className="text-btn" onClick={() => setPrefs((p) => ({ ...p, size: Math.max(1, Math.round((p.size - 0.1) * 10) / 10) }))} aria-label="Smaller text">
          A−
        </button>
        <button className="text-btn" onClick={() => setPrefs((p) => ({ ...p, size: Math.min(3, Math.round((p.size + 0.1) * 10) / 10) }))} aria-label="Larger text">
          A+
        </button>
        <button className="text-btn" onClick={() => setPrefs((p) => ({ ...p, dark: !p.dark }))}>
          {prefs.dark ? "Light" : "Dark"}
        </button>
        <button className="pill-btn" onClick={onClose} title="Leave preach mode (Esc)">
          Close
        </button>
      </div>
      <div className="preach-page" style={{ fontSize: `${prefs.size}rem` }} onClick={() => prefs.paged && setPage((p) => Math.min(pages.length - 1, p + 1))}>
        {shown.map((b, i) => (
          <Block key={i} b={b} />
        ))}
      </div>
    </div>
  );
}
