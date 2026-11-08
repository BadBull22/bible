// A polite request to review the app on the Microsoft Store: when to ask, and what to remember. The rules are kept here (no app code) so that node can test them.
// The aim is a fair, honest review from people who have used the app. The Store does not allow steering or rewarding reviews, so everybody who is asked is
// asked the same way, and the request is never repeated once the reader has said "don't ask again" or has gone to the Store.

/** The app's page in the Microsoft Store, where it can be rated and reviewed. */
export const STORE_PAGE = "https://apps.microsoft.com/detail/9NWNL186FS6W";

const KEY = "review:ask";
const DAY = 86_400_000;
/** the app must have been opened this many times, over at least this many days, before the first request */
export const MIN_OPENS = 6;
export const MIN_DAYS = 4;
/** after a request, no new one for this many days, and never more than this many requests in all */
export const GAP_DAYS = 30;
export const MAX_ASKS = 3;

export interface AskState {
  /** how many times the app has been opened */
  opens: number;
  /** when it was first opened (ms) */
  first: number;
  /** how many times the request has been shown */
  asks: number;
  /** not before this time (ms) */
  next: number;
  /** the reader went to the Store or asked not to be asked again */
  off: boolean;
}

export type ReviewAnswer = "review" | "later" | "never";

export const fresh = (now: number): AskState => ({ opens: 0, first: now, asks: 0, next: 0, off: false });

/** Is it time to ask? */
export function due(s: AskState, now: number): boolean {
  return !s.off && s.asks < MAX_ASKS && s.opens >= MIN_OPENS && now - s.first >= MIN_DAYS * DAY && now >= s.next;
}

export const afterOpen = (s: AskState): AskState => ({ ...s, opens: s.opens + 1 });

/** The request is on the screen: the next one is a month away, whatever the reader does. */
export const afterShown = (s: AskState, now: number): AskState => ({ ...s, asks: s.asks + 1, next: now + GAP_DAYS * DAY });

/** "review" (went to the Store) and "never" end the requests; "later" leaves the month's wait that was already set. */
export const afterAnswer = (s: AskState, answer: ReviewAnswer): AskState => (answer === "later" ? s : { ...s, off: true });

export function load(now: number): AskState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<AskState>;
      if (typeof s.opens === "number" && typeof s.first === "number") return { ...fresh(now), ...s } as AskState;
    }
  } catch {
    /* no storage: nothing is remembered, and so nothing is asked */
  }
  return fresh(now);
}

export function save(s: AskState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let counted = false;
/** Counts this start of the app once (not each time a screen redraws) and returns what is remembered. */
export function countOpen(now: number): AskState {
  let s = load(now);
  if (!counted) {
    counted = true;
    s = afterOpen(s);
    save(s);
  }
  return s;
}
