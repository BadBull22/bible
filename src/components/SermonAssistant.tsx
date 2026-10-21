// The Offline Assistant inside the sermon builder (hidden unless it is unlocked). It answers
// questions about the passage or subject being prepared, from this app's own texts, and shows the
// verses it read. It writes none of the sermon: an answer goes into "what has been gathered" only
// when the preacher presses Add, marked as the assistant's with its verses, and the preacher
// decides from there what goes into the sermon.

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ai, AiMessage } from "../offlineAi";
import { BookInfo } from "../api";
import { Material } from "../sermon";
import { SermonBuild } from "./SermonBuild";

interface Props {
  /** what the sermon is about: the passage or subjects being prepared (for the starter questions) */
  topics: string[];
  /** what has been gathered so far (its passages are offered to build around) */
  gathered: Material[];
  books: BookInfo[];
  onAdd: (m: Material) => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

export function SermonAssistant({ topics, gathered, books, onAdd, onJump }: Props) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ai
      .status()
      .then((s) => setReady(s.runtime && s.model))
      .catch(() => setReady(false));
    const un = listen<{ chat_id: number; text: string }>("ai-status", (e) => setStatus(e.payload.text));
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, status]);

  async function send(asked?: string) {
    const q = (asked ?? question).trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    setMessages((m) => [...m, { id: -1, role: "user", content: q, sources: [], unsupported: [], kind: "question", created_at: "" }]);
    try {
      const r = await ai.ask(chatId, q);
      setChatId(r.chat_id);
      setMessages(r.messages);
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  /** The assistant's answer, as something gathered for the sermon: named as the assistant's, with the verses it read. */
  function add(m: AiMessage, asked: string) {
    const first = m.sources[0];
    const verses = m.sources.map((s) => s.label).join("; ");
    onAdd({
      key: `assistant:${m.id}`,
      kind: "assistant",
      title: `Offline Assistant — ${asked.length > 70 ? `${asked.slice(0, 70)}…` : asked}`,
      text: m.content,
      source: verses ? `Offline Assistant · verses it read: ${verses}` : "Offline Assistant",
      ref: first ? { book: first.book, chapter: first.chapter, verse: first.verse, verseEnd: first.verse_end } : undefined,
      topic: topics[0] ?? "",
    });
    setAdded((a) => new Set(a).add(m.id));
  }

  if (ready === null) return null;
  const starters = topics.slice(0, 2).map((t) => `What does the Bible say about ${t}?`);

  return (
    <details className="sb-assistant">
      <summary>Offline Assistant</summary>
      <SermonBuild topics={topics} gathered={gathered} books={books} onAdd={onAdd} onJump={onJump} modelReady={ready} />
      {!ready ? (
        <p className="search-hint">To ask it questions, and for its own sentences, set it up first: Study → Offline Assistant, then Settings → Download.</p>
      ) : (
        <>
          <h4 className="sb-assistant-ask">Ask a question</h4>
          <div className="sb-assistant-messages">
            {messages.length === 0 && (
              <p className="search-hint">
                Ask about what you are preparing. It answers only from this app's texts and shows the verses it read; nothing goes into your sermon unless you press Add.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={m.id >= 0 ? m.id : `n${i}`} className={`ai-msg ai-${m.role}`}>
                <div className="ai-text">{m.content}</div>
                {m.unsupported.length > 0 && <div className="ai-unsupported">⚠ Check this against the passage: {m.unsupported.join("; ")}</div>}
                {m.sources.length > 0 && (
                  <div className="citation-row">
                    {m.sources.map((s) => (
                      <button key={s.tag} className="link-btn" onClick={() => onJump(s.book, s.chapter, s.verse)} title={s.text.slice(0, 200)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && m.kind === "model" && m.sources.length > 0 && (
                  <div>
                    <button className="text-btn" disabled={added.has(m.id)} onClick={() => add(m, [...messages].slice(0, i).reverse().find((x) => x.role === "user")?.content ?? "")}>
                      {added.has(m.id) ? "Added to what you've gathered" : "Add to what I've gathered"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="ai-msg ai-assistant">{status || "Looking in the texts…"}</div>}
            <div ref={end} />
          </div>
          {error && <p className="status-error">{error}</p>}
          {messages.length === 0 && starters.length > 0 && (
            <div className="chips">
              {starters.map((s) => (
                <button key={s} className="link-btn" disabled={busy} onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="ai-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your passage or subject…" disabled={busy} aria-label="Ask the Offline Assistant" />
            <button type="submit" disabled={busy || !question.trim()}>
              {busy ? "…" : "Ask"}
            </button>
          </form>
          <p className="search-hint ai-disclaimer">
            Give more detail (a name, a place, a book) for a more accurate answer, and check the verses yourself: it can still get things wrong.
          </p>
        </>
      )}
    </details>
  );
}
