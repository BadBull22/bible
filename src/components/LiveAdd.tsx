import { useEffect, useState } from "react";
import type { BookInfo, Version } from "../api";
import type { SlideSpec } from "../sermonOutputs";
import { CloseIcon } from "./icons";
import { MediaAdder } from "./MediaAdder";
import { SongPicker } from "./SongLibrary";
import { VerseFinder } from "./VerseFinder";
import { backdrop } from "../backdrop";

type Tab = "verse" | "song" | "media" | "picture";

const TABS: [Tab, string][] = [
  ["verse", "A Bible verse"],
  ["song", "A song"],
  ["media", "Music, video or link"],
  ["picture", "A picture"],
];

/** "Add to the show" while presenting: a verse, a song from the library, music, a video or a link, or a picture,
 * put in after the slide that is showing, and shown at once if asked. */
export function LiveAdd({ versions, books, versionCode, start = "verse", onUse, onClose }: { versions: Version[]; books: BookInfo[]; versionCode: string; start?: Tab; onUse: (slides: SlideSpec[], show: boolean) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(start);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Add to the show" {...backdrop(onClose)}>
      <div className="mp live-add" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>Add to the show</strong>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="mode-toggle" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="mp-body">
          {tab === "verse" && <VerseFinder versions={versions} books={books} versionCode={versionCode} onUse={onUse} />}
          {tab === "song" && <SongPicker showNow onUse={(slides, _song, show) => onUse(slides, show)} />}
          {tab === "media" && <MediaAdder onUse={onUse} />}
          {tab === "picture" && <MediaAdder only="picture" onUse={onUse} />}
        </div>
      </div>
    </div>
  );
}
