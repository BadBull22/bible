// The owner's rule (2026-11-07): the app does not use the modern name "Easter" for the time of the Passover and the resurrection of Jesus.
// Where an old calendar or list says "Easter", the reader sees the correct term first, followed by the original as a "modern reference":
//   "Easter Day: Principal Service" -> "Resurrection Sunday: Principal Service (modern reference: Easter Day)".
// Pure text, no dependencies, so it can be tested exactly (scripts/test_plain_terms.mts).

export function plainTerm(text: string): string {
  if (!/\bEaster\b/.test(text)) return text;
  // only the part before a colon names the day ("Easter Day: Early Service"); the part after it is a detail
  const colon = text.indexOf(":");
  const head = colon < 0 ? text : text.slice(0, colon);
  const tail = colon < 0 ? "" : text.slice(colon);
  const correct = head
    .replace(/^The Great Vigil of Easter$/, "The Great Vigil of the Resurrection")
    .replace(/\bEaster Day\b/, "Resurrection Sunday")
    .replace(/\b(\w+) in Easter Week\b/, "$1 in Resurrection Week")
    .replace(/\b(\w+) Sunday (?:of|in) Easter\b/, "$1 Sunday of the Resurrection Season")
    .replace(/\bEaster\b/g, "Resurrection");
  return `${correct}${tail} (modern reference: ${head})`;
}
