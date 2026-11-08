import { useEffect, useState } from "react";
import { SheetBlock } from "../api";
import { printPage, storySheet, topicSheet } from "../browse/buildSheets";
import { useBrowsePrint } from "../browse/printBridge";
import { storyPicture } from "../browse/storyPictures";
import type { Story, Topic } from "../browse/types";
import { SheetOutput } from "./SheetOutput";

/**
 * The printable page for a story or a "Verses for..." page: print it, save it as PDF or Word, or copy it, with or without the picture (small,
 * as a reference) and the words of the passages. The text shows at once; the picture is added when it is ready, and nothing prints before then.
 */
export function BrowsePrint({ page, versionCode }: { page: Story | Topic; versionCode: string }) {
  const isStory = "summary" in page;
  const hasPicture = isStory && !!storyPicture(page.id);
  const [picture, setPicture] = useState(true);
  const [withWords, setWithWords] = useState(false);
  const [large, setLarge] = useState(false);
  const [blocks, setBlocks] = useState<SheetBlock[]>([]);
  /** the page is complete (the picture, if asked for, is in): only then can it be printed */
  const [final, setFinal] = useState(false);

  useEffect(() => {
    let live = true;
    setFinal(false);
    (async () => {
      if (!isStory) {
        const t = await topicSheet(page, versionCode, withWords);
        if (live) {
          setBlocks(t);
          setFinal(true);
        }
        return;
      }
      const quick = await storySheet(page, versionCode, { words: withWords, picture: false });
      if (live) {
        setBlocks(quick);
        if (!(picture && hasPicture)) setFinal(true);
      }
      if (picture && hasPicture) {
        const full = await storySheet(page, versionCode, { words: withWords, picture: true });
        if (live) {
          setBlocks(full);
          setFinal(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [page, isStory, versionCode, withWords, picture, hasPicture]);

  // the Print button in the top bar, with this menu open, prints with the options chosen here (waiting for the page if it is still being made)
  const [printWhenReady, setPrintWhenReady] = useState(false);
  useBrowsePrint(() => {
    if (final && blocks.length > 0) printPage(blocks, large);
    else setPrintWhenReady(true);
  });
  useEffect(() => {
    if (printWhenReady && final && blocks.length > 0) {
      setPrintWhenReady(false);
      printPage(blocks, large);
    }
  }, [printWhenReady, final, blocks, large]);

  return (
    <div className="browse-sheet">
      <div className="browse-sheet-options">
        {hasPicture && (
          <label className="set-check">
            <input type="checkbox" checked={picture} onChange={(e) => setPicture(e.target.checked)} />
            <span>Include the picture, small, as a reference picture with the story</span>
          </label>
        )}
        <label className="set-check">
          <input type="checkbox" checked={withWords} onChange={(e) => setWithWords(e.target.checked)} />
          <span>Include the words of the passages ({versionCode})</span>
        </label>
        <label className="set-check">
          <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />
          <span>Large print</span>
        </label>
      </div>
      <SheetOutput blocks={blocks} title={page.title} building={!final} printOptions={{ page: "a4", large }} />
    </div>
  );
}
