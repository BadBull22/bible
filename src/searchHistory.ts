// Shared "recent searches" store for the two free-text search entry points (the opening
// Gospel screen and the top-bar quick search) -- one shared list rather than two separate
// ones, since both boxes do the same kind of search and a term typed in one is just as
// worth remembering when the other is used later.
//
// Persisted via localStorage (per-viewer convenience data, same treatment this app already
// gives the sidebar/panel-width preferences in App.tsx) so it survives app restarts, not
// just the current session -- wrapped in try/catch throughout since storage can be
// unavailable (a private window, cleared site data) and this must never break search itself.

const KEY = "search-history";
const MAX_ENTRIES = 10;

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Records a search term, most-recent first, deduplicated case-insensitively (searching
 * something already in the list moves it to the front rather than creating a second
 * entry), capped at MAX_ENTRIES. Returns the updated list so callers can update UI state
 * directly from the result instead of re-reading storage. */
export function addSearchHistory(query: string): string[] {
  const q = query.trim();
  if (!q) return getSearchHistory();
  try {
    const existing = getSearchHistory().filter((x) => x.toLowerCase() !== q.toLowerCase());
    const next = [q, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return getSearchHistory();
  }
}
