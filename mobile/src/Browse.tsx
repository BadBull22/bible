// Browse on the phone (since 3.0.0): Bible stories, "Verses for..." pages and children's pages, the same pages as on the computer. The pages hold
// Scripture REFERENCES only: the words shown are those of the Bible the reader chose (the BSB when that Bible lacks the passage; the children's
// pages always use the BSB). The data and the rules for finding a page are the desktop's own files (src/browse), used from their source.
// Left out on the phone: printing and the activity sheet, the review mode, and the people and places box (the pictures come later, as optional downloads).

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, type Verse } from "./api";
import { useBack } from "./back";
import { AGE_BANDS, ageLabel, parseRef, searchEntries, tagCounts, withTag, type BrowseEntry } from "../../src/browse/browseLogic";
import { CHILDREN, ENTRIES, STORIES, TOPICS, childPage, findBrowse, story, topic } from "../../src/browse/data";
import type { BrowseKind, ChildPage, Story, Topic } from "../../src/browse/types";
import { KidFigure, PictureOffer, StoryFigure } from "./Pictures";
import { linkRefs } from "./scriptureLinks";

export interface BrowseOpen {
  kind: BrowseKind;
  /** the page open, or null for the list */
  id: string | null;
}

interface Actions {
  /** the Bible the reader chose (children's pages ignore it and use the BSB) */
  version: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onOpen: (kind: BrowseKind, id: string) => void;
  /** run a search in the main search box ("More on this subject") */
  onSearch: (query: string) => void;
}

const TABS: { kind: BrowseKind; label: string; hint: string; find: string; empty: string }[] = [
  { kind: "stories", label: "Bible stories", hint: "A short retelling of each story, with its passages to read in the Bible.", find: "Find a story (David, storm, lost)", empty: "No story matches that. Try a name (David), a place or a word (storm)." },
  { kind: "topics", label: "Verses for…", hint: "Passages for a need or a subject, with a line on what each one says.", find: "Find a subject (fear, grief, hope)", empty: "No subject matches that. Try one word (fear, peace, hope)." },
  { kind: "children", label: "For children", hint: "Stories told simply, with a memory verse, questions and a thing to try.", find: "Find a page", empty: "No children's page matches that." },
];
const LABEL: Record<BrowseKind, string> = { stories: "Bible stories", topics: "Verses for…", children: "For children" };
const COUNT: Record<BrowseKind, number> = { stories: STORIES.length, topics: TOPICS.length, children: CHILDREN.length };

/** The name of a page, for "Back to David and Goliath". */
export function pageTitle(kind: BrowseKind, id: string): string | undefined {
  return kind === "stories" ? story(id)?.title : kind === "topics" ? topic(id)?.title : childPage(id)?.title;
}
export const listName = (kind: BrowseKind): string => LABEL[kind];

// What was opened on a page ("Show the words", "Show the answer") is kept while the app runs, so coming back to a page from the Bible finds it as it was left.
const opened = new Set<string>();
const PageKey = createContext("");
function useOpened(key: string, start = false): [boolean, (v: boolean) => void] {
  const full = `${useContext(PageKey)}|${key}`;
  const [open, set] = useState(() => start || opened.has(full));
  return [
    open,
    (v) => {
      if (v) opened.add(full);
      else opened.delete(full);
      set(v);
    },
  ];
}

/** how many subject buttons show before "more" */
const TAGS_SHOWN = 8;

// ---- Bible text ---------------------------------------------------------------------------------------------------
// One chapter at a time, kept while the app runs, so several passages of one chapter ask for it once.
const chapters = new Map<string, Promise<Verse[]>>();
function chapterOf(code: string, book: string, chapter: number): Promise<Verse[]> {
  const key = `${code}|${book}|${chapter}`;
  let p = chapters.get(key);
  if (!p) {
    p = api.chapter(code, book, chapter).catch(() => []);
    chapters.set(key, p);
  }
  return p;
}

/** the verses of a reference in the Bible asked for, or in the BSB when that Bible does not have them */
async function passageVerses(ref: string, code: string): Promise<{ verses: Verse[]; code: string }> {
  const r = parseRef(ref);
  if (!r) return { verses: [], code };
  const pick = (all: Verse[]) => all.filter((v) => v.verse >= r.verse && v.verse <= r.verseEnd);
  const mine = pick(await chapterOf(code, r.book, r.chapter));
  if (mine.length > 0 || code === "BSB") return { verses: mine, code };
  return { verses: pick(await chapterOf("BSB", r.book, r.chapter)), code: "BSB" };
}

/** A sentence with the scripture written in it made tappable: "(1 Samuel 17:37)" and "(17:47)" open that verse in the Bible. */
function Linked({ text, book, onJump }: { text: string; book?: string; onJump: Actions["onJump"] }) {
  return (
    <>
      {linkRefs(text, book).map((p, i) =>
        "book" in p ? (
          <button key={i} className="link inline-ref" onClick={() => onJump(p.book, p.chapter, p.verse)} aria-label={`Open ${p.text} in the Bible`}>
            {p.text}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function VerseText({ refText, version }: { refText: string; version: string }) {
  const [got, setGot] = useState<{ verses: Verse[]; code: string } | null>(null);
  useEffect(() => {
    let live = true;
    setGot(null);
    void passageVerses(refText, version).then((g) => live && setGot(g));
    return () => {
      live = false;
    };
  }, [refText, version]);
  if (!got) return <p className="hint">Loading…</p>;
  if (got.verses.length === 0) return <p className="hint">The text of this passage is not available here.</p>;
  return (
    <div className="browse-text">
      {got.verses.map((v) => (
        <span key={v.verse}>
          <sup>{v.verse}</sup> {v.text}{" "}
        </span>
      ))}
      <div className="browse-version">
        {got.code}
        {got.code !== version ? " (your Bible does not have this passage)" : ""}
      </div>
    </div>
  );
}

function PassageBlock({ refText, label, note, actions, startOpen, bsbOnly }: { refText: string; label?: string; note?: string; actions: Actions; startOpen?: boolean; bsbOnly?: boolean }) {
  const [open, setOpen] = useOpened(`p:${refText}`, !!startOpen);
  const r = parseRef(refText);
  return (
    <div className="browse-passage">
      <div className="browse-passage-head">
        <button className="link" disabled={!r} onClick={() => r && actions.onJump(r.book, r.chapter, r.verse)} aria-label={`Open ${refText} in the Bible`}>
          {refText}
        </button>
        {label && <span className="browse-passage-label">{label}</span>}
      </div>
      {note && (
        <p className="browse-note">
          <Linked text={note} book={r?.book} onJump={actions.onJump} />
        </p>
      )}
      <button className="browse-pill quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide the words" : "Show the words"}
      </button>
      {open && <VerseText refText={refText} version={bsbOnly ? "BSB" : actions.version} />}
    </div>
  );
}

function FlagBox({ note, teaching }: { note?: string; teaching?: string }) {
  if (!note) return null;
  return (
    <>
      <div className="browse-differ" role="note">
        <strong>Where Christians differ</strong>
        <p>{note}</p>
      </div>
      {/* the owner's own words, shown only when he has written them (the field is empty and hidden by default) */}
      {teaching && teaching.trim() && (
        <div className="browse-differ" role="note">
          <strong>What our church teaches</strong>
          <p>{teaching}</p>
        </div>
      )}
    </>
  );
}

function Chips({ items, kind, actions }: { items: { id: string; title: string }[]; kind: BrowseKind; actions: Actions }) {
  return (
    <div className="browse-chips">
      {items.map((i) => (
        <button key={i.id} className="browse-pill quiet" onClick={() => actions.onOpen(kind, i.id)}>
          {i.title}
        </button>
      ))}
    </div>
  );
}

function RefLinks({ refs, actions }: { refs: string[]; actions: Actions }) {
  return (
    <div className="browse-chips">
      {refs.map((ref) => {
        const r = parseRef(ref);
        return (
          <button key={ref} className="browse-pill quiet" disabled={!r} onClick={() => r && actions.onJump(r.book, r.chapter, r.verse)}>
            {ref}
          </button>
        );
      })}
    </div>
  );
}

// ---- a Bible story --------------------------------------------------------------------------------------------------
function StoryView({ page, actions }: { page: Story; actions: Actions }) {
  const related = (page.related ?? []).map(story).filter((s): s is Story => !!s);
  const topics = (page.topics ?? []).map(topic).filter((t): t is Topic => !!t);
  const kids = childPage(page.child_page);
  const whole = parseRef(page.whole ?? "");
  // a chapter and verse written alone ("(17:47)") belongs to the book of the story
  const book = parseRef(page.context?.ref ?? page.passages[0]?.ref ?? "")?.book;
  return (
    <article className="browse-page">
      <h2>{page.title}</h2>
      {page.also && page.also.length > 0 && <p className="browse-also">Also called: {page.also.join(", ")}</p>}
      <StoryFigure id={page.id} title={page.title} />
      <PictureOffer kind="stories" />
      <FlagBox note={page.doctrine === "needs_review" ? page.doctrine_note : undefined} teaching={page.church_teaching} />
      {page.summary.split("\n\n").map((para, i) => (
        <p key={i} className="browse-summary">
          <Linked text={para} book={book} onJump={actions.onJump} />
        </p>
      ))}
      {page.look_closer && (
        <p className="browse-look">
          <strong>Look closer.</strong> <Linked text={page.look_closer} book={book} onJump={actions.onJump} />
        </p>
      )}
      {page.lessons && page.lessons.length > 0 && (
        <div className="browse-teaches">
          <strong>What this teaches us</strong>
          <ul>
            {page.lessons.map((l) => (
              <li key={l}>
                <Linked text={l} book={book} onJump={actions.onJump} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <h4 className="browse-section">Read it in the Bible</h4>
      {page.context && <PassageBlock refText={page.context.ref} label={page.context.label} actions={actions} />}
      {page.passages.map((p) => (
        <PassageBlock key={p.ref} refText={p.ref} label={p.label} actions={actions} />
      ))}
      {whole && (
        <p>
          <button className="browse-pill" onClick={() => actions.onJump(whole.book, whole.chapter, whole.verse)}>
            Read the whole story: {page.whole}
          </button>
        </p>
      )}
      {page.parallels && page.parallels.length > 0 && (
        <>
          <h4 className="browse-section">The same story in the other Gospels</h4>
          <RefLinks refs={page.parallels} actions={actions} />
        </>
      )}
      {page.also_read && page.also_read.length > 0 && (
        <>
          <h4 className="browse-section">Also read</h4>
          <RefLinks refs={page.also_read} actions={actions} />
        </>
      )}
      {(related.length > 0 || topics.length > 0 || kids) && <h4 className="browse-section">Go further</h4>}
      {kids && (
        <p>
          <button className="browse-pill" onClick={() => actions.onOpen("children", kids.id)}>
            For children: {kids.title} ({ageLabel(kids.age)})
          </button>
        </p>
      )}
      {related.length > 0 && (
        <>
          <p className="browse-sub">Related stories</p>
          <Chips items={related} kind="stories" actions={actions} />
        </>
      )}
      {topics.length > 0 && (
        <>
          <p className="browse-sub">Verses on this subject</p>
          <Chips items={topics} kind="topics" actions={actions} />
        </>
      )}
    </article>
  );
}

// ---- a "Verses for..." page -------------------------------------------------------------------------------------------
function TopicView({ page, actions }: { page: Topic; actions: Actions }) {
  const see = (page.see_also ?? []).map(topic).filter((t): t is Topic => !!t);
  const stories = (page.stories ?? []).map(story).filter((s): s is Story => !!s);
  return (
    <article className="browse-page">
      <h2>{page.title}</h2>
      {page.also && page.also.length > 0 && <p className="browse-also">Also: {page.also.join(", ")}</p>}
      <FlagBox note={page.doctrine === "needs_review" ? page.doctrine_note : undefined} teaching={page.church_teaching} />
      <p className="browse-summary">
        <Linked text={page.intro} onJump={actions.onJump} />
      </p>
      {page.items.map((i) => (
        <div key={i.ref}>
          <PassageBlock refText={i.ref} note={i.note} actions={actions} />
          {i.doctrine === "needs_review" && <FlagBox note={i.doctrine_note} />}
        </div>
      ))}
      <p>
        <button className="browse-pill" onClick={() => actions.onSearch(page.dictionary)}>
          More on this subject: Nave's and Torrey's
        </button>
      </p>
      {see.length > 0 && (
        <>
          <p className="browse-sub">See also</p>
          <Chips items={see} kind="topics" actions={actions} />
        </>
      )}
      {stories.length > 0 && (
        <>
          <p className="browse-sub">Stories on this subject</p>
          <Chips items={stories} kind="stories" actions={actions} />
        </>
      )}
    </article>
  );
}

// ---- a children's page ------------------------------------------------------------------------------------------------
function Question({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useOpened(`q:${q}`);
  return (
    <li>
      <div className="browse-q">{q}</div>
      <button className="browse-pill quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide the answer" : "Show the answer"}
      </button>
      {open && <div className="browse-a">{a}</div>}
    </li>
  );
}

function ChildView({ page, actions }: { page: ChildPage; actions: Actions }) {
  const from = story(page.story);
  return (
    <article className="browse-page browse-kids">
      <h2>{page.title}</h2>
      <p className="browse-also">{ageLabel(page.age)}</p>
      <KidFigure id={page.id} title={page.title} />
      <PictureOffer kind="kids" />
      <FlagBox note={page.doctrine === "needs_review" ? page.doctrine_note : undefined} teaching={page.church_teaching} />
      <div className="browse-retelling">
        {page.retelling.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      <div className="browse-idea" role="note">
        <strong>The big idea</strong>
        <p>{page.message}</p>
      </div>
      <h4 className="browse-section">Read the real story together</h4>
      <PassageBlock refText={page.read_from} actions={actions} bsbOnly />
      <h4 className="browse-section">Memory verse</h4>
      <PassageBlock refText={page.memory.ref} actions={actions} startOpen bsbOnly />
      <h4 className="browse-section">Talk about it</h4>
      <ol className="browse-questions">
        {page.questions.map((q) => (
          <Question key={q.q} q={q.q} a={q.a} />
        ))}
      </ol>
      {page.try_this && (
        <>
          <h4 className="browse-section">Try this</h4>
          <p>{page.try_this}</p>
        </>
      )}
      {from && (
        <p>
          <button className="browse-pill" onClick={() => actions.onOpen("stories", from.id)}>
            The grown-up page: {from.title}
          </button>
        </p>
      )}
    </article>
  );
}

// ---- the lists ------------------------------------------------------------------------------------------------------
function blurb(kind: BrowseKind, id: string): string {
  if (kind === "stories") {
    const s = story(id);
    if (!s) return "";
    const first = s.summary.split(/(?<=[.!?])\s/)[0] ?? s.summary;
    return first.length > 150 ? first.slice(0, 147).trimEnd() + "…" : first;
  }
  if (kind === "topics") {
    const t = topic(id);
    return t?.items.length ? `${t.items.length} passages` : "";
  }
  const c = childPage(id);
  return c ? ageLabel(c.age) : "";
}

function List({ list, onOpen }: { list: BrowseEntry[]; onOpen: (e: BrowseEntry) => void }) {
  return (
    <ul className="browse-list">
      {list.map((e) => (
        <li key={e.kind + e.id}>
          <button className="browse-card" onClick={() => onOpen(e)}>
            <span className="browse-card-title">{e.title}</span>
            <span className="browse-card-blurb">{blurb(e.kind, e.id)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The three ways in, as rows of the list at the top of Extras. */
export function BrowseEntryPoints({ onOpen }: { onOpen: (kind: BrowseKind) => void }) {
  return (
    <>
      {TABS.map((t) => (
        <button key={t.kind} className="more-row" onClick={() => onOpen(t.kind)}>
          <span className="more-row-title">{t.label}</span>
          <small>{COUNT[t.kind]}</small>
          <span className="dl-chev" aria-hidden>
            ›
          </span>
        </button>
      ))}
    </>
  );
}

/** Bible stories, "Verses for..." pages and children's pages, opened from More (or from the offer under search results). The Back button steps from a page to the list, then out. */
export function BrowseScreen({ open, setOpen, version, backLabel, onJump, onSearch, onClose }: { open: BrowseOpen; setOpen: (o: BrowseOpen) => void; version: string; /** where Back from the list goes ("Search" or "More") */ backLabel: string; onJump: Actions["onJump"]; onSearch: Actions["onSearch"]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [moreTags, setMoreTags] = useState(false);
  const tab = open.kind;
  const info = TABS.find((t) => t.kind === tab)!;
  useBack(true, onClose);
  useBack(!!open.id, () => setOpen({ kind: tab, id: null }));

  const entries = ENTRIES[tab];
  const tags = useMemo(() => tagCounts(entries), [entries]);
  const shown = useMemo(() => withTag(searchEntries(entries, query), tag), [entries, query, tag]);
  const actions: Actions = { version, onJump, onSearch, onOpen: (kind, id) => setOpen({ kind, id }) };
  // a page that is not in this version of the app (a link from an older page) says so instead of showing nothing
  const present = open.id ? (tab === "stories" ? story(open.id) : tab === "topics" ? topic(open.id) : childPage(open.id)) : undefined;

  useEffect(() => {
    window.scrollTo?.(0, 0);
    document.querySelector("main")?.scrollTo?.(0, 0);
  }, [open.kind, open.id]);

  if (open.id) {
    return (
      <div className="browse">
        <button className="link back" onClick={() => setOpen({ kind: tab, id: null })}>
          ‹ {LABEL[tab]}
        </button>
        <PageKey.Provider value={`${tab}:${open.id}`}>
          {!present ? (
            <p className="hint">That page is not in this version of the app.</p>
          ) : tab === "stories" ? (
            <StoryView page={present as Story} actions={actions} />
          ) : tab === "topics" ? (
            <TopicView page={present as Topic} actions={actions} />
          ) : (
            <ChildView page={present as ChildPage} actions={actions} />
          )}
        </PageKey.Provider>
      </div>
    );
  }
  return (
    <div className="browse">
      <button className="link back" onClick={onClose}>
        ‹ {backLabel}
      </button>
      <div className="chips segmented" role="tablist" aria-label="What to browse">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            aria-selected={tab === t.kind}
            className={tab === t.kind ? "on" : ""}
            onClick={() => {
              setOpen({ kind: t.kind, id: null });
              setTag(null);
              setQuery("");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="hint">{info.hint}</p>
      <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={info.find} aria-label="Find a page" autoCapitalize="none" autoCorrect="off" />
      {tab !== "children" && tags.length > 1 && (
        <div className="chips" role="group" aria-label="Narrow by subject">
          <button className={tag === null ? "on" : ""} aria-pressed={tag === null} onClick={() => setTag(null)}>
            All
          </button>
          {(moreTags ? tags : tags.slice(0, TAGS_SHOWN)).map((t) => (
            <button key={t.tag} className={tag === t.tag ? "on" : ""} aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? null : t.tag)}>
              {t.tag} <small>{t.count}</small>
            </button>
          ))}
          {tags.length > TAGS_SHOWN && (
            <button aria-expanded={moreTags} onClick={() => setMoreTags(!moreTags)}>
              {moreTags ? "Fewer" : `${tags.length - TAGS_SHOWN} more…`}
            </button>
          )}
        </div>
      )}
      {shown.length === 0 && <p className="hint">{info.empty}</p>}
      {tab === "children" ? (
        AGE_BANDS.map((band) => {
          const list = shown.filter((e) => childPage(e.id)?.age === band);
          if (list.length === 0) return null;
          return (
            <section key={band}>
              <h4 className="browse-section">
                {ageLabel(band)} · {list.length}
              </h4>
              <List list={list} onOpen={(e) => setOpen({ kind: e.kind, id: e.id })} />
            </section>
          );
        })
      ) : (
        <List list={shown} onOpen={(e) => setOpen({ kind: e.kind, id: e.id })} />
      )}
    </div>
  );
}

const KIND_LABEL: Record<BrowseKind, string> = { stories: "Bible story: ", topics: "", children: "For children: " };

/** how many of a subject's passages are listed in the results themselves (the rest are one tap away) */
const SHOWN = 3;

/**
 * Under a search or an answer: the Browse pages that are about what was typed, and, for the best matching subject, its first passages with what each
 * says. `also`: other wordings of the same question (the answer's own question), so a paraphrase finds the same pages. Nothing when no page matches.
 */
export function BrowseMatches({ query, also = [], onOpen, onJump }: { query: string; also?: string[]; onOpen: (kind: BrowseKind, id: string) => void; onJump: (book: string, chapter: number, verse: number) => void }) {
  const alsoKey = also.join("|");
  const found = useMemo(() => {
    const out = findBrowse(query, 4);
    for (const q of alsoKey ? alsoKey.split("|") : []) {
      for (const e of findBrowse(q, 4)) if (out.length < 4 && !out.some((o) => o.kind === e.kind && o.id === e.id)) out.push(e);
    }
    return out;
  }, [query, alsoKey]);
  if (found.length === 0) return null;
  // the first subject found, if any: its verses are listed (a subject on which Christians differ lists none, only its page, which carries the neutral box)
  const subject = found.find((e) => e.kind === "topics");
  const page = subject ? topic(subject.id) : undefined;
  const listed = page && page.doctrine !== "needs_review" ? page.items.slice(0, SHOWN) : [];
  return (
    <div className="browse-matches" role="group" aria-label="Stories and topics">
      <span className="browse-matches-label">Stories and topics</span>
      <div className="browse-chips">
        {found.map((e) => (
          <button key={e.kind + e.id} className="browse-pill quiet" onClick={() => onOpen(e.kind, e.id)}>
            {KIND_LABEL[e.kind]}
            {e.title}
          </button>
        ))}
      </div>
      {page && listed.length > 0 && (
        <div className="browse-topic-card">
          <strong>{page.title}</strong>
          <ul>
            {listed.map((i) => {
              const r = parseRef(i.ref);
              return (
                <li key={i.ref}>
                  <button className="link" disabled={!r} onClick={() => r && onJump(r.book, r.chapter, r.verse)}>
                    {i.ref}
                  </button>{" "}
                  <span className="browse-note">{i.note}</span>
                </li>
              );
            })}
          </ul>
          <button className="browse-pill quiet" onClick={() => onOpen("topics", page.id)}>
            All {page.items.length} passages
          </button>
        </div>
      )}
    </div>
  );
}
