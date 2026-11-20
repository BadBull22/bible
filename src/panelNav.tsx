// Back inside the side panel. The top bar's Back steps back through where you were reading; this one steps back through the side panels you came through
// (Interlinear, then a word's Word Study, then its meanings...), so a link in a panel never loses the place it came from.

import { createContext, useContext } from "react";
import { ChevronLeftIcon } from "./components/icons";

interface PanelNav {
  /** what Back goes to ("Interlinear: Genesis 1:1"), or null when there is nothing to go back to */
  backLabel: string | null;
  back: () => void;
}

export const PanelNavContext = createContext<PanelNav>({ backLabel: null, back: () => {} });

/** Sits first in a side panel's header; shows nothing unless the panel was reached from another one. */
export function PanelBack() {
  const nav = useContext(PanelNavContext);
  if (!nav.backLabel) return null;
  return (
    <button type="button" className="panel-back" onClick={nav.back} title={`Back to ${nav.backLabel}`} aria-label={`Back to ${nav.backLabel}`}>
      <ChevronLeftIcon size={14} /> <span>{nav.backLabel}</span>
    </button>
  );
}
