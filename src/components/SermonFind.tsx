import { ReactNode, useEffect, useMemo, useState } from "react";
import { api, BookInfo, Verse } from "../api";
import { GROUPS, isScripture, Material, MaterialKind, parseRef, Ref, refLabel } from "../sermon";
import { plainText } from "./RichText";
import { PassageStudy } from "./PassageStudy";
import { ChevronLeftIcon } from "./icons";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  onGather: (q: string) => void;
  busy: string | null;
  gathered: Material[];
  topics: string[];
  chosen: Set<string>;
  onToggle: (m: Material) => void;
  /** "used in another sermon" note for an item, or null */
  usedNote: (m: Material) => ReactNode;
  /** where an added item goes, in words ("after Explain", "at the end") */
  target: string;
  onTargetEnd: () => void;
  books: BookInfo[];
  versionCode: string;
  onJump: (book: string, chapter: number, verse: number) => void;
}

const EXAMPLES = ["faith in God", "forgiveness", "John 3", "Romans 8:28-39", "Psalm 23", "how do I forgive someone who hurt me"];
const PER_GROUP = 6;

const text = (m: Material) => plainText(m.text).replace(/⟪\d+⟫/g, "").replace(/\s+/g, " ").trim();

/** The left side of the builder: what to look for, what was found -- in groups that stay at
 * the top while the list scrolls -- and a passage read or studied in place. */
export function SermonFind({ query, onQuery, onGather, busy, gathered, topics, chosen, onToggle, usedNote, target, onTargetEnd, books, versionCode, onJump }: Props) {
  const [group, setGroup] = useState<MaterialKind | "all">("all");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [studying, setStudying] = useState<Material | null>(null);
  const [reading, setReading] = useState<Ref | null>(null);

  // a new search starts on everything it found
  useEffect(() => {
    setGroup("all");
  }, [topics.join(";")]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = filter.trim().toLowerCase();
  const matches = useMemo(() => (f ? gathered.filter((m) => `${m.title} ${m.source ?? ""} ${text(m)}`.toLowerCase().includes(f)) : gathered), [gathered, f]);
  const counts = useMemo(() => {
    const c = new Map<MaterialKind, { n: number; ticked: number }>();
    for (const m of matches) {
      const x = c.get(m.kind) ?? { n: 0, ticked: 0 };
      x.n++;
      if (chosen.has(m.key)) x.ticked++;
      c.set(m.kind, x);
    }
    return c;
  }, [matches, chosen]);

  const flip = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const item = (m: Material) => {
    const ticked = chosen.has(m.key);
    const open = expanded.has(m.key);
    const t = text(m);
    return (
      <li key={m.key} className={"sf-item" + (ticked ? " ticked" : "")}>
        <button className="sf-add" onClick={() => onToggle(m)} title={ticked ? "Take it out of the sermon" : `Add to the sermon (${target})`} aria-pressed={ticked}>
          {ticked ? "✓" : "+"}
        </button>
        <div className="sf-main">
          <button className="sf-title" onClick={() => flip(m.key)} aria-expanded={open} title={open ? "Show less" : "Show it all"}>
            {m.title}
          </button>
          <span className="sf-meta">
            {m.source && <span className="sf-source">{m.source}</span>}
            {topics.length > 1 && m.topic && <span className="note-tag small">{m.topic}</span>}
            {usedNote(m)}
          </span>
          <div className={"sf-text" + (open ? " open" : "")}>{t}</div>
          {m.ref && (
            <span className="sf-actions">
              <button className="link-btn" onClick={() => setReading(m.ref!)} title="Read the chapter here">
                Read
              </button>
              {isScripture(m) && (
                <button className="link-btn" onClick={() => setStudying(m)} title="Everything the app has on this passage">
                  Study this passage
                </button>
              )}
            </span>
          )}
        </div>
      </li>
    );
  };

  // ---- reading a chapter, or studying a passage, in place of the list
  if (reading) return <ChapterPeek r={reading} versionCode={versionCode} onBack={() => setReading(null)} onJump={onJump} />;
  if (studying) {
    return (
      <div className="sf">
        <div className="sf-top">
          <button className="text-btn" onClick={() => setStudying(null)}>
            <ChevronLeftIcon size={14} /> Back to what was found
          </button>
          <span className="muted">Studying {studying.title}</span>
        </div>
        <div className="sf-scroll">
          <PassageStudy passage={studying} chosen={chosen} onToggle={onToggle} onJump={(b, c, v) => setReading({ book: b, chapter: c, verse: v, verseEnd: v })} />
        </div>
      </div>
    );
  }

  const shownGroups = GROUPS.filter((g) => counts.get(g.kind));
  return (
    <div className="sf">
      <div className="sf-top">
        <form
          className="sf-ask"
          onSubmit={(e) => {
            e.preventDefault();
            onGather(query);
          }}
        >
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="A subject (faith in God) or a passage (John 3)" aria-label="What the sermon is about" autoFocus={gathered.length === 0} />
          <button className="pill-btn" type="submit" disabled={!!busy || !query.trim()}>
            {busy ? "Looking…" : gathered.length ? "Find more" : "Find"}
          </button>
        </form>
        {busy && <p className="muted sf-busy">{busy}</p>}
        {gathered.length > 0 && (
          <>
            <div className="sf-groups" role="tablist" aria-label="What was found">
              <button role="tab" aria-selected={group === "all"} className={"sf-chip" + (group === "all" ? " on" : "")} onClick={() => setGroup("all")}>
                Everything <span>{matches.length}</span>
              </button>
              {shownGroups.map((g) => {
                const c = counts.get(g.kind)!;
                return (
                  <button key={g.kind} role="tab" aria-selected={group === g.kind} className={"sf-chip" + (group === g.kind ? " on" : "")} onClick={() => setGroup(g.kind)} title={g.about}>
                    {g.label} <span>{c.n}</span>
                    {c.ticked > 0 && <em> ✓{c.ticked}</em>}
                  </button>
                );
              })}
            </div>
            <div className="sf-filter">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter what was found…" aria-label="Filter what was found" />
              <span className="muted">
                Adding {target}
                {target.startsWith("into") && (
                  <>
                    {" · "}
                    <button className="link-btn" onClick={onTargetEnd} title="Let each thing go into its own place again">
                      each into its place instead
                    </button>
                  </>
                )}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="sf-scroll">
        {gathered.length === 0 && !busy && (
          <div className="sf-empty">
            <p>
              Type what the sermon is about — a subject or a passage — and press <strong>Find</strong>. Scripture, cross-references, commentary, your Library books,
              Spurgeon's sermons, outlines, stories and more are gathered here. Press <strong>+</strong> to add something to your sermon on the right.
            </p>
            <p className="sermon-examples">
              Try:{" "}
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  className="note-tag"
                  onClick={() => {
                    onQuery(x);
                    onGather(x);
                  }}
                >
                  {x}
                </button>
              ))}
            </p>
            {parseRef(query.split(";")[0] ?? "", books) && <p className="muted">A passage gives it section by section, with its background and everything written on it.</p>}
          </div>
        )}
        {group === "all"
          ? shownGroups.map((g) => {
              const list = matches.filter((m) => m.kind === g.kind);
              return (
                <section key={g.kind} className="sf-group">
                  <h4 className="section-label">
                    {g.label} <span className="tab-count">{list.length}</span>
                  </h4>
                  <ul className="sf-list">{list.slice(0, PER_GROUP).map(item)}</ul>
                  {list.length > PER_GROUP && (
                    <button className="text-btn sf-more" onClick={() => setGroup(g.kind)}>
                      All {list.length} {g.label.toLowerCase()} →
                    </button>
                  )}
                </section>
              );
            })
          : (() => {
              const g = GROUPS.find((x) => x.kind === group);
              const list = matches.filter((m) => m.kind === group);
              return (
                <section className="sf-group">
                  <p className="muted sf-about">{g?.about}</p>
                  <ul className="sf-list">{list.map(item)}</ul>
                  {list.length === 0 && <p className="muted">Nothing here{f ? " matches the filter" : ""}.</p>}
                </section>
              );
            })()}
      </div>
    </div>
  );
}

/** A chapter read in the builder, the passage marked, without leaving it. */
function ChapterPeek({ r, versionCode, onBack, onJump }: { r: Ref; versionCode: string; onBack: () => void; onJump: Props["onJump"] }) {
  const [verses, setVerses] = useState<Verse[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .getChapter(versionCode, r.book, r.chapter)
      .then((v) => live && setVerses(v))
      .catch(() => live && setVerses([]));
    return () => {
      live = false;
    };
  }, [r.book, r.chapter, versionCode]);
  useEffect(() => {
    if (verses) document.getElementById(`peek-${r.verse}`)?.scrollIntoView({ block: "center" });
  }, [verses, r.verse]);
  const end = Math.max(r.verse, r.verseEnd);
  return (
    <div className="sf">
      <div className="sf-top">
        <button className="text-btn" onClick={onBack}>
          <ChevronLeftIcon size={14} /> Back
        </button>
        <strong>
          {r.book} {r.chapter}
        </strong>
        <span className="muted">{refLabel({ ...r, verseEnd: end })}</span>
        <button className="link-btn" onClick={() => onJump(r.book, r.chapter, r.verse)} title="Leave the builder and open it in the Bible (your sermon is kept)">
          Open in the Bible
        </button>
      </div>
      <div className="sf-scroll sf-peek">
        {verses === null && <p className="muted">Loading…</p>}
        {verses?.map((v) => (
          <p key={v.verse} id={`peek-${v.verse}`} className={v.verse >= r.verse && v.verse <= end ? "here" : undefined}>
            <sup>{v.verse}</sup> {plainText(v.text)}
          </p>
        ))}
      </div>
    </div>
  );
}
