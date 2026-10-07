import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, CatalogItem, InstalledModule, LibraryKind, LibraryProgress } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  initialTab?: "mine" | "more";
  /** start "Get more" filtered to this kind (e.g. from the sidebar's "Get more books") */
  onlyKind?: LibraryKind;
  onUseVersion: (code: string) => void;
  onOpenCommentary: (id: string) => void;
  onOpenDictionary: () => void;
  onOpenBook: (name: string) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<LibraryKind, string> = {
  bible: "Bible",
  commentary: "Commentary",
  dictionary: "Dictionary",
  devotional: "Devotional",
  book: "Book",
  other: "Other",
};

const KIND_FILTERS: { key: LibraryKind | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "bible", label: "Bibles" },
  { key: "commentary", label: "Commentaries" },
  { key: "dictionary", label: "Dictionaries" },
  { key: "devotional", label: "Devotionals" },
  { key: "book", label: "Books" },
];

const STAGE_LABEL: Record<LibraryProgress["stage"], string> = {
  downloading: "Downloading",
  unpacking: "Unpacking…",
  reading: "Reading…",
  saving: "Saving…",
};

function formatSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

const PREFS_KEY = "library:filters";

function readFilters(): { kind: LibraryKind | "all"; language: string; questionable: boolean } {
  try {
    return { kind: "all", language: "English", questionable: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return { kind: "all", language: "English", questionable: false };
  }
}

export function LibraryPanel({ initialTab, onlyKind, onUseVersion, onOpenCommentary, onOpenDictionary, onOpenBook, onClose }: Props) {
  const [tab, setTab] = useState<"mine" | "more">(initialTab ?? "mine");
  const [installed, setInstalled] = useState<InstalledModule[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [filters, setFilters] = useState(() => (onlyKind ? { ...readFilters(), kind: onlyKind } : readFilters()));
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const reloadInstalled = () => api.libraryInstalled().then(setInstalled).catch(() => undefined);

  useEffect(() => {
    reloadInstalled();
    const un = listen<LibraryProgress>("library-progress", (e) => {
      const p = e.payload;
      const label = p.stage === "downloading" && p.pct != null ? `Downloading ${p.pct}%` : STAGE_LABEL[p.stage];
      setProgress((m) => ({ ...m, [p.name]: label }));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(filters));
    } catch {
      /* per-viewer convenience only */
    }
  }, [filters]);

  function loadCatalog(refresh: boolean) {
    setLoadingCatalog(true);
    setCatalogError(null);
    api
      .libraryCatalog(refresh)
      .then(setCatalog)
      .catch((e) => setCatalogError(String(e)))
      .finally(() => setLoadingCatalog(false));
  }

  useEffect(() => {
    if (tab === "more" && catalog === null && !loadingCatalog) loadCatalog(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function install(item: CatalogItem) {
    setErrors((m) => ({ ...m, [item.name]: "" }));
    setProgress((m) => ({ ...m, [item.name]: "Starting…" }));
    try {
      await api.libraryInstall(item.name);
      setCatalog((c) => c?.map((x) => (x.name === item.name ? { ...x, installed: true, installed_version: x.version } : x)) ?? c);
      reloadInstalled();
    } catch (e) {
      setErrors((m) => ({ ...m, [item.name]: String(e) }));
    } finally {
      setProgress((m) => {
        const n = { ...m };
        delete n[item.name];
        return n;
      });
    }
  }

  async function remove(name: string) {
    setConfirmRemove(null);
    try {
      await api.libraryRemove(name);
      setCatalog((c) => c?.map((x) => (x.name === name ? { ...x, installed: false, installed_version: null } : x)) ?? c);
      reloadInstalled();
    } catch (e) {
      setErrors((m) => ({ ...m, [name]: String(e) }));
    }
  }

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of catalog ?? []) counts.set(c.language, (counts.get(c.language) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog ?? []).filter(
      (c) =>
        c.kind !== "other" &&
        (filters.kind === "all" || c.kind === filters.kind) &&
        (filters.language === "all" || c.language === filters.language) &&
        (filters.questionable || !c.questionable) &&
        (!q || `${c.title} ${c.name} ${c.about}`.toLowerCase().includes(q)),
    );
  }, [catalog, filters, query]);

  function openInstalled(m: InstalledModule) {
    if (m.kind === "bible") onUseVersion(m.name);
    else if (m.kind === "commentary") onOpenCommentary(`lib:${m.name}`);
    else if (m.kind === "dictionary") onOpenDictionary();
    else onOpenBook(m.name);
  }

  const openLabel: Record<LibraryKind, string> = {
    bible: "Read",
    commentary: "Open",
    dictionary: "Open",
    devotional: "Read",
    book: "Read",
    other: "Open",
  };

  return (
    <aside className="side-panel wide library-panel">
      <div className="side-panel-header">
        <h3>Library</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="Library view">
        <button role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
          My library{installed.length ? ` (${installed.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "more"} className={tab === "more" ? "active" : ""} onClick={() => setTab("more")}>
          Get more
        </button>
      </div>

      {tab === "mine" && (
        <>
          {installed.length === 0 ? (
            <div className="search-hint">
              <p>
                Nothing installed yet. <strong>Get more</strong> lists hundreds of free Bibles, commentaries, dictionaries,
                devotionals and classic Christian books from the CrossWire Bible Society — Barnes, Spurgeon, Josephus,
                Pilgrim's Progress, the Geneva Bible, the Afrikaans 1953 Bybel and many more.
              </p>
              <button className="pill-btn" onClick={() => setTab("more")}>
                Browse the library
              </button>
            </div>
          ) : (
            <ul className="library-list">
              {installed.map((m) => (
                <li key={m.name} className="library-item">
                  <div className="library-item-head">
                    <span className="basket-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>
                    <span className="library-title">{m.title}</span>
                    <span className="item-tools">
                      <button className="pill-btn small" onClick={() => openInstalled(m)}>
                        {openLabel[m.kind]}
                      </button>
                      {confirmRemove === m.name ? (
                        <>
                          <button className="text-btn danger" onClick={() => remove(m.name)}>
                            Remove
                          </button>
                          <button className="text-btn" onClick={() => setConfirmRemove(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button className="text-btn" onClick={() => setConfirmRemove(m.name)} title="Remove from this computer">
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="library-meta muted">
                    {m.name} · {m.language} · {m.entries.toLocaleString()} {m.kind === "bible" ? "verses" : m.kind === "book" ? "sections" : "entries"}
                    {m.licence ? ` · ${m.licence}` : ""}
                  </div>
                  {errors[m.name] && <p className="status-error">{errors[m.name]}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="search-hint">
            Installed Bibles appear in the translation list, commentaries in the Commentary panel, dictionaries in the
            Dictionary panel; books and devotionals are listed under Books in the left-hand list and open in the reading area. Everything works offline once installed.
          </p>
        </>
      )}

      {tab === "more" && (
        <>
          <div className="library-filters">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles and descriptions…" aria-label="Search the library" />
            <select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as LibraryKind | "all" })} aria-label="Kind">
              {KIND_FILTERS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
            <select value={filters.language} onChange={(e) => setFilters({ ...filters, language: e.target.value })} aria-label="Language">
              <option value="all">All languages</option>
              {languages.map(([l, n]) => (
                <option key={l} value={l}>
                  {l} ({n})
                </option>
              ))}
            </select>
            <label className="read-aloud-check" title="CrossWire files a few works under “Cults / Unorthodox / Questionable Material”">
              <input type="checkbox" checked={filters.questionable} onChange={(e) => setFilters({ ...filters, questionable: e.target.checked })} /> Show
              questionable material
            </label>
          </div>
          {loadingCatalog && <p className="muted">Loading the CrossWire catalogue…</p>}
          {catalogError && <p className="status-error">{catalogError}</p>}
          {catalog && (
            <p className="search-hint">
              {shown.length} of {catalog.filter((c) => c.kind !== "other").length} items ·{" "}
              <button className="link-btn" onClick={() => loadCatalog(true)} disabled={loadingCatalog}>
                Refresh the list
              </button>
            </p>
          )}
          <ul className="library-list">
            {shown.map((c) => {
              const busy = progress[c.name];
              const update = c.installed && c.installed_version !== null && c.installed_version !== c.version;
              return (
                <li key={c.name} className={"library-item" + (c.questionable ? " questionable" : "")}>
                  <div className="library-item-head">
                    <span className="basket-kind">{KIND_LABEL[c.kind] ?? c.kind}</span>
                    <button className="link-btn library-title" onClick={() => setExpanded((x) => (x === c.name ? null : c.name))} title="Show the description">
                      {c.title}
                    </button>
                    <span className="item-tools">
                      {busy ? (
                        <span className="muted library-progress">{busy}</span>
                      ) : c.built_in ? (
                        <span className="muted">Built in</span>
                      ) : !c.supported ? (
                        <span className="muted" title={c.note ?? ""}>
                          Not supported
                        </span>
                      ) : c.installed && !update ? (
                        <span className="library-installed">✓ Installed</span>
                      ) : (
                        <button className="pill-btn small" onClick={() => install(c)}>
                          {update ? "Update" : "Install"}
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="library-meta muted">
                    {c.name} · {c.language} · {formatSize(c.size_kb)} · {c.licence}
                    {c.questionable ? " · CrossWire: questionable material" : ""}
                  </div>
                  {c.note && !c.supported && <div className="library-meta muted">{c.note}</div>}
                  {errors[c.name] && <p className="status-error">{errors[c.name]}</p>}
                  {expanded === c.name && c.about && <div className="library-about">{c.about}</div>}
                </li>
              );
            })}
          </ul>
          <p className="search-hint">
            From the CrossWire Bible Society's free library (crosswire.org). Internet is needed only while downloading; installed
            items work offline. Each item's licence is shown — most are public domain.
          </p>
        </>
      )}
    </aside>
  );
}
