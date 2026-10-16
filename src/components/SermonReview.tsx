import { useLayoutEffect, useRef, useState } from "react";
import { isScripture, Material, SermonItem, stripMarks } from "../sermon";
import { plainText } from "./RichText";
import { tidyQuotes } from "../sermonOutputs";
import { CloseIcon } from "./icons";

// Review: the sermon laid out as it will print, with everything the preacher wrote editable
// where it stands -- the title, big idea, purpose, the points and section names, and the
// words in each section. Typing here changes the sermon itself (the same items Prepare
// edits). What was gathered (Scripture, commentary, quotations) is shown as it will print;
// it can be taken out, and a quotation can be shortened: the shortened text is this sermon's
// own copy, and the original can be put back.

interface Props {
  title: string;
  subtitle: string;
  bigIdea: string;
  purpose: string;
  showLabels: boolean;
  items: SermonItem[];
  /** the version names, for a passage's heading */
  versionName: (code: string) => string;
  onTitle: (text: string) => void;
  onBigIdea: (text: string) => void;
  onPurpose: (text: string) => void;
  /** a point's title, or the words of a section or note */
  onText: (id: string, text: string) => void;
  /** a section's name */
  onLabel: (id: string, label: string) => void;
  /** takes an item out (Undo brings it back) */
  onRemove: (id: string) => void;
  /** this sermon's copy of a quotation, shortened (null: the original again) */
  onTrim: (id: string, text: string | null) => void;
}

/** A text box that grows with what is in it, styled as the printed words. */
function Grow({ value, onChange, className, placeholder, label }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} className={"rv-edit " + (className ?? "")} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

function Line({ value, onChange, className, placeholder, label }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string }) {
  return <input className={"rv-edit " + (className ?? "")} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

const QUOTED = new Set(["commentary", "illustration", "quote", "background"]);

export function SermonReview(p: Props) {
  const [trimming, setTrimming] = useState<string | null>(null);

  const remove = (id: string, what: string) => (
    <button className="text-btn rv-x" onClick={() => p.onRemove(id)} title={`Take ${what} out of the sermon (Undo brings it back)`} aria-label="Remove">
      <CloseIcon size={11} />
    </button>
  );

  const material = (id: string, m: Material) => {
    const text = tidyQuotes(plainText(m.text).replace(/⟪\d+⟫/g, "").trim());
    if (isScripture(m)) {
      const version = (m.source ?? "").split(" · ")[0];
      return (
        <div className="rv-item rv-gathered" key={id}>
          {remove(id, "this passage")}
          <h4>
            {m.title}
            {version ? ` (${p.versionName(version)})` : ""}
          </h4>
          <blockquote>{text}</blockquote>
        </div>
      );
    }
    const tools = (
      <span className="rv-tools">
        {trimming === id ? (
          <button className="link-btn" onClick={() => setTrimming(null)}>
            Done
          </button>
        ) : (
          <button className="link-btn" onClick={() => setTrimming(id)} title="Shorten this quotation for this sermon (the source is not changed)">
            Shorten
          </button>
        )}
        {m.original != null && (
          <button className="link-btn" onClick={() => p.onTrim(id, null)} title="Put back the whole quotation">
            Put back the whole text
          </button>
        )}
        {remove(id, "this")}
      </span>
    );
    if (m.kind === "outline") {
      return (
        <div className="rv-item rv-gathered" key={id}>
          {tools}
          <h4>{m.title}</h4>
          {trimming === id ? (
            <Grow value={m.text} onChange={(v) => p.onTrim(id, v)} label={`Shorten ${m.title}`} />
          ) : (
            m.text
              .split("\n")
              .filter((l) => l.trim())
              .map((l, n) => (
                <p key={n} className="rv-outline">
                  {l}
                </p>
              ))
          )}
          {m.source && <p className="rv-source">{m.source}</p>}
        </div>
      );
    }
    return (
      <div className="rv-item rv-gathered" key={id}>
        {tools}
        {trimming === id ? (
          <>
            <p>
              <strong>{m.title}:</strong>
            </p>
            <Grow value={text} onChange={(v) => p.onTrim(id, v)} label={`Shorten ${m.title}`} />
          </>
        ) : (
          <p>
            <strong>{m.title}: </strong>
            <span className={QUOTED.has(m.kind) ? "rv-quoted" : undefined}>{text}</span>
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="rv-paper">
      <p className="search-hint rv-hint">
        This is the sermon as it will print. Click any words you wrote to change them; the passages and quotations you gathered can be taken out, and a quotation can be shortened.
      </p>
      <Line className="rv-title" value={p.title} onChange={p.onTitle} placeholder="Sermon title" label="Sermon title" />
      {p.subtitle && <p className="rv-sub">{p.subtitle}</p>}
      <div className="rv-bigidea">
        <strong>Big idea: </strong>
        <Grow value={p.bigIdea} onChange={p.onBigIdea} placeholder="(the one sentence the sermon says)" label="Big idea" />
      </div>
      <div className="rv-purpose">
        <strong>Purpose: </strong>
        <Grow value={p.purpose} onChange={p.onPurpose} placeholder="(what listeners should know, feel and do)" label="Purpose" />
      </div>
      {p.items.map((i) => {
        if (i.type === "heading") {
          return (
            <div className="rv-item" key={i.id}>
              {remove(i.id, "this point")}
              <Line className="rv-h2" value={i.text} onChange={(v) => p.onText(i.id, v)} label="Point" />
            </div>
          );
        }
        if (i.type === "block") {
          return (
            <div className="rv-item" key={i.id}>
              {i.level === 1 ? (
                <Line className="rv-h2" value={i.label} onChange={(v) => p.onLabel(i.id, v)} label="Section name" />
              ) : (
                <Line className={"rv-h3" + (p.showLabels ? "" : " rv-unprinted")} value={i.label} onChange={(v) => p.onLabel(i.id, v)} label="Section name" />
              )}
              <Grow value={i.text} onChange={(v) => p.onText(i.id, v)} placeholder={i.prompt || "(empty: write here, or leave it for lines to write on)"} label={i.label} />
            </div>
          );
        }
        if (i.type === "note") {
          return (
            <div className="rv-item" key={i.id}>
              {remove(i.id, "this note")}
              <Grow value={i.text} onChange={(v) => p.onText(i.id, v)} label="Your words" />
            </div>
          );
        }
        if (i.type === "media") {
          return (
            <div className="rv-item rv-gathered" key={i.id}>
              {remove(i.id, "this")}
              <p>
                <strong>{i.media.kind === "image" ? "Picture" : i.media.kind === "video" ? "Video" : i.media.kind === "audio" ? "Music" : "Link"}: </strong>
                {stripMarks(i.media.title)}
              </p>
            </div>
          );
        }
        return material(i.id, i.material);
      })}
    </div>
  );
}
