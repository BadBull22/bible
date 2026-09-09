import { useEffect, useRef, useState } from "react";
import { api, ChapterEntities, EntityDetail, EntityKind, EntityLink, EntitySummary } from "../api";
import { BackIcon, CloseIcon } from "./icons";

interface Props {
  book: string;
  chapter: number;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

type Tab = "people" | "places" | "events";

const TABS: { key: Tab; label: string; kind: EntityKind }[] = [
  { key: "people", label: "People", kind: "person" },
  { key: "places", label: "Places", kind: "place" },
  { key: "events", label: "Events", kind: "event" },
];

const LINK_KIND: Record<EntityLink["type"], EntityKind | null> = { people: "person", places: "place", events: "event", groups: null };

const RELATION_LABELS: Record<string, string> = {
  father: "Father",
  mother: "Mother",
  partners: "Spouse",
  children: "Children",
  siblings: "Siblings",
  birthPlace: "Born at",
  deathPlace: "Died at",
  memberOf: "Member of",
  events: "Events",
  participants: "People involved",
  locations: "Where",
  predecessor: "Preceded by",
};

function year(y: number | null): string | null {
  if (y == null) return null;
  return y < 0 ? `${-y} BC` : `AD ${y}`;
}

function lifespan(d: EntityDetail): string | null {
  const b = year(d.birth_year);
  const dd = year(d.death_year);
  if (!b && !dd) return null;
  return `${b ?? "?"} – ${dd ?? "?"}`;
}

export function EntitiesPanel({ book, chapter, onJump, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("people");
  const [data, setData] = useState<ChapterEntities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntitySummary[] | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    api
      .chapterEntities(book, chapter)
      .then((d) => id === requestId.current && setData(d))
      .catch((e) => id === requestId.current && setError(String(e)))
      .finally(() => id === requestId.current && setLoading(false));
  }, [book, chapter]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      api.searchEntities(q, 40).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  async function open(kind: EntityKind, id: string) {
    setDetailLoading(true);
    try {
      const d = await api.getEntity(kind, id);
      setDetail(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  const relations: [string, EntityLink[]][] = detail?.relations_json ? Object.entries(JSON.parse(detail.relations_json)) : [];

  if (detail || detailLoading) {
    return (
      <aside className="side-panel entities-panel">
        <div className="side-panel-header">
          <h3>
            <button className="icon-btn inline" onClick={() => setDetail(null)} aria-label="Back to list" title="Back">
              <BackIcon size={15} />
            </button>{" "}
            {detail?.name ?? "Loading…"}
          </h3>
          <button onClick={onClose} aria-label="Close panel">
            <CloseIcon size={14} />
          </button>
        </div>
        {detail && (
          <div className="entity-detail">
            <div className="entity-meta">
              {detail.kind === "person" && detail.gender && <span className="xref-tag">{detail.gender}</span>}
              {detail.kind === "place" && detail.feature_type && <span className="xref-tag">{detail.feature_type}</span>}
              {detail.kind === "event" && <span className="xref-tag">Event</span>}
              {lifespan(detail) && <span className="muted">{lifespan(detail)}</span>}
              {detail.kind === "event" && detail.start_date && <span className="muted">{year(Number(detail.start_date)) ?? detail.start_date}</span>}
              {detail.latitude != null && detail.longitude != null && (
                <span className="muted" title="Coordinates">
                  {detail.latitude.toFixed(3)}, {detail.longitude.toFixed(3)}
                </span>
              )}
            </div>
            {detail.description && (
              <div className="commentary-text">
                {detail.description.split(/\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            )}
            {relations.length > 0 && (
              <dl className="entity-relations">
                {relations.map(([key, links]) => (
                  <div key={key}>
                    <dt>{RELATION_LABELS[key] ?? key}</dt>
                    <dd>
                      {links.map((l, i) => {
                        const kind = LINK_KIND[l.type];
                        return (
                          <span key={l.id}>
                            {i > 0 && ", "}
                            {kind ? (
                              <button className="link-btn" onClick={() => open(kind, l.id)}>
                                {l.name}
                              </button>
                            ) : (
                              l.name
                            )}
                          </span>
                        );
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <h4 className="section-label">
              {detail.references.length} {detail.references.length === 1 ? "reference" : "references"}
            </h4>
            <div className="citation-row">
              {detail.references.map((r, i) => (
                <button key={i} className="link-btn" onClick={() => onJump(r.book, r.chapter, r.verse)}>
                  {r.book} {r.chapter}:{r.verse}
                  {r.end_verse && r.end_verse > r.verse ? `–${r.end_verse}` : ""}
                </button>
              ))}
            </div>
            <p className="search-hint">
              Theographic Bible Metadata (CC BY-SA 4.0), bundled offline via the Free Use Bible API. Dates are the
              dataset's traditional estimates, not settled scholarship.
            </p>
          </div>
        )}
      </aside>
    );
  }

  const list = data ? data[tab] : [];

  return (
    <aside className="side-panel entities-panel">
      <div className="side-panel-header">
        <h3>
          People &amp; Places: {book} {chapter}
        </h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="search-controls">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find any person, place or event…" aria-label="Search people and places" />
      </div>
      {results ? (
        <>
          <p className="result-count">
            {results.length} {results.length === 1 ? "match" : "matches"} across the whole Bible
          </p>
          <ul className="xref-list">
            {results.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <div className="xref-item-head">
                  <button className="link-btn" onClick={() => open(e.kind, e.id)}>
                    {e.name}
                  </button>
                  <span className="votes">
                    {e.kind}
                    {e.feature_type ? ` · ${e.feature_type}` : ""} · {e.reference_count} refs
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="mode-toggle" role="tablist" aria-label="Entity type">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
                {t.label}
                {data && <span className="tab-count">{data[t.key].length}</span>}
              </button>
            ))}
          </div>
          {loading && <p className="muted">Loading…</p>}
          {error && <p className="status-error">{error}</p>}
          {!loading && !error && list.length === 0 && (
            <p className="muted">No {tab} are indexed for this chapter.</p>
          )}
          <ul className="xref-list">
            {list.map((e) => (
              <li key={e.id}>
                <div className="xref-item-head">
                  <button className="link-btn" onClick={() => open(e.kind, e.id)} title="Open profile">
                    {e.name}
                  </button>
                  <span className="votes">
                    {e.feature_type ?? (e.kind === "event" && e.start_date ? year(Number(e.start_date)) : null)}
                    {e.feature_type || (e.kind === "event" && e.start_date) ? " · " : ""}
                    {e.reference_count} refs
                  </span>
                </div>
                <div className="citation-row">
                  {e.verses.map((v) => (
                    <button key={v} className="verse-chip" onClick={() => onJump(book, chapter, v)} title={`Go to verse ${v}`}>
                      v{v}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="search-hint">
            Theographic Bible Metadata (CC BY-SA 4.0), bundled offline. Click a name for its profile, family links and
            every reference.
          </p>
        </>
      )}
    </aside>
  );
}
