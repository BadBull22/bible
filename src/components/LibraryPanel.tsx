import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, CatalogItem, InstalledModule, InstallReport, LibraryKind, LibraryProgress, LibrarySource } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  initialTab?: Tab;
  /** start "Get more" filtered to this kind (e.g. from the sidebar's "Get more books") */
  onlyKind?: LibraryKind;
  onUseVersion: (code: string) => void;
  onOpenCommentary: (id: string) => void;
  onOpenDictionary: () => void;
  onOpenBook: (name: string) => void;
  onClose: () => void;
}

type Tab = "mine" | "more" | "file";

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

/** Shown first in "Get more" regardless of the language filter (CrossWire names). */
const PINNED = ["Afr1953"];

interface Filters {
  kind: LibraryKind | "all";
  language: string;
  questionable: boolean;
  /** which source "Get more" is showing */
  source: string;
}

function readFilters(): Filters {
  const defaults: Filters = { kind: "all", language: "English", questionable: false, source: "crosswire" };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

const ENTRY_WORD: Record<LibraryKind, string> = {
  bible: "verses",
  commentary: "notes",
  dictionary: "entries",
  devotional: "readings",
  book: "sections",
  other: "entries",
};

export function LibraryPanel({ initialTab, onlyKind, onUseVersion, onOpenCommentary, onOpenDictionary, onOpenBook, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "mine");
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileState, setFileState] = useState<"idle" | "checking" | "ready" | "installing" | "done">("idle");
  const [fileReport, setFileReport] = useState<InstallReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
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
  const wantedSource = useRef(filters.source);
  const source = sources.find((s) => s.id === filters.source);

  const reloadInstalled = () => api.libraryInstalled().then(setInstalled).catch(() => undefined);

  useEffect(() => {
    reloadInstalled();
    api.librarySources().then(setSources).catch(() => undefined);
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
    const wanted = filters.source;
    wantedSource.current = wanted;
    api
      .libraryCatalog(refresh, wanted)
      .then((c) => wantedSource.current === wanted && setCatalog(c))
      .catch((e) => wantedSource.current === wanted && setCatalogError(String(e)))
      .finally(() => wantedSource.current === wanted && setLoadingCatalog(false));
  }

  // each source has its own catalogue: load it when "Get more" opens or the source changes
  useEffect(() => {
    if (tab !== "more") return;
    setCatalog(null);
    loadCatalog(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters.source]);

  async function checkFile(file: File) {
    setFileName(file.name);
    setFileReport(null);
    setFileError(null);
    setFileState("checking");
    try {
      const name = file.name.toLowerCase();
      if (/\.(mobi|azw3?|kfx)$/.test(name)) throw "Kindle files can't be added. Only EPUB e-books, PDF books and SWORD modules (.zip) can.";
      if (!/\.(epub|pdf|zip)$/.test(name)) throw "Only EPUB e-books (.epub), PDF books (.pdf) and SWORD modules (.zip) can be added.";
      setFileReport(await api.libraryImportCheck(new Uint8Array(await file.arrayBuffer()), file.name));
      setFileState("ready");
    } catch (e) {
      setFileError(String(e));
      setFileState("idle");
    }
  }

  async function installFile() {
    setFileState("installing");
    try {
      setFileReport(await api.libraryImportInstall());
      setFileState("done");
      reloadInstalled();
    } catch (e) {
      setFileError(String(e));
      setFileState("idle");
    }
  }

  function cancelFile() {
    api.libraryImportCancel().catch(() => undefined);
    setFileReport(null);
    setFileError(null);
    setFileState("idle");
  }

  async function install(item: CatalogItem) {
    setErrors((m) => ({ ...m, [item.name]: "" }));
    setProgress((m) => ({ ...m, [item.name]: "Starting…" }));
    try {
      await api.libraryInstall(item.name, item.source);
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

  // a language remembered from another source may not exist in this one
  const language = filters.language === "all" || languages.some(([l]) => l === filters.language) ? filters.language : "all";

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (catalog ?? []).filter(
      (c) =>
        c.kind !== "other" &&
        (filters.kind === "all" || c.kind === filters.kind) &&
        (language === "all" || c.language === language) &&
        (filters.questionable || !c.questionable) &&
        (!q || `${c.title} ${c.name} ${c.about}`.toLowerCase().includes(q)),
    );
    // always in view, whatever language the list is showing: the Afrikaanse Bybel
    const pinned = !q && (filters.kind === "all" || filters.kind === "bible") ? (catalog ?? []).filter((c) => PINNED.includes(c.name)) : [];
    return [...pinned, ...list.filter((c) => !pinned.includes(c))];
  }, [catalog, filters, language, query]);

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
        <button role="tab" aria-selected={tab === "file"} className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>
          Add from file
        </button>
      </div>

      {tab === "mine" && (
        <>
          {installed.length === 0 ? (
            <div className="search-hint">
              <p>
                Nothing installed yet. <strong>Get more</strong> lists free Bibles, commentaries, dictionaries, devotionals
                and classic Christian books from the CrossWire Bible Society, eBible.org and others — Barnes, Spurgeon,
                Josephus, Pilgrim's Progress, the Geneva Bible, the Afrikaans 1953 Bybel and Bibles in well over a thousand
                languages.
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
                    {m.source === "file" && <span className="library-own">Added by you</span>}
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
                    {m.name} · {m.language} · {m.entries.toLocaleString()} {ENTRY_WORD[m.kind]}
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
          <div className="library-source">
            <label>
              <span className="muted">From</span>
              <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} aria-label="Library source">
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {source && <span className="muted">{source.about}</span>}
          </div>
          <div className="library-filters">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles and descriptions…" aria-label="Search the library" />
            <select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as LibraryKind | "all" })} aria-label="Kind">
              {KIND_FILTERS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
            <select value={language} onChange={(e) => setFilters({ ...filters, language: e.target.value })} aria-label="Language">
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
          {loadingCatalog && <p className="muted">Loading the {source?.name ?? "library"} catalogue…</p>}
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
                    {c.questionable ? " · filed as questionable material" : ""}
                  </div>
                  {c.note && !c.supported && <div className="library-meta muted">{c.note}</div>}
                  {errors[c.name] && <p className="status-error">{errors[c.name]}</p>}
                  {expanded === c.name && c.about && <div className="library-about">{c.about}</div>}
                </li>
              );
            })}
          </ul>
          <p className="search-hint">
            Free libraries of SWORD modules: the CrossWire Bible Society (crosswire.org), eBible.org and others — choose one
            under <em>From</em>. Internet is needed only while downloading; installed items work offline. Each item's licence is
            shown; read it before sharing a text with others.
          </p>
        </>
      )}

      {tab === "file" && (
        <div className="library-file">
          <p>
            Add something you already have as a file:
          </p>
          <ul>
            <li>
              an <strong>e-book</strong> in EPUB format (<em>.epub</em>) — it joins your books, with its chapters, search and
              Listen, and the Bible references in it become links;
            </li>
            <li>
              a <strong>book as a PDF</strong> (<em>.pdf</em>) — also added to your books. A PDF stores printed pages, so the
              result is rougher than an EPUB: use the EPUB when a book comes in both;
            </li>
            <li>
              a <strong>SWORD module</strong> (<em>.zip</em>) — a Bible, commentary, dictionary or book in the format CrossWire
              and eBible.org publish.
            </li>
          </ul>
          <p className="muted">
            The app checks the whole file first and shows you what it found. Nothing is added unless every check passes and you
            press Add, and anything you add can be removed again under My library.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".epub,.pdf,.zip,application/epub+zip,application/pdf,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) checkFile(f);
            }}
          />
          {(fileState === "idle" || fileState === "done") && (
            <button className="pill-btn" onClick={() => fileRef.current?.click()}>
              {fileState === "done" ? "Add another file…" : "Choose a file…"}
            </button>
          )}
          {fileState === "checking" && <p className="muted">Checking {fileName}…</p>}
          {fileError && (
            <div className="library-file-result refused" role="alert">
              <strong>{fileName} wasn't added.</strong>
              <p>{fileError}</p>
            </div>
          )}
          {fileReport && fileState !== "checking" && (
            <div className={"library-file-result" + (fileState === "done" ? " added" : "")}>
              <strong>
                {fileState === "done" ? "Added: " : ""}
                {fileReport.title}
              </strong>
              <p>
                {KIND_LABEL[fileReport.kind]} · {fileReport.language || "language not stated"} ·{" "}
                {fileReport.entries.toLocaleString()} {ENTRY_WORD[fileReport.kind]}
                {fileReport.books > 0 ? ` in ${fileReport.books} book${fileReport.books === 1 ? "" : "s"}` : ""}
                {fileReport.licence ? ` · ${fileReport.licence}` : ""}
              </p>
              {fileReport.replaces && fileState !== "done" && (
                <p className="library-file-warning">This replaces “{fileReport.replaces}”, which is already in your library.</p>
              )}
              {fileReport.warnings.map((w) => (
                <p key={w} className="library-file-warning">
                  {w}
                </p>
              ))}
              {fileState === "ready" && (
                <div className="note-editor-actions">
                  <button className="pill-btn" onClick={installFile}>
                    Add to my library
                  </button>
                  <button className="text-btn" onClick={cancelFile}>
                    Cancel
                  </button>
                </div>
              )}
              {fileState === "installing" && <p className="muted">Adding…</p>}
              {fileState === "done" && (
                <div className="note-editor-actions">
                  <button className="text-btn" onClick={() => setTab("mine")}>
                    Show my library
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="search-hint">
            Only add files you have the right to use; they stay on this computer and are never shared. Only the text of a
            book is added, not its pictures. Copy-protected or password-protected files (most Kindle, Kobo and Apple Books
            purchases, and library loans) can't be added, and neither can Kindle files or scanned books that are only pictures
            of pages.
          </p>
        </div>
      )}
    </aside>
  );
}
