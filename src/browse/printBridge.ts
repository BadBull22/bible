// The Print button in the top bar prints "this view". When a Browse page is open it must print that page (and not the whole window, search screen
// and all), and with the same options as the page's own "Print this page" button: so it opens the print menu (the picture, the words of the passages,
// large print, the colouring page...). When that menu is already open it prints with the options chosen there.
//
// Each piece of screen that knows how to print registers itself while it is open; the one opened last is asked first.

import { useEffect, useRef } from "react";

const stack: Array<() => void> = [];

/** What the top-bar Print button does for the Browse page on screen; false when no Browse page is open (the caller then prints the window as before). */
export function printBrowsePage(): boolean {
  const h = stack[stack.length - 1];
  if (!h) return false;
  h();
  return true;
}

/** While this is on screen, the Print button in the top bar calls `print` (the most recently opened one wins). */
export function useBrowsePrint(print: () => void) {
  const latest = useRef(print);
  latest.current = print;
  useEffect(() => {
    const h = () => latest.current();
    stack.push(h);
    return () => {
      const i = stack.lastIndexOf(h);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}
