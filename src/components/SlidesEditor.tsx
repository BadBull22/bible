import { useEffect, useState } from "react";
import type { SlideKind, SlideSpec } from "../sermonOutputs";
import { mediaUrl, MediaRef } from "../sermonMedia";
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
  onSave: () => void;
  saving: boolean;
}

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

/** A slide drawn small, as it will look: words on navy, or on the darkened photo. */
function Preview({ s, background }: { s: SlideSpec; background: string | null }) {
  const bg = useMedia(background);
  const pic = useMedia(s.kind === "image" ? s.image : null);
  return (
    <div className={`slide-preview k-${s.kind}`} style={bg ? { backgroundImage: `linear-gradient(rgba(0,0,0,.52), rgba(0,0,0,.52)), url(${bg})` } : undefined}>
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
    </div>
  );
}

/** The sermon's slides: as they follow from the sermon, or changed, reordered and added to
 * by the preacher -- words, song words, pictures, video and music links -- on navy or on a
 * photo. Saved as PowerPoint. */
export function SlidesEditor({ slides, edited, background, onChange, onBackground, onSave, saving }: Props) {
  const [selected, setSelected] = useState(0);
  const [picker, setPicker] = useState<null | { for: "background" | "picture" | "media"; at: number }>(null);
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
          <span className="muted">Background</span>
          <button className={"sf-chip" + (!background ? " on" : "")} onClick={() => onBackground(null)}>
            Plain navy
          </button>
          <button className={"sf-chip" + (background ? " on" : "")} onClick={() => setPicker({ for: "background", at: 0 })}>
            {background ? "Change the photo…" : "A photo…"}
          </button>
        </span>
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
        <span className="slides-actions">
          <select className="add-section" value="" onChange={(e) => e.target.value && addKind(e.target.value as SlideKind)} aria-label="Add a slide">
            <option value="">+ Add a slide…</option>
            {KINDS.filter((k) => k.kind !== "title").map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <button className="pill-btn" onClick={onSave} disabled={saving || slides.length === 0}>
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

      {picker && (
        <MediaPicker
          only={picker.for === "media" ? undefined : "picture"}
          onClose={() => setPicker(null)}
          onAdd={(media) => {
            const p = picker;
            setPicker(null);
            if (p.for === "background") onBackground(media[0]?.file ?? null);
            else if (p.at === -1) update(selected, { image: media[0]?.file, title: cur?.title && cur.title !== "New slide" ? cur.title : media[0]?.title ?? "" });
            else insert(p.at, media.map(fromMedia));
          }}
        />
      )}
    </div>
  );
}
