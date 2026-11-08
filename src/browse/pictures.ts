// The children's pictures (original artwork, src/browse/pictures/kids): <page id>.svg in colour and <page id>-line.svg as an outline to colour in.

const urls = import.meta.glob("./pictures/kids/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** the address of a children's page picture, or null when that page has none yet */
export function kidPicture(id: string, outline = false): string | null {
  return urls[`./pictures/kids/${id}${outline ? "-line" : ""}.svg`] ?? null;
}
