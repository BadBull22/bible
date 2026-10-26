// "Build around this" in the sermon builder (hidden unless the Offline Assistant is unlocked).
// The preacher chooses a passage; the assistant brings what the app already has around it. Every
// card is the app's own data with its source named (the interlinear, Strong's, the dictionary);
// where the model wrote a sentence, it is marked as the assistant's and was checked against that
// card's text. Nothing goes into the sermon unless the preacher presses Add, and then it is
// gathered, marked as the assistant's, not placed.

import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BookInfo } from "../api";
import { ai, AiGroupQuestion, AiPart, AiStory, AiThread, AiWordInsight } from "../offlineAi";
import { Material, parseRef, Ref } from "../sermon";

interface Props {
  topics: string[];
  gathered: Material[];
  books: BookInfo[];
  onAdd: (m: Material) => void;
  onJump: (book: string, chapter: number, verse: number) => void;
  /** the model is downloaded: without it the parts still show what the app holds, but write no sentence of their own */
  modelReady: boolean;
}

/** "John 3:16–18", or "John 3" for a whole chapter. */
export function passageLabel(r: Ref): string {
  if (r.verseEnd >= 200) return `${r.book} ${r.chapter}`;
  return r.verseEnd > r.verse ? `${r.book} ${r.chapter}:${r.verse}–${r.verseEnd}` : `${r.book} ${r.chapter}:${r.verse}`;
}

export function SermonBuild({ topics, gathered, books, onAdd, onJump, modelReady }: Props) {
  // the passages the preacher is working on: typed passages first, then what has been gathered
  const passages = useMemo(() => {
    const seen = new Set<string>();
    const out: Ref[] = [];
    const take = (r: Ref | null | undefined) => {
      if (!r) return;
      const k = passageLabel(r);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    };
    topics.forEach((t) => take(parseRef(t, books)));
    gathered.forEach((m) => take(m.ref));
    return out.slice(0, 8);
  }, [topics, gathered, books]);

  const [choice, setChoice] = useState("");
  const [typed, setTyped] = useState("");
  const [cards, setCards] = useState<AiWordInsight[] | null>(null);
  const [cardsFor, setCardsFor] = useState<Ref | null>(null);
  const [threads, setThreads] = useState<AiThread[] | null>(null);
  const [threadsFor, setThreadsFor] = useState<Ref | null>(null);
  /** the assistant's one sentence for each link of a thread, by thread */
  const [ties, setTies] = useState<Record<string, (string | null)[]>>({});
  const [stories, setStories] = useState<AiStory[] | null>(null);
  const [storiesFor, setStoriesFor] = useState<Ref | null>(null);
  const [questions, setQuestions] = useState<AiGroupQuestion[] | null>(null);
  const [questionsFor, setQuestionsFor] = useState<Ref | null>(null);
  const [parts, setParts] = useState<AiPart[] | null>(null);
  const [partsFor, setPartsFor] = useState<Ref | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const un = listen<{ chat_id: number; text: string }>("ai-status", (e) => setStatus(e.payload.text));
    return () => void un.then((f) => f());
  }, []);

  const typedRef = typed.trim() ? parseRef(typed, books) : null;
  const picked: Ref | null = typedRef ?? passages.find((p) => passageLabel(p) === choice) ?? passages[0] ?? null;

  async function words() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    setCards(null);
    setCardsFor(picked);
    setStatus("Looking at the Hebrew and Greek…");
    try {
      setCards(await ai.wordInsights(picked.book, picked.chapter, picked.verse, picked.verseEnd, modelReady));
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function findThreads() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    setThreads(null);
    setThreadsFor(picked);
    setStatus("Following the links from the passage…");
    try {
      setThreads(await ai.threads(picked.book, picked.chapter, picked.verse, picked.verseEnd));
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function findStories() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    setStories(null);
    setStoriesFor(picked);
    setStatus("Looking through what the old preachers said and the stories…");
    try {
      const subjects = topics.filter((t) => !parseRef(t, books));
      setStories(await ai.stories(picked.book, picked.chapter, picked.verse, picked.verseEnd, subjects, modelReady));
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function findStructure() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    setParts(null);
    setPartsFor(picked);
    setStatus("Cutting the passage into its parts…");
    try {
      setParts(await ai.structure(picked.book, picked.chapter, picked.verse, picked.verseEnd, modelReady));
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  async function findQuestions() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    setQuestions(null);
    setQuestionsFor(picked);
    setStatus("Writing questions for the group…");
    try {
      setQuestions(await ai.groupQuestions(picked.book, picked.chapter, picked.verse, picked.verseEnd));
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  /** The questions as something gathered: prompts for a group, marked as the assistant's. */
  function addQuestions(list: AiGroupQuestion[], r: Ref) {
    const lines = list.map((q, i) => `${i + 1}. ${q.text}`);
    onAdd({
      key: `assistant:questions:${r.book}:${r.chapter}:${r.verse}:${r.verseEnd}`,
      kind: "assistant",
      title: `Questions for a small group — ${passageLabel(r)}`,
      text: lines.join("\n"),
      source: "Offline Assistant · written from the passage; the first four were each answered from the passage by the assistant's own checked reading",
      ref: { book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd },
      topic: topics[0] ?? "",
    });
    setAdded((a) => new Set(a).add("questions"));
  }

  const partRange = (p: AiPart) => (p.verse_end > p.verse_start ? `verses ${p.verse_start}–${p.verse_end}` : `verse ${p.verse_start}`);

  /** The parts as something gathered: an outline the preacher can use or throw away. */
  function addParts(list: AiPart[], r: Ref) {
    const lines = list.map((p, i) => `${i + 1}. ${p.heading ?? "(no heading)"} — ${partRange(p)}`);
    onAdd({
      key: `assistant:structure:${r.book}:${r.chapter}:${r.verse}:${r.verseEnd}`,
      kind: "assistant",
      title: `Outline ideas — ${passageLabel(r)}`,
      text: lines.join("\n"),
      source: "Offline Assistant · the passage cut into its parts; each heading written from the part's own words",
      ref: { book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd },
      topic: topics[0] ?? "",
    });
    setAdded((a) => new Set(a).add("structure"));
  }

  /** A story or an outline as something gathered, with the book it is from named. */
  function addStory(s: AiStory, r: Ref) {
    onAdd({
      key: `assistant:story:${s.kind}:${s.title}`,
      kind: "assistant",
      title: `${s.kind === "illustration" ? "Story" : s.kind === "simeon" ? "Simeon's outline" : "Spurgeon's sermon"} — ${s.title}`,
      text: s.text,
      source: `Offline Assistant · ${s.source}${s.subject ? ` · ${s.subject}` : ""}`,
      ref: s.kind === "illustration" ? undefined : { book: r.book, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd },
      topic: topics[0] ?? "",
    });
    setAdded((a) => new Set(a).add(`story:${s.kind}:${s.title}`));
  }

  async function sayTies(th: AiThread, r: Ref) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus("Reading the verses side by side…");
    try {
      const notes = await ai.threadNotes(r.book, r.chapter, r.verse, r.verseEnd, th.links.map((l) => ({ book: l.book, chapter: l.chapter, verse: l.verse, verse_end: l.verse_end })));
      setTies((m) => ({ ...m, [`${th.kind}:${th.title}`]: notes }));
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus("");
      setBusy(false);
    }
  }

  /** A thread as something gathered: its verses written out, named for what ties them and where that comes from. */
  function addThread(th: AiThread, r: Ref) {
    const notes = ties[`${th.kind}:${th.title}`];
    const lines = th.links.map(
      (l, i) => `${l.book} ${l.chapter}:${l.verse}${l.verse_end > l.verse ? `–${l.verse_end}` : ""}${l.why ? ` (${l.why})` : ""} — ${l.text}${notes?.[i] ? `
    Offline Assistant's note (from these two texts only): ${notes[i]}` : ""}`
    );
    onAdd({
      key: `assistant:thread:${th.kind}:${th.title}:${r.book}:${r.chapter}:${r.verse}`,
      kind: "assistant",
      title: `Thread — ${th.title}`,
      text: lines.join("\n"),
      source: `Offline Assistant · ${th.source} · around ${passageLabel(r)}`,
      ref: { book: th.links[0].book, chapter: th.links[0].chapter, verse: th.links[0].verse, verseEnd: th.links[0].verse_end },
      topic: topics[0] ?? "",
    });
    setAdded((a) => new Set(a).add(`thread:${th.kind}:${th.title}`));
  }

  /** A card as something gathered: the app's data, named, with the assistant's sentence marked as such. */
  function add(c: AiWordInsight, r: Ref) {
    const lines = [
      `In ${r.book} ${r.chapter}:${c.verse} the English “${c.english}” is the ${c.strongs.startsWith("G") ? "Greek" : "Hebrew"} ${c.original} (${c.translit}), Strong's ${c.strongs}: ${c.lemma_gloss}.`,
      c.definition ? `Strong's: ${c.definition}` : "",
      c.renderings.length ? `Translated: ${c.renderings.join(", ")}.` : "",
      c.others.length ? `Other words glossed the same: ${c.others.map((o) => `${o.lemma} (${o.strongs})`).join(", ")}.` : "",
      ...c.others.filter((o) => o.note).map((o) => `${o.lemma} (${o.strongs}) — Strong's: ${o.note}`),
      c.explanation ? `Offline Assistant's note (from the entry above only): ${c.explanation}` : "",
    ].filter(Boolean);
    onAdd({
      key: `assistant:word:${c.strongs}:${r.book}:${r.chapter}:${c.verse}`,
      kind: "assistant",
      title: `Word — ${c.original} (${c.translit}) ${c.strongs}, “${c.english}”`,
      text: lines.join("\n"),
      source: `Offline Assistant · interlinear and Strong's ${c.strongs} · ${r.book} ${r.chapter}:${c.verse}`,
      ref: { book: r.book, chapter: r.chapter, verse: c.verse, verseEnd: c.verse },
      topic: topics[0] ?? "",
    });
    setAdded((a) => new Set(a).add(`${c.strongs}:${c.verse}`));
  }

  return (
    <section className="sb-build" aria-label="Build around this">
      <h4>Build around this</h4>
      <p className="search-hint">
        Choose the passage. The assistant brings what this app already has around it, with its source. Where it writes a sentence of its own (a note, a heading, a question) it says so, and the sentence was checked against the passage. Nothing goes into your sermon unless you press Add.
      </p>
      <details className="sb-howto">
        <summary>How it helps, from start to finish</summary>
        <ol>
          <li>
            <strong>Start:</strong> choose the passage you are preaching (the list holds the passages in your sermon), or type one.
          </li>
          <li>
            <strong>Look:</strong> press a button. <em>Word insights</em>: what the Hebrew or Greek adds to the English. <em>Threads</em>: other passages that tie in.{" "}
            <em>Stories &amp; sermons</em>: what Simeon and Spurgeon preached on it, and stories. <em>Structure ideas</em>: the passage cut into parts with a short heading each.{" "}
            <em>Group questions</em>: questions to ask a group.
          </li>
          <li>
            <strong>Keep:</strong> press <em>Add to what I've gathered</em> on what is useful. It goes into the group “From the Offline Assistant” in your gathered list (left, further down),
            marked as the assistant's, with where it comes from.
          </li>
          <li>
            <strong>Use:</strong> press the + beside it to put it in your sermon (Scripture, Explain, Illustrate or Apply). <strong>Finish:</strong> you write the points, the conclusion and the
            response yourself; the assistant does not write them.
          </li>
        </ol>
      </details>
      <div className="sb-build-pick">
        {passages.length > 0 && (
          <select value={picked && !typedRef ? passageLabel(picked) : choice} onChange={(e) => (setChoice(e.target.value), setTyped(""))} aria-label="Passage to build around">
            {passages.map((p) => (
              <option key={passageLabel(p)}>{passageLabel(p)}</option>
            ))}
          </select>
        )}
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={passages.length ? "or another passage, e.g. Romans 8:28-30" : "A passage, e.g. John 3:16-18"} aria-label="Another passage" />
      </div>
      <div className="sb-build-buttons">
        <button type="button" onClick={() => void words()} disabled={!picked || busy} title="The words whose Hebrew or Greek says more than the English">
          {busy ? "…" : "Word insights"}
        </button>
        <button type="button" onClick={() => void findThreads()} disabled={!picked || busy} title="Other places in the Bible that tie in with the passage: cross-references, the same word, topics, people">
          {busy ? "…" : "Threads"}
        </button>
        <button type="button" onClick={() => void findStories()} disabled={!picked || busy} title="What Simeon and Spurgeon preached on the passage, and stories and sayings that go with it">
          {busy ? "…" : "Stories & sermons"}
        </button>
        <button type="button" onClick={() => void findStructure()} disabled={!picked || busy} title="The passage cut into its parts, with a short heading for each">
          {busy ? "…" : "Structure ideas"}
        </button>
        {modelReady && (
          <button type="button" onClick={() => void findQuestions()} disabled={!picked || busy} title="Questions for a small group on the passage: what it says, what it means, how to live it">
            {busy ? "…" : "Group questions"}
          </button>
        )}
      </div>
      {!picked && <p className="search-hint">Choose a passage first: type one above, or add a passage to your sermon.</p>}
      {busy && <p className="search-hint">{status}</p>}
      {error && <p className="status-error">{error}</p>}

      {questions && questionsFor && (
        <div className="sb-build-cards">
          <h5>
            Questions for a small group on {passageLabel(questionsFor)} <span className="muted">· written by the assistant from the passage</span>
          </h5>
          {questions.length === 0 && <p className="search-hint">It had no questions that stayed with the passage. Try again, or a longer passage.</p>}
          <ol className="sb-questions">
            {questions.map((q) => (
              <li key={q.text}>
                {q.text} <span className="muted">({q.kind === "look" ? "what it says" : q.kind === "think" ? "what it means" : "how to live it"})</span>
              </li>
            ))}
          </ol>
          {questions.length > 0 && (
            <button className="text-btn" disabled={added.has("questions")} onClick={() => addQuestions(questions, questionsFor)}>
              {added.has("questions") ? "Added to what you've gathered" : "Add these questions to what I've gathered"}
            </button>
          )}
        </div>
      )}

      {parts && partsFor && (
        <div className="sb-build-cards">
          <h5>
            Parts of {passageLabel(partsFor)} <span className="muted">· the passage's own parts; the headings are the assistant's</span>
          </h5>
          {parts.length === 0 && <p className="search-hint">This passage is too short to cut into parts.</p>}
          {parts.map((p, i) => (
            <article key={`${p.verse_start}-${p.verse_end}-${i}`} className="sb-word">
              <header>
                <strong>
                  {i + 1}. {p.heading ?? <span className="muted">(no heading passed the check)</span>}
                </strong>{" "}
                ·{" "}
                <button className="link-btn" onClick={() => onJump(partsFor.book, partsFor.chapter, p.verse_start)}>
                  {partRange(p)}
                </button>
              </header>
              <p className="muted">{p.text.length > 260 ? `${p.text.slice(0, 260)}…` : p.text}</p>
            </article>
          ))}
          {parts.length > 0 && (
            <button className="text-btn" disabled={added.has("structure")} onClick={() => addParts(parts, partsFor)}>
              {added.has("structure") ? "Added to what you've gathered" : "Add these parts to what I've gathered"}
            </button>
          )}
        </div>
      )}

      {stories && storiesFor && (
        <div className="sb-build-cards">
          <h5>
            Stories and sermons for {passageLabel(storiesFor)} <span className="muted">· from the books in this app</span>
          </h5>
          {stories.length === 0 && <p className="search-hint">Nothing in the app's books goes with these verses.</p>}
          {(["simeon", "spurgeon", "illustration"] as const).map((kind) => {
            const group = stories.filter((s) => s.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <h6 className="sb-story-group">{kind === "simeon" ? "Simeon's outlines on this passage" : kind === "spurgeon" ? "Spurgeon's sermons on this passage" : "Stories and sayings (Moody, Spurgeon's Gleanings)"}</h6>
                {kind === "illustration" && <p className="search-hint">The assistant answered YES or NO for each, to “does it illustrate what the passage teaches?”. It wrote none of them. Weak matches are last.</p>}
                {group.map((s) => (
                  <details key={`${s.kind}:${s.title}`} className={`sb-thread${s.fits === false ? " sb-weak" : ""}`}>
                    <summary>
                      <strong>{s.title}</strong> <span className="muted">· {s.kind === "illustration" ? s.source : s.subject}</span>
                      {s.fits === true && <span className="sb-fits"> · assistant: fits</span>}
                      {s.fits === false && <span className="muted"> · weak match</span>}
                    </summary>
                    <p className="muted sb-word-why">
                      {s.source}
                      {s.kind === "illustration" ? ` · found by “${s.found_by}”` : ""}
                      {s.url && (
                        <>
                          {" · "}
                          <a href={s.url} target="_blank" rel="noreferrer">
                            read it whole
                          </a>
                        </>
                      )}
                    </p>
                    <p className="sb-story-text">{s.text}</p>
                    <button className="text-btn" disabled={added.has(`story:${s.kind}:${s.title}`)} onClick={() => addStory(s, storiesFor)}>
                      {added.has(`story:${s.kind}:${s.title}`) ? "Added to what you've gathered" : "Add to what I've gathered"}
                    </button>
                  </details>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {threads && threadsFor && (
        <div className="sb-build-cards">
          <h5>
            Threads from {passageLabel(threadsFor)} <span className="muted">· what ties other passages to it</span>
          </h5>
          {threads.length === 0 && <p className="search-hint">The app has no links for these verses.</p>}
          {threads.map((th) => (
            <details key={`${th.kind}:${th.title}`} className="sb-thread" open={th.kind === "cross"}>
              <summary>
                <strong>{th.title}</strong> <span className="muted">· {th.links.length} verses</span>
              </summary>
              <p className="muted sb-word-why">{th.source}</p>
              <ul className="sb-thread-links">
                {th.links.map((l, i) => (
                  <li key={`${l.book}${l.chapter}:${l.verse}`}>
                    <button className="link-btn" onClick={() => onJump(l.book, l.chapter, l.verse)}>
                      {l.book} {l.chapter}:{l.verse}
                      {l.verse_end > l.verse ? `–${l.verse_end}` : ""}
                    </button>
                    {l.why && <span className="muted"> ({l.why})</span>} {l.text.length > 170 ? `${l.text.slice(0, 170)}…` : l.text}
                    {ties[`${th.kind}:${th.title}`]?.[i] && (
                      <div className="sb-word-ai">
                        <span className="muted">Assistant's note, from these two texts only:</span> {ties[`${th.kind}:${th.title}`][i]}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <button className="text-btn" hidden={!modelReady} disabled={busy || !!ties[`${th.kind}:${th.title}`]} onClick={() => void sayTies(th, threadsFor)} title="The assistant says in one sentence what each verse has in common with the passage, from the two texts only; it says nothing where nothing is clear">
                {ties[`${th.kind}:${th.title}`] ? "Ties written" : "Say how each ties in (assistant)"}
              </button>{" "}
              <button className="text-btn" disabled={added.has(`thread:${th.kind}:${th.title}`)} onClick={() => addThread(th, threadsFor)}>
                {added.has(`thread:${th.kind}:${th.title}`) ? "Added to what you've gathered" : "Add this thread to what I've gathered"}
              </button>
            </details>
          ))}
        </div>
      )}

      {cards && cardsFor && (
        <div className="sb-build-cards">
          <h5>
            Words in {passageLabel(cardsFor)} <span className="muted">· from the interlinear and Strong's</span>
          </h5>
          {cards.length === 0 && <p className="search-hint">Nothing in these verses stands out from the data (they are plain words, or the interlinear has nothing for them).</p>}
          {cards.map((c) => (
            <article key={`${c.strongs}:${c.verse}`} className="sb-word">
              <header>
                <strong>
                  {c.original} <span className="muted">({c.translit})</span>
                </strong>{" "}
                · {c.strongs} · “{c.english}” in{" "}
                <button className="link-btn" onClick={() => onJump(cardsFor.book, cardsFor.chapter, c.verse)}>
                  verse {c.verse}
                </button>
              </header>
              <p className="muted sb-word-why">{c.reasons.join("; ")}</p>
              <p>
                <span className="muted">Strong's:</span> {c.definition}
              </p>
              {c.renderings.length > 0 && (
                <p>
                  <span className="muted">Translated:</span> {c.renderings.join(", ")} <span className="muted">· used {c.uses.toLocaleString()} times</span>
                </p>
              )}
              {c.others.length > 0 && (
                <p>
                  <span className="muted">Other words glossed the same:</span> {c.others.map((o) => `${o.lemma} ${o.strongs} (${o.uses})`).join(", ")}
                </p>
              )}
              {c.others
                .filter((o) => o.note)
                .map((o) => (
                  <p key={o.strongs} className="sb-word-note">
                    <span className="muted">
                      Strong's entry for {o.lemma} {o.strongs}:
                    </span>{" "}
                    {o.note}
                  </p>
                ))}
              {c.explanation && (
                <p className="sb-word-ai">
                  <span className="muted">Assistant's note, written from this entry only:</span> {c.explanation}
                </p>
              )}
              <button className="text-btn" disabled={added.has(`${c.strongs}:${c.verse}`)} onClick={() => add(c, cardsFor)}>
                {added.has(`${c.strongs}:${c.verse}`) ? "Added to what you've gathered" : "Add to what I've gathered"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
