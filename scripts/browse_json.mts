// Writes Browse data files in the layout of the hand-written seed files: short lists on one line, one object per line in the lists of small records.
// Used by merge_browse_drafts.mts and link_browse.mts.
const flat = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);
export function put(v: unknown, pad: string): string {
  if (flat(v)) return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every(flat)) return "[" + v.map((x) => JSON.stringify(x)).join(", ") + "]";
    const small = v.every((x) => x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every(flat) && JSON.stringify(x).length < 150);
    if (small) return "[\n" + v.map((x) => pad + "  " + "{ " + Object.entries(x as object).map(([k, y]) => `${JSON.stringify(k)}: ${JSON.stringify(y)}`).join(", ") + " }").join(",\n") + "\n" + pad + "]";
    return "[\n" + v.map((x) => pad + "  " + put(x, pad + "  ")).join(",\n") + "\n" + pad + "]";
  }
  const entries = Object.entries(v as object);
  if (entries.every(([, y]) => flat(y)) && JSON.stringify(v).length < 90) return "{ " + entries.map(([k, y]) => `${JSON.stringify(k)}: ${JSON.stringify(y)}`).join(", ") + " }";
  return "{\n" + entries.map(([k, y]) => `${pad}  ${JSON.stringify(k)}: ${put(y, pad + "  ")}`).join(",\n") + "\n" + pad + "}";
}
