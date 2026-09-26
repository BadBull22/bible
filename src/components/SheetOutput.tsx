import { useMemo, useState } from "react";
import { api, SheetBlock } from "../api";
import { copyRich, copyText } from "../clipboard";
import { printSheet, sheetHtml, sheetPlainText } from "../studySheet";
import { CopyIcon, PrintIcon } from "./icons";

/** The output half of a study sheet: Print / Copy / Word / Plain text buttons and the
 * paper-style preview. Used by the passage study sheet and the study basket. */
export function SheetOutput({ blocks, title, building }: { blocks: SheetBlock[]; title: string; building: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const html = useMemo(() => sheetHtml(blocks), [blocks]);
  const ready = !building && blocks.length > 0;

  function flash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? null : s)), 4000);
  }

  async function saveWord() {
    try {
      flash(`Saved to ${await api.saveStudySheet(title, blocks)}`);
    } catch (e) {
      setStatus(`Couldn't save the Word document: ${e}`);
    }
  }

  return (
    <>
      <div className="sheet-actions">
        <button className="pill-btn" disabled={!ready} onClick={() => printSheet(blocks)} title="Print, or choose “Microsoft Print to PDF” as the printer">
          <PrintIcon size={14} /> Print / PDF
        </button>
        <button
          className="outline-btn"
          disabled={!ready}
          title="Copy with headings and bold, ready to paste into Word, Google Docs or an email"
          onClick={async () => flash((await copyRich(html, sheetPlainText(blocks))) ? "Copied — paste into Word or an email" : "Couldn't copy")}
        >
          <CopyIcon size={14} /> Copy
        </button>
        <button className="outline-btn" disabled={!ready} onClick={saveWord} title="Save a .docx in Documents\Bible Concordance">
          Save as Word
        </button>
        <button
          className="text-btn"
          disabled={!ready}
          title="Copy as plain text (for notes apps, WhatsApp, etc.)"
          onClick={async () => flash((await copyText(sheetPlainText(blocks))) ? "Copied as plain text" : "Couldn't copy")}
        >
          Plain text
        </button>
      </div>
      {status && (
        <p className="search-hint" role="status">
          {status}
        </p>
      )}
      <div className={"sheet-paper" + (building ? " is-building" : "")} aria-busy={building} aria-label="Study sheet preview">
        {blocks.length === 0 && building ? <p className="muted">Gathering…</p> : <div dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </>
  );
}
