// The prayer list (Extras > Prayer list): what the reader is praying about, with a place to mark what God has answered and how. Kept on the phone and in the backup
// file; nothing is sent anywhere.

import { useEffect, useRef, useState } from "react";
import { api, type Prayer } from "./api";
import { dayString } from "./memoryVerse";

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** "2026-11-20" -> "20 Nov 2026" */
function nice(day: string | null | undefined): string {
  if (!day) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  /** words to start the new request with (from "How are you today?"), or null */
  draft: string | null;
  say: (message: string) => void;
  fail: (e: unknown) => void;
  /** called whenever the list changes (so the notifications and the row's count are made again) */
  onChanged: () => void;
}

export function PrayerList({ draft, say, fail, onChanged }: Props) {
  const [list, setList] = useState<Prayer[] | null>(null);
  const [text, setText] = useState(draft ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sure, setSure] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = () =>
    api
      .prayers()
      .then(setList)
      .catch((e) => {
        setList([]);
        fail(e);
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (draft) {
      setText(draft);
      window.setTimeout(() => {
        const el = box.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 150);
    }
  }, [draft]);

  async function save() {
    if (!text.trim()) return;
    try {
      await api.savePrayer(editing ?? newId(), text);
      setText("");
      setEditing(null);
      say(editing ? "Changed" : "Added to your prayer list");
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }
  async function answered(p: Prayer) {
    try {
      await api.answerPrayer(p.id, dayString(), note);
      setAnswering(null);
      setNote("");
      say("Thank God! Moved to Answered");
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }
  async function reopen(p: Prayer) {
    try {
      await api.answerPrayer(p.id, null, "");
      say("Back among the things you are praying about");
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }
  async function remove(p: Prayer) {
    if (sure !== p.id) {
      setSure(p.id);
      window.setTimeout(() => setSure((s) => (s === p.id ? null : s)), 4000);
      return;
    }
    try {
      await api.deletePrayer(p.id);
      setSure(null);
      await load();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  const open = (list ?? []).filter((p) => !p.answered_at);
  const done = (list ?? []).filter((p) => p.answered_at);

  return (
    <>
      <h3>Prayer list</h3>
      <p className="hint">What you are praying about, and what God has answered. It stays on this phone and goes into your backup; no one else sees it.</p>
      <textarea
        ref={box}
        className="field"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What are you praying about? A person, a need, a thank-you…"
        aria-label="A prayer request"
      />
      <div className="actions">
        <button className="primary" disabled={!text.trim()} onClick={() => void save()}>
          {editing ? "Save the change" : "Add to my prayer list"}
        </button>
        {editing && (
          <button
            onClick={() => {
              setEditing(null);
              setText("");
            }}
          >
            Cancel
          </button>
        )}
      </div>

      <h4 className="prayer-head">Praying about ({open.length})</h4>
      {list && open.length === 0 && <p className="hint">Nothing yet. Add what is on your heart above. “Do not be anxious about anything, but in everything, by prayer and petition, with thanksgiving, present your requests to God.” (Philippians 4:6)</p>}
      <ul className="prayer-list">
        {open.map((p) => (
          <li key={p.id} className="prayer">
            <p className="prayer-text">{p.body}</p>
            <p className="hint prayer-meta">Since {nice(p.created_at)}</p>
            {answering === p.id ? (
              <div className="prayer-answer">
                <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How did God answer? (you can leave this empty)" aria-label="How God answered" />
                <div className="actions">
                  <button className="primary" onClick={() => void answered(p)}>
                    It was answered
                  </button>
                  <button onClick={() => setAnswering(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="actions">
                <button
                  onClick={() => {
                    setAnswering(p.id);
                    setNote("");
                  }}
                >
                  Answered
                </button>
                <button
                  onClick={() => {
                    setEditing(p.id);
                    setText(p.body);
                    window.scrollTo?.({ top: 0 });
                    box.current?.focus();
                  }}
                >
                  Edit
                </button>
                <button onClick={() => void remove(p)}>{sure === p.id ? "Tap again to delete" : "Delete"}</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <h4 className="prayer-head">Answered ({done.length})</h4>
          <ul className="prayer-list">
            {done.map((p) => (
              <li key={p.id} className="prayer answered">
                <p className="prayer-text">{p.body}</p>
                <p className="hint prayer-meta">
                  Answered {nice(p.answered_at)}
                  {p.answer_note ? `: ${p.answer_note}` : ""}
                </p>
                <div className="actions">
                  <button onClick={() => void reopen(p)}>Pray about it again</button>
                  <button onClick={() => void remove(p)}>{sure === p.id ? "Tap again to delete" : "Delete"}</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** The Extras row. */
export function PrayerEntry({ open, onOpen }: { open: number; onOpen: () => void }) {
  return (
    <button className="more-row" onClick={onOpen}>
      <span className="more-row-title">Prayer list</span>
      <small>{open > 0 ? `${open} praying` : "add a request"}</small>
      <span className="dl-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}
