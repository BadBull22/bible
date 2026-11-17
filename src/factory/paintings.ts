// Content Factory: the Bible paintings that come from the collections downloaded in Explore, Pictures. Pure helpers: the credit
// a painting's licence asks for, the list filter, a hint for small pictures. (Public-domain works need no credit; Sweet Publishing
// is CC BY-SA 3.0 and the Old Testament scans by Phillip Medhurst are CC BY-SA, so those two always carry a line.)

export interface PaintingLike {
  id: string;
  c: string;
  title: string;
  caption?: string;
  refs: [string, number, number | null, number | null][];
  w: number;
  h: number;
  artist: string;
  licence: string;
}

/** does the picture's licence ask for a credit (anything of the CC BY family, even next to a public-domain remark)? */
export const paintingNeedsCredit = (licence: string): boolean => /\bcc[- ]by\b/i.test(licence);

/** "Picture: James Tissot, Phillip Medhurst scan, CC BY-SA" for a licence that asks for it; "" for public domain. At most 150 characters, and the licence is never the part that gets cut. */
export function paintingCredit(p: Pick<PaintingLike, "title" | "artist" | "licence">): string {
  if (!paintingNeedsCredit(p.licence)) return "";
  const who = p.artist.replace(/\s*\([^)]*\)/g, "").trim();
  // "Public domain artwork; scans by Phillip Medhurst (CC BY-SA)" -> "scans by Phillip Medhurst, CC BY-SA 3.0"
  const lic = (/;\s*(.*?)\s*\(([^)]*cc[- ]by[^)]*)\)/i.exec(p.licence) ?? []).slice(1);
  const licence = lic.length === 2 ? `${lic[0]}, ${lic[1]}` : p.licence.trim();
  const generic = /·\s*picture\s*\d+$|^picture\s*\d+$/i.test(p.title);
  const tail = [who, licence].filter(Boolean).join(", ");
  const head = "Picture: ";
  const room = 150 - head.length - tail.length - 2;
  const title = generic || !p.title || room < 12 ? "" : p.title.length > room ? p.title.slice(0, room - 1).trimEnd() + "…" : p.title;
  const line = `${head}${title ? title + ", " : ""}${tail}`;
  return line.length <= 150 ? line : line.slice(0, 150);
}

/** a painting whose short side is under about 1,000 pixels looks soft in a tall picture */
export const SMALL_PICTURE = 1000;
export const isSmallPicture = (p: Pick<PaintingLike, "w" | "h">): boolean => Math.min(p.w, p.h) > 0 && Math.min(p.w, p.h) < SMALL_PICTURE;

/** the books the pictures are about, in the order they first appear, for a book chooser */
export function paintingBooks(list: PaintingLike[], bookOrder: string[]): string[] {
  const seen = new Set<string>();
  for (const p of list) for (const r of p.refs) seen.add(r[0]);
  return [...seen].sort((a, b) => (bookOrder.indexOf(a) + 1 || 999) - (bookOrder.indexOf(b) + 1 || 999) || a.localeCompare(b));
}

/** the list narrowed by collection key ("" = all), book ("" = all) and words typed in the search box (title, caption, book, reference) */
export function filterPaintings<T extends PaintingLike>(list: T[], o: { collection?: string; book?: string; query?: string }): T[] {
  const words = (o.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    if (o.collection && p.c !== o.collection) return false;
    if (o.book && !p.refs.some((r) => r[0] === o.book)) return false;
    if (!words.length) return true;
    const hay = `${p.title} ${p.caption ?? ""} ${p.refs.map((r) => `${r[0]} ${r[1]}`).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** the label on the tab: the count when there is one */
export const paintingsTabLabel = (n: number): string => (n > 0 ? `Paintings (${n.toLocaleString("en-US")})` : "Paintings");
