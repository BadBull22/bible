// Content Factory: the shelf along the bottom of the studio. "Ready to post" holds what the factory made for the reader (the posts
// of the week, a season's series), "Saved by me" the pictures and videos already saved in the Content Factory folder. Shut, it is one
// slim line with the number waiting; open, it is a grid of small pictures (or a list) that can be filtered by kind of post. A click on
// a picture opens it large with what can be done to it: edit it in the studio, copy it, save it, post it, mark it posted.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { PictureBank } from "../factory/draw";
import { RECIPES, type RecipeId } from "../factory/autopilot";
import { inOrder, waiting, type Post, type PostStatus } from "../factory/inbox";
import { SEASON_VERSES, SERIES_ORDER } from "../factory/seasonVerses";
import type { Card, FooterSettings, SizeInfo } from "../factory/types";
import { dateOf, type OccasionId } from "../themes/themeCalendar";
import { Icon } from "./FactoryIcons";
import { Popover, ThumbCanvas } from "./FactoryParts";
import { FileLarge, FileThumb, isVideo, SitesRow, stemOf, whenLabel, type SavedFile } from "./FactoryFiles";

interface Props {
  posts: Post[];
  size: SizeInfo;
  footer: FooterSettings;
  bank: PictureBank;
  rev: number;
  /** all the pictures of a post, drawn in its look */
  cardsOf: (post: Post) => Card[];
  busy: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  view: "icons" | "list";
  onView: (v: "icons" | "list") => void;
  /** changes whenever something new has been saved, so the list of saved files is read again */
  savedTick: number;
  include: RecipeId[];
  onInclude: (r: RecipeId[]) => void;
  /** the season now or coming soon, to offer its series */
  suggestion: { id: OccasionId; name: string; soon: boolean } | null;
  onMakeWeek: () => void;
  onMakeSeries: (id: OccasionId) => void;
  /** open a post in the studio to change it */
  onEdit: (p: Post) => void;
  onStatus: (p: Post, s: PostStatus) => void;
  onRemove: (p: Post) => void;
  onCopyPicture: (p: Post, cardIndex: number) => void;
  onCopyCaption: (p: Post) => void;
  onSavePost: (p: Post) => void;
  onCopyFiles: (paths: string[]) => void;
  onShareFiles: (paths: string[]) => void;
  onReveal: (path: string) => void;
  onOpenFolder: () => void;
  /** open the gallery of saved work in a window of its own */
  onGallery: () => void;
}

export function dayLabel(day: number): string {
  const { y, m, d } = dateOf(day);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

type Source = "posts" | "saved";
type Item = { kind: "post"; post: Post } | { kind: "file"; file: SavedFile };

export function FactoryLibrary(p: Props) {
  const [source, setSource] = useState<Source>("posts");
  const [topic, setTopic] = useState<"" | RecipeId>("");
  const [status, setStatus] = useState<"waiting" | "posted" | "skipped" | "all">("waiting");
  const [kind, setKind] = useState<"" | "Pictures" | "Videos">("");
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [series, setSeries] = useState<OccasionId>(p.suggestion?.id ?? "advent");

  useEffect(() => {
    api
      .factoryFiles()
      .then((l) => setFiles(l.filter((f) => f.folder !== "Music")))
      .catch(() => setFiles([]));
  }, [p.savedTick]);

  const ordered = useMemo(() => inOrder(p.posts), [p.posts]);
  const nWaiting = waiting(p.posts).length;
  const posts = useMemo(
    () =>
      ordered.filter((x) => (topic ? x.recipe === topic : true) && (status === "all" ? true : status === "waiting" ? x.status === "new" || x.status === "approved" : x.status === status)),
    [ordered, topic, status],
  );
  const myFiles = useMemo(() => files.filter((f) => (kind ? f.folder === kind : true)), [files, kind]);
  const items: Item[] = source === "posts" ? posts.map((post) => ({ kind: "post", post })) : myFiles.map((file) => ({ kind: "file", file }));
  const keyOf = (i: Item) => (i.kind === "post" ? `p:${i.post.id}` : `f:${i.file.path}`);
  const index = shown ? items.findIndex((i) => keyOf(i) === shown) : -1;
  const current = index >= 0 ? items[index] : null;

  // if the item on show leaves the list (deleted, or no longer matching), the dialog closes
  useEffect(() => {
    if (shown && index < 0) setShown(null);
  }, [shown, index]);

  const goTo = (to: number) => {
    if (items.length === 0) return;
    setShown(keyOf(items[(to + items.length) % items.length]));
  };

  const pickSource = (s: Source) => {
    setSource(s);
    p.onToggle(true);
  };

  const peek = ordered.filter((x) => x.status === "new" || x.status === "approved").slice(0, 7);
  const toggleRecipe = (r: RecipeId) => p.onInclude(p.include.includes(r) ? p.include.filter((x) => x !== r) : [...p.include, r]);

  const tile = (i: Item) => {
    const k = keyOf(i);
    if (i.kind === "post") {
      const post = i.post;
      const cards = p.cardsOf(post);
      return (
        <li key={k}>
          <button type="button" className={"fx-tile " + post.status} onClick={() => setShown(k)} title={post.title}>
            <span className="fx-tile-pic">
              <ThumbCanvas card={cards[0]} size={p.size} footer={p.footer} bank={p.bank} rev={p.rev} credit={null} width={p.size.h > p.size.w ? 120 : 170} lazy label={post.title} />
              {post.cards.length > 1 && <em className="fx-badge count">{post.cards.length}</em>}
              {post.status === "new" && <em className="fx-badge fresh">New</em>}
              {post.status === "posted" && <em className="fx-badge ok">Posted</em>}
              {post.status === "skipped" && <em className="fx-badge">Skipped</em>}
            </span>
            <strong>{post.title}</strong>
            <small>{dayLabel(post.day)}</small>
          </button>
        </li>
      );
    }
    const f = i.file;
    return (
      <li key={k}>
        <button type="button" className="fx-tile" onClick={() => setShown(k)} title={f.name}>
          <span className="fx-tile-pic">
            <FileThumb file={f} />
            {isVideo(f.name) && (
              <em className="fx-badge video">
                <Icon name="play" size={11} /> Video
              </em>
            )}
          </span>
          <strong>{stemOf(f.name)}</strong>
          <small>{whenLabel(f.modified)}</small>
        </button>
      </li>
    );
  };

  const row = (i: Item) => {
    const k = keyOf(i);
    const title = i.kind === "post" ? i.post.title : stemOf(i.file.name);
    const meta =
      i.kind === "post"
        ? `for ${dayLabel(i.post.day)} · ${i.post.cards.length} picture${i.post.cards.length === 1 ? "" : "s"}${i.post.status === "new" ? " · new" : i.post.status === "posted" ? " · posted" : i.post.status === "skipped" ? " · skipped" : ""}`
        : `${isVideo(i.file.name) ? "Video" : "Picture"} · ${(i.file.size / 1_000_000).toFixed(1)} MB · ${whenLabel(i.file.modified)}`;
    return (
      <li key={k} className="fx-row">
        <button type="button" className="fx-row-pic" onClick={() => setShown(k)} aria-label={`Open ${title}`}>
          {i.kind === "post" ? <ThumbCanvas card={p.cardsOf(i.post)[0]} size={p.size} footer={p.footer} bank={p.bank} rev={p.rev} credit={null} width={p.size.h > p.size.w ? 52 : 84} lazy /> : <FileThumb file={i.file} />}
        </button>
        <button type="button" className="fx-row-text" onClick={() => setShown(k)}>
          <strong>{title}</strong>
          <span className="muted">{meta}</span>
        </button>
        {i.kind === "post" && (
          <button type="button" className="outline-btn" onClick={() => p.onEdit(i.post)}>
            Edit
          </button>
        )}
      </li>
    );
  };

  return (
    <section className={"fx-library" + (p.open ? " open" : "")} aria-label="Ready to post and saved pictures">
      <header className="fx-lib-head">
        <button type="button" className="fx-lib-toggle" onClick={() => p.onToggle(!p.open)} aria-expanded={p.open} title={p.open ? "Make this shelf small" : "Open the shelf of made pictures"}>
          <Icon name={p.open ? "chevronDown" : "chevronUp"} size={16} />
          <Icon name="library" size={17} />
        </button>
        <div className="fx-lib-tabs" role="tablist" aria-label="What to show">
          <button type="button" role="tab" aria-selected={p.open && source === "posts"} className={p.open && source === "posts" ? "on" : ""} onClick={() => pickSource("posts")}>
            Ready to post <span className={"fx-count" + (nWaiting ? " hot" : "")}>{nWaiting}</span>
          </button>
          <button type="button" role="tab" aria-selected={p.open && source === "saved"} className={p.open && source === "saved" ? "on" : ""} onClick={() => pickSource("saved")}>
            Saved by me <span className="fx-count">{files.length}</span>
          </button>
        </div>
        {!p.open && peek.length > 0 && (
          <div className="fx-lib-peek" aria-hidden="true">
            {peek.map((x) => (
              <button key={x.id} type="button" tabIndex={-1} onClick={() => (setSource("posts"), setShown(`p:${x.id}`), p.onToggle(true))} title={x.title}>
                <ThumbCanvas card={p.cardsOf(x)[0]} size={p.size} footer={p.footer} bank={p.bank} rev={p.rev} credit={null} width={p.size.h > p.size.w ? 26 : 40} lazy />
              </button>
            ))}
          </div>
        )}
        {!p.open && nWaiting === 0 && <span className="muted fx-lib-empty">Nothing waiting. “Make my week” fills this shelf.</span>}
        <span className="fx-spacer" />
        <button type="button" className="pill-btn fx-small" onClick={p.onMakeWeek} disabled={p.busy || p.include.length === 0} title="One post for each of the next seven days, made from the app's own verses, stories and facts">
          Make my week
        </button>
        <Popover label="More" up align="right" title="A season's series, and what “Make my week” includes">
          {(close) => (
            <div className="fx-menu">
              {p.suggestion && (
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => {
                    close();
                    p.onMakeSeries(p.suggestion!.id);
                  }}
                  disabled={p.busy}
                >
                  {p.suggestion.soon ? `${p.suggestion.name} is coming: ` : `It is ${p.suggestion.name}: `}make its verses
                </button>
              )}
              <label className="fx-inline-field">
                <span>A series for</span>
                <select value={series} onChange={(e) => setSeries(e.target.value as OccasionId)} aria-label="A season to make a series for">
                  {SERIES_ORDER.map((id) => (
                    <option key={id} value={id}>
                      {SEASON_VERSES[id]?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="outline-btn"
                onClick={() => {
                  close();
                  p.onMakeSeries(series);
                }}
                disabled={p.busy}
              >
                Make the series
              </button>
              <hr />
              <strong className="fx-menu-title">“Make my week” includes</strong>
              {RECIPES.map((r) => (
                <label key={r.id} className="factory-check" title={r.blurb}>
                  <input type="checkbox" checked={p.include.includes(r.id)} onChange={() => toggleRecipe(r.id)} /> {r.label}
                </label>
              ))}
            </div>
          )}
        </Popover>
      </header>

      {p.open && (
        <div className="fx-lib-body">
          <div className="fx-lib-filters">
            {source === "posts" ? (
              <>
                <label className="fx-inline-field">
                  <span>Topic</span>
                  <select value={topic} onChange={(e) => setTopic(e.target.value as "" | RecipeId)} aria-label="Which kind of post">
                    <option value="">All topics</option>
                    {RECIPES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fx-inline-field">
                  <span>Show</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Which posts">
                    <option value="waiting">Waiting to be posted</option>
                    <option value="posted">Posted</option>
                    <option value="skipped">Skipped</option>
                    <option value="all">Everything</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="fx-inline-field">
                  <span>Show</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Pictures or videos">
                    <option value="">Pictures and videos</option>
                    <option value="Pictures">Pictures only</option>
                    <option value="Videos">Videos only</option>
                  </select>
                </label>
                <button type="button" className="outline-btn fx-small" onClick={p.onGallery} title="Show the saved pictures and videos in a window of their own, to move to another screen">
                  Open in a window
                </button>
                <button type="button" className="link-btn" onClick={p.onOpenFolder}>
                  Open the folder
                </button>
              </>
            )}
            <span className="fx-spacer" />
            <div className="fx-view" role="group" aria-label="How to show them">
              <button type="button" className={p.view === "icons" ? "on" : ""} onClick={() => p.onView("icons")} aria-pressed={p.view === "icons"} title="Small pictures">
                <Icon name="library" size={16} />
              </button>
              <button type="button" className={p.view === "list" ? "on" : ""} onClick={() => p.onView("list")} aria-pressed={p.view === "list"} title="A list">
                <Icon name="list" size={16} />
              </button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="muted fx-lib-none">
              {source === "posts"
                ? status === "waiting" && !topic
                  ? "Nothing is waiting. Press “Make my week”, or make a picture yourself above."
                  : "No posts like that."
                : "Nothing saved yet. Pictures and videos you save appear here."}
            </p>
          ) : p.view === "icons" ? (
            <ul className="fx-lib-grid">{items.map(tile)}</ul>
          ) : (
            <ul className="fx-lib-list">{items.map(row)}</ul>
          )}
        </div>
      )}

      {current && (
        <ItemDialog
          item={current}
          position={`${index + 1} of ${items.length}`}
          many={items.length > 1}
          onClose={() => setShown(null)}
          onStep={(d) => goTo(index + d)}
          p={p}
        />
      )}
    </section>
  );
}

/** One picture opened large, with what can be done to it. */
function ItemDialog({ item, position, many, onClose, onStep, p }: { item: Item; position: string; many: boolean; onClose: () => void; onStep: (d: number) => void; p: Props }) {
  const [card, setCard] = useState(0);
  const [sure, setSure] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const itemKey = item.kind === "post" ? item.post.id : item.file.path;
  useEffect(() => {
    setCard(0);
    setSure(false);
  }, [itemKey]);
  useEffect(() => {
    first.current?.focus();
  }, [itemKey]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (!typing && e.key === "ArrowLeft") {
        e.stopPropagation();
        onStep(-1);
      } else if (!typing && e.key === "ArrowRight") {
        e.stopPropagation();
        onStep(1);
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose, onStep]);

  const post = item.kind === "post" ? item.post : null;
  const cards = post ? p.cardsOf(post) : [];
  const title = post ? post.title : stemOf((item as { file: SavedFile }).file.name);
  return (
    <div className="fx-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fx-dialog">
        <header>
          <h3>{title}</h3>
          <span className="muted">{position}</span>
          <span className="fx-spacer" />
          {many && (
            <>
              <button type="button" className="fx-btn icon" onClick={() => onStep(-1)} aria-label="The one before" title="The one before (left arrow)">
                <Icon name="chevronLeft" size={18} />
              </button>
              <button type="button" className="fx-btn icon" onClick={() => onStep(1)} aria-label="The next one" title="The next one (right arrow)">
                <Icon name="chevronRight" size={18} />
              </button>
            </>
          )}
          <button type="button" className="fx-btn icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="fx-dialog-body">
          <div className="fx-dialog-pic">
            {post ? (
              <>
                <ThumbCanvas card={cards[Math.min(card, cards.length - 1)]} size={p.size} footer={p.footer} bank={p.bank} rev={p.rev} credit={null} width={p.size.h > p.size.w ? 420 : 640} label={title} />
                {cards.length > 1 && (
                  <div className="fx-dots" role="group" aria-label="The pictures in this set">
                    {cards.map((_, i) => (
                      <button key={i} type="button" className={i === card ? "on" : ""} onClick={() => setCard(i)} aria-label={`Picture ${i + 1}`} aria-pressed={i === card}>
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <FileLarge file={(item as { file: SavedFile }).file} />
            )}
          </div>
          <div className="fx-dialog-actions">
            {post ? (
              <>
                <p className="muted">
                  For {dayLabel(post.day)} · {post.cards.length} picture{post.cards.length === 1 ? "" : "s"} ·{" "}
                  {post.status === "new" ? "new" : post.status === "approved" ? "looked at" : post.status === "posted" ? "posted" : "skipped"}
                </p>
                <p className="fx-caption-peek">{post.caption.length > 220 ? `${post.caption.slice(0, 220)}…` : post.caption}</p>
                <button
                  type="button"
                  ref={first}
                  className="pill-btn"
                  onClick={() => {
                    onClose();
                    p.onEdit(post);
                  }}
                >
                  <Icon name="edit" size={16} /> Edit in the studio
                </button>
                <div className="fx-action-grid">
                  <button type="button" className="outline-btn" onClick={() => p.onCopyPicture(post, card)}>
                    <Icon name="copy" size={15} /> Copy picture
                  </button>
                  <button type="button" className="outline-btn" onClick={() => p.onCopyCaption(post)}>
                    <Icon name="copy" size={15} /> Copy caption
                  </button>
                  <button type="button" className="outline-btn" onClick={() => p.onSavePost(post)} disabled={p.busy}>
                    <Icon name="save" size={15} /> Save pictures
                  </button>
                </div>
                <SitesRow what="picture and caption" />
                <div className="fx-action-grid">
                  {(post.status === "new" || post.status === "approved") && (
                    <>
                      <button type="button" className="outline-btn" onClick={() => p.onStatus(post, "posted")}>
                        <Icon name="check" size={15} /> Mark as posted
                      </button>
                      <button type="button" className="outline-btn" onClick={() => p.onStatus(post, "skipped")} title="Not this one: it may come round again later">
                        Skip it
                      </button>
                    </>
                  )}
                  {(post.status === "posted" || post.status === "skipped") && (
                    <button type="button" className="outline-btn" onClick={() => p.onStatus(post, "new")}>
                      Back to waiting
                    </button>
                  )}
                  <button
                    type="button"
                    className={"text-btn fx-danger" + (sure ? " sure" : "")}
                    onClick={() => {
                      if (sure) p.onRemove(post);
                      else setSure(true);
                    }}
                  >
                    <Icon name="trash" size={15} /> {sure ? "Press again to delete" : "Delete"}
                  </button>
                </div>
              </>
            ) : (
              <FileActions file={(item as { file: SavedFile }).file} p={p} first={first} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FileActions({ file, p, first }: { file: SavedFile; p: Props; first: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <>
      <p className="muted">
        {isVideo(file.name) ? "Video" : "Picture"} · {(file.size / 1_000_000).toFixed(1)} MB · saved {whenLabel(file.modified)}
      </p>
      <button type="button" ref={first} className="pill-btn" onClick={() => p.onShareFiles([file.path])} title="Open the Windows Share window: WhatsApp, Mail, nearby devices">
        <Icon name="post" size={16} /> Share…
      </button>
      <div className="fx-action-grid">
        <button type="button" className="outline-btn" onClick={() => p.onCopyFiles([file.path])} title="Copy the file, then paste it into a message or an upload box">
          <Icon name="copy" size={15} /> Copy file
        </button>
        <button type="button" className="outline-btn" onClick={() => p.onReveal(file.path)}>
          <Icon name="folder" size={15} /> Show in the folder
        </button>
      </div>
      <SitesRow what="file" />
    </>
  );
}
