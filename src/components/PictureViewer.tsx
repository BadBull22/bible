import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, PictureInfo } from "../api";
import { addToBasket } from "../basket";
import { pictureRefLabel, usePictureUrl } from "../pictures";
import { BasketButton } from "./BasketButton";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./icons";

interface Props {
  pictures: PictureInfo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** A picture shown large over the app, with its caption, passage, credit and licence;
 * ←/→ step through the set, Esc closes. */
export function PictureViewer({ pictures, index, onIndex, onClose, onJump }: Props) {
  const p = pictures[index];
  const url = usePictureUrl(p?.id ?? null);
  const [verseText, setVerseText] = useState<string | null>(null);

  // the linked verse(s), in the BSB, under the picture (Tissot's own titles are French)
  useEffect(() => {
    setVerseText(null);
    const r = p?.refs[0];
    if (!r || r[2] == null) return;
    let live = true;
    const [b, c, v, end] = r;
    api
      .passageText("BSB", b, c, v, Math.min(end ?? v, v + 4))
      .then((t) => live && setVerseText(t))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [p]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < pictures.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, pictures.length, onClose, onIndex]);

  if (!p) return null;
  const ref = pictureRefLabel(p);
  return (
    <div className="picture-viewer" role="dialog" aria-label={p.title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="picture-viewer-close icon-round" onClick={onClose} aria-label="Close">
        <CloseIcon size={16} />
      </button>
      {index > 0 && (
        <button className="picture-viewer-nav prev icon-round" onClick={() => onIndex(index - 1)} aria-label="Previous picture">
          <ChevronLeftIcon size={18} />
        </button>
      )}
      {index < pictures.length - 1 && (
        <button className="picture-viewer-nav next icon-round" onClick={() => onIndex(index + 1)} aria-label="Next picture">
          <ChevronRightIcon size={18} />
        </button>
      )}
      <figure className="picture-viewer-figure">
        {url ? <img src={url} alt={p.title} /> : <div className="picture-viewer-loading muted">Loading…</div>}
        <figcaption>
          <div className="picture-viewer-title">
            <strong>{p.title}</strong>
            {ref && (
              <>
                {" · "}
                <button
                  className="link-btn"
                  onClick={() => {
                    const [b, c, v] = p.refs[0];
                    onJump(b, c, v ?? 1);
                    onClose();
                  }}
                >
                  {ref}
                </button>
              </>
            )}
          </div>
          {verseText && <div className="picture-viewer-verse">“{verseText}”</div>}
          {p.caption && <div className="picture-viewer-caption">{p.caption}</div>}
          <div className="picture-viewer-credit muted">
            {p.credit || p.artist} · {p.collection_title} · {p.licence} ·{" "}
            <button className="link-btn" onClick={() => openUrl(p.page).catch(() => undefined)}>
              source
            </button>
            {pictures.length > 1 && ` · ${index + 1} of ${pictures.length}`}
          </div>
          <div className="picture-viewer-actions">
            <BasketButton
              title="Add this picture to the study basket (it prints on the study sheet)"
              add={() => addToBasket("picture", ref ? `${p.title} (${ref})` : p.title, p.caption, { id: p.id, credit: `${p.credit || p.artist} · ${p.licence}` })}
            />
          </div>
        </figcaption>
      </figure>
    </div>
  );
}
