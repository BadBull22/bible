import { useEffect, useState } from "react";
import { api } from "../api";
import { libraryMentions, Material, outlineMaterial, refLabel, spurgeonMaterial } from "../sermon";
import { plainText } from "./RichText";

interface Props {
  /** the Scripture being studied */
  passage: Material;
  /** keys of what is ticked for the sermon */
  chosen: Set<string>;
  onToggle: (m: Material) => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

interface Found {
  commentary: Material[];
  xref: Material[];
  word: Material[];
  article: Material[];
  people: Material[];
  note: Material[];
  outline: Material[];
  mention: Material[];
  sermon: Material[];
}

const SECTIONS: { key: keyof Found; label: string; about: string }[] = [
  { key: "commentary", label: "What the commentaries say", about: "Every commentary in the app on these verses. Their views are their own." },
  { key: "outline", label: "How others outlined it", about: "Charles Simeon's sermon outlines on these verses (1832) — to learn from, not to copy." },
  { key: "sermon", label: "Spurgeon preached on it", about: "C. H. Spurgeon's sermons on these verses, with how each began. Read them in full at CCEL." },
  { key: "word", label: "The words in the original", about: "Each Hebrew or Greek word behind the English, with its meaning." },
  { key: "xref", label: "Cross-references", about: "The verses most often read alongside these." },
  { key: "article", label: "Dictionary and topics", about: "Bible dictionary and topical Bible entries that list these verses." },
  { key: "mention", label: "In your Library", about: "Where the books, dictionaries, devotionals and commentaries you've downloaded refer to these verses." },
  { key: "people", label: "People and places", about: "Who and where these verses mention." },
  { key: "note", label: "Your notes", about: "What you've written on these verses." },
];

const cut = (text: string, max: number) => {
  const plain = plainText(text).replace(/⟪\d+⟫/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).replace(/\s+\S*$/, "")} …` : plain;
};

/** Everything the app has on one passage, gathered when it is opened: all the commentaries,
 * the original words, cross-references, dictionary and topical entries, people and places,
 * and the preacher's own notes -- each tickable for the sermon. */
export function PassageStudy({ passage, chosen, onToggle, onJump }: Props) {
  const r = passage.ref!;
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // sections shown in full (otherwise the first few)
  const [full, setFull] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    (async () => {
      const f: Found = { commentary: [], xref: [], word: [], article: [], people: [], note: [], outline: [], mention: [], sermon: [] };
      const topic = passage.topic;
      const last = Math.min(r.verseEnd >= 200 ? r.verse + 40 : r.verseEnd, r.verse + 40);
      const verses = Array.from({ length: last - r.verse + 1 }, (_, i) => r.verse + i);
      const few = verses.slice(0, 6);
      const label = refLabel({ ...r, verseEnd: last });

      // every commentary's sections on these verses
      const commentaries = await api.listCommentaries().catch(() => []);
      await Promise.all(
        commentaries.map(async (c) => {
          const ch = await api.getCommentaryChapter(c.id, r.book, r.chapter).catch(() => null);
          if (!ch) return;
          const secs = ch.sections.filter((s, i) => {
            const end = (ch.sections[i + 1]?.verse_start ?? 999) - 1;
            return s.verse_start <= last && end >= r.verse && s.text.trim();
          });
          for (const s of secs.slice(0, 3)) {
            f.commentary.push({
              key: `c:${c.id}:${r.book}|${r.chapter}|${s.verse_start}`,
              kind: "commentary",
              title: `${c.name} on ${r.book} ${r.chapter}:${s.verse_start}`,
              text: cut(s.text, 2400),
              ref: { book: r.book, chapter: r.chapter, verse: s.verse_start, verseEnd: s.verse_start },
              topic,
            });
          }
        }),
      );

      // how others outlined it
      for (const d of await api.sermonOutlines(r.book, r.chapter, r.verse, last).catch(() => [])) f.outline.push(outlineMaterial(d, topic));

      // the original words (each number once)
      const seen = new Set<string>();
      for (const v of few) {
        const w = await api.getVerseWithStrongs("BSB", r.book, r.chapter, v).catch(() => null);
        for (const word of w?.words ?? []) {
          for (const num of word.strongs_numbers) {
            if (seen.has(num) || !word.surface_text.trim()) continue;
            seen.add(num);
            const s = await api.strongsLookup(num).catch(() => null);
            if (!s) continue;
            const def = [s.strongs_def, s.kjv_def ? `KJV: ${s.kjv_def}` : ""].filter(Boolean).join(" ").trim();
            f.word.push({
              key: `w:${num}`,
              kind: "word",
              title: `“${word.surface_text.trim()}” — ${s.lemma ?? num}${s.xlit ? ` (${s.xlit})` : ""}`,
              text: `${s.language}, Strong's ${num} (verse ${v}). ${def}`.trim(),
              ref: { book: r.book, chapter: r.chapter, verse: v, verseEnd: v },
              topic,
            });
          }
        }
      }

      // cross-references: the most agreed-on few for each verse
      const xseen = new Set<string>();
      for (const v of few) {
        const refs = await api.crossReferencesFor(r.book, r.chapter, v).catch(() => []);
        for (const x of refs.slice(0, 4)) {
          const key = `x:${x.to_book}|${x.to_chapter}|${x.to_verse_start}`;
          if (xseen.has(key)) continue;
          xseen.add(key);
          const to = { book: x.to_book, chapter: x.to_chapter, verse: x.to_verse_start, verseEnd: Math.max(x.to_verse_start, x.to_verse_end) };
          const text = await api.passageText("BSB", to.book, to.chapter, to.verse, to.verseEnd).catch(() => "");
          if (text) f.xref.push({ key, kind: "xref", title: refLabel(to), text, source: `BSB · linked from ${r.book} ${r.chapter}:${v}`, ref: to, topic });
        }
      }

      // dictionary and topical entries that list these verses
      const aseen = new Set<number>();
      for (const v of few.slice(0, 3)) {
        for (const h of (await api.topicsForVerse(r.book, r.chapter, v).catch(() => [])).slice(0, 8)) {
          if (aseen.has(h.id)) continue;
          aseen.add(h.id);
          const e = await api.dictionaryEntry(h.id).catch(() => null);
          f.article.push({ key: `a:${h.id}`, kind: "article", title: `${h.headword} — ${h.dict_name}`, text: cut(e?.body ?? h.snippet, 1400), topic });
        }
      }

      // Spurgeon's sermons on these verses
      for (const s of await api.spurgeonSermonsOn(r.book, r.chapter, r.verse, last).catch(() => [])) f.sermon.push({ ...spurgeonMaterial(s), topic });

      // where the downloaded books refer to these verses
      for (const m of await libraryMentions(r.book, r.chapter, r.verse, last, 60, 10)) f.mention.push({ ...m, topic });

      // people and places in these verses
      const ents = await api.chapterEntities(r.book, r.chapter).catch(() => null);
      for (const [kind, list] of [
        ["Person", ents?.people ?? []],
        ["Place", ents?.places ?? []],
      ] as const) {
        for (const e of list.filter((x) => x.verses.some((v) => v >= r.verse && v <= last))) {
          const where = e.verses.filter((v) => v >= r.verse && v <= last);
          f.people.push({
            key: `e:${e.id}`,
            kind: "people",
            title: `${kind}: ${e.name}`,
            text: `${e.name}${e.feature_type ? ` (${e.feature_type})` : ""} — ${label}, verse${where.length > 1 ? "s" : ""} ${where.join(", ")}. Mentioned ${e.reference_count} times in the Bible.`,
            topic,
          });
        }
      }

      // the preacher's notes
      for (const v of verses.slice(0, 40)) {
        const n = await api.getNote(r.book, r.chapter, v).catch(() => null);
        if (n?.body.trim() && n.verse === v) {
          const ref = { book: r.book, chapter: r.chapter, verse: v, verseEnd: n.verse_end || v };
          f.note.push({ key: `n:${r.book}|${r.chapter}|${v}`, kind: "note", title: `My note on ${refLabel(ref)}`, text: n.body, ref, topic });
        }
      }
      if (live) setFound(f);
    })().catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [passage.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="status-error">{error}</p>;
  if (!found) return <p className="muted passage-study-loading">Gathering everything on {passage.title}…</p>;
  const total = SECTIONS.reduce((n, s) => n + found[s.key].length, 0);

  return (
    <div className="passage-study">
      <p className="passage-study-summary">
        On {passage.title}:{" "}
        {SECTIONS.filter((s) => found[s.key].length)
          .map((s) => `${found[s.key].length} ${s.label.toLowerCase()}`)
          .join(" · ") || "nothing more"}
        {total > 0 && " — tick what you want in the sermon."}
      </p>
      {SECTIONS.map((s) => {
        const all = found[s.key];
        if (!all.length) return null;
        const FEW = 6;
        const list = all.length > FEW + 2 && !full.has(s.key) ? all.slice(0, FEW) : all;
        return (
          <section key={s.key} className="passage-study-group">
            <h5>
              {s.label} <span className="tab-count">{all.length}</span>
            </h5>
            <p className="muted small">{s.about}</p>
            <ul className="sermon-list">
              {list.map((m) => {
                const isOpen = open.has(m.key);
                const long = m.text.length > 300;
                return (
                  <li key={m.key} className={chosen.has(m.key) ? "ticked" : undefined}>
                    <label className="sermon-tick">
                      <input type="checkbox" checked={chosen.has(m.key)} onChange={() => onToggle(m)} />
                      <span className="sermon-item-title">{m.title}</span>
                    </label>
                    {m.source && <span className="votes">{m.source}</span>}
                    {m.ref && m.kind === "xref" && (
                      <button className="link-btn sermon-open" onClick={() => onJump(m.ref!.book, m.ref!.chapter, m.ref!.verse)}>
                        Open
                      </button>
                    )}
                    <div className="sermon-body">
                      <span className="sermon-text">{isOpen || !long ? m.text : `${m.text.slice(0, 280).trimEnd()}…`}</span>
                      {long && (
                        <button
                          className="link-btn sermon-more"
                          onClick={() =>
                            setOpen((o) => {
                              const n = new Set(o);
                              if (n.has(m.key)) n.delete(m.key);
                              else n.add(m.key);
                              return n;
                            })
                          }
                        >
                          {isOpen ? "Show less" : "Show all"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {list.length < all.length && (
              <button className="text-btn" onClick={() => setFull((f) => new Set(f).add(s.key))}>
                Show all {all.length}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
