// Showing what is being read aloud: finding the sentences of a piece of text as it sits on
// the page, and tinting the one being spoken.
//
// The sentences are taken from the page itself (the DOM), not from the stored text, so what
// is highlighted is exactly what was sent to the voice. The tint uses the CSS Custom
// Highlight API (`::highlight(reading)` in App.css): it paints over a text range without
// changing the page's elements, so links, word spans and page marks keep working.

/** Abbreviations whose full stop doesn't end a sentence. */
const ABBREVIATIONS = new Set(
  (
    "mr mrs ms dr st rev prof sr jr vs v vv ver ch chap cf etc eg ie viz no vol pp p ff art ps ex lev num deut josh judg sam kgs chr neh esth prov eccl isa jer lam ezek dan hos obad mic nah hab zeph hag zech mal matt mk lk jn rom cor gal eph phil col thess tim tit phlm heb jas pet rev gen exod"
  ).split(" "),
);

export interface Span {
  start: number;
  end: number;
}

/** Where the sentences of `text` start and end. A full stop ends a sentence only when
 * what follows looks like a new one, and not after an abbreviation ("Rev. 4:6", "Mr. Smith")
 * or an initial ("C. H. Spurgeon"). */
export function splitSentences(text: string): Span[] {
  const out: Span[] = [];
  let start = 0;
  const re = /[.!?]+["”’')\]]*(\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[0].trimEnd().startsWith(".") && end < text.length) {
      const before = /([\p{L}]+)$/u.exec(text.slice(start, m.index))?.[1] ?? "";
      const next = text[end] ?? "";
      const initial = before.length === 1 && before === before.toUpperCase();
      // "…the Lord. And he said" ends; "chap. 3", "Rev. 4:6", "e.g. this" and "J. Smith" don't
      if (ABBREVIATIONS.has(before.toLowerCase()) || initial || /[\p{Ll}\d,;:)]/u.test(next)) continue;
    }
    if (/[\p{L}\p{N}]/u.test(text.slice(start, end))) {
      out.push({ start, end });
      start = end;
    }
  }
  if (start < text.length && /[\p{L}\p{N}]/u.test(text.slice(start))) out.push({ start, end: text.length });
  else if (out.length && start < text.length) out[out.length - 1].end = text.length;
  return out;
}

interface TextMap {
  text: string;
  parts: { node: Text; start: number }[];
}

/** The text of an element as the reader sees it, leaving out anything inside `skip`
 * (verse numbers, page marks, buttons), with each character traceable to its text node. */
export function textMap(el: Element, skip: string): TextMap {
  const parts: TextMap["parts"] = [];
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (skip && n.parentElement?.closest(skip) && el.contains(n.parentElement.closest(skip)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    parts.push({ node: n as Text, start: text.length });
    text += n.nodeValue ?? "";
  }
  return { text, parts };
}

function rangeOf(map: TextMap, span: Span): Range | null {
  const at = (offset: number, end: boolean) => {
    for (let i = map.parts.length - 1; i >= 0; i--) {
      const p = map.parts[i];
      if (offset > p.start || (!end && offset === p.start) || i === 0) return { node: p.node, offset: Math.min(offset - p.start, p.node.length) };
    }
    return null;
  };
  const a = at(span.start, false);
  const b = at(span.end, true);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, Math.max(0, a.offset));
    r.setEnd(b.node, Math.max(0, b.offset));
  } catch {
    return null;
  }
  return r;
}

export interface PageSentence {
  text: string;
  range: () => Range | null;
}

/** The sentences inside one element (a paragraph, a verse), each able to say where it is. */
export function sentencesIn(el: Element, skip = ""): PageSentence[] {
  const map = textMap(el, skip);
  return splitSentences(map.text).map((span) => ({
    text: map.text.slice(span.start, span.end).replace(/\s+/g, " ").trim(),
    range: () => rangeOf(textMap(el, skip), span),
  }));
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights && "Highlight" in globalThis ? css.highlights : null;
}

/** Tints `range` as the sentence being read (or clears the tint). Returns false where the
 * browser can't do it, so the caller can fall back to tinting the whole paragraph. */
export function showReading(range: Range | null): boolean {
  const reg = registry();
  if (!reg) return false;
  if (!range) {
    reg.delete("reading");
    return true;
  }
  const Ctor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
  reg.set("reading", new Ctor(range));
  return true;
}

/** Scrolls so `target` sits comfortably in view inside `box`, if it isn't already. */
export function keepInView(box: HTMLElement, target: Range | Element, topGap = 120, bottomGap = 170) {
  const r = target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const b = box.getBoundingClientRect();
  if (r.top >= b.top + topGap && r.bottom <= b.bottom - bottomGap) return;
  const wanted = box.scrollTop + (r.top - b.top) - Math.max(topGap, b.height * 0.3);
  box.scrollTo({ top: Math.max(0, wanted), behavior: "smooth" });
}

/** Following the reading stops when the reader scrolls for themselves (wheel, touch, the
 * paging keys, dragging the scrollbar) and starts again when they ask. Calls `onPause` once. */
export function watchForManualScroll(box: HTMLElement, onPause: () => void): () => void {
  const pause = () => onPause();
  const keys = (e: KeyboardEvent) => {
    if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(e.key)) onPause();
  };
  // a press on the scrollbar itself lands on the box, not on anything inside it
  const press = (e: MouseEvent) => {
    if (e.target === box && e.offsetX >= box.clientWidth) onPause();
  };
  box.addEventListener("wheel", pause, { passive: true });
  box.addEventListener("touchmove", pause, { passive: true });
  box.addEventListener("mousedown", press);
  window.addEventListener("keydown", keys);
  return () => {
    box.removeEventListener("wheel", pause);
    box.removeEventListener("touchmove", pause);
    box.removeEventListener("mousedown", press);
    window.removeEventListener("keydown", keys);
  };
}
