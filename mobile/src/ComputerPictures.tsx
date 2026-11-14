// More > Downloads > Pictures from the computer: the pictures and videos the Windows app made (Content Factory), read from the shared sync folder, to look at,
// save in the phone's gallery (Pictures/Bible Concordance and Movies/Bible Concordance) and share as normal. Nothing here is made on the phone.

import { useEffect, useRef, useState } from "react";
import { api, phone, type ComputerFile } from "./api";
import { countText, isVideo, savedText, shareMime, sizeText, titleOf } from "./pictureFiles";

/** A small copy of a picture, so a page of thumbnails does not hold a page of full-size pictures. */
async function thumbnail(base64: string, mime: string): Promise<string> {
  const img = new Image();
  img.src = `data:${mime};base64,${base64}`;
  await img.decode();
  const w = 280;
  const scale = Math.min(1, w / Math.max(img.naturalWidth, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.78);
}

function Pictures({ folderUri, folderName, fail }: { folderUri: string | null; folderName: string | null; fail: (e: unknown) => void }) {
  const [files, setFiles] = useState<ComputerFile[] | null>(null);
  const [found, setFound] = useState(true);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<{ file: ComputerFile; src: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = async () => {
    if (!folderUri) return;
    setNote(null);
    try {
      const r = await phone.listComputerPictures(folderUri);
      if (!alive.current) return;
      setFound(r.found);
      setFiles(r.files);
      setPicked((p) => p.filter((id) => r.files.some((f) => f.id === id)));
    } catch (e) {
      setFiles([]);
      setNote(String(e));
    }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderUri]);

  // thumbnails, one at a time (a picture from the computer is a megabyte or two)
  useEffect(() => {
    if (!files || !folderUri) return;
    const next = files.find((f) => !isVideo(f) && thumbs[f.id] === undefined);
    if (!next) return;
    let live = true;
    phone
      .readComputerPicture(folderUri, next.id)
      .then((r) => thumbnail(r.base64, next.mime))
      .then((src) => live && setThumbs((t) => ({ ...t, [next.id]: src })))
      .catch(() => live && setThumbs((t) => ({ ...t, [next.id]: "" })));
    return () => {
      live = false;
    };
  }, [files, thumbs, folderUri]);

  if (!folderUri) {
    return (
      <>
        <h3>Pictures from the computer</h3>
        <p className="hint">
          The pictures and videos you make in the Windows app can come to this phone through the folder you share with it (a OneDrive, Google Drive or Dropbox folder). First choose the shared folder in
          <strong> More &gt; Your study &gt; Keep in step with your computer</strong>. Then, in the Windows app, open <strong>Settings &gt; Keep in step</strong> and switch on
          <strong> Also put my Content Factory pictures in this folder, for the phone</strong>.
        </p>
      </>
    );
  }

  const chosen = (files ?? []).filter((f) => picked.includes(f.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async (list: ComputerFile[]) => {
    setBusy(true);
    setNote(null);
    try {
      let saved = 0;
      let already = 0;
      const where = new Set<string>();
      for (const f of list) {
        const r = await phone.saveComputerPicture(folderUri, f.id, f.name, f.mime);
        if (r.already) already++;
        else saved++;
        where.add(r.where);
      }
      setNote(savedText(saved, already, [...where].join(" and ") || "the gallery"));
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async (list: ComputerFile[]) => {
    setNote(null);
    try {
      await phone.shareComputerPictures(folderUri, list.map((f) => f.id), list.map((f) => f.name), shareMime(list));
    } catch (e) {
      fail(e);
    }
  };

  const open = async (f: ComputerFile) => {
    if (isVideo(f)) {
      try {
        await phone.openComputerFile(folderUri, f.id, f.name, f.mime);
      } catch (e) {
        fail(e);
      }
      return;
    }
    setView({ file: f, src: null });
    try {
      const r = await phone.readComputerPicture(folderUri, f.id);
      setView((v) => (v && v.file.id === f.id ? { file: f, src: `data:${f.mime};base64,${r.base64}` } : v));
    } catch (e) {
      setView(null);
      setNote(String(e));
    }
  };

  if (view) {
    return (
      <>
        <button className="link-btn" onClick={() => setView(null)}>
          ‹ All pictures
        </button>
        <h3>{titleOf(view.file.name)}</h3>
        {view.src ? <img className="cp-full" src={view.src} alt={titleOf(view.file.name)} /> : <p className="hint">Opening…</p>}
        <div className="actions">
          <button disabled={busy} onClick={() => void save([view.file])}>
            Save to the phone
          </button>
          <button onClick={() => void share([view.file])}>Share</button>
        </div>
        {note && <p className="hint status">{note}</p>}
      </>
    );
  }

  return (
    <>
      <h3>Pictures from the computer</h3>
      <p className="hint">
        Made in the Windows app (Content Factory) and copied into <strong>{folderName ?? "your shared folder"}</strong>. {files && files.length > 0 ? countText(files) + "." : ""}
      </p>
      <div className="actions">
        <button onClick={() => void load()}>Refresh</button>
        {files && files.length > 0 && <button onClick={() => setPicked(picked.length === files.length ? [] : files.map((f) => f.id))}>{picked.length === files.length ? "Choose none" : "Choose all"}</button>}
      </div>
      {chosen.length > 0 && (
        <div className="actions">
          <button disabled={busy} onClick={() => void save(chosen)}>
            Save {chosen.length} to the phone
          </button>
          <button onClick={() => void share(chosen)}>Share {chosen.length}</button>
        </div>
      )}
      {note && <p className="hint status">{note}</p>}
      {files === null && <p className="hint">Looking in the folder…</p>}
      {files && files.length === 0 && (
        <p className="hint">
          {found
            ? "The folder is empty."
            : "Nothing here yet. In the Windows app open Settings > Keep in step, switch on “Also put my Content Factory pictures in this folder, for the phone”, and press Sync now. It reaches this phone when your cloud app has synced the folder."}
        </p>
      )}
      <div className="cp-grid">
        {(files ?? []).map((f) => (
          <div key={f.id} className={"cp-tile" + (picked.includes(f.id) ? " on" : "")}>
            <button className="cp-pic" onClick={() => void open(f)} aria-label={`${isVideo(f) ? "Play" : "Open"} ${titleOf(f.name)}`}>
              {isVideo(f) ? <span className="cp-video">▶ Video</span> : thumbs[f.id] ? <img src={thumbs[f.id]} alt="" /> : <span className="cp-wait">{thumbs[f.id] === "" ? "No preview" : "…"}</span>}
            </button>
            <label className="cp-name">
              <input type="checkbox" checked={picked.includes(f.id)} onChange={() => toggle(f.id)} />
              <span>
                {titleOf(f.name)}
                {f.size ? <small> {sizeText(f.size)}</small> : null}
              </span>
            </label>
          </div>
        ))}
      </div>
    </>
  );
}

/** The screen: finds the shared folder the phone keeps in step through, then shows what the computer put there. */
export function ComputerPictures({ fail }: { fail: (e: unknown) => void }) {
  const [st, setSt] = useState<{ uri: string | null; name: string | null } | null>(null);
  useEffect(() => {
    api
      .syncStatus()
      .then((s) => setSt({ uri: s.folder_uri, name: s.folder }))
      .catch(() => setSt({ uri: null, name: null }));
  }, []);
  if (!st) return <p className="hint">Opening…</p>;
  return <Pictures folderUri={st.uri} folderName={st.name} fail={fail} />;
}
