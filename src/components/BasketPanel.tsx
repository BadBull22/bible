import { useEffect, useRef, useState } from "react";
import { api, BasketItem, BasketKind, BasketVerseMeta, SheetBlock } from "../api";
import { addToBasket, basketSheet, notifyBasketChanged, useBasket } from "../basket";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./icons";
import { SheetOutput } from "./SheetOutput";

interface Props {
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<BasketKind, string> = {
  verse: "Scripture",
  note: "My note",
  commentary: "Commentary",
  dictionary: "Dictionary",
  answer: "Answer",
  text: "Own text",
};

const TITLE_KEY = "basket:title";

function readTitle(): string {
  try {
    return localStorage.getItem(TITLE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function BasketPanel({ onJump, onClose }: Props) {
  const [items] = useBasket();
  const [view, setView] = useState<"items" | "sheet">("items");
  const [editing, setEditing] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [title, setTitle] = useState(readTitle);
  const [blankLines, setBlankLines] = useState(8);
  const [blocks, setBlocks] = useState<SheetBlock[]>([]);
  const [building, setBuilding] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(TITLE_KEY, title);
    } catch {
      /* per-viewer convenience only */
    }
  }, [title]);

  useEffect(() => {
    if (view !== "sheet") return;
    const id = ++requestId.current;
    setBuilding(true);
    const t = window.setTimeout(() => {
      basketSheet(items, title, blankLines)
        .then((b) => id === requestId.current && setBlocks(b))
        .finally(() => id === requestId.current && setBuilding(false));
    }, 200);
    return () => window.clearTimeout(t);
  }, [view, items, title, blankLines]);

  async function change(p: Promise<unknown>) {
    await p.catch(() => undefined);
    notifyBasketChanged();
  }

  function move(index: number, delta: number) {
    const ids = items.map((i) => i.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    change(api.basketReorder(ids));
  }

  function startEdit(i: BasketItem) {
    setEditing(i.id);
    setEditTitle(i.title);
    setEditBody(i.body);
  }

  function jumpTo(i: BasketItem) {
    try {
      const m = JSON.parse(i.meta) as Partial<BasketVerseMeta>;
      if (m.book && m.chapter) onJump(m.book, m.chapter, m.verseStart ?? 1);
    } catch {
      /* not a verse */
    }
  }

  return (
    <aside className="side-panel wide basket-panel">
      <div className="side-panel-header">
        <h3>Study basket{items.length ? ` (${items.length})` : ""}</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="Basket view">
        <button role="tab" aria-selected={view === "items"} className={view === "items" ? "active" : ""} onClick={() => setView("items")}>
          Gathered items
        </button>
        <button role="tab" aria-selected={view === "sheet"} className={view === "sheet" ? "active" : ""} onClick={() => setView("sheet")} disabled={items.length === 0}>
          Make study sheet
        </button>
      </div>

      {view === "items" && (
        <>
          {items.length === 0 && (
            <p className="search-hint">
              The basket gathers material for one study, sermon or service from anywhere in the app: use{" "}
              <strong>＋ Basket</strong> on a commentary note, cross reference, dictionary entry, answer or one of your notes, or{" "}
              <em>⋯ → Add to study basket</em> on any verse. Then put the items in order, add your own text, and choose{" "}
              <em>Make study sheet</em> to print it, copy it or save it as a Word document.
            </p>
          )}
          <ol className="basket-list">
            {items.map((it, idx) => (
              <li key={it.id} className="basket-item">
                <div className="basket-item-head">
                  <span className="basket-kind">{KIND_LABEL[it.kind] ?? it.kind}</span>
                  {it.kind === "verse" ? (
                    <button className="link-btn basket-title" onClick={() => jumpTo(it)} title="Read this passage">
                      {it.title}
                    </button>
                  ) : (
                    <span className="basket-title">{it.title}</span>
                  )}
                  <span className="basket-tools">
                    <button className="icon-only" title="Move up" aria-label="Move up" disabled={idx === 0} onClick={() => move(idx, -1)}>
                      <ChevronLeftIcon size={13} className="rot-90" />
                    </button>
                    <button className="icon-only" title="Move down" aria-label="Move down" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}>
                      <ChevronRightIcon size={13} className="rot-90" />
                    </button>
                    <button className="text-btn" onClick={() => startEdit(it)} title="Edit this item's heading or text (only in the basket)">
                      Edit
                    </button>
                    <button className="icon-only" title="Remove from the basket" aria-label="Remove" onClick={() => change(api.basketRemove(it.id))}>
                      <CloseIcon size={12} />
                    </button>
                  </span>
                </div>
                {editing === it.id ? (
                  <div className="note-editor">
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Heading (optional)" aria-label="Heading" />
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={5} aria-label="Text" />
                    <div className="note-editor-actions">
                      <button
                        className="pill-btn"
                        onClick={() => {
                          change(api.basketUpdate(it.id, editTitle, editBody));
                          setEditing(null);
                        }}
                      >
                        Save
                      </button>
                      <button className="text-btn" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  it.body && <div className="basket-body">{it.body}</div>
                )}
              </li>
            ))}
          </ol>

          <div className="basket-add">
            <h4 className="section-label">Add your own text</h4>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Heading (optional), e.g. Opening prayer, Point 1, Application" aria-label="Heading for your text" />
            <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={3} placeholder="Your thoughts, outline points, questions for discussion…" aria-label="Your text" />
            <button
              className="outline-btn"
              disabled={!newBody.trim() && !newTitle.trim()}
              onClick={async () => {
                await addToBasket("text", newTitle.trim(), newBody.trim());
                setNewTitle("");
                setNewBody("");
              }}
            >
              Add to basket
            </button>
          </div>

          {items.length > 0 && (
            <div className="basket-footer">
              <button className="pill-btn" onClick={() => setView("sheet")}>
                Make study sheet →
              </button>
              {confirmClear ? (
                <>
                  <span className="muted">Empty the whole basket?</span>
                  <button
                    className="text-btn danger"
                    onClick={() => {
                      change(api.basketClear());
                      setConfirmClear(false);
                    }}
                  >
                    Yes, empty it
                  </button>
                  <button className="text-btn" onClick={() => setConfirmClear(false)}>
                    No
                  </button>
                </>
              ) : (
                <button className="text-btn" onClick={() => setConfirmClear(true)}>
                  Empty basket
                </button>
              )}
            </div>
          )}
        </>
      )}

      {view === "sheet" && (
        <>
          <div className="sheet-options">
            <div className="sheet-grid">
              <label htmlFor="basket-title">Title</label>
              <input id="basket-title" value={title} placeholder="Study notes" onChange={(e) => setTitle(e.target.value)} />
              <span>Space for notes</span>
              <select value={blankLines} onChange={(e) => setBlankLines(Number(e.target.value))}>
                {[0, 8, 12, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None" : `${n} blank lines`}
                  </option>
                ))}
              </select>
            </div>
            <p className="search-hint">Items appear in the basket's order — go back to <em>Gathered items</em> to rearrange or edit them.</p>
          </div>
          <SheetOutput blocks={blocks} title={title.trim() || "Study notes"} building={building} />
        </>
      )}
    </aside>
  );
}
