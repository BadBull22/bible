import { useEffect, useRef, useState } from "react";
import { BackIcon } from "./icons";
import { api, EntityDetail, Verse } from "../api";
import { ageLabel, parseRef } from "../browse/browseLogic";
import { childPage, story, topic } from "../browse/data";
import { REVIEW_ON, ReviewEntry, setReview, useReviewMarks, reviewKey } from "../browse/review";
import type { BrowseKind, ChildPage, Story, Topic } from "../browse/types";
import { BrowseSheet } from "./BrowseSheet";
import { BrowsePrint } from "./BrowsePrint";
import { kidPicture } from "../browse/pictures";
import { pictureCaption, storyPicture } from "../browse/storyPictures";
import { useBrowsePrint } from "../browse/printBridge";

export interface BrowseActions {
  /** the Bible the reader chose (children's pages ignore it and use the BSB) */
  versionCode: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onOpen: (kind: BrowseKind, id: string) => void;
  onOpenDictionary: (query: string) => void;
  /** show a place on the map */
  onOpenPlace: (id: string) => void;
}

// ---- Bible text -------------------------------------------------------------------------------------------------
// One chapter at a time, kept for the session, so opening several passages of one chapter asks for it once.
const chapters = new Map<string, Promise<Verse[]>>();
function chapterOf(code: string, book: string, chapter: number): Promise<Verse[]> {
  const key = `${code}|${book}|${chapter}`;
  let p = chapters.get(key);
  if (!p) {
    p = api.getChapter(code, book, chapter).catch(() => []);
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

export function VerseText({ refText, versionCode, bsbOnly }: { refText: string; versionCode: string; bsbOnly?: boolean }) {
  const [got, setGot] = useState<{ verses: Verse[]; code: string } | null>(null);
  const want = bsbOnly ? "BSB" : versionCode;
  useEffect(() => {
    let live = true;
    setGot(null);
    passageVerses(refText, want).then((g) => live && setGot(g));
    return () => {
      live = false;
    };
  }, [refText, want]);
  if (!got) return <p className="muted">Loading…</p>;
  if (got.verses.length === 0) return <p className="muted">The text of this passage is not available here.</p>;
  return (
    <div className="browse-text">
      {got.verses.map((v) => (
        <span key={v.verse}>
          <sup>{v.verse}</sup> {v.text}{" "}
        </span>
      ))}
      <div className="browse-version">{got.code}{got.code !== want ? " (your Bible does not have this passage)" : ""}</div>
    </div>
  );
}

function PassageBlock({ refText, label, note, actions, startOpen, bsbOnly }: { refText: string; label?: string; note?: string; actions: BrowseActions; startOpen?: boolean; bsbOnly?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  const r = parseRef(refText);
  return (
    <div className="browse-passage">
      <div className="browse-passage-head">
        <button className="link-btn" disabled={!r} title="Open this passage in the Bible" onClick={() => r && actions.onJump(r.book, r.chapter, r.verse)}>
          {refText}
        </button>
        {label && <span className="browse-passage-label">{label}</span>}
        <button className="pill-btn small quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide the words" : "Show the words"}
        </button>
      </div>
      {note && <p className="browse-note">{note}</p>}
      {open && <VerseText refText={refText} versionCode={actions.versionCode} bsbOnly={bsbOnly} />}
    </div>
  );
}

// ---- marks shared by the three pages --------------------------------------------------------------------------------
function FlagBox({ note, teaching }: { note?: string; teaching?: string }) {
  if (!note) return null;
  // the reader sees the neutral note; the "needs special attention" mark is for the owner's review of the draft
  return (
    <>
      {REVIEW_ON && (
        <div className="browse-attention" role="note">
          <strong>Needs special attention</strong> (doctrine or a viewpoint): the wording of the box below is yours to decide.
        </div>
      )}
      <div className="browse-differ" role="note">
        <strong>Where Christians differ</strong>
        <p>{note}</p>
      </div>
      {/* the owner's own words, shown only when he has written them (the field is empty and hidden by default) */}
      {teaching && teaching.trim() && (
        <div className="browse-differ browse-church" role="note">
          <strong>What our church teaches</strong>
          <p>{teaching}</p>
        </div>
      )}
    </>
  );
}

/** Review mode only: Good / Change / Remove and a comment, for the page on screen. */
function ReviewBar({ kind, id, rev }: { kind: BrowseKind; id: string; rev: number }) {
  const marks = useReviewMarks();
  const mark: ReviewEntry | undefined = marks[reviewKey(kind, id)];
  const [comment, setComment] = useState(mark?.comment ?? "");
  const seen = useRef(`${kind}:${id}`);
  useEffect(() => {
    if (seen.current !== `${kind}:${id}`) {
      seen.current = `${kind}:${id}`;
      setComment(mark?.comment ?? "");
    }
  }, [kind, id, mark?.comment]);
  if (!REVIEW_ON) return null;
  const stale = mark && mark.rev !== rev;
  return (
    <div className="browse-review" role="group" aria-label="Review this page (development app only)">
      <div className="browse-review-row">
        <strong>Review</strong>
        {(["good", "change", "remove"] as const).map((v) => (
          <button key={v} className={"pill-btn small" + (mark?.verdict === v && !stale ? " on" : " quiet")} aria-pressed={mark?.verdict === v && !stale} onClick={() => setReview(kind, id, rev, { verdict: v, comment })}>
            {v === "good" ? "Good" : v === "change" ? "Change" : "Remove"}
          </button>
        ))}
        {stale && <span className="muted">(the page was rewritten after your mark)</span>}
      </div>
      <textarea
        rows={2}
        value={comment}
        placeholder="Comment (what to change, and why)"
        aria-label="Review comment"
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => comment !== (mark?.comment ?? "") && setReview(kind, id, rev, { comment })}
      />
    </div>
  );
}

function Chips({ items, actions, kind }: { items: { id: string; title: string }[]; actions: BrowseActions; kind: BrowseKind }) {
  return (
    <div className="browse-chips">
      {items.map((i) => (
        <button key={i.id} className="pill-btn small quiet" onClick={() => actions.onOpen(kind, i.id)}>
          {i.title}
        </button>
      ))}
    </div>
  );
}

function RefLinks({ refs, actions }: { refs: string[]; actions: BrowseActions }) {
  return (
    <div className="browse-chips">
      {refs.map((ref) => {
        const r = parseRef(ref);
        return (
          <button key={ref} className="pill-btn small quiet" disabled={!r} onClick={() => r && actions.onJump(r.book, r.chapter, r.verse)}>
            {ref}
          </button>
        );
      })}
    </div>
  );
}

// ---- the people and places a story names ------------------------------------------------------------------------------
function Who({ people, places, actions }: { people: string[]; places: string[]; actions: BrowseActions }) {
  const [found, setFound] = useState<EntityDetail[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setOpen(null);
    const wanted = [...people.map((id) => api.getEntity("person", id)), ...places.map((id) => api.getEntity("place", id))];
    Promise.all(wanted.map((p) => p.catch(() => null))).then((r) => live && setFound(r.filter((x): x is EntityDetail => !!x)));
    return () => {
      live = false;
    };
  }, [people.join("|"), places.join("|")]);
  if (found.length === 0) return null;
  const sel = found.find((e) => e.kind + e.id === open);
  return (
    <>
      <h4 className="section-label">People and places in this story</h4>
      <div className="browse-chips">
        {found.map((e) => (
          <button key={e.kind + e.id} className={"pill-btn small " + (open === e.kind + e.id ? "on" : "quiet")} aria-pressed={open === e.kind + e.id} onClick={() => setOpen(open === e.kind + e.id ? null : e.kind + e.id)}>
            {e.name}
          </button>
        ))}
      </div>
      {sel && (
        <div className="browse-entity">
          <strong>{sel.name}</strong>
          {sel.description ? <p>{sel.description.length > 520 ? sel.description.slice(0, 520).replace(/\s+\S*$/, "") + "…" : sel.description}</p> : <p className="muted">No description is kept for this {sel.kind}.</p>}
          {sel.kind === "place" && sel.latitude !== null && (
            <button className="pill-btn small" onClick={() => actions.onOpenPlace(sel.id)}>
              Show on the map
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** the print view of a page: a way back, and the page as it will print */
function PrintShell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <article className="browse-page">
      <button className="browse-back" onClick={onBack}>
        <BackIcon size={14} /> Back to {title}
      </button>
      <h2>Print: {title}</h2>
      {children}
    </article>
  );
}

// ---- a Bible story -------------------------------------------------------------------------------------------------
export function StoryView({ page, actions }: { page: Story; actions: BrowseActions }) {
  const related = (page.related ?? []).map(story).filter((s): s is Story => !!s);
  const topics = (page.topics ?? []).map(topic).filter((t): t is Topic => !!t);
  const kids = childPage(page.child_page);
  const whole = parseRef(page.whole ?? "");
  const picture = storyPicture(page.id);
  const [printing, setPrinting] = useState(false);
  // the Print button in the top bar opens the same print menu as "Print this page" (not the whole window)
  useBrowsePrint(() => setPrinting(true));
  if (printing) {
    return (
      <PrintShell title={page.title} onBack={() => setPrinting(false)}>
        <BrowsePrint page={page} versionCode={actions.versionCode} />
      </PrintShell>
    );
  }
  return (
    <article className="browse-page">
      <h2>{page.title}</h2>
      {page.also && page.also.length > 0 && <p className="browse-also">Also called: {page.also.join(", ")}</p>}
      {picture && (
        <figure className="browse-story-picture">
          <img src={picture.url} alt={`A painting or engraving of the story: ${page.title}`} />
          <figcaption>
            {pictureCaption(picture.credit)}{" "}
            <a href={picture.credit.page} target="_blank" rel="noreferrer">
              Source
            </a>
          </figcaption>
        </figure>
      )}
      <FlagBox note={page.doctrine === "needs_review" ? page.doctrine_note : undefined} teaching={page.church_teaching} />
      {page.summary.split("\n\n").map((para, i) => (
        <p key={i} className="browse-summary">
          {para}
        </p>
      ))}
      {page.look_closer && (
        <p className="browse-look">
          <strong>Look closer.</strong> {page.look_closer}
        </p>
      )}
      {page.lessons && page.lessons.length > 0 && (
        <div className="browse-teaches">
          <strong>What this teaches us</strong>
          <ul>
            {page.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <h4 className="section-label">Read it in the Bible</h4>
      {page.context && <PassageBlock refText={page.context.ref} label={page.context.label} actions={actions} />}
      {page.passages.map((p) => (
        <PassageBlock key={p.ref} refText={p.ref} label={p.label} actions={actions} />
      ))}
      {whole && (
        <p>
          <button className="pill-btn small" onClick={() => actions.onJump(whole.book, whole.chapter, whole.verse)}>
            Read the whole story: {page.whole}
          </button>
        </p>
      )}
      {page.parallels && page.parallels.length > 0 && (
        <>
          <h4 className="section-label">The same story in the other Gospels</h4>
          <RefLinks refs={page.parallels} actions={actions} />
        </>
      )}
      {page.also_read && page.also_read.length > 0 && (
        <>
          <h4 className="section-label">Also read</h4>
          <RefLinks refs={page.also_read} actions={actions} />
        </>
      )}
      <Who people={page.people ?? []} places={page.places ?? []} actions={actions} />
      {(related.length > 0 || topics.length > 0 || kids) && <h4 className="section-label">Go further</h4>}
      {kids && (
        <p>
          <button className="pill-btn small" onClick={() => actions.onOpen("children", kids.id)}>
            For children: {kids.title} ({ageLabel(kids.age)})
          </button>
        </p>
      )}
      {related.length > 0 && (
        <>
          <p className="browse-sub">Related stories</p>
          <Chips items={related} actions={actions} kind="stories" />
        </>
      )}
      {topics.length > 0 && (
        <>
          <p className="browse-sub">Verses on this subject</p>
          <Chips items={topics} actions={actions} kind="topics" />
        </>
      )}
      <p>
        <button className="pill-btn small" onClick={() => setPrinting(true)}>
          Print this page
        </button>
      </p>
      <ReviewBar kind="stories" id={page.id} rev={page.review.rev} />
    </article>
  );
}

// ---- a "Verses for..." page -----------------------------------------------------------------------------------------
export function TopicView({ page, actions }: { page: Topic; actions: BrowseActions }) {
  const see = (page.see_also ?? []).map(topic).filter((t): t is Topic => !!t);
  const stories = (page.stories ?? []).map(story).filter((s): s is Story => !!s);
  const [printing, setPrinting] = useState(false);
  useBrowsePrint(() => setPrinting(true));
  if (printing) {
    return (
      <PrintShell title={page.title} onBack={() => setPrinting(false)}>
        <BrowsePrint page={page} versionCode={actions.versionCode} />
      </PrintShell>
    );
  }
  return (
    <article className="browse-page">
      <h2>{page.title}</h2>
      {page.also && page.also.length > 0 && <p className="browse-also">Also: {page.also.join(", ")}</p>}
      <FlagBox note={page.doctrine === "needs_review" ? page.doctrine_note : undefined} teaching={page.church_teaching} />
      <p className="browse-summary">{page.intro}</p>
      {page.items.map((i) => (
        <div key={i.ref}>
          <PassageBlock refText={i.ref} note={i.note} actions={actions} />
          {i.doctrine === "needs_review" && <FlagBox note={i.doctrine_note} />}
        </div>
      ))}
      <p>
        <button className="pill-btn small" onClick={() => actions.onOpenDictionary(page.dictionary)}>
          More on this subject: Nave's and Torrey's
        </button>
      </p>
      {see.length > 0 && (
        <>
          <p className="browse-sub">See also</p>
          <Chips items={see} actions={actions} kind="topics" />
        </>
      )}
      {stories.length > 0 && (
        <>
          <p className="browse-sub">Stories on this subject</p>
          <Chips items={stories} actions={actions} kind="stories" />
        </>
      )}
      <p>
        <button className="pill-btn small" onClick={() => setPrinting(true)}>
          Print this page
        </button>
      </p>
      <ReviewBar kind="topics" id={page.id} rev={page.review.rev} />
    </article>
  );
}

// ---- a children's page ----------------------------------------------------------------------------------------------
function Question({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="browse-q">{q}</div>
      <button className="pill-btn small quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide the answer" : "Show the answer"}
      </button>
      {open && <div className="browse-a">{a}</div>}
    </li>
  );
}

export function ChildView({ page, actions }: { page: ChildPage; actions: BrowseActions }) {
  const from = story(page.story);
  // children's pages always use the BSB (plain, widely trusted wording), whatever Bible the reader chose
  const kidActions: BrowseActions = { ...actions, versionCode: "BSB" };
  const [sheet, setSheet] = useState(false);
  const picture = kidPicture(page.id);
  useBrowsePrint(() => setSheet(true));
  if (sheet) {
    return (
      <article className="browse-page">
        <button className="browse-back" onClick={() => setSheet(false)}>
          <BackIcon size={14} /> Back to {page.title}
        </button>
        <h2>Activity sheet: {page.title}</h2>
        <BrowseSheet page={page} />
      </article>
    );
  }
  return (
    <article className="browse-page browse-kids">
      <h2>{page.title}</h2>
      <p className="browse-also">{ageLabel(page.age)}</p>
      {picture && <img className="browse-picture" src={picture} alt={`A picture of the story: ${page.title}`} />}
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
      <h4 className="section-label">Read the real story together</h4>
      <PassageBlock refText={page.read_from} actions={kidActions} bsbOnly />
      <h4 className="section-label">Memory verse</h4>
      <PassageBlock refText={page.memory.ref} actions={kidActions} startOpen bsbOnly />
      <h4 className="section-label">Talk about it</h4>
      <ol className="browse-questions">
        {page.questions.map((q) => (
          <Question key={q.q} q={q.q} a={q.a} />
        ))}
      </ol>
      {page.try_this && (
        <>
          <h4 className="section-label">Try this</h4>
          <p>{page.try_this}</p>
        </>
      )}
      <p>
        <button className="pill-btn small" onClick={() => setSheet(true)}>
          Print the activity sheet and picture
        </button>
      </p>
      {from && (
        <p>
          <button className="pill-btn small" onClick={() => actions.onOpen("stories", from.id)}>
            The grown-up page: {from.title}
          </button>
        </p>
      )}
      <ReviewBar kind="children" id={page.id} rev={page.review.rev} />
    </article>
  );
}
