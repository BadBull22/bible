import { useEffect, useState } from "react";
import { api, BookInfo, SavedSermon, SermonHit, SermonQuery, SermonStage } from "../api";
import { parseRef } from "../sermon";
import { niceDate, preachingLine } from "./SermonPreachings";

// Finding a sermon again: by its words (title, series, subjects, big idea, what the preacher
// wrote), by a passage it uses ("Romans 8" finds a sermon on Romans 8:28-39), by when it was
// preached, its series, where, or its stage -- newest, oldest or most preached first.

interface Props {
  saved: SavedSermon[];
  books: BookInfo[];
  stages: { key: SermonStage; label: string }[];
  currentId: number;
  onOpen: (id: number) => void;
}

export function SermonSearch({ saved, books, stages, currentId, onOpen }: Props) {
  const [words, setWords] = useState("");
  const [passage, setPassage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [series, setSeries] = useState("");
  const [venue, setVenue] = useState("");
  const [stage, setStage] = useState("");
  const [sort, setSort] = useState("newest");
  const [hits, setHits] = useState<SermonHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ref = passage.trim() ? parseRef(passage, books) : null;
  const badPassage = !!passage.trim() && !ref;

  useEffect(() => {
    if (badPassage) return;
    const q: SermonQuery = {
      words,
      book: ref?.book ?? "",
      chapter: ref?.chapter ?? null,
      // "Romans 8" is the whole chapter; "Romans 8:28" a verse
      verse: ref && ref.verseEnd < 200 ? ref.verse : null,
      verse_end: ref && ref.verseEnd < 200 ? ref.verseEnd : null,
      from,
      to,
      series,
      venue,
      stage,
      sort,
    };
    let live = true;
    const t = window.setTimeout(() => {
      api
        .sermonSearch(q)
        .then((h) => {
          if (!live) return;
          setHits(h);
          setError(null);
        })
        .catch((e) => live && setError(String(e)));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, passage, from, to, series, venue, stage, sort, saved]);

  const seriesNames = [...new Set(saved.map((s) => s.series).filter(Boolean))].sort();
  const any = words || passage || from || to || series || venue || stage;

  return (
    <div className="sermon-search">
      <div className="ss-filters">
        <input className="ss-words" value={words} onChange={(e) => setWords(e.target.value)} placeholder="Words in a sermon: grace, the prodigal son…" aria-label="Words" autoFocus />
        <input value={passage} onChange={(e) => setPassage(e.target.value)} placeholder="A passage: Romans 8" aria-label="A passage" className={badPassage ? "invalid" : undefined} />
        <label>
          <span className="muted">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="muted">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select value={series} onChange={(e) => setSeries(e.target.value)} aria-label="Series">
          <option value="">Any series</option>
          {seriesNames.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Where" aria-label="Where it was preached" />
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          <option value="">Any stage</option>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="most">Most preached</option>
          <option value="title">By title</option>
        </select>
        {any && (
          <button
            className="text-btn"
            onClick={() => {
              setWords("");
              setPassage("");
              setFrom("");
              setTo("");
              setSeries("");
              setVenue("");
              setStage("");
            }}
          >
            Clear
          </button>
        )}
      </div>
      {badPassage && <p className="muted">Type a passage like “Romans 8” or “John 3:16”.</p>}
      {error && <p className="status-error">{error}</p>}
      {hits && (
        <p className="muted">
          {hits.length === 0 ? "No sermon matches." : `${hits.length} sermon${hits.length === 1 ? "" : "s"}`}
        </p>
      )}
      <ul className="sermon-list ss-results">
        {hits?.map((h) => (
          <li key={h.id} className={h.id === currentId ? "ticked" : undefined}>
            <button className="link-btn sermon-item-title" onClick={() => onOpen(h.id)}>
              {h.title}
            </button>
            <span className={`stage-chip stage-${h.stage}`}>{stages.find((s) => s.key === h.stage)?.label ?? h.stage}</span>
            {h.series && <span className="muted"> · {h.series}</span>}
            <div className="sermon-body">
              {h.preachings.length ? (
                <span>
                  {h.preachings.length === 1 ? "Preached " : `Preached ${h.preachings.length} times: `}
                  {h.preachings
                    .slice()
                    .reverse()
                    .slice(0, 4)
                    .map((p) => preachingLine(p))
                    .join("; ")}
                  {h.preachings.length > 4 ? "; …" : ""}
                </span>
              ) : (
                <span className="muted">{h.preached_on ? `Planned for ${niceDate(h.preached_on)}` : `Not preached yet · edited ${h.updated_at.slice(0, 10)}`}</span>
              )}
            </div>
            {h.passages && <div className="sermon-body muted">{h.passages}</div>}
            {h.big_idea && <div className="sermon-body ss-idea">“{h.big_idea}”</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
