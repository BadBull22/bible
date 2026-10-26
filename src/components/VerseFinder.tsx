import { useState } from "react";
import { api, BookInfo, Version } from "../api";
import { parseRef } from "../sermon";
import { scriptureSlides, SlideSpec, tidyQuotes } from "../sermonOutputs";
import { defaultBible, keepDefaultBible } from "../service";

/** The Scripture slides for a typed reference ("John 3:16-18", "Romans 8"; several with a semicolon), in the Bible
 * chosen: a verse or a few to a slide, each slide naming its own verses. */
export async function verseSlides(typed: string, version: string, books: BookInfo[], numbers: boolean): Promise<SlideSpec[]> {
  const refs = typed
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  if (refs.length === 0) throw new Error("Type a verse, such as John 3:16 or Romans 8:28-30.");
  const out: SlideSpec[] = [];
  for (const typedRef of refs) {
    const r = parseRef(typedRef, books);
    if (!r) throw new Error(`“${typedRef}” isn't a verse I can find. Try the book, the chapter and the verse, like John 3:16.`);
    const chapter = await api.getChapter(version, r.book, r.chapter).catch(() => []);
    const verses = chapter.length ? chapter : await api.getChapter("BSB", r.book, r.chapter).catch(() => []);
    const used = chapter.length ? version : "BSB";
    if (verses.length === 0) throw new Error(`${r.book} ${r.chapter} isn't in this Bible.`);
    const last = Math.min(r.verseEnd, verses[verses.length - 1].verse);
    const picked = verses.filter((v) => v.verse >= r.verse && v.verse <= last);
    if (picked.length === 0) throw new Error(`${r.book} ${r.chapter} has no verse ${r.verse}.`);
    const text = tidyQuotes(picked.map((v) => `${v.verse} ${v.text}`).join(" ").replace(/\s+/g, " "));
    for (const c of scriptureSlides(text, picked[0].verse, numbers)) {
      const where = `${r.book} ${r.chapter}:${c.from ?? picked[0].verse}${c.to != null && c.from != null && c.to > c.from ? `–${c.to}` : ""}`;
      out.push({ kind: "scripture", title: `${where} · ${used}`, body: c.text });
    }
  }
  return out;
}

/** "Show this verse": type a reference, choose the Bible (the one chosen last time is kept as the default), and the
 * Scripture slides it makes are handed to `onUse`. */
export function VerseFinder({
  versions,
  books,
  versionCode,
  onUse,
  useLabel = "Add after this slide",
  numbers = true,
}: {
  versions: Version[];
  books: BookInfo[];
  versionCode: string;
  onUse: (slides: SlideSpec[], show: boolean) => void;
  useLabel?: string;
  numbers?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [version, setVersion] = useState(() => {
    const d = defaultBible(versionCode);
    return versions.some((v) => v.code === d) ? d : versionCode;
  });
  const [slides, setSlides] = useState<SlideSpec[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async (v = version) => {
    setError(null);
    setBusy(true);
    try {
      setSlides(await verseSlides(typed, v, books, numbers));
    } catch (e) {
      setSlides(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (code: string) => {
    setVersion(code);
    keepDefaultBible(code);
    if (slides) void find(code);
  };

  return (
    <div className="verse-finder">
      <form
        className="songs-find"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="A verse: John 3:16, or Romans 8:28-30" aria-label="The verse to show" autoFocus />
        <select value={version} onChange={(e) => pick(e.target.value)} aria-label="The Bible" title="The Bible the verse is read from. The one you choose is kept as your default.">
          {versions.map((v) => (
            <option key={v.code} value={v.code}>
              {v.code} — {v.name}
            </option>
          ))}
        </select>
        <button className="pill-btn" type="submit" disabled={busy || !typed.trim()}>
          {busy ? "Looking…" : "Find"}
        </button>
      </form>
      <p className="search-hint">The Bible you choose here is kept as your default for the next verse.</p>
      {error && <p className="status-error">{error}</p>}
      {slides && (
        <>
          <ol className="songs-preview" aria-label="The slides it makes">
            {slides.map((s, i) => (
              <li key={i}>
                <b>{s.title}</b>
                <span>{s.body}</span>
              </li>
            ))}
          </ol>
          <div className="songs-actions">
            <button className="pill-btn" onClick={() => onUse(slides, true)}>
              Show it now
            </button>
            <button className="outline-btn" onClick={() => onUse(slides, false)}>
              {useLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
