// The rows of More > Downloads: every add-on the app can download, together, each one a title, a few words, and its state with one button. No paragraphs.

import { useState, type ReactNode } from "react";

/** What every download (Advanced search, Original words, the picture packs) offers. */
export interface PackLike {
  /** null until known */
  installed: boolean | null;
  size: number;
  /** the percentage downloaded, while downloading */
  downloading: number | null;
  error: string | null;
  install: () => Promise<void>;
  remove: () => Promise<void>;
}

/** A download: "Advanced search · Find verses by meaning", then Get (31 MB), a progress bar while it comes, or ✓ and Remove. */
export function DownloadRow({ title, note, pack }: { title: string; note?: string; pack: PackLike }) {
  return (
    <div className="dl-row">
      <div className="dl-main">
        <strong>{title}</strong>
        {note && <small>{note}</small>}
      </div>
      <div className="dl-act">
        {pack.downloading != null ? (
          <span className="dl-pct">{pack.downloading}%</span>
        ) : pack.installed ? (
          <>
            <span className="dl-ok" aria-label="Downloaded">
              ✓
            </span>
            <button onClick={() => void pack.remove()} aria-label={`Remove ${title}`}>
              Remove
            </button>
          </>
        ) : (
          <button className="primary" disabled={pack.installed === null} onClick={() => void pack.install()}>
            Get · {pack.size} MB
          </button>
        )}
      </div>
      {pack.downloading != null && (
        <div className="bar dl-bar" aria-hidden>
          <i style={{ width: `${pack.downloading}%` }} />
        </div>
      )}
      {pack.error && <p className="hint status dl-error">{pack.error}</p>}
    </div>
  );
}

/** One download in the list. */
export interface DownloadItem {
  key: string;
  title: string;
  note?: string;
  pack: PackLike;
}

/** What is already on the phone, out of the way: one closed row "Installed (3)" that opens to the list. `open` is kept by the screen, so it stays as it was
 * while the screen is open. Nothing is drawn when `count` is 0. */
export function InstalledFold({ count, open, onToggle, children }: { count: number; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="fold inner installed-fold" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        Installed <small>({count})</small>
      </summary>
      {children}
    </details>
  );
}

/** The downloads, the ones not yet on the phone first (each with its Get button), and what is already there inside one closed "Installed" row. */
export function DownloadRows({ items }: { items: DownloadItem[] }) {
  const [open, setOpen] = useState(false);
  const have = items.filter((i) => i.pack.installed === true && i.pack.downloading == null);
  const todo = items.filter((i) => !have.includes(i));
  return (
    <>
      {todo.map((i) => (
        <DownloadRow key={i.key} title={i.title} note={i.note} pack={i.pack} />
      ))}
      <InstalledFold count={have.length} open={open} onToggle={setOpen}>
        <div className="dl-list">
          {have.map((i) => (
            <DownloadRow key={i.key} title={i.title} note={i.note} pack={i.pack} />
          ))}
        </div>
      </InstalledFold>
    </>
  );
}

/** A row that opens a screen: "Library ›". */
export function LinkRow({ title, note, onClick, children }: { title: string; note?: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button className="dl-row dl-link" onClick={onClick}>
      <div className="dl-main">
        <strong>{title}</strong>
        {note && <small>{note}</small>}
      </div>
      <span className="dl-chev" aria-hidden>
        ›
      </span>
      {children}
    </button>
  );
}
