import { useEffect, useState } from "react";
import { SheetBlock } from "../api";
import { kidPicture } from "../browse/pictures";
import { childSheet, printPage } from "../browse/buildSheets";
import { useBrowsePrint } from "../browse/printBridge";
import type { ChildPage } from "../browse/types";
import { SheetOutput } from "./SheetOutput";

/**
 * The printable activity sheet for a children's page: print it or save it as PDF or Word, with or without the colour picture (small, as a
 * reference), the outline picture on a full page to colour in, and the answer key.
 */
export function BrowseSheet({ page }: { page: ChildPage }) {
  const hasPicture = !!kidPicture(page.id);
  const [picture, setPicture] = useState(true);
  const [colouringPage, setColouringPage] = useState(false);
  const [answers, setAnswers] = useState(false);
  const [large, setLarge] = useState(false);
  const [blocks, setBlocks] = useState<SheetBlock[]>([]);

  useEffect(() => {
    let live = true;
    childSheet(page, { answers, picture, colouringPage }).then((next) => live && setBlocks(next));
    return () => {
      live = false;
    };
  }, [page, answers, picture, colouringPage]);

  // the Print button in the top bar, with this menu open, prints with the options chosen here (waiting for the page if it is still being made)
  const [printWhenReady, setPrintWhenReady] = useState(false);
  useBrowsePrint(() => {
    if (blocks.length > 0) printPage(blocks, large);
    else setPrintWhenReady(true);
  });
  useEffect(() => {
    if (printWhenReady && blocks.length > 0) {
      setPrintWhenReady(false);
      printPage(blocks, large);
    }
  }, [printWhenReady, blocks, large]);

  return (
    <div className="browse-sheet">
      <div className="browse-sheet-options">
        {hasPicture && (
          <>
            <label className="set-check">
              <input type="checkbox" checked={picture} onChange={(e) => setPicture(e.target.checked)} />
              <span>Include the colour picture, small, as a reference picture with the story</span>
            </label>
            <label className="set-check">
              <input type="checkbox" checked={colouringPage} onChange={(e) => setColouringPage(e.target.checked)} />
              <span>Add the outline picture on its own full A4 page, to colour in</span>
            </label>
          </>
        )}
        <label className="set-check">
          <input type="checkbox" checked={answers} onChange={(e) => setAnswers(e.target.checked)} />
          <span>Add the answer key for the grown-up</span>
        </label>
        <label className="set-check">
          <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />
          <span>Large print</span>
        </label>
      </div>
      <SheetOutput blocks={blocks} title={page.title} building={blocks.length === 0} printOptions={{ page: "a4", large }} />
    </div>
  );
}
