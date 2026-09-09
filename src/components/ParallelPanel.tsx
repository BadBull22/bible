import { useEffect, useMemo, useState } from "react";
import { api, OnlineVersionInfo, SearchHit, Version } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  versions: Version[];
  onClose: () => void;
}

type OnlineEntry = { text: string; copyright: string } | "loading" | "error";

export function ParallelPanel({ book, chapter, verse, versions, onClose }: Props) {
  const [byCode, setByCode] = useState<Record<string, SearchHit>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlineVersions, setOnlineVersions] = useState<OnlineVersionInfo[]>([]);
  const [onlineByCode, setOnlineByCode] = useState<Record<string, OnlineEntry>>({});

  // Enoch has one translation and no Bible version contains it, so comparing an
  // Enoch verse against KJV/BSB (or a Bible verse against ENOCH1) would only ever
  // produce "not available" rows.
  const isEnoch = book === "Enoch";
  const relevant = useMemo(
    () => versions.filter((v) => (v.code === "ENOCH1") === isEnoch),
    [versions, isEnoch],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getParallelVerse(book, chapter, verse, relevant.map((v) => v.code))
      .then((result) => {
        if (cancelled) return;
        const map: Record<string, SearchHit> = {};
        for (const hit of result) map[hit.version_code] = hit;
        setByCode(map);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [book, chapter, verse, relevant]);

  useEffect(() => {
    if (isEnoch) return;
    api.listOnlineVersions().then(setOnlineVersions).catch(() => setOnlineVersions([]));
  }, [isEnoch]);

  const configuredOnline = useMemo(() => onlineVersions.filter((v) => v.configured), [onlineVersions]);

  useEffect(() => {
    if (isEnoch || configuredOnline.length === 0) return;
    let cancelled = false;
    const loadingState: Record<string, OnlineEntry> = {};
    for (const v of configuredOnline) loadingState[v.code] = "loading";
    setOnlineByCode(loadingState);
    for (const v of configuredOnline) {
      api
        .fetchOnlineVerse(v.code, book, chapter, verse)
        .then((r) => !cancelled && setOnlineByCode((prev) => ({ ...prev, [v.code]: { text: r.text, copyright: r.copyright } })))
        .catch(() => !cancelled && setOnlineByCode((prev) => ({ ...prev, [v.code]: "error" })));
    }
    return () => {
      cancelled = true;
    };
  }, [book, chapter, verse, configuredOnline, isEnoch]);

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>
          Compare: {book} {chapter}:{verse}
        </h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load: {error}</p>}
      {!loading && !error && (
        <div className="parallel-list">
          {relevant.map((v) => {
            const row = byCode[v.code];
            return (
              <div className="parallel-row" key={v.code}>
                <div className="parallel-version" title={v.name}>
                  {v.code}
                  <span className="parallel-version-name">{v.name}</span>
                </div>
                <div className={"parallel-text" + (v.is_original_language ? " original-language" : "")} lang={langFor(v)}>
                  {row ? row.text : <em className="muted">not available in this text</em>}
                </div>
              </div>
            );
          })}
          {configuredOnline.map((v) => {
            const entry = onlineByCode[v.code];
            return (
              <div className="parallel-row" key={v.code}>
                <div className="parallel-version" title={v.name}>
                  {v.code}
                  <span className="parallel-version-name">{v.name}</span>
                  <span className="xref-tag">online</span>
                </div>
                {entry === "loading" && <div className="parallel-text muted">Fetching…</div>}
                {entry === "error" && <div className="parallel-text status-error">Couldn't fetch (check connection/key).</div>}
                {entry && entry !== "loading" && entry !== "error" && (
                  <>
                    <div className="parallel-text">{entry.text}</div>
                    <div className="copyright-note">{entry.copyright}</div>
                  </>
                )}
              </div>
            );
          })}
          {!isEnoch && onlineVersions.length > 0 && configuredOnline.length === 0 && (
            <p className="search-hint">Add an api.bible key in Settings to also compare against NIV and NKJV here.</p>
          )}
        </div>
      )}
    </aside>
  );
}

function langFor(v: Version): string | undefined {
  if (!v.is_original_language) return undefined;
  const l = v.language.toLowerCase();
  if (l.startsWith("heb")) return "he";
  if (l.startsWith("gr")) return "grc";
  return undefined;
}
