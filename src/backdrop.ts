// A window with a dark background that closes when the background is clicked. A click counts only when the mouse was pressed
// AND let go on the background: dragging to select text in the window and letting go outside it is no click on the
// background (the browser reports it as one, on the thing both are inside), and used to close the window.
import type { MouseEvent } from "react";

let pressedOnBackground = false;

/** Spread onto the background: `<div className="mp-backdrop" {...backdrop(onClose)}>`. */
export function backdrop(onClose: () => void) {
  return {
    onMouseDown: (e: MouseEvent) => {
      pressedOnBackground = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent) => {
      const close = pressedOnBackground && e.target === e.currentTarget;
      pressedOnBackground = false;
      if (close) onClose();
    },
  };
}
