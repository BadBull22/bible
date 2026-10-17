import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SlideKind, SlideSpec } from "../sermonOutputs";
import { kindOfName, mediaUrl, MediaRef } from "../sermonMedia";
import { MediaPicker } from "./MediaPicker";
import { CloseIcon } from "./icons";

interface Props {
  /** the slides as shown: the preacher's own, or made from the sermon */
  slides: SlideSpec[];
  /** the preacher has changed them (otherwise they follow the sermon) */
  edited: boolean;
  background: string | null;
  onChange: (slides: SlideSpec[] | null) => void;
  onBackground: (file: string | null) => void;
  /** verse numbers on Scripture slides */
  verseNumbers: boolean;
  onVerseNumbers: (on: boolean) => void;
  /** save as PowerPoint; `embed`: put the video and music files inside it */
  onSave: (embed: boolean) => void;
  saving: boolean;
  /** start the slide show from this slide */
  onPresent: (from: number) => void;
}

/** File types PowerPoint can play from inside the file (the rest can only be linked). */
const EMBEDDABLE = /\.(mp4|m4v|mov|wmv|avi|mp3|m4a|wav|wma)$/i;

/** The slide kinds there is a button for, in the order a preacher reaches for them. */
const ADD: { kind: SlideKind; label: string }[] = [
  { kind: "text", label: "Words" },
  { kind: "song", label: "Song" },
  { kind: "scripture", label: "Scripture" },
  { kind: "image", label: "Picture" },
  { kind: "link", label: "Video or link" },
  { kind: "point", label: "Heading" },
];

/** Kinds that can have a picture beside their words. */
const BESIDE: SlideKind[] = ["title", "point", "scripture", "text", "song"];

const KINDS: { kind: SlideKind; label: string }[] = [
  { kind: "point", label: "Heading" },
  { kind: "text", label: "Words" },
  { kind: "song", label: "Song words" },
  { kind: "scripture", label: "Scripture" },
  { kind: "image", label: "Picture" },
  { kind: "link", label: "Video, music or link" },
  { kind: "title", label: "Title" },
];

function useMedia(file: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (file) mediaUrl(file).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file]);
  return url;
}

/** The background a slide will have: its own, or the one for all slides. */
const backgroundOf = (s: SlideSpec, all: string | null) => (s.background === undefined ? all : s.background || null);

/** Makes the words fit the slide, as PowerPoint's "shrink text on overflow" does: the
 * preview's text is made smaller step by step until nothing spills over. */
function useFit(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize) || 13;
      let size = base;
      for (let i = 0; i < 14 && el.scrollHeight > el.clientHeight + 1 && size > base * 0.35; i++) {
        size *= 0.9;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** A slide drawn small, as it will look: words on navy, or on the darkened photo, with a
 * picture beside them if one was added. */
export function Preview({ s, background }: { s: SlideSpec; background: string | null }) {
  const bgFile = backgroundOf(s, background);
  const bg = useMedia(bgFile);
  const pic = useMedia(s.kind === "image" ? s.image : null);
  const side = useMedia(s.kind !== "image" && s.kind !== "link" ? s.picture : null);
  const fit = useFit([s.title, s.body, s.kind, side]);
  const words = (
    <div className={`slide-preview k-${s.kind}` + (side ? " with-picture" : "")} ref={fit} style={bg ? { backgroundImage: `linear-gradient(rgba(0,0,0,.52), rgba(0,0,0,.52)), url(${bg})` } : undefined}>
      {s.kind === "image" ? (
        <>
          {pic ? <img src={pic} alt="" /> : <span className="slide-missing">(choose a picture)</span>}
          <span className="slide-caption">{s.title}</span>
        </>
      ) : s.kind === "scripture" ? (
        <>
          <span className="slide-body">“{s.body}”</span>
          <span className="slide-ref">{s.title}</span>
        </>
      ) : s.kind === "text" || s.kind === "song" ? (
        <>
          <span className="slide-ref">{s.title}</span>
          <span className="slide-body">{s.body}</span>
        </>
      ) : (
        <>
          <span className="slide-title">{s.title}</span>
          {s.body && <span className={s.kind === "link" ? "slide-link" : "slide-sub"}>{s.body}</span>}
        </>
      )}
      {side && <img className="slide-beside" src={side} alt="" />}
    </div>
  );
  return words;
}

/** The sermon's slides: as they follow from the sermon, or changed, reordered and added to
 * by the preacher -- words, song words, pictures, video and music links -- on navy or on a
 * photo. Saved as PowerPoint. */
export function SlidesEditor({ slides, edited, background, onChange, onBackground, verseNumbers, onVerseNumbers, onSave, saving, onPresent }: Props) {
  const [selected, setSelected] = useState(0);
  // the video and music files on the slides: asked each time whether they go inside the
  // PowerPoint or are linked
  const [askClips, setAskClips] = useState(false);
  const clipFiles = slides.filter((s) => s.kind === "link" && s.link?.startsWith("media:") && ["video", "audio"].includes(kindOfName(s.link)));
  const save = () => (clipFiles.length ? setAskClips(true) : onSave(false));
  const [picker, setPicker] = useState<null | { for: "background" | "slide-background" | "picture" | "beside" | "media"; at: number }>(null);
  const cur = slides[Math.min(selected, slides.length - 1)];

  const update = (i: number, patch: Partial<SlideSpec>) => onChange(slides.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const move = (i: number, to: number) => {
    if (to < 0 || to >= slides.length) return;
    const next = [...slides];
    const [s] = next.splice(i, 1);
    next.splice(to, 0, s);
    onChange(next);
    setSelected(to);
  };
  const insert = (at: number, add: SlideSpec[]) => {
    const next = [...slides];
    next.splice(at + 1, 0, ...add);
    onChange(next);
    setSelected(at + 1);
  };
  const remove = (i: number) => {
    onChange(slides.filter((_, n) => n !== i));
    setSelected(Math.max(0, i - 1));
  };
  const addKind = (kind: SlideKind) => {
    if (kind === "image") setPicker({ for: "picture", at: selected });
    else if (kind === "link") setPicker({ for: "media", at: selected });
    else insert(selected, [{ kind, title: kind === "song" ? "Song title" : kind === "scripture" ? "Reference" : "New slide", body: "" }]);
  };
  const fromMedia = (m: MediaRef): SlideSpec =>
    m.kind === "image" && m.file
      ? { kind: "image", title: m.title, body: "", image: m.file }
      : { kind: "link", title: m.title, body: m.kind === "video" || m.kind === "audio" ? "▶ Play" : "Open", link: m.url ?? `media:${m.file}` };

  return (
    <div className="slides-editor">
      <div className="slides-bar">
        <span className="sb-inline">
          <span className="muted">Background for all slides</span>
          <button className={"sf-chip" + (!background ? " on" : "")} onClick={() => onBackground(null)}>
            Plain navy
          </button>
          <button className={"sf-chip" + (background ? " on" : "")} onClick={() => setPicker({ for: "background", at: 0 })}>
            {background ? "Change the photo…" : "A photo…"}
          </button>
        </span>
        <label className="sb-inline" title="Show the verse numbers in the Scripture on the slides">
          <input type="checkbox" checked={verseNumbers} onChange={(e) => onVerseNumbers(e.target.checked)} />
          <span className="muted">Verse numbers</span>
        </label>
        <span className="muted">
          {edited ? (
            <>
              Your own slides.{" "}
              <button className="link-btn" onClick={() => onChange(null)} title="Throw away your changes and make the slides from the sermon again">
                Make them from the sermon again
              </button>
            </>
          ) : (
            "Made from your sermon: they change as it does. Edit any slide to make them your own."
          )}
        </span>
        <span className="slides-add" role="group" aria-label="Add a slide after the one selected">
          <span className="muted">Add a slide:</span>
          {ADD.map((k) => (
            <button key={k.kind} className="sf-chip" onClick={() => addKind(k.kind)} title={`Add a ${k.label.toLowerCase()} slide after slide ${selected + 1}`}>
              + {k.label}
            </button>
          ))}
        </span>
        <span className="slides-actions">
          <button className="pill-btn" onClick={() => onPresent(0)} disabled={slides.length === 0} title="Show the slides on the second screen, with your presenter view on this one">
            ▶ Present
          </button>
          <button className="outline-btn" onClick={() => onPresent(selected)} disabled={slides.length === 0} title={`Start the show at slide ${selected + 1}`}>
            From this slide
          </button>
          <button className="outline-btn" onClick={save} disabled={saving || slides.length === 0}>
            {saving ? "Saving…" : "Save as PowerPoint"}
          </button>
        </span>
      </div>

      <div className="slides-work">
        <ol className="slides-strip" aria-label="The slides">
          {slides.map((s, i) => (
            <li key={i} className={i === selected ? "on" : undefined}>
              <button className="slides-strip-pick" onClick={() => setSelected(i)} aria-label={`Slide ${i + 1}: ${s.title}`}>
                <span className="slides-n">{i + 1}</span>
                <Preview s={s} background={background} />
              </button>
            </li>
          ))}
        </ol>

        {cur && (
          <div className="slides-edit">
            <Preview s={cur} background={background} />
            <div className="slides-fields">
              <label className="sb-inline">
                <span className="muted">Kind</span>
                <select value={cur.kind} onChange={(e) => update(selected, { kind: e.target.value as SlideKind })}>
                  {KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="muted">{cur.kind === "scripture" ? "Reference" : cur.kind === "image" ? "Caption" : cur.kind === "song" ? "Song title" : "Heading"}</span>
                <input value={cur.title} onChange={(e) => update(selected, { title: e.target.value })} />
              </label>
              {cur.kind !== "image" && (
                <label>
                  <span className="muted">{cur.kind === "link" ? "The words to click" : cur.kind === "song" ? "The words (a line each; a blank line between verses)" : "Words"}</span>
                  <textarea value={cur.body} rows={cur.kind === "song" || cur.kind === "scripture" ? 8 : 3} onChange={(e) => update(selected, { body: e.target.value })} />
                </label>
              )}
              {cur.kind === "image" && (
                <button className="outline-btn" onClick={() => setPicker({ for: "picture", at: -1 })}>
                  {cur.image ? "Choose another picture…" : "Choose the picture…"}
                </button>
              )}
              {cur.kind === "link" && (
                <label>
                  <span className="muted">What it opens (a web address)</span>
                  <input
                    value={cur.link?.startsWith("media:") ? "(a file kept with the sermon)" : cur.link ?? ""}
                    disabled={cur.link?.startsWith("media:")}
                    onChange={(e) => update(selected, { link: e.target.value })}
                    placeholder="https://www.youtube.com/watch?v=…"
                  />
                </label>
              )}
              <div className="slides-look">
                <span className="sb-inline">
                  <span className="muted">This slide's background</span>
                  <button className={"sf-chip" + (cur.background === undefined ? " on" : "")} onClick={() => update(selected, { background: undefined })} title="The background chosen for all slides">
                    Same as all
                  </button>
                  <button className={"sf-chip" + (cur.background === "" ? " on" : "")} onClick={() => update(selected, { background: "" })}>
                    Plain
                  </button>
                  <button className={"sf-chip" + (cur.background ? " on" : "")} onClick={() => setPicker({ for: "slide-background", at: selected })}>
                    {cur.background ? "Change the photo…" : "A photo…"}
                  </button>
                  {cur.background !== undefined && (
                    <button
                      className="link-btn"
                      onClick={() => {
                        onBackground(cur.background || null);
                        onChange(slides.map(({ background: _, ...s }) => s));
                      }}
                      title="Make this slide's background the one for every slide"
                    >
                      Use for all slides
                    </button>
                  )}
                </span>
                {BESIDE.includes(cur.kind) && (
                  <span className="sb-inline">
                    <span className="muted">Picture beside the words</span>
                    <button className="sf-chip" onClick={() => setPicker({ for: "beside", at: selected })}>
                      {cur.picture ? "Change the picture…" : "Add a picture to this slide…"}
                    </button>
                    {cur.picture && (
                      <button className="link-btn" onClick={() => update(selected, { picture: undefined })}>
                        Remove it
                      </button>
                    )}
                  </span>
                )}
              </div>
              <label>
                <span className="muted">Your notes (only you see them, in the presenter view)</span>
                <textarea value={cur.notes ?? ""} rows={2} onChange={(e) => update(selected, { notes: e.target.value || undefined })} />
              </label>
              <div className="slides-row-tools">
                <button className="text-btn" onClick={() => move(selected, selected - 1)} disabled={selected === 0}>
                  ▲ Earlier
                </button>
                <button className="text-btn" onClick={() => move(selected, selected + 1)} disabled={selected >= slides.length - 1}>
                  ▼ Later
                </button>
                <button className="text-btn" onClick={() => insert(selected, [{ ...cur }])}>
                  Copy
                </button>
                <button className="text-btn danger" onClick={() => remove(selected)} disabled={slides.length <= 1}>
                  <CloseIcon size={11} /> Delete
                </button>
              </div>
              {cur.kind === "link" && <p className="search-hint">In the slide show, click the words to play it. A web link needs the internet; a file plays from this computer.</p>}
            </div>
          </div>
        )}
      </div>

      {askClips && (
        <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Videos and music in the PowerPoint" onClick={() => setAskClips(false)}>
          <div className="mp slides-ask" onClick={(e) => e.stopPropagation()}>
            <strong>
              {clipFiles.length === 1 ? "There is a video or music file on the slides." : `There are ${clipFiles.length} video or music files on the slides.`} How should{" "}
              {clipFiles.length === 1 ? "it" : "they"} go into the PowerPoint?
            </strong>
            <div className="slides-ask-choices">
              <button
                className="pill-btn"
                onClick={() => {
                  setAskClips(false);
                  onSave(true);
                }}
              >
                Put {clipFiles.length === 1 ? "it" : "them"} inside the PowerPoint
              </button>
              <span className="muted">Plays on any computer, without the original files. The PowerPoint file is bigger.</span>
              <button
                className="outline-btn"
                onClick={() => {
                  setAskClips(false);
                  onSave(false);
                }}
              >
                Link to {clipFiles.length === 1 ? "it" : "them"}
              </button>
              <span className="muted">A small file, but it plays only on this computer, where the files are kept.</span>
            </div>
            {clipFiles.some((s) => !EMBEDDABLE.test(s.link ?? "")) && (
              <p className="search-hint">
                PowerPoint can't play {[...new Set(clipFiles.filter((s) => !EMBEDDABLE.test(s.link ?? "")).map((s) => "." + (s.link ?? "").split(".").pop()))].join(", ")} files from
                inside, so those stay linked either way.
              </p>
            )}
            <p className="search-hint">Web videos (YouTube and the like) are always links: they need the internet.</p>
            <button className="text-btn" onClick={() => setAskClips(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {picker && (
        <MediaPicker
          only={picker.for === "media" ? undefined : "picture"}
          onClose={() => setPicker(null)}
          onAdd={(media) => {
            const p = picker;
            setPicker(null);
            if (p.for === "background") onBackground(media[0]?.file ?? null);
            else if (p.for === "slide-background") update(p.at, { background: media[0]?.file ?? undefined });
            else if (p.for === "beside") update(p.at, { picture: media[0]?.file ?? undefined });
            else if (p.at === -1) update(selected, { image: media[0]?.file, title: cur?.title && cur.title !== "New slide" ? cur.title : media[0]?.title ?? "" });
            else insert(p.at, media.map(fromMedia));
          }}
        />
      )}
    </div>
  );
}
