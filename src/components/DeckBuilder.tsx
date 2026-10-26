// The notices and the music: slides made and saved on their own, apart from any sermon, to be used again and
// presented alongside the sermon. The same slide page as the sermon's, without the sermon behind it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, BookInfo, DeckKind, Version } from "../api";
import type { SlideOrder } from "../slideOrder";
import type { SlideSpec } from "../sermonOutputs";
import { deckBody, KIND_NAME, parseDeck, PresenterDeck } from "../service";
import { stillFor } from "../stills";
import { SlidesEditor } from "./SlidesEditor";
import { keepAsNotice, NoticeSidebar } from "./NoticeLibrary";
import { SongPickerDialog, SongSidebar } from "./SongLibrary";
import { Presenter } from "./SlideShow";

interface Props {
  kind: DeckKind;
  /** the saved one to open; null for a new one */
  id: number | null;
  versions: Version[];
  books: BookInfo[];
  versionCode: string;
  onBack: () => void;
}

const START: Record<DeckKind, SlideSpec[]> = {
  notices: [
    { kind: "title", title: "Notices", body: "Welcome" },
    { kind: "point", title: "This week", body: "" },
  ],
  music: [],
};

interface Step {
  slides: SlideSpec[];
  background: string | null;
  label: string;
}

/** A free order: any slide can go anywhere (a sermon's slides are held in place by the sermon). */
function freeOrder(slides: SlideSpec[], set: (next: SlideSpec[], label: string) => void): SlideOrder {
  const n = slides.length;
  const gap = (i: number, g: number) => (g < 0 || g > n || g === i || g === i + 1 ? null : g);
  return {
    unit: (i) => (slides[i] ? [i, i + 1] : null),
    gap,
    step: (i, dir) => gap(i, dir < 0 ? i - 1 : i + 2),
    move: (i, g) => {
      if (gap(i, g) === null) return null;
      const next = [...slides];
      const [one] = next.splice(i, 1);
      const to = g > i ? g - 1 : g;
      next.splice(to, 0, one);
      set(next, "moved a slide");
      return to;
    },
    inStep: true,
    match: () => undefined,
  };
}

export function DeckBuilder({ kind, id, versions, books, versionCode, onBack }: Props) {
  const [deckId, setDeckId] = useState<number>(id ?? 0);
  // a new one has a name already ("Notices, 26 October 2026"), so it saves from the first change without being asked
  const [title, setTitle] = useState(() => (id ? "" : `${KIND_NAME[kind]}, ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`));
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [slides, setSlides] = useState<SlideSpec[]>(id ? [] : START[kind]);
  const [background, setBackground] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [ready, setReady] = useState(!id);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved">(id ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [arranging, setArranging] = useState(false);
  const [library, setLibrary] = useState(0); // changes when a notice is kept, so the list shows it
  const undoStack = useRef<Step[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const now = useRef({ slides, background, overlay });
  now.current = { slides, background, overlay };

  useEffect(() => {
    if (!id) return;
    let live = true;
    api
      .deckGet(id)
      .then((d) => {
        if (!live || !d) return;
        const body = parseDeck(d.body);
        setTitle(d.title);
        setSlides(body.slides);
        setBackground(body.background);
        setOverlay(body.overlay ?? null);
        setReady(true);
      })
      .catch((e) => live && setError(`That couldn't be opened: ${e}`));
    return () => {
      live = false;
    };
  }, [id]);

  const remember = (label: string) => {
    undoStack.current.push({ slides: now.current.slides, background: now.current.background, label });
    if (undoStack.current.length > 60) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  };
  const lastChange = useRef({ label: "", at: 0 });
  const changeSlides = useCallback((next: SlideSpec[], label: string) => {
    // typing in a box is one step to undo, not one for every letter
    const typing = label === lastChange.current.label && Date.now() - lastChange.current.at < 1500;
    lastChange.current = { label, at: Date.now() };
    if (!typing) {
      undoStack.current.push({ slides: now.current.slides, background: now.current.background, label });
      if (undoStack.current.length > 60) undoStack.current.shift();
      setUndoCount(undoStack.current.length);
    }
    setSlides(next);
    setDirty(true);
  }, []);
  const undo = () => {
    const step = undoStack.current.pop();
    if (!step) return;
    setUndoCount(undoStack.current.length);
    setSlides(step.slides);
    setBackground(step.background);
    setDirty(true);
  };

  const save = useCallback(async (quiet = false) => {
    if (!title.trim()) {
      if (!quiet) setError(`Give the ${KIND_NAME[kind].toLowerCase()} a name before saving it.`);
      return;
    }
    setState("saving");
    try {
      const saved = await api.deckSave({ id: deckId, kind, title: title.trim(), body: deckBody(now.current.slides, now.current.background, now.current.overlay) });
      setDeckId(saved);
      setDirty(false);
      setSavedAt(new Date());
      setState("saved");
      setError(null);
    } catch (e) {
      setState("idle");
      setError(`It couldn't be saved: ${e}`);
    }
  }, [deckId, kind, title]);

  // saves itself a moment after a change, once it has a name
  useEffect(() => {
    if (!dirty || !ready || !title.trim()) return;
    const t = setTimeout(() => void save(true), 1000);
    return () => clearTimeout(t);
  }, [dirty, ready, title, slides, background, overlay, save]);

  const order = useMemo(() => freeOrder(slides, changeSlides), [slides, changeSlides]);

  const flash = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote((x) => (x === m ? null : x)), 9000);
  };
  const forExport = async (embed: boolean, forPowerPoint: boolean) =>
    Promise.all(
      slides.map(async (s) => ({
        ...s,
        // (a PowerPoint file holds a moving background as a still picture from it; the ProPresenter bundle holds the video)
        background: forPowerPoint ? await stillFor(s.background === undefined ? background : s.background) : (s.background === undefined ? background : s.background) || undefined,
        // the layer over the background (a heading graphic): the slide's own, or the one for all slides ("" is none)
        overlay: (s.overlay === undefined ? overlay : s.overlay) || undefined,
        link: s.link?.startsWith("media:") ? (forPowerPoint ? await api.sermonMediaPath(s.link.slice(6)).catch(() => undefined) : undefined) : s.link,
        video: s.kind === "link" && s.link?.startsWith("media:") && (embed || !forPowerPoint) ? s.link.slice(6) : undefined,
      })),
    );
  const saveSlides = async (embed: boolean) => {
    setSaving(true);
    try {
      flash(`Saved to ${await api.saveSermonSlides(title.trim() || KIND_NAME[kind], await forExport(embed, true))}`);
    } catch (e) {
      setError(`Couldn't save the slides: ${e}`);
    } finally {
      setSaving(false);
    }
  };
  const saveProPresenter = async () => {
    setSaving(true);
    try {
      const done = await api.saveSermonProPresenter(title.trim() || KIND_NAME[kind], await forExport(true, false));
      flash(`Saved for ProPresenter: ${done.path}${done.warnings.length ? ` (${done.warnings.length} to check: ${done.warnings.join(" ")})` : ""}`);
    } catch (e) {
      setError(`Couldn't save the slides for ProPresenter: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const deck: PresenterDeck = { kind, title: title.trim() || KIND_NAME[kind], slides, background, overlay, resumeKey: deckId ? `${kind}:${deckId}` : `${kind}:draft` };

  if (!ready) return <p className="muted">Opening…</p>;
  return (
    <article className="sermon-builder sb deck-builder">
      <div className="sb-head">
        <button className="outline-btn" onClick={() => void (dirty ? save(true) : Promise.resolve()).then(onBack)} title="Back to the Sunday service">
          ← Sunday service
        </button>
        <input
          className="sb-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder={kind === "notices" ? "Name these notices, e.g. Notices for March" : "Name this set of songs, e.g. Songs, Sunday morning"}
          aria-label={`${KIND_NAME[kind]} name`}
        />
        <span className={"deck-state" + (state === "saved" && !dirty ? " saved" : " muted")} role="status">
          {state === "saving"
            ? "Saving…"
            : !title.trim()
              ? "Give it a name to save it"
              : dirty
                ? "Saving in a moment…"
                : savedAt || deckId
                  ? `✓ Saved${savedAt ? ` at ${savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}`
                  : "Not saved yet: it saves as soon as you change something"}
        </span>
        <button className="pill-btn" onClick={() => void save()} title="Save it now (it also saves itself a moment after each change)">
          Save
        </button>
      </div>
      {error && (
        <p className="status-error" role="alert">
          {error}{" "}
          <button className="link-btn" onClick={() => setError(null)}>
            Close
          </button>
        </p>
      )}
      {note && <p className="status-ok" role="status">{note}</p>}
      <div className={"deck-layout" + (kind === "music" || kind === "notices" ? " with-songs" : "")}>
        {kind === "music" && <SongSidebar onAdd={(add) => changeSlides([...now.current.slides, ...add], "added a song")} onArrange={() => setArranging(true)} />}
        {kind === "notices" && <NoticeSidebar reload={library} onAdd={(add, name) => changeSlides([...now.current.slides, ...add], `added “${name}”`)} />}
      <div className="sb-page sb-slides">
        <SlidesEditor
          slides={slides}
          edited
          deck={kind}
          onKeepSlide={
            kind === "notices"
              ? (slide) =>
                  void keepAsNotice(slide)
                    .then((name) => {
                      setLibrary((n) => n + 1);
                      flash(`“${name}” is kept in your notices, on the left.`);
                    })
                    .catch((e) => setError(`It couldn't be kept: ${e}`))
              : undefined
          }
          background={background}
          onChange={(s) => s && changeSlides(s, "changed the slides")}
          onBackground={(f) => {
            remember("changed the background");
            setBackground(f);
            setDirty(true);
          }}
          overlay={overlay}
          onOverlay={(f) => {
            remember("changed the picture over the background");
            setOverlay(f);
            setDirty(true);
          }}
          versions={versions}
          books={books}
          versionCode={versionCode}
          onSave={(embed) => void saveSlides(embed)}
          onSaveProPresenter={() => void saveProPresenter()}
          saving={saving}
          onPresent={(from) => setPresenting(from)}
          order={order}
          undo={{ can: undoCount > 0, label: undoStack.current[undoStack.current.length - 1]?.label ?? null, run: undo }}
        />
      </div>
      </div>
      {arranging && (
        <SongPickerDialog
          onClose={() => setArranging(false)}
          onUse={(add) => {
            setArranging(false);
            changeSlides([...now.current.slides, ...add], "added songs");
          }}
        />
      )}
      {presenting !== null && (
        <Presenter decks={[deck]} start={presenting} versions={versions} books={books} versionCode={versionCode} onEnd={() => setPresenting(null)} />
      )}
    </article>
  );
}
