// Memory verses (Extras > Memory verses): verses the reader is learning by heart, practised again after longer and longer gaps. A verse is added from here (type it),
// from a suggestion, from a verse's menu in the Bible, or from "How are you today?". The practice is one verse at a time: part of the words are hidden, the reader says
// the verse, shows it, and says whether they knew it. The scheduling is memoryVerse.ts.

import { useEffect, useMemo, useState } from "react";
import { api, type Book, type MemoryRow } from "./api";
import { addDays, afterPractice, blankWords, dayString, daysBetween, dueVerses, firstLetters, levelForBox, refOf, stageName, SUGGESTED } from "./memoryVerse";
import { parseReference } from "./refs";

/** The words of a verse or a few verses: in the reader's Bible, or the BSB when theirs lacks the passage. */
export async function wordsOf(version: string, v: { book: string; chapter: number; verse: number; verse_end: number }): Promise<string> {
  const end = v.verse_end > v.verse ? v.verse_end : null;
  const text = (await api.passage(version, v.book, v.chapter, v.verse, end)).trim();
  if (text || version === "BSB") return text;
  return (await api.passage("BSB", v.book, v.chapter, v.verse, end)).trim();
}

const key = (v: { book: string; chapter: number; verse: number; verse_end: number }) => `${v.book}|${v.chapter}|${v.verse}|${v.verse_end}`;

function dueText(due: string, today: string): string {
  const d = daysBetween(today, due);
  if (d < 0) return d === -1 ? "Due since yesterday" : `Due ${-d} days ago`;
  if (d === 0) return "Due today";
  return d === 1 ? "Due tomorrow" : `Due in ${d} days`;
}

interface Props {
  version: string;
  books: Book[];
  say: (message: string) => void;
  fail: (e: unknown) => void;
  /** open the verse in the Bible */
  onRead: (book: string, chapter: number, verse: number) => void;
  /** called when the list changes */
  onChanged: () => void;
  /** start straight in practice (from a notification) */
  practiceNow?: boolean;
}

export function MemoryPractice({ version, books, say, fail, onRead, onChanged, practiceNow }: Props) {
  const [rows, setRows] = useState<MemoryRow[] | null>(null);
  const [typed, setTyped] = useState("");
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [queue, setQueue] = useState<MemoryRow[] | null>(null);
  const [shown, setShown] = useState(false);
  const [hint, setHint] = useState<"blanks" | "letters">("blanks");
  const [practised, setPractised] = useState(0);
  const [sure, setSure] = useState<string | null>(null);
  const today = dayString();

  const load = () =>
    api
      .memoryVerses()
      .then(setRows)
      .catch((e) => {
        setRows([]);
        fail(e);
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const due = useMemo(() => dueVerses(rows ?? [], today), [rows, today]);
  const startedPractice = useState({ done: false })[0];
  useEffect(() => {
    if (practiceNow && rows && !startedPractice.done && due.length > 0) {
      startedPractice.done = true;
      begin(due);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceNow, rows]);

  async function need(v: MemoryRow) {
    const k = key(v);
    if (texts[k] !== undefined) return;
    try {
      const t = await wordsOf(version, v);
      setTexts((x) => ({ ...x, [k]: t }));
    } catch {
      setTexts((x) => ({ ...x, [k]: "" }));
    }
  }

  async function add(book: string, chapter: number, verse: number, verseEnd: number) {
    try {
      const was = await api.addMemoryVerse(book, chapter, verse, verseEnd, today);
      say(was ? `${refOf({ book, chapter, verse, verse_end: verseEnd })} added: it is ready to practise` : "You are already learning that verse");
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }
  async function addTyped() {
    const r = parseReference(typed, books);
    if (!r || r.verse == null) {
      say("Type a verse, like John 3:16 or Psalm 23:1-3");
      return;
    }
    const range = /-\s*(\d+)\s*$/.exec(typed);
    const end = range ? Math.max(r.verse, Number(range[1])) : r.verse;
    if (end - r.verse > 5) {
      say("Learn a few verses at a time: up to six in a row");
      return;
    }
    const text = await wordsOf(version, { book: r.book, chapter: r.chapter, verse: r.verse, verse_end: end }).catch(() => "");
    if (!text) {
      say(`${r.book} ${r.chapter}:${r.verse} is not in the Bible you read`);
      return;
    }
    setTyped("");
    await add(r.book, r.chapter, r.verse, end);
  }
  async function remove(v: MemoryRow) {
    const k = key(v);
    if (sure !== k) {
      setSure(k);
      window.setTimeout(() => setSure((s) => (s === k ? null : s)), 4000);
      return;
    }
    try {
      await api.removeMemoryVerse(v.book, v.chapter, v.verse, v.verse_end);
      setSure(null);
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  function begin(list: MemoryRow[]) {
    setQueue(list.slice());
    setShown(false);
    setPractised(0);
    list.slice(0, 3).forEach((v) => void need(v));
  }

  async function judge(knewIt: boolean) {
    if (!queue || queue.length === 0) return;
    const v = queue[0];
    const next = afterPractice(v.box, knewIt, today);
    try {
      await api.setMemoryProgress(v.book, v.chapter, v.verse, v.verse_end, next.box, next.due_on, today);
    } catch (e) {
      fail(e);
    }
    const rest = queue.slice(1);
    // a verse that was not known comes round again at the end of this practice, once
    if (!knewIt && !queue.slice(1).some((q) => key(q) === key(v))) rest.push({ ...v, box: 0, due_on: addDays(today, 1) });
    setPractised((n) => n + (knewIt ? 1 : 0));
    setShown(false);
    setQueue(rest);
    rest.slice(0, 2).forEach((q) => void need(q));
    if (rest.length === 0) {
      await load();
      onChanged();
    }
  }

  // ------------------------------------------------------------ practice
  if (queue) {
    if (queue.length === 0) {
      return (
        <>
          <h3>Well done</h3>
          <p className="memory-done">{practised === 0 ? "Keep going: it comes with practice." : `${practised} verse${practised === 1 ? "" : "s"} practised.`}</p>
          <p className="hint">“I have hidden Your word in my heart that I might not sin against You.” (Psalm 119:11)</p>
          <div className="actions">
            <button className="primary" onClick={() => setQueue(null)}>
              Back to my verses
            </button>
          </div>
        </>
      );
    }
    const v = queue[0];
    const text = texts[key(v)];
    const level = levelForBox(v.box);
    const blanks = text ? blankWords(text, level, refOf(v)) : null;
    return (
      <>
        <h3>Practise</h3>
        <p className="hint">{queue.length} to go · {stageName(v.box)}</p>
        <div className="memory-card">
          <p className="memory-ref">{refOf(v)}</p>
          {text === undefined && <p className="hint">Loading…</p>}
          {text === "" && <p className="hint">The words of this verse are not in the Bible you read. Change Bible in More, or remove the verse.</p>}
          {text && !shown && hint === "blanks" && blanks && (
            <p className="memory-words" aria-label="The verse with words hidden">
              {blanks.parts.map((p, i) => (p.hidden ? <span key={i} className="memory-blank">{"_".repeat(Math.max(2, Math.min(8, p.word.replace(/[^\p{L}\p{N}]/gu, "").length)))} </span> : <span key={i}>{p.word} </span>))}
            </p>
          )}
          {text && !shown && hint === "letters" && <p className="memory-words memory-letters">{firstLetters(text)}</p>}
          {text && shown && <p className="memory-words memory-full">{text}</p>}
        </div>
        {text && !shown && (
          <>
            <p className="hint">Say the verse out loud, then show it.</p>
            <div className="chips segmented" role="group" aria-label="Hint">
              <button className={hint === "blanks" ? "on" : ""} onClick={() => setHint("blanks")}>
                Some words
              </button>
              <button className={hint === "letters" ? "on" : ""} onClick={() => setHint("letters")}>
                First letters
              </button>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => setShown(true)}>
                Show the verse
              </button>
            </div>
          </>
        )}
        {text && shown && (
          <div className="actions">
            <button className="primary" onClick={() => void judge(true)}>
              I knew it
            </button>
            <button onClick={() => void judge(false)}>Not yet</button>
          </div>
        )}
        {text === "" && (
          <div className="actions">
            <button onClick={() => void judge(false)}>Skip it</button>
          </div>
        )}
        <div className="actions">
          <button onClick={() => setQueue(null)}>Stop</button>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------ the list
  const learning = rows ?? [];
  const have = new Set(learning.map(key));
  const suggestions = SUGGESTED.filter(([b, c, v, e]) => !have.has(key({ book: b, chapter: c, verse: v, verse_end: e })));
  return (
    <>
      <h3>Memory verses</h3>
      <p className="hint">
        Learn Scripture by heart. Add a verse and it comes back to you after a day, then three days, a week, and on, as you get to know it. Part of the words are hidden each time; say the verse, then check.
      </p>
      {rows && due.length > 0 && (
        <div className="actions">
          <button className="primary" onClick={() => begin(due)}>
            Practise now ({due.length} due)
          </button>
        </div>
      )}
      {rows && learning.length > 0 && due.length === 0 && <p className="hint">Nothing is due today. Well done. The next one is {dueText(learning[0].due_on, today).toLowerCase()}.</p>}

      <div className="memory-add">
        <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="A verse to learn: John 3:16 or Psalm 23:1-3" aria-label="A verse to learn" autoCapitalize="words" onKeyDown={(e) => e.key === "Enter" && void addTyped()} />
        <button onClick={() => void addTyped()} disabled={!typed.trim()}>
          Add
        </button>
      </div>
      {suggestions.length > 0 && (
        <>
          <p className="hint">Or choose one:</p>
          <div className="chips" role="group" aria-label="Suggested verses">
            {suggestions.slice(0, 6).map(([b, c, v, e]) => (
              <button key={`${b}${c}${v}`} onClick={() => void add(b, c, v, e)}>
                + {refOf({ book: b, chapter: c, verse: v, verse_end: e })}
              </button>
            ))}
          </div>
        </>
      )}

      {learning.length > 0 && <h4 className="prayer-head">Your verses ({learning.length})</h4>}
      <ul className="prayer-list">
        {learning.map((v) => {
          const k = key(v);
          return (
            <li key={k} className="prayer">
              <button
                className="memory-row"
                onClick={() => {
                  setOpen(open === k ? null : k);
                  void need(v);
                }}
                aria-expanded={open === k}
              >
                <span className="memory-row-ref">{refOf(v)}</span>
                <small>
                  {stageName(v.box)} · {dueText(v.due_on, today)}
                </small>
              </button>
              {open === k && (
                <>
                  <p className="memory-words memory-full">{texts[k] ?? "…"}</p>
                  <div className="actions">
                    <button onClick={() => begin([v])}>Practise this one</button>
                    <button onClick={() => onRead(v.book, v.chapter, v.verse)}>Read in the Bible</button>
                    <button onClick={() => void remove(v)}>{sure === k ? "Tap again to remove" : "Remove"}</button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The Extras row. */
export function MemoryEntry({ due, total, onOpen }: { due: number; total: number; onOpen: () => void }) {
  return (
    <button className="more-row" onClick={onOpen}>
      <span className="more-row-title">Memory verses</span>
      <small>{due > 0 ? `${due} due` : total > 0 ? `${total} learning` : "learn by heart"}</small>
      <span className="dl-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}
