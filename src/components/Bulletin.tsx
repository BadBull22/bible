// The printed bulletin: made from the notices, the music and the sermon ticked on the Sunday service page. The
// order of service can be changed line by line, then it is printed (or saved as a PDF or Word document, or
// copied) like any study sheet. Songs are listed by title only.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { bulletinBlocks, BulletinNotice, BulletinSermon, defaultOrder, nextSunday, noticesOf, songTitles } from "../bulletin";
import { parseDeck, ServiceChoice } from "../service";
import { SheetOutput } from "./SheetOutput";

const KEY = "bulletin:";
const remembered = (k: string, fallback: string): string => {
  try {
    return localStorage.getItem(KEY + k) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(KEY + k, v);
  } catch {
    /* not remembered */
  }
};

interface Props {
  /** the one of each part ticked on the service page */
  choice: ServiceChoice;
  onBack: () => void;
}

export function Bulletin({ choice, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [songs, setSongs] = useState<string[]>([]);
  const [notices, setNotices] = useState<BulletinNotice[]>([]);
  const [sermon, setSermon] = useState<BulletinSermon | null>(null);
  const [church, setChurch] = useState(() => remembered("church", ""));
  const [date, setDate] = useState(nextSunday);
  const [order, setOrder] = useState("");
  const [showNotices, setShowNotices] = useState(() => remembered("notices", "1") === "1");
  const [noteLines, setNoteLines] = useState(() => Number(remembered("lines", "8")) || 0);
  const [page, setPage] = useState<"a4" | "a5">(() => (remembered("page", "a4") === "a5" ? "a5" : "a4"));

  // what the ticked parts hold
  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const [n, m, s] = await Promise.all([
          choice.notices ? api.deckGet(choice.notices) : null,
          choice.music ? api.deckGet(choice.music) : null,
          choice.sermon ? api.sermonGet(choice.sermon) : null,
        ]);
        if (stale) return;
        const noticeList = n ? noticesOf(parseDeck(n.body).slides) : [];
        const songList = m ? songTitles(parseDeck(m.body).slides) : [];
        const sm: BulletinSermon | null = s ? { title: s.title, series: s.series, passages: s.passages } : null;
        setNotices(noticeList);
        setSongs(songList);
        setSermon(sm);
        if (s?.preached_on) setDate(s.preached_on.slice(0, 10));
        setOrder(defaultOrder(songList, sm, noticeList.length > 0));
      } catch (e) {
        if (!stale) setError(`The service couldn't be read: ${e}`);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [choice.notices, choice.music, choice.sermon]);

  const blocks = useMemo(() => bulletinBlocks({ church, date, order, notices, showNotices, sermon, noteLines }), [church, date, order, notices, showNotices, sermon, noteLines]);

  return (
    <article className="service bulletin">
      <header className="service-head">
        <h2>Printed bulletin</h2>
        <button className="outline-btn" onClick={onBack}>
          Back to the service
        </button>
      </header>
      <p className="muted">
        Made from the notices, music and sermon ticked for this Sunday. Change anything below, then print it, save it as a PDF or Word document, or copy it. Songs are listed by title only, not their words (printing the words needs a church music licence).
      </p>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Gathering the service…</p>
      ) : (
        <div className="bulletin-cols">
          <div className="bulletin-form">
            <label>
              <span>Church name</span>
              <input
                value={church}
                onChange={(e) => {
                  setChurch(e.target.value);
                  remember("church", e.target.value);
                }}
                placeholder="Shown at the top (kept for next time)"
              />
            </label>
            <label>
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              <span>Order of service (one item to a line)</span>
              <textarea value={order} onChange={(e) => setOrder(e.target.value)} rows={11} />
            </label>
            <button className="link-btn" onClick={() => setOrder(defaultOrder(songs, sermon, notices.length > 0))} title="Put back the order made from the notices, music and sermon">
              Start the order again from the service
            </button>
            <label className="bulletin-check">
              <input
                type="checkbox"
                checked={showNotices}
                disabled={notices.length === 0}
                onChange={(e) => {
                  setShowNotices(e.target.checked);
                  remember("notices", e.target.checked ? "1" : "0");
                }}
              />
              <span>{notices.length === 0 ? "Print the notices (none ticked on the service page)" : `Print the ${notices.length} notice${notices.length === 1 ? "" : "s"} in full`}</span>
            </label>
            <label>
              <span>Ruled lines for notes after the message</span>
              <select
                value={noteLines}
                onChange={(e) => {
                  setNoteLines(Number(e.target.value));
                  remember("lines", e.target.value);
                }}
              >
                {[0, 4, 8, 12, 16].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None" : `${n} lines`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Paper</span>
              <select
                value={page}
                onChange={(e) => {
                  const v = e.target.value === "a5" ? "a5" : "a4";
                  setPage(v);
                  remember("page", v);
                }}
              >
                <option value="a4">A4</option>
                <option value="a5">A5 (a folded sheet)</option>
              </select>
            </label>
          </div>
          <div className="bulletin-preview">
            <SheetOutput blocks={blocks} title={`Bulletin ${date}`} building={false} printOptions={{ page }} />
          </div>
        </div>
      )}
    </article>
  );
}
