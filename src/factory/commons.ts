// Content Factory: finding a photograph online (Wikimedia Commons) to put behind the words. Only pictures whose licence allows
// this: public domain, CC0, CC BY and CC BY-SA (never "non-commercial" or "no derivatives"). The credit is made for the picture and
// goes on it automatically, because those licences ask for it. Nothing is downloaded until the reader searches or picks.

export interface CommonsPhoto {
  title: string;
  /** a picture about 1280 px wide */
  thumb: string;
  width: number;
  height: number;
  /** "Photo: Jane Smith, CC BY-SA 4.0, Wikimedia Commons"; empty for public domain and CC0 */
  credit: string;
  licence: string;
  /** its Commons page */
  page: string;
}

/** May a picture with this licence be used (public domain, CC0, CC BY, CC BY-SA; not NC, ND or anything unknown)? */
export function acceptable(licence: string): boolean {
  const l = licence.trim().toLowerCase();
  if (!l) return false;
  if (/\b(nc|nd)\b|non-?commercial|no.?deriv/.test(l)) return false;
  return /^(cc0|cc-zero|public domain|pd\b|pdm|no restrictions)/.test(l) || l.includes("public domain") || /^cc[- ]by(-sa)?\b/.test(l);
}

/** public domain and CC0 need no credit; the others do */
export const needsCredit = (licence: string) => !/^(cc0|cc-zero|public domain|pd\b|pdm|no restrictions)/i.test(licence.trim()) && !/public domain/i.test(licence);

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "Photo: Jane Smith, CC BY-SA 4.0, Wikimedia Commons" (empty when the licence needs no credit). Short enough to sit on a picture. */
export function creditLine(artistHtml: string, licence: string): string {
  if (!needsCredit(licence)) return "";
  const who = strip(artistHtml)
    .replace(/^(user|by):?\s*/i, "")
    .replace(/^original:\s*/i, "")
    .replace(/^(this\s+(photo|picture|image|photograph)\s+was\s+(taken|made|created)\s+by|(photo|photograph|picture|image)(\s+taken)?\s+by|taken\s+by|created\s+by)\s*:?\s*/i, "")
    .replace(/\s*derivative work:.*$/i, "")
    // a photographer's own note after the name ("Jane Smith. Feel free to use my photos...") is left out
    .split(/\.\s+(?=(?:feel free|please|if you|you may|you can|this (?:photo|image|picture)|taken|use |all rights|licen|contact|see |for more|credit|thanks|thank you)\b)|\s[-–—|]\s|\s*\(|\s*;/i)[0]
    .trim()
    .replace(/[.,;:]+$/, "");
  const short = who.length > 34 ? `${who.slice(0, 34).replace(/\s+\S*$/, "")}` : who;
  return `Photo: ${short ? `${short}, ` : ""}${licence.trim()}, Wikimedia Commons`;
}

const API = "https://commons.wikimedia.org/w/api.php";

/** Searches Commons for photographs (JPEG and PNG, at least 1400 px wide) and keeps those with a usable licence. */
export async function searchCommons(query: string, limit = 30): Promise<CommonsPhoto[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${query.trim()} filetype:bitmap`,
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "1280",
    iiextmetadatafilter: "LicenseShortName|Artist",
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error("The search did not work. Check the internet connection and try again.");
  const data = (await res.json()) as { query?: { pages?: Record<string, { title: string; index?: number; imageinfo?: { thumburl?: string; url: string; width: number; height: number; descriptionurl?: string; extmetadata?: Record<string, { value: string }> }[] }> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: CommonsPhoto[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || ii.width < 1400 || !/\.(jpe?g|png)$/i.test(p.title)) continue;
    const licence = ii.extmetadata?.LicenseShortName?.value ?? "";
    if (!acceptable(licence)) continue;
    out.push({ title: p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""), thumb: ii.thumburl ?? ii.url, width: ii.width, height: ii.height, credit: creditLine(ii.extmetadata?.Artist?.value ?? "", licence), licence, page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}` });
  }
  return out;
}

/** quick searches for the church year */
export const PHOTO_IDEAS = ["sunrise over hills", "candle flame", "Christmas lights", "Advent wreath", "Passover seder", "open Bible", "wheat field harvest", "dove", "cross sunset", "mountain lake", "stained glass", "olive tree"];
