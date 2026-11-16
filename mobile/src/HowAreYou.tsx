// "How are you today?" (Extras): the reader taps how they feel and is given a verse for it, from the "Verses for..." pages (Scripture first). From the verse they can
// read it in the Bible, see more verses like it, pray about it (it starts a prayer request) or learn it by heart.

import { useEffect, useState } from "react";
import { api, phone } from "./api";
import { parseRef } from "../../src/browse/browseLogic";
import { TOPICS } from "../../src/browse/data";
import { dayNumber, trimWords } from "./dailyScroll";
import { MOODS, passageIndex, type Mood } from "./moods";
import { wordsOf } from "./MemoryPractice";

interface Props {
  version: string;
  say: (message: string) => void;
  fail: (e: unknown) => void;
  onRead: (book: string, chapter: number, verse: number) => void;
  /** open the "Verses for..." page */
  onMore: (topicId: string) => void;
  /** open the prayer list with these words to start a request */
  onPray: (draft: string) => void;
  /** a verse was added to the memory verses */
  onChanged: () => void;
}

export function HowAreYou({ version, say, fail, onRead, onMore, onPray, onChanged }: Props) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [skip, setSkip] = useState(0);
  const [text, setText] = useState<string | null>(null);

  const page = mood ? TOPICS.find((t) => t.id === mood.topic) : undefined;
  const items = page?.items ?? [];
  const at = mood ? passageIndex(mood.id, dayNumber(), items.length, skip) : 0;
  const item = items[at];
  const ref = item ? parseRef(item.ref) : null;

  useEffect(() => {
    if (!ref) {
      setText(null);
      return;
    }
    let live = true;
    setText(null);
    wordsOf(version, { book: ref.book, chapter: ref.chapter, verse: ref.verse, verse_end: ref.verseEnd })
      .then((t) => live && setText(t))
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood?.id, skip, version]);

  if (!mood) {
    return (
      <>
        <h3>How are you today?</h3>
        <p className="hint">Tap what is closest, and read a word from Scripture for it.</p>
        <div className="mood-grid" role="group" aria-label="How you feel">
          {MOODS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMood(m);
                setSkip(0);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <h3>{mood.label}</h3>
      <p className="hint mood-line">{mood.line}</p>
      {item && ref && (
        <div className="memory-card">
          <p className="memory-words memory-full">{text === null ? "…" : text ? `“${trimWords(text, 420)}”` : "That verse is not in the Bible you read."}</p>
          <p className="memory-ref">
            {item.ref} · {version}
          </p>
          {item.note && <p className="hint mood-note">{item.note}</p>}
        </div>
      )}
      <div className="actions">
        <button className="primary" onClick={() => setSkip(skip + 1)}>
          Another verse
        </button>
        {ref && <button onClick={() => onRead(ref.book, ref.chapter, ref.verse)}>Read in the Bible</button>}
      </div>
      <div className="actions">
        <button onClick={() => onPray(mood.prayer)}>Pray about this</button>
        {ref && (
          <button
            onClick={() => {
              const today = new Date();
              const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
              api
                .addMemoryVerse(ref.book, ref.chapter, ref.verse, ref.verseEnd, day)
                .then((added) => {
                  say(added ? "Added to your memory verses" : "You are already learning that verse");
                  onChanged();
                })
                .catch(fail);
            }}
          >
            Learn this verse
          </button>
        )}
      </div>
      <div className="actions">
        <button onClick={() => onMore(mood.topic)}>More verses like this</button>
        {item && text && (
          <button onClick={() => void phone.share(`“${trimWords(text, 420)}” — ${item.ref}\n\nhttps://bible4me.org`, item.ref).catch(fail)}>Share</button>
        )}
        <button onClick={() => setMood(null)}>How else?</button>
      </div>
    </>
  );
}

/** The Extras row. */
export function MoodEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="more-row" onClick={onOpen}>
      <span className="more-row-title">How are you today?</span>
      <small>a verse for how you feel</small>
      <span className="dl-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}
