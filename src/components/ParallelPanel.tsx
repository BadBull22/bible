import { useEffect, useState } from "react";
import { api, OnlineVersionInfo, SearchHit, Version } from "../api";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  versions: Version[];
  onClose: () => void;
}

export function ParallelPanel({ book, chapter, verse, versions, onClose }: Props) {
  const [byCode, setByCode] = useState<Record<string, SearchHit>>({});
  const [loading, setLoading] = useState(true);
  const [onlineVersions, setOnlineVersions] = useState<OnlineVersionInfo[]>([]);
  const [onlineByCode, setOnlineByCode] = useState<Record<string, { text: string; copyright: string } | "loading" | "error">>({});

  useEffect(() => {
    setLoading(true);
    const codes = versions.map((v) => v.code);
    api
      .getParallelVerse(book, chapter, verse, codes)
      .then((result) => {
        const map: Record<string, SearchHit> = {};
        for (const hit of result) map[hit.version_code] = hit;
        setByCode(map);
      })
      .finally(() => setLoading(false));
    api.listOnlineVersions().then(setOnlineVersions);
  }, [book, chapter, verse, versions]);

  const configuredOnline = onlineVersions.filter((v) => v.configured);

  useEffect(() => {
    if (configuredOnline.length === 0) return;
    for (const v of configuredOnline) {
      setOnlineByCode((prev) => ({ ...prev, [v.code]: "loading" }));
      api
        .fetchOnlineVerse(v.code, book, chapter, verse)
        .then((r) => setOnlineByCode((prev) => ({ ...prev, [v.code]: { text: r.text, copyright: r.copyright } })))
        .catch(() => setOnlineByCode((prev) => ({ ...prev, [v.code]: "error" })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse, onlineVersions.length]);

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>
          Compare: {book} {chapter}:{verse}
        </h3>
        <button onClick={onClose}>✕</button>
      </div>
      {loading && <p>Loading…</p>}
      {!loading && (
        <div className="parallel-list">
          {versions.map((v) => {
            const row = byCode[v.code];
            return (
              <div className="parallel-row" key={v.code}>
                <div className="parallel-version">{v.code}</div>
                <div className="parallel-text">{row ? row.text : <em>not available</em>}</div>
              </div>
            );
          })}
          {configuredOnline.map((v) => {
            const entry = onlineByCode[v.code];
            return (
              <div className="parallel-row" key={v.code}>
                <div className="parallel-version">
                  {v.code} <span className="xref-tag">online</span>
                </div>
                {entry === "loading" && <div className="parallel-text">Fetching…</div>}
                {entry === "error" && <div className="parallel-text">Couldn't fetch (check connection/key).</div>}
                {entry && entry !== "loading" && entry !== "error" && (
                  <>
                    <div className="parallel-text">{entry.text}</div>
                    <div className="search-hint" style={{ marginTop: "0.4rem" }}>
                      {entry.copyright}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {onlineVersions.length > 0 && configuredOnline.length === 0 && (
            <p className="search-hint">
              Add an api.bible key in Settings to also compare against NIV and NKJV here.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
