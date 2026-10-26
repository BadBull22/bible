import { useRef, useState } from "react";
import { addFiles, kindOfUrl, KIND_LABEL, normaliseUrl, youtubeId } from "../sermonMedia";
import type { SlideSpec } from "../sermonOutputs";
import { slideOfMedia } from "../service";

/** Adds music, a video, a web link, a picture or any file as slides, in one box: paste a link (YouTube, a song on
 * YouTube Music or Spotify, a web page) or choose files from this computer. `only="picture"` takes pictures alone. */
export function MediaAdder({ onUse, only, useLabel = "Add after this slide" }: { onUse: (slides: SlideSpec[], show: boolean) => void; only?: "picture"; useLabel?: string }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const link = normaliseUrl(url);
  const kind = link ? kindOfUrl(link) : "link";
  const yt = youtubeId(link);

  const files = async (list: File[]) => {
    const take = only === "picture" ? list.filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f.name)) : list;
    if (take.length === 0) return setError(only === "picture" ? "Choose a picture (JPEG, PNG or GIF)." : "Nothing was chosen.");
    setError(null);
    setBusy(true);
    try {
      onUse((await addFiles(take)).map(slideOfMedia), true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="media-adder">
      {only !== "picture" && (
        <form
          className="mp-link"
          onSubmit={(e) => {
            e.preventDefault();
            if (!link) return;
            const m = { kind, title: name.trim() || link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url: link };
            onUse([slideOfMedia(m)], true);
          }}
        >
          <label>
            <span className="muted">Paste a web address: a YouTube video or song, music on Spotify or YouTube Music, any web page</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
          </label>
          <label>
            <span className="muted">What to call it</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Everyday Angel — Southern Cross Music" />
          </label>
          {link && (
            <p className="muted">
              {KIND_LABEL[kind]}
              {yt && <img className="mp-yt" src={`https://img.youtube.com/vi/${yt}/mqdefault.jpg`} alt="" />}
            </p>
          )}
          <div className="songs-actions">
            <button className="pill-btn" type="submit" disabled={!link}>
              Show it now
            </button>
            <button
              className="outline-btn"
              type="button"
              disabled={!link}
              onClick={() => onUse([slideOfMedia({ kind, title: name.trim() || link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url: link })], false)}
            >
              {useLabel}
            </button>
          </div>
        </form>
      )}
      <div className="media-adder-file">
        <span className="muted">{only === "picture" ? "A picture from this computer" : "Or a video, music or picture from this computer"}</span>
        <button className="outline-btn" onClick={() => file.current?.click()} disabled={busy}>
          {busy ? "Adding…" : only === "picture" ? "Choose a picture…" : "Choose a file…"}
        </button>
        <input
          ref={file}
          type="file"
          multiple={only !== "picture"}
          accept={only === "picture" ? "image/png,image/jpeg,image/gif,image/webp" : undefined}
          hidden
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            void files(list);
          }}
        />
      </div>
      {error && <p className="status-error">{error}</p>}
    </div>
  );
}
