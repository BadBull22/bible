// Content Factory: small clean-ups of Bible text so it reads well alone on a picture. Pure text, no imports (tested under Node).

const OPEN = "“";
const CLOSE = "”";

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** A verse taken out of its chapter often has a quotation mark that opened or closes outside it, and the odd space after
 * an opening mark. Fix the spaces and drop a mark that has no partner at the very start or end. Everything else stays as
 * the Bible gives it. */
export function tidyQuotes(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/“\s+/g, OPEN).replace(/\s+”/g, CLOSE);
  let open = count(s, OPEN);
  let close = count(s, CLOSE);
  if (close > open && s.endsWith(CLOSE)) {
    s = s.slice(0, -1).trimEnd();
    close--;
  }
  if (open > close && s.startsWith(OPEN)) {
    s = s.slice(1).trimStart();
    open--;
  }
  return s;
}

/** The words in quotation marks for a caption, unless they already carry some. */
export function quoted(text: string): string {
  return text.includes(OPEN) || text.includes(CLOSE) ? text : `${OPEN}${text}${CLOSE}`;
}
