import { useEffect, useState } from "react";
import { api, CatalogItem } from "../api";

// The free modern English Bibles, easy to find: a short list at the top of Library > Get
// more > Bibles, each with its licence (read from the library's own catalogue) and one
// button to install. Only translations whose licence lets anyone share them for free are
// listed. NIV, ESV, NASB and NLT are not free; they stay online with the reader's own key.

interface Pick {
  source: "crosswire" | "ebible";
  name: string;
  /** a line on what it is */
  why: string;
}

const PICKS: Pick[] = [
  { source: "ebible", name: "englsv2020eb", why: "Literal Standard Version (2020): a modern, word-for-word translation." },
  { source: "crosswire", name: "NETfree", why: "NET Bible, free edition: a readable modern translation (the full edition's 60,000 notes are locked by its publisher)." },
  { source: "ebible", name: "engmsb2024eb", why: "Majority Standard Bible: the Berean Standard Bible's sister, from the Majority Greek text." },
  { source: "crosswire", name: "LEB", why: "Lexham English Bible: close to the original languages, easy to compare with them." },
  { source: "crosswire", name: "NHEB", why: "New Heart English Bible: a modern-English revision of the World English Bible." },
  { source: "ebible", name: "engfbv2018eb", why: "Free Bible Version: plain, everyday English." },
  { source: "ebible", name: "engULB2017eb", why: "Unlocked Literal Bible: a literal translation made to be freely shared." },
  { source: "crosswire", name: "OEB", why: "Open English Bible: modern English (the Old Testament is still being translated)." },
];

interface Props {
  /** names of the modules already installed */
  installedNames: Set<string>;
  progress: Record<string, string>;
  errors: Record<string, string>;
  onInstall: (item: CatalogItem) => void;
  /** "✓ Installed" with its Remove, for an installed one */
  installedTools: (name: string) => React.ReactNode;
}

export function RecommendedBibles({ installedNames, progress, errors, onInstall, installedTools }: Props) {
  const [items, setItems] = useState<Map<string, CatalogItem> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // the two catalogues (kept for a week, so this works offline after the first time)
    Promise.all((["crosswire", "ebible"] as const).map((s) => api.libraryCatalog(false, s).catch(() => [] as CatalogItem[]))).then((lists) => {
      if (!live) return;
      const all = new Map<string, CatalogItem>();
      for (const list of lists) for (const c of list) all.set(`${c.source}:${c.name}`, c);
      setItems(all);
      setFailed(all.size === 0);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="library-recommended">
      <h4 className="section-label">Recommended free translations</h4>
      <p className="muted">
        Modern English Bibles that are free to use and share. Already built in: BSB, KJV, ASV, WEB and YLT. NIV, ESV, NASB and NLT are
        not free; they can be shown online with your own key (Settings).
      </p>
      {!items && <p className="muted">Loading…</p>}
      {failed && <p className="muted">Connect to the internet once to see these.</p>}
      {items && !failed && (
        <ul className="library-list">
          {PICKS.map((p) => {
            const c = items.get(`${p.source}:${p.name}`);
            if (!c) return null;
            const busy = progress[c.name];
            return (
              <li key={c.name} className="library-item">
                <div className="library-item-head">
                  <span className="basket-kind">Bible</span>
                  <span className="library-title">{c.title}</span>
                  <span className="item-tools">
                    {busy ? (
                      <span className="muted library-progress">{busy}</span>
                    ) : installedNames.has(c.name) ? (
                      installedTools(c.name)
                    ) : !c.supported ? (
                      <span className="muted" title={c.note ?? ""}>
                        Not supported
                      </span>
                    ) : (
                      <button className="pill-btn small" onClick={() => onInstall(c)}>
                        Install
                      </button>
                    )}
                  </span>
                </div>
                <div className="library-meta">{p.why}</div>
                <div className="library-meta muted">
                  {c.licence} · from {c.source === "ebible" ? "eBible.org" : "CrossWire"}
                </div>
                {errors[c.name] && <p className="status-error">{errors[c.name]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
