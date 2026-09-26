/** Copy text to the clipboard. The async Clipboard API is available in the app's webview
 * (it is a secure context); the textarea fallback covers any environment where it isn't. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Copy formatted text: Word, Outlook and Google Docs paste the HTML version (headings,
 * bold, italics); plain-text editors get `plain`. Falls back to plain text alone. */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    return copyText(plain);
  }
}

/** "John 3:16" style reference plus the verse text and translation, the way study
 * software conventionally formats a copied verse. */
export function formatVerseForCopy(book: string, chapter: number, verse: number, text: string, versionCode: string): string {
  return `"${text.trim()}" — ${book} ${chapter}:${verse} (${versionCode})`;
}
