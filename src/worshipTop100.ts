// The "Top 100 worship songs of 2026" (PraiseCharts, list updated 23 October 2026): names and artists only.
// No words are kept here. The words of a song are looked up on the church's computer when the song is wanted, checked, and
// saved in its own library (the church shows them under its own CCLI licence). Pure, so it can be tested under Node
// (scripts/test_top100.mts).

/** [title as the list has it, who recorded it] */
export const TOP_100: [string, string][] = [
  ["Jesus Be The Name", "Elevation Worship / Tiffany Hudson"],
  ["Washed", "ELEVATION RHYTHM"],
  ["Holy Forever", "Chris Tomlin"],
  ["God I'm Just Grateful", "Elevation Worship / Chandler Moore"],
  ["Goodness Of God", "Bethel Music / Jenn Johnson"],
  ["I Know A Name", "Elevation Worship / Chris Brown / Brandon Lake"],
  ["Who Else (Live)", "Gateway Worship / Abbie Gamboa"],
  ["Trust In God", "Elevation Worship / Chris Brown"],
  ["Thank God I'm Free", "ELEVATION RHYTHM / Lizzie Morgan"],
  ["What A God (Live)", "SEU Worship / One House / Chelsea Plank / Kenzie Walker / Roosevelt Stewart"],
  ["It Really Is Amazing Grace", "Phil Wickham / Crowder"],
  ["I Speak Jesus", "Charity Gayle / Steven Musso"],
  ["Thank You Jesus For The Blood", "Charity Gayle"],
  ["Worthy Of It All (Live)", "CeCe Winans"],
  ["Goodbye Yesterday (Live)", "ELEVATION RHYTHM"],
  ["The Blood (Live)", "Bethel Music / David Funk"],
  ["What A Beautiful Name (Live)", "Hillsong Worship"],
  ["Living Hope", "Phil Wickham"],
  ["Great Are You Lord", "All Sons & Daughters"],
  ["King Of Kings", "Hillsong Worship"],
  ["How Great Is Our God", "Chris Tomlin"],
  ["10,000 Reasons (Bless The Lord)", "Matt Redman / Passion"],
  ["Build My Life", "Pat Barrett"],
  ["Firm Foundation (He Won't) (Live)", "Cody Carnes"],
  ["Center (Live)", "Bethel Music / Abbie Gamboa"],
  ["O Come To The Altar", "Elevation Worship"],
  ["Worthy", "Elevation Worship"],
  ["Amazing Grace (My Chains Are Gone)", "Chris Tomlin"],
  ["I Thank God", "Maverick City Music / Dante Bowe / Aaron Moses / Maryanne J. George / Chuck Butler"],
  ["Yet Not I But Through Christ In Me", "CityAlight"],
  ["This Is Amazing Grace", "Phil Wickham"],
  ["Gratitude (Live)", "Brandon Lake"],
  ["All Hail King Jesus (Live)", "Bethel Music / Bethany Wohrle"],
  ["The Blessing (Live)", "Elevation Worship / Kari Jobe / Cody Carnes"],
  ["Lord I Need You", "Matt Maher"],
  ["Alleluia", "Elevation Worship / Chandler Moore / Chris Brown"],
  ["The Lord Will Provide (Live From Passion 2024)", "Passion / Landon Wolfe"],
  ["What An Awesome God", "Phil Wickham"],
  ["Glorious Day", "Passion / Kristian Stanfill"],
  ["Abide (Live)", "The Worship Initiative / Shane & Shane"],
  ["House Of The Lord", "Phil Wickham"],
  ["Graves Into Gardens (Live)", "Elevation Worship / Brandon Lake"],
  ["O Praise The Name (Anastasis)", "Hillsong Worship"],
  ["The Joy (Live)", "The Belonging Co / Andrew Holt"],
  ["Battle Belongs", "Phil Wickham"],
  ["Praise", "Elevation Worship / Chris Brown / Brandon Lake / Chandler Moore"],
  ["Who You Say I Am", "Hillsong Worship"],
  ["Always On Time", "Elevation Worship / Bella Cordero"],
  ["Made For More (Live)", "Josh Baldwin / Jenn Johnson"],
  ["Good Good Father", "Chris Tomlin"],
  ["Same God", "Elevation Worship / Jonsal Barrientes"],
  ["Mighty Name Of Jesus", "The Belonging Co / Hope Darst"],
  ["In Christ Alone", "Kristian Stanfill / Passion"],
  ["Way Maker (Live)", "Leeland"],
  ["The Heart Of Worship", "Matt Redman"],
  ["Christ Be Magnified", "Cody Carnes"],
  ["Rest On Us", "Maverick City Music / UPPERROOM / Brandon Lake / Eniola Abioye"],
  ["SO BE IT", "Elevation Worship / Tiffany Hudson / Chris Brown"],
  ["Give Me Jesus", "UPPERROOM / Abbie Gamboa"],
  ["Testimony", "Terrian"],
  ["Worthy Of It All (Worthy)", "CeCe Winans"],
  ["Oceans (Where Feet May Fail)", "Hillsong UNITED / TAYA"],
  ["Come Jesus Come", "CeCe Winans"],
  ["I Believe", "Charity Gayle"],
  ["Nothing Else", "Cody Carnes"],
  ["How Great Thou Art", "Shane & Shane / The Worship Initiative"],
  ["Run To The Father", "Cody Carnes"],
  ["Reckless Love", "Bethel Music / Cory Asbury"],
  ["Cornerstone", "Hillsong Worship"],
  ["The Wonderful Blood", "Tiffany Hudson"],
  ["Make Room", "The Church Will Sing / Elyssa Smith / Community Music"],
  ["Christus Victor (Amen)", "Keith & Kristyn Getty / Cochren & Co / Sing!"],
  ["Great Things", "Phil Wickham"],
  ["How Good It Is", "Chris Tomlin"],
  ["Jesus Paid It All", "Kristian Stanfill / Passion"],
  ["Holy Spirit", "Francesca Battistelli"],
  ["Shout To The Lord", "Hillsong Worship"],
  ["Here I Am To Worship", "Chris Tomlin / Passion"],
  ["Our God", "Chris Tomlin"],
  ["Bless God", "Brooke Ligertwood"],
  ["You've Already Won (Live)", "Shane & Shane"],
  ["At The Altar", "ELEVATION RHYTHM / Abbie Gamboa / Tiffany Hudson"],
  ["Because He Lives", "Rock Springs Worship / Arr. Matt Summers / Arr. Amber Balltzglier"],
  ["Good Plans", "Red Rocks Worship"],
  ["Nothing But The Blood", "The Worship Initiative"],
  ["Raise A Hallelujah", "Bethel Music / Melissa Helser / Jonathan David Helser"],
  ["Open The Eyes Of My Heart", "Paul Baloche"],
  ["I Believe", "Phil Wickham"],
  ["The King Is In The Room", "Phil Wickham"],
  ["Worthy Is The Lamb", "Hillsong Worship"],
  ["Blessed Be Your Name", "Matt Redman"],
  ["Only A Holy God", "CityAlight"],
  ["God So Loved", "We The Kingdom"],
  ["I Surrender", "Hillsong Worship"],
  ["Hymn Of Heaven", "Phil Wickham"],
  ["Great Is Thy Faithfulness", "Christy Nockels"],
  ["The Lion And The Lamb", "Bethel Music / Leeland"],
  ["Love Of God", "Brandon Lake / Phil Wickham"],
  ["How Deep The Father's Love For Us", "Austin Stone Worship"],
  ["This Is Our God", "Phil Wickham"],
];

export type ChartStatus = "new" | "listed" | "dropped";

/** A song on the chart, as kept between runs of the app. */
export interface StoredSong {
  /** the title as the chart has it ("Who Else (Live)") */
  listed: string;
  /** all the artists, as listed */
  artists: string;
  /** new: not on the list before the last update; dropped: no longer on the chart */
  status: ChartStatus;
  /** the day it was first seen as new */
  added?: string;
}

export interface TopSong extends StoredSong {
  /** its place on the chart (0 for one that has dropped off) */
  rank: number;
  /** the title to look up and to keep: the same without a "(Live)" and the like */
  title: string;
  /** the first of the artists */
  artist: string;
}

/** "(Live)" and "(Live From Passion 2024)" are how a recording was made, not part of the title; "(Bless The Lord)" is. */
export function cleanTitle(listed: string): string {
  let t = listed.trim();
  for (;;) {
    const next = t.replace(/\s*\((?:live|acoustic|radio edit|single version)\b[^)]*\)\s*$/i, "").trim();
    if (next === t) break;
    t = next;
  }
  return t || listed.trim();
}

/** The artist to look a song up under (the first one) and to write against it, in the way names are usually written. */
export function firstArtist(artists: string): string {
  const first = artists.split("/")[0].trim();
  // the list writes a few bands in capitals ("ELEVATION RHYTHM"); a name that is all capitals is written plainly
  return first === first.toUpperCase() && /[A-Z]{3}/.test(first) ? first.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : first;
}

/** Words compared without capitals, punctuation or spacing. */
export const normTitle = (s: string): string => cleanTitle(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The list that comes with the app (23 October 2026). */
export const BUNDLED: StoredSong[] = TOP_100.map(([listed, artists]) => ({ listed, artists, status: "listed" as const }));

/** The stored songs as the screen shows them: the title and first artist worked out, the chart places given in order. */
export function toTopSongs(stored: StoredSong[]): TopSong[] {
  let rank = 0;
  return stored.map((s) => ({ ...s, rank: s.status === "dropped" ? 0 : ++rank, title: cleanTitle(s.listed), artist: firstArtist(s.artists) }));
}

/** A fresh chart set against the list kept before: a song not on it before is new (it stays new until the new marks are cleared,
 * or it is kept), one that is on it keeps its mark, and one that is no longer on the chart is marked dropped (and put after the rest). */
export function mergeChart(prev: StoredSong[], fresh: { title: string; artists: string[] }[], today: string): StoredSong[] {
  const before = new Map(prev.map((s) => [normTitle(s.listed), s]));
  const seen = new Set<string>();
  const out: StoredSong[] = [];
  for (const f of fresh) {
    const key = normTitle(f.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const old = before.get(key);
    const artists = f.artists.join(" / ");
    if (old) out.push({ listed: f.title.trim(), artists: artists || old.artists, status: old.status === "new" ? "new" : "listed", ...(old.status === "new" && old.added ? { added: old.added } : {}) });
    else out.push({ listed: f.title.trim(), artists, status: "new", added: today });
  }
  for (const s of prev) if (!seen.has(normTitle(s.listed))) out.push({ listed: s.listed, artists: s.artists, status: "dropped" });
  return out;
}

/** The new marks taken off (the preacher has seen them). */
export const clearNew = (list: StoredSong[]): StoredSong[] => list.map((s) => (s.status === "new" ? { listed: s.listed, artists: s.artists, status: "listed" as const } : s));

/** Which of the songs a saved song is (by its title), or null. */
export function topSongFor(list: TopSong[], savedTitle: string): TopSong | null {
  const n = normTitle(savedTitle);
  return list.find((t) => normTitle(t.title) === n) ?? null;
}

const KEY = "bc-top-list";

/** The list kept from the last update, or the one that came with the app. */
export function loadList(): { songs: StoredSong[]; updated: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { songs?: StoredSong[]; updated?: string } | null;
    if (raw && Array.isArray(raw.songs) && raw.songs.length > 0) return { songs: raw.songs, updated: raw.updated ?? null };
  } catch {
    /* none kept */
  }
  return { songs: BUNDLED, updated: null };
}

export function saveList(songs: StoredSong[], updated: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ songs, updated }));
  } catch {
    /* it just starts from the bundled list next time */
  }
}

/** Of what a look-up found, the one to take for a wanted song: the same title by the same artist, else the only one with that title. */
export function bestHit<T extends { title: string; artist: string }>(hits: T[], wantedTitle: string, wantedArtist: string): T | null {
  const same = hits.filter((h) => normTitle(h.title) === normTitle(wantedTitle));
  if (same.length === 0) return null;
  const a = wantedArtist.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").trim();
  const byArtist = same.filter((h) => {
    const b = h.artist.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").trim();
    return a && b && (b.includes(a) || a.includes(b));
  });
  if (byArtist.length > 0) return byArtist[0];
  return same.length === 1 ? same[0] : null;
}

// ---- the library as a file, to carry to another computer (the church's) without putting any words in the app

export interface SongsFile {
  app: "bible-concordance-songs";
  version: 1;
  saved: string;
  songs: { title: string; author: string; ccli: string; body: string }[];
}

export function makeSongsFile(rows: { title: string; author: string; ccli: string; body: string }[], when = new Date()): SongsFile {
  return { app: "bible-concordance-songs", version: 1, saved: when.toISOString(), songs: rows.map((r) => ({ title: r.title, author: r.author, ccli: r.ccli, body: r.body })) };
}

/** The songs in a file made by makeSongsFile, or an error in plain words. */
export function readSongsFile(text: string): { songs: SongsFile["songs"] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That is not a songs file (it can't be read)." };
  }
  const f = data as Partial<SongsFile> | null;
  if (!f || f.app !== "bible-concordance-songs" || !Array.isArray(f.songs)) return { error: "That is not a songs file from this app." };
  const songs = f.songs
    .filter((s) => s && typeof s.title === "string" && s.title.trim() && typeof s.body === "string")
    .map((s) => ({ title: s.title.trim(), author: typeof s.author === "string" ? s.author : "", ccli: typeof s.ccli === "string" ? s.ccli : "", body: s.body }));
  // a song with no words in it is no song
  const withWords = songs.filter((s) => {
    try {
      return ((JSON.parse(s.body) as { sections?: unknown[] }).sections?.length ?? 0) > 0;
    } catch {
      return false;
    }
  });
  if (withWords.length === 0) return { error: "There are no songs with words in that file." };
  return { songs: withWords };
}
