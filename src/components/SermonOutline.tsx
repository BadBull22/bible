import { ReactNode, useEffect, useState } from "react";
import { GROUPS, Material, newId, SermonItem, stripMarks } from "../sermon";
import { movePart, moveIntoSlot, Part, partsOf, Slot, slotsOf } from "../sermonLayout";
import { KIND_LABEL, mediaUrl, MediaRef, openMedia, youtubeId } from "../sermonMedia";
import { Role, ROLES } from "../sermonTemplates";
import { CloseIcon, GripIcon } from "./icons";

type Mark = "bold" | "italic" | "blank" | "bullet";

interface Props {
  items: SermonItem[];
  /** headings and section names only */
  outline: boolean;
  /** the section (or point) being worked in: what is added goes there */
  target: string | null;
  onTarget: (id: string | null) => void;
  /** a change Undo can take back */
  onChange: (f: (items: SermonItem[]) => SermonItem[]) => void;
  onText: (id: string, text: string) => void;
  onLabel: (id: string, label: string) => void;
  onMedia: (id: string, patch: Partial<MediaRef>) => void;
  onMark: (id: string, kind: Mark) => void;
  /** a piece of gathered material, shown short */
  renderMaterial: (m: Material) => ReactNode;
  /** opens the picture / video / link chooser for a section */
  onPickMedia: (slotId: string) => void;
  /** show only this part (the id of its heading): the Write step takes one part at a time */
  only?: string;
  /** every section open to write in, even those with nothing in them yet */
  expand?: boolean;
}

const POINT_ROLES: Role[] = ["scripture", "explain", "illustrate", "apply", "transition", "story", "context", "prayer"];
const SECTION_ROLES: Role[] = ["intro", "context", "scripture", "explain", "illustrate", "apply", "story", "conclusion", "response", "prayer"];

const hasWords = (i: SermonItem | null) => !!i && (i.type === "block" || i.type === "note" || i.type === "heading") && !!i.text.trim();

/** The sermon on the right: each point a card, holding its sections; a section with nothing in
 * it yet folds away into a "+ Explain" chip; one Add menu a point; points dragged by their
 * handle, and anything in them dragged to another section. */
export function SermonOutline({ items, outline, target, onTarget, onChange, onText, onLabel, onMedia, onMark, renderMaterial, onPickMedia, only, expand }: Props) {
  // sections opened to write in although still empty
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [dropOn, setDropOn] = useState<string | null>(null);
  const parts = partsOf(items);

  const open = (id: string) => {
    setOpened((s) => new Set(s).add(id));
    onTarget(id);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`)?.focus(), 30);
  };

  /** A new section in a point (before its transition) or after a section. */
  function addSection(part: Part, role: Role) {
    const block: SermonItem = { id: newId(), type: "block", role, label: ROLES[role].label, prompt: ROLES[role].prompt, text: "", level: part.kind === "point" ? 2 : 1 };
    onChange((list) => {
      const p = partsOf(list).find((x) => x.head?.id === part.head?.id);
      if (!p) return [...list, block];
      let at = p.end;
      if (p.kind === "point") {
        const t = slotsOf(list, p).find((s) => s.block?.type === "block" && s.block.role === "transition");
        if (t?.block) at = list.findIndex((i) => i.id === t.block!.id);
      }
      return [...list.slice(0, at), block, ...list.slice(at)];
    });
    open(block.id);
  }

  const addAfterPart = (part: Part, item: SermonItem) =>
    onChange((list) => {
      const p = partsOf(list).find((x) => x.head?.id === part.head?.id);
      const at = p ? p.end : list.length;
      return [...list.slice(0, at), item, ...list.slice(at)];
    });

  const addNote = (slotEnd: number) => {
    const note: SermonItem = { id: newId(), type: "note", text: "" };
    onChange((list) => [...list.slice(0, slotEnd), note, ...list.slice(slotEnd)]);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-id="${note.id}"]`)?.focus(), 30);
  };

  function move(part: Part, by: -1 | 1) {
    const i = parts.indexOf(part);
    const other = parts[i + by];
    if (!other || !part.head) return;
    if (by < 0) onChange((list) => movePart(list, part.head!.id, other.head?.id ?? null));
    else onChange((list) => movePart(list, other.head!.id, part.head!.id));
  }

  const removeItem = (id: string) => onChange((list) => list.filter((i) => i.id !== id));
  const removePart = (part: Part) => {
    const ids = new Set(items.slice(part.start, part.end).map((i) => i.id));
    onChange((list) => list.filter((i) => !ids.has(i.id)));
  };

  // ---- dragging: a point by its handle, an item by its own
  const dragPart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/sb-part", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const dragItem = (e: React.DragEvent, id: string) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/sb-item", id);
    e.dataTransfer.effectAllowed = "move";
  };
  const isPart = (e: React.DragEvent) => e.dataTransfer.types.includes("text/sb-part");
  const isItem = (e: React.DragEvent) => e.dataTransfer.types.includes("text/sb-item");

  const member = (n: number) => {
    const it = items[n];
    return (
      <div key={it.id} className="sb-member" draggable onDragStart={(e) => dragItem(e, it.id)}>
        <span className="sermon-grip" title="Drag to another section">
          <GripIcon size={12} />
        </span>
        <div className="sb-member-main">
          {it.type === "material" && (
            <>
              <div className="sermon-row-head">
                <span className="basket-kind">{GROUPS.find((g) => g.kind === it.material.kind)?.label.replace(/s$/, "") ?? it.material.kind}</span>
                <strong>{it.material.title}</strong>
                {it.material.source && <span className="votes">{it.material.source}</span>}
              </div>
              {!outline && <div className="sermon-body">{renderMaterial(it.material)}</div>}
            </>
          )}
          {it.type === "media" && <MediaRow m={it.media} outline={outline} onTitle={(title) => onMedia(it.id, { title })} />}
          {it.type === "note" &&
            (outline ? (
              <span className="muted">{stripMarks(it.text).split("\n")[0] || "(empty note)"}</span>
            ) : (
              <textarea data-id={it.id} value={it.text} onChange={(e) => onText(it.id, e.target.value)} rows={2} placeholder="Your own words" aria-label="Your note" />
            ))}
        </div>
        <button className="text-btn sb-x" onClick={() => removeItem(it.id)} title="Take this out" aria-label="Remove">
          <CloseIcon size={11} />
        </button>
      </div>
    );
  };

  const tools = (id: string) =>
    !outline &&
    target === id && (
      <span className="block-tools" aria-label="Formatting">
        {(
          [
            ["bold", <b key="b">B</b>, "Bold (**words**)"],
            ["italic", <i key="i">I</i>, "Italic (*words*)"],
            ["bullet", "•", "Bullet points (lines starting “- ”)"],
            ["blank", "[ _ ]", "Leave these words blank on the fill-in handout ([[words]])"],
          ] as const
        ).map(([k, label, title]) => (
          <button key={k} className="text-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => onMark(id, k)} title={title}>
            {label}
          </button>
        ))}
      </span>
    );

  /** A section with its writing space and what it holds. */
  const slotView = (slot: Slot, _part: Part, isHead: boolean) => {
    const b = slot.block;
    const id = b?.id ?? `loose`;
    const dropKey = `slot:${id}`;
    const drop = {
      onDragOver: (e: React.DragEvent) => {
        if (!isItem(e) || !b) return;
        e.preventDefault();
        e.stopPropagation();
        setDropOn(dropKey);
      },
      onDragLeave: () => setDropOn((d) => (d === dropKey ? null : d)),
      onDrop: (e: React.DragEvent) => {
        const it = e.dataTransfer.getData("text/sb-item");
        setDropOn(null);
        if (!it || !b) return;
        e.preventDefault();
        e.stopPropagation();
        onChange((list) => moveIntoSlot(list, it, b.id));
      },
    };
    const members = slot.members.map(member);
    if (b?.type !== "block") {
      // a point's own items (before its first section), or items with no part
      return members.length ? (
        <div key={`own-${id}`} className={"sb-slot own" + (dropOn === dropKey ? " drop" : "")} {...drop}>
          {members}
        </div>
      ) : null;
    }
    return (
      <div
        key={b.id}
        className={`sb-slot role-${b.role}${target === b.id ? " target" : ""}${dropOn === dropKey ? " drop" : ""}`}
        onClickCapture={() => onTarget(b.id)}
        {...drop}
      >
        {!isHead && (
          <div className="block-head">
            <input className="block-label" value={b.label} onChange={(e) => onLabel(b.id, e.target.value)} aria-label="Section name" />
            {b.label !== ROLES[b.role].label && <span className={`role-chip role-${b.role}`}>{ROLES[b.role].label}</span>}
            {tools(b.id)}
            <button className="text-btn sb-x" onClick={() => removeItem(b.id)} title="Take this section out (what is in it moves up)" aria-label="Remove the section">
              <CloseIcon size={11} />
            </button>
          </div>
        )}
        {isHead && tools(b.id)}
        {outline ? (
          <span className={b.text.trim() ? "" : "muted"}>{stripMarks(b.text).split("\n")[0] || b.prompt}</span>
        ) : (
          <textarea
            data-id={b.id}
            value={b.text}
            onChange={(e) => onText(b.id, e.target.value)}
            onFocus={() => onTarget(b.id)}
            rows={b.text.split("\n").length > 2 ? Math.min(14, b.text.split("\n").length + 1) : b.text.trim() || slot.members.length === 0 ? 2 : 1}
            placeholder={b.prompt}
            aria-label={b.label}
          />
        )}
        {members}
      </div>
    );
  };

  const partView = (part: Part, idx: number) => {
    const h = part.head;
    if (!h) return <div key={`loose-${part.start}`} className="sb-part loose">{slotsOf(items, part).map((s) => slotView(s, part, false))}</div>;
    const slots = slotsOf(items, part);
    const [own, ...sections] = slots;
    const shown = (s: Slot) => s.block?.type === "block" && (!!expand || hasWords(s.block) || s.members.length > 0 || opened.has(s.block.id) || target === s.block.id);
    const hidden = sections.filter((s) => !shown(s));
    const isSection = part.kind === "section" && h.type === "block";
    const headShown = isSection ? !!expand || hasWords(h) || own.members.length > 0 || opened.has(h.id) || target === h.id : true;
    const dropKey = `part:${h.id}`;
    return (
      <section
        key={h.id}
        id={`row-${h.id}`}
        className={`sb-part ${part.kind}${target === h.id ? " target" : ""}${dropOn === dropKey ? " drop-before" : ""}`}
        onDragOver={(e) => {
          if (!isPart(e)) return;
          e.preventDefault();
          setDropOn(dropKey);
        }}
        onDragLeave={() => setDropOn((d) => (d === dropKey ? null : d))}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/sb-part");
          setDropOn(null);
          if (!id) return;
          e.preventDefault();
          onChange((list) => movePart(list, id, h.id));
        }}
      >
        <header className="sb-part-head" onClickCapture={() => onTarget(h.id)}>
          <span className="sermon-grip sb-part-grip" draggable onDragStart={(e) => dragPart(e, h.id)} title="Drag to move this whole part">
            <GripIcon size={14} />
          </span>
          {h.type === "heading" ? (
            <input className="sermon-heading-input" value={h.text} onChange={(e) => onText(h.id, e.target.value)} onFocus={() => onTarget(h.id)} aria-label="The point" />
          ) : h.type === "block" ? (
            <input className="block-label sb-section-label" value={h.label} onChange={(e) => onLabel(h.id, e.target.value)} aria-label="Section name" />
          ) : null}
          {isSection && !headShown && (
            <button className="link-btn" onClick={() => open(h.id)} title={h.type === "block" ? h.prompt : undefined}>
              Write…
            </button>
          )}
          <select
            className="add-section sb-add"
            value=""
            aria-label="Add to this part"
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              const slotEnd = (sections.length ? sections[sections.length - 1] : own).end;
              if (v.startsWith("role:")) {
                const role = v.slice(5) as Role;
                const existing = sections.find((s) => s.block?.type === "block" && s.block.role === role && !shown(s));
                if (existing?.block) open(existing.block.id);
                else if (isSection) addAfterPart(part, { id: newId(), type: "block", role, label: ROLES[role].label, prompt: ROLES[role].prompt, text: "", level: 1 });
                else addSection(part, role);
              } else if (v === "note") addNote(slotEnd);
              else if (v === "media") onPickMedia(sections.length ? sections[sections.length - 1].block!.id : h.id);
              else if (v === "point") addAfterPart(part, { id: newId(), type: "heading", text: "New point" });
              else if (v === "up") move(part, -1);
              else if (v === "down") move(part, 1);
              else if (v === "remove") removePart(part);
            }}
          >
            <option value="">Add ▾</option>
            <optgroup label={isSection ? "After this" : "In this point"}>
              {(isSection ? SECTION_ROLES : POINT_ROLES).map((r) => (
                <option key={r} value={`role:${r}`}>
                  {ROLES[r].label}
                </option>
              ))}
              <option value="note">A note</option>
              <option value="media">A picture, video, music or link</option>
            </optgroup>
            <optgroup label="The sermon">
              <option value="point">A new point after this</option>
              <option value="up" disabled={idx === 0}>
                Move up
              </option>
              <option value="down" disabled={idx === parts.length - 1}>
                Move down
              </option>
              <option value="remove">Take this {part.kind === "point" ? "point" : "section"} out</option>
            </optgroup>
          </select>
        </header>
        {(isSection ? headShown : true) && slotView(own, part, isSection)}
        {sections.filter(shown).map((s) => slotView(s, part, false))}
        {!outline && hidden.length > 0 && (
          <div className="sb-chips">
            {hidden.map((s) =>
              s.block?.type === "block" ? (
                <button key={s.block.id} className="sf-chip" onClick={() => open(s.block!.id)} title={s.block.prompt}>
                  + {s.block.label}
                </button>
              ) : null,
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="sb-outline">
      {parts.filter((p) => !only || (p.head?.id ?? "") === only).map((p) => partView(p, parts.indexOf(p)))}
      {!only && <div
        className={"sb-end-drop" + (dropOn === "end" ? " on" : "")}
        onDragOver={(e) => {
          if (!isPart(e)) return;
          e.preventDefault();
          setDropOn("end");
        }}
        onDragLeave={() => setDropOn((d) => (d === "end" ? null : d))}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("text/sb-part");
          setDropOn(null);
          if (id) onChange((list) => movePart(list, id, null));
        }}
      />}
    </div>
  );
}

/** A picture shown small, or a video, music, file or link with a button to open it. */
export function MediaRow({ m, outline, onTitle }: { m: MediaRef; outline: boolean; onTitle: (t: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setError(null);
    if (m.kind === "image" && m.file) mediaUrl(m.file).then((u) => live && setUrl(u)).catch(() => live && setError("This picture is missing from the app's folder."));
    return () => {
      live = false;
    };
  }, [m.file, m.kind]);
  const yt = m.url ? youtubeId(m.url) : null;
  return (
    <div className="media-row">
      <div className="sermon-row-head">
        <span className="basket-kind">{KIND_LABEL[m.kind]}</span>
        <input className="media-title" value={m.title} onChange={(e) => onTitle(e.target.value)} aria-label="What to call it" />
        {m.kind !== "image" && (
          <button className="link-btn" onClick={() => openMedia(m).catch((e) => setError(String(e)))} title={m.url ?? m.name}>
            {m.kind === "video" || m.kind === "audio" ? "▶ Play" : "Open"}
          </button>
        )}
      </div>
      {!outline && (
        <>
          {url && <img className="media-picture" src={url} alt={m.title} />}
          {yt && <img className="media-picture small" src={`https://img.youtube.com/vi/${yt}/mqdefault.jpg`} alt="" />}
          {(m.url || m.credit) && <span className="votes">{m.credit ?? m.url}</span>}
          {error && <span className="status-error"> {error}</span>}
        </>
      )}
    </div>
  );
}
