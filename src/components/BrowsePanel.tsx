import { useMemo, useState } from "react";
import { AGE_BANDS, ageLabel, flaggedFirst, searchEntries, tagCounts, withTag, BrowseEntry } from "../browse/browseLogic";
import { CHILDREN, ENTRIES, STORIES, TOPICS, childPage, story, topic } from "../browse/data";
import { REVIEW_ON, reviewKey, reviewedCount, useReviewMarks } from "../browse/review";
import type { BrowseKind } from "../browse/types";
import { BrowseActions, ChildView, StoryView, TopicView } from "./BrowsePages";
import { BackIcon, CloseIcon } from "./icons";

export interface BrowseOpen {
  tab?: BrowseKind;
  /** a page to open straight away */
  page?: string;
}

interface Props extends Omit<BrowseActions, "onOpen"> {
  initial?: BrowseOpen;
  onClose: () => void;
}

/** how many subject buttons show before "more" */
const TAGS_SHOWN = 10;

const TABS: { kind: BrowseKind; label: string; hint: string; empty: string }[] = [
  { kind: "stories", label: "Bible stories", hint: "A short retelling of each story, with its passages to read in the Bible.", empty: "No story matches that. Try a name (David), a place or a word (storm)." },
  { kind: "topics", label: "Verses for…", hint: "Passages for a need or a subject, with a line on what each one says.", empty: "No subject matches that. Try one word (fear, peace, hope)." },
  { kind: "children", label: "For children", hint: "Stories told simply, with a memory verse, questions and a thing to try.", empty: "No children's page matches that." },
];

const TITLE_OF: Record<BrowseKind, (id: string) => string | undefined> = {
  stories: (id) => story(id)?.title,
  topics: (id) => topic(id)?.title,
  children: (id) => childPage(id)?.title,
};

function blurb(kind: BrowseKind, id: string): string {
  if (kind === "stories") {
    const s = story(id);
    if (!s) return "";
    const first = s.summary.split(/(?<=[.!?])\s/)[0] ?? s.summary;
    return first.length > 170 ? first.slice(0, 167).trimEnd() + "…" : first;
  }
  if (kind === "topics") return topic(id)?.items.length ? `${topic(id)!.items.length} passages` : "";
  const c = childPage(id);
  return c ? ageLabel(c.age) : "";
}

/** Bible stories, "Verses for..." pages and children's pages. */
export function BrowsePanel({ initial, versionCode, onJump, onOpenDictionary, onOpenPlace, onClose }: Props) {
  const [tab, setTab] = useState<BrowseKind>(initial?.tab ?? "stories");
  const [open, setOpen] = useState<{ kind: BrowseKind; id: string } | null>(initial?.page ? { kind: initial.tab ?? "stories", id: initial.page } : null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "flagged">("all");
  const [moreTags, setMoreTags] = useState(false);
  const marks = useReviewMarks();

  const entries = ENTRIES[tab];
  const tags = useMemo(() => tagCounts(entries), [entries]);
  const shown = useMemo(() => {
    let list = withTag(searchEntries(entries, query), tag);
    if (REVIEW_ON && filter === "flagged") list = list.filter((e) => e.flagged);
    if (REVIEW_ON && filter === "open") {
      const rev = (e: BrowseEntry) => (e.kind === "stories" ? story(e.id)?.review.rev : e.kind === "topics" ? topic(e.id)?.review.rev : childPage(e.id)?.review.rev) ?? 1;
      list = list.filter((e) => {
        const m = marks[reviewKey(e.kind, e.id)];
        return !(m && m.verdict && m.rev === rev(e));
      });
    }
    // while reviewing, the pages that need the most care come first
    return REVIEW_ON && !query.trim() ? flaggedFirst(list) : list;
  }, [entries, query, tag, filter, marks]);

  const actions: BrowseActions = {
    versionCode,
    onJump,
    onOpenDictionary,
    onOpenPlace,
    onOpen: (kind, id) => {
      setTab(kind);
      setOpen({ kind, id });
    },
  };

  const counts = REVIEW_ON ? reviewedCount(marks, tab, tab === "stories" ? STORIES : tab === "topics" ? TOPICS : CHILDREN) : null;
  const info = TABS.find((t) => t.kind === tab)!;
  const openTitle = open ? TITLE_OF[open.kind](open.id) : undefined;

  return (
    <aside className={"side-panel wide browse-panel" + (open?.kind === "children" ? " kids" : "")}>
      <div className="side-panel-header">
        {open ? (
          <button className="browse-back" onClick={() => setOpen(null)} aria-label={`Back to ${TABS.find((t) => t.kind === open.kind)!.label}`}>
            <BackIcon size={14} /> {TABS.find((t) => t.kind === open.kind)!.label}
          </button>
        ) : (
          <h3>Browse</h3>
        )}
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>

      {open ? (
        openTitle ? (
          open.kind === "stories" ? (
            <StoryView page={story(open.id)!} actions={actions} />
          ) : open.kind === "topics" ? (
            <TopicView page={topic(open.id)!} actions={actions} />
          ) : (
            <ChildView page={childPage(open.id)!} actions={actions} />
          )
        ) : (
          <p className="muted">That page is not in this version of the app.</p>
        )
      ) : (
        <>
          <div className="mode-toggle" role="tablist" aria-label="What to browse">
            {TABS.map((t) => (
              <button
                key={t.kind}
                role="tab"
                aria-selected={tab === t.kind}
                className={tab === t.kind ? "active" : ""}
                onClick={() => {
                  setTab(t.kind);
                  setTag(null);
                  setQuery("");
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="search-hint">{info.hint}</p>
          <div className="search-controls">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "stories" ? "Find a story (e.g. David, storm, lost)" : tab === "topics" ? "Find a subject (e.g. fear, grief, hope)" : "Find a page"} aria-label="Find a page" />
          </div>
          {tab !== "children" && tags.length > 1 && (
            <div className="browse-tags" role="group" aria-label="Narrow by subject">
              <button className={"browse-tag" + (tag === null ? " on" : "")} aria-pressed={tag === null} onClick={() => setTag(null)}>
                All
              </button>
              {(moreTags ? tags : tags.slice(0, TAGS_SHOWN)).map((t) => (
                <button key={t.tag} className={"browse-tag" + (tag === t.tag ? " on" : "")} aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)}>
                  {t.tag} <span className="muted">{t.count}</span>
                </button>
              ))}
              {tags.length > TAGS_SHOWN && (
                <button className="browse-tag more" onClick={() => setMoreTags(!moreTags)} aria-expanded={moreTags}>
                  {moreTags ? "Fewer" : `${tags.length - TAGS_SHOWN} more…`}
                </button>
              )}
            </div>
          )}
          {counts && (
            <div className="browse-review-summary" role="group" aria-label="Review progress (development app only)">
              <span>
                Reviewed: {counts.good} good, {counts.change} to change, {counts.remove} to remove, {counts.open} not yet looked at
              </span>
              {(["all", "open", "flagged"] as const).map((f) => (
                <button key={f} className={"pill-btn small" + (filter === f ? " on" : " quiet")} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "open" ? "Not yet looked at" : "Needs special attention"}
                </button>
              ))}
            </div>
          )}
          {shown.length === 0 && <p className="muted">{info.empty}</p>}
          {tab === "children"
            ? AGE_BANDS.map((band) => {
                const list = shown.filter((e) => childPage(e.id)?.age === band);
                if (list.length === 0) return null;
                return (
                  <section key={band}>
                    <h4 className="section-label">
                      {ageLabel(band)} &middot; {list.length}
                    </h4>
                    <List list={list} onOpen={(e) => setOpen({ kind: e.kind, id: e.id })} />
                  </section>
                );
              })
            : <List list={shown} onOpen={(e) => setOpen({ kind: e.kind, id: e.id })} />}
        </>
      )}
    </aside>
  );
}

function List({ list, onOpen }: { list: BrowseEntry[]; onOpen: (e: BrowseEntry) => void }) {
  const marks = useReviewMarks();
  return (
    <ul className="browse-list">
      {list.map((e) => {
        const m = REVIEW_ON ? marks[reviewKey(e.kind, e.id)] : undefined;
        return (
          <li key={e.kind + e.id}>
            <button className="browse-card" onClick={() => onOpen(e)}>
              <span className="browse-card-title">
                {e.title}
                {REVIEW_ON && e.flagged && <span className="browse-card-flag" title="Needs special attention (doctrine or a viewpoint)">needs attention</span>}
                {m?.verdict && <span className={"browse-card-mark " + m.verdict}>{m.verdict}</span>}
              </span>
              <span className="browse-card-blurb">{blurb(e.kind, e.id)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
