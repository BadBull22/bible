// Offline Assistant: ask about the Bible and get an answer written only from this app's own
// texts, with its sources. Hidden until unlocked (offline_ai.rs). Chats and the things the
// reader asks it to remember are kept, so they are still here after the app is closed.

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { parseCitation } from "../api";
import { ai, AiChat, AiMessage, AiStatus } from "../offlineAi";
import { CloseIcon } from "./icons";

interface Props {
  /** a question to ask at once (from the search results' button) */
  initialQuestion?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
  /** after "Turn off": the panel and its menu item go away */
  onTurnedOff: () => void;
}

const KIND_NOTE: Record<string, string> = {
  curated: "A hand-checked answer from this app, shown word for word.",
  none: "Nothing in the app's texts answers this, so the AI wasn't asked.",
  no_answer: "The AI read the passages below; none of them answers this.",
  memory: "Kept for all your chats.",
};

export function OfflineAiPanel({ initialQuestion, onJump, onClose, onTurnedOff }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [chats, setChats] = useState<AiChat[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "chats" | "settings">("chat");
  const [memory, setMemory] = useState<{ id: number; fact: string }[]>([]);
  const end = useRef<HTMLDivElement>(null);

  const refresh = () => {
    void ai.status().then(setStatus).catch((e) => setError(String(e)));
    void ai.chats().then(setChats).catch(() => undefined);
    void ai.memory().then(setMemory).catch(() => undefined);
  };
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    const a = listen<{ stage: string; percent: number }>("ai-progress", (e) => setProgress(e.payload));
    const b = listen<{ chat_id: number; text: string }>("ai-status", (e) => setWriting(e.payload.text));
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (chatId == null) setMessages([]);
    else void ai.messages(chatId).then(setMessages).catch((e) => setError(String(e)));
  }, [chatId]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, writing]);

  async function install() {
    setError(null);
    setProgress({ stage: "runtime", percent: 0 });
    try {
      await ai.install();
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
      refresh();
    }
  }

  async function send(asked?: string) {
    const q = (asked ?? question).trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setWriting("");
    setQuestion("");
    setMessages((m) => [...m, { id: -1, role: "user", content: q, sources: [], unsupported: [], kind: "question", created_at: "" }]);
    try {
      const r = await ai.ask(chatId, q);
      setChatId(r.chat_id);
      setMessages(r.messages);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setWriting("");
      setBusy(false);
    }
  }

  const ready = status?.runtime && status?.model;
  // the search results' button: the question is asked as soon as the assistant is ready
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (initialQuestion && ready && started.current !== initialQuestion) {
      started.current = initialQuestion;
      setView("chat");
      setChatId(null);
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, ready]);
  const ref = (label: string) => {
    const r = parseCitation(label.replace(/^.* on /, ""));
    return r ? () => onJump(r.book, r.chapter, r.verse) : undefined;
  };

  return (
    <aside className="side-panel wide offline-ai-panel">
      <div className="side-panel-header">
        <h3>Offline Assistant</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="Offline Assistant">
        {(
          [
            ["chat", "Ask"],
            ["chats", `Chats (${chats.length})`],
            ["settings", "Settings"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? "active" : ""} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="status-error">{error}</p>}

      {view === "settings" || (status && !ready) ? (
        <div className="ai-settings">
          <p className="search-hint">
            Answers questions only from this app's Bibles and commentaries, on this computer, and shows its sources. It is a beta: small AI models can still
            make mistakes, so check the sources. Your hand-checked answers always come first, word for word.
          </p>
          {ready ? (
            <p>
              Downloaded and ready ({status?.variant === "generic-gpu" ? "using the graphics card" : "using the processor"}).
            </p>
          ) : progress ? (
            <p>
              Downloading {progress.stage === "model" ? "the model" : progress.stage === "accelerator" ? "the graphics-card support" : "the AI runtime"}…{" "}
              {Math.round(progress.percent)}%
            </p>
          ) : (
            <>
              <p>It needs a one-time download: the AI runtime (about 40 MB) and the Phi-4-mini model (about 3–5 GB). After that it works offline.</p>
              <button className="primary-btn" disabled={status?.downloading} onClick={() => void install()}>
                Download
              </button>
            </>
          )}
          {memory.length > 0 && (
            <>
              <h4>What it remembers</h4>
              <ul className="xref-list">
                {memory.map((m) => (
                  <li key={m.id}>
                    {m.fact}{" "}
                    <button className="link-btn" onClick={() => void ai.forget(m.id).then(refresh)}>
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="search-hint">Tell it “remember that …” in a chat to add to this list.</p>
          <div className="ai-actions">
            {ready && (
              <button className="link-btn" onClick={() => void ai.remove().then(refresh).catch((e) => setError(String(e)))}>
                Remove the download
              </button>
            )}
            <button className="link-btn" onClick={() => void ai.turnOff().then(onTurnedOff)}>
              Turn the Offline Assistant off
            </button>
          </div>
        </div>
      ) : view === "chats" ? (
        <ul className="xref-list">
          <li>
            <button
              className="link-btn"
              onClick={() => {
                setChatId(null);
                setView("chat");
              }}
            >
              + New chat
            </button>
          </li>
          {chats.map((c) => (
            <li key={c.id}>
              <button
                className="link-btn"
                onClick={() => {
                  setChatId(c.id);
                  setView("chat");
                }}
              >
                {c.title}
              </button>{" "}
              <span className="votes">{c.created_at.slice(0, 16)}</span>{" "}
              <button className="link-btn" onClick={() => void ai.deleteChat(c.id).then(() => (chatId === c.id && setChatId(null), refresh()))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ai-chat">
          <div className="ai-messages">
            {messages.length === 0 && !busy && (
              <p className="search-hint">
                Ask about the Bible, e.g. “Why was Daniel's answer delayed?” Follow-up questions work too. Answers come only from the app's texts and
                show their sources.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={m.id >= 0 ? m.id : `new-${i}`} className={`ai-msg ai-${m.role}`}>
                <div className="ai-text">{m.content}</div>
                {m.role === "assistant" && KIND_NOTE[m.kind] && <div className="search-hint">{KIND_NOTE[m.kind]}</div>}
                {m.unsupported.length > 0 && (
                  <div className="ai-unsupported">
                    ⚠ Check this against the passage: {m.unsupported.join("; ")}
                  </div>
                )}
                {m.sources.length > 0 && (
                  <details className="ai-sources" open>
                    <summary>The verses it read ({m.sources.length})</summary>
                    <ul>
                      {m.sources.map((s) => (
                        <li key={s.tag}>
                          <button className="link-btn" disabled={!ref(s.label)} onClick={ref(s.label)}>
                            {s.tag} · {s.label}
                          </button>
                          <div className="snippet">{s.text.length > 400 ? `${s.text.slice(0, 400)}…` : s.text}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {m.kind === "model" && <div className="search-hint">Offline Assistant — check the verses it read.</div>}
              </div>
            ))}
            {busy && <div className="ai-msg ai-assistant">{writing || "Looking in the texts…"}</div>}
            <div ref={end} />
          </div>
          <form
            className="ai-ask"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={chatId == null ? "Ask a question…" : "Ask a follow-up…"}
              rows={2}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !question.trim()}>
              {busy ? "…" : "Ask"}
            </button>
          </form>
          <p className="search-hint ai-disclaimer">
            Offline Assistant. Give more detail (a name, a place, a book) for a more accurate answer, and always check the verses yourself: it can still get things wrong.
          </p>
        </div>
      )}
    </aside>
  );
}
