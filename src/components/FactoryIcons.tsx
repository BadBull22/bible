// Content Factory: the small line icons of the tool bar and buttons (one stroke weight, drawn in the text colour).

import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  text: (
    <>
      <path d="M4 6V4h16v2" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </>
  ),
  look: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.4-1-1.7-1-2.8 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7" r="1" />
      <circle cx="15" cy="7" r="1" />
    </>
  ),
  photos: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-8 9" />
    </>
  ),
  sizes: (
    <>
      <path d="M6 3v15h15" />
      <path d="M3 6h15v15" />
    </>
  ),
  brand: (
    <>
      <path d="M4 20V6l8-3 8 3v14" />
      <path d="M9 20v-6h6v6" />
      <path d="M12 9v2" />
    </>
  ),
  header: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="3" y="4" width="18" height="5" fill="currentColor" stroke="none" />
    </>
  ),
  footer: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="3" y="15" width="18" height="5" fill="currentColor" stroke="none" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M11 18.5h2" />
    </>
  ),
  post: (
    <>
      <path d="M21 3 10 14" />
      <path d="m21 3-7 18-4-7-7-4 18-7Z" />
    </>
  ),
  library: (
    <>
      <rect x="3" y="4" width="7" height="7" rx="1" />
      <rect x="14" y="4" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </>
  ),
  dock: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  save: (
    <>
      <path d="M5 3h11l3 3v15H5V3Z" />
      <path d="M8 3v5h7V3" />
      <path d="M8 21v-7h8v7" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  play: <path d="m7 4 13 8-13 8V4Z" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 11 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="fx-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** A little window with the tool bar shown on one side: the buttons that move the tool bar. */
export function DockGlyph({ side, size = 16 }: { side: "left" | "right" | "top" | "bottom"; size?: number }) {
  const bar =
    side === "left" ? <rect x="3" y="4" width="6" height="16" fill="currentColor" stroke="none" /> :
    side === "right" ? <rect x="15" y="4" width="6" height="16" fill="currentColor" stroke="none" /> :
    side === "top" ? <rect x="3" y="4" width="18" height="6" fill="currentColor" stroke="none" /> :
    <rect x="3" y="14" width="18" height="6" fill="currentColor" stroke="none" />;
  return (
    <svg className="fx-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {bar}
    </svg>
  );
}
