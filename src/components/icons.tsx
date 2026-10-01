// Small inline SVG icon set. Inline SVG renders identically on every platform,
// unlike the Unicode glyphs previously used (⌕ 🖶 ⛓ ⇄), which fall back to
// mismatched system emoji/symbol fonts on Windows and often show as boxes.

interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number | undefined, className: string | undefined) {
  return {
    width: size ?? 16,
    height: size ?? 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className,
  };
}

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const HomeIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="m3 11 9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </svg>
);

export const BackIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const PrintIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M6 9V3h12v6" />
    <rect x="6" y="14" width="12" height="7" />
    <path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
  </svg>
);

export const SheetIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
    <path d="M8 13h8M8 17h5" />
  </svg>
);

export const GripIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </svg>
);

export const PlayIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
);

export const PauseIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M8 5v14M16 5v14" />
  </svg>
);

export const SpeakerIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 9v6h4l5 4V5L8 9z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);

export const BasketIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 10h16l-1.6 9.2a1 1 0 0 1-1 .8H6.6a1 1 0 0 1-1-.8z" />
    <path d="m8 10 3-6M16 10l-3-6" />
    <path d="M9.5 14v3M14.5 14v3" />
  </svg>
);

export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const LinkIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

export const CompareIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M16 3h5v5" />
    <path d="M21 3 4 20" />
    <path d="M8 21H3v-5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export const MenuIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
);

export const TreeIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M12 7.5V12" />
    <path d="M12 12 6 16.5" />
    <path d="m12 12 6 4.5" />
  </svg>
);

export const StarIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);

export const BookIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export const MapIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
    <path d="M9 3v15" />
    <path d="M15 6v15" />
  </svg>
);

// A time axis with Adams' century pillars standing on it -- the chart's own visual motif.
export const TimelineIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M2 14h20" />
    <path d="M6 14V9" />
    <path d="M12 14V5" />
    <path d="M18 14v-7" />
    <path d="M4 18h16" />
  </svg>
);

export const UsersIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const MoreIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </svg>
);

export const BookmarkIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
);

export const HighlightIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="m9 11-5 5v3h3l5-5" />
    <path d="m14 4 6 6-8 8-6-6z" />
  </svg>
);

export const NoteIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13 7 4 4" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

export const InterlinearIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 6h16" />
    <path d="M4 10h10" />
    <path d="M4 15h16" />
    <path d="M4 19h10" />
  </svg>
);

export const DictionaryIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" />
    <path d="M4 17a3 3 0 0 1 3-3h11" />
    <path d="m9 11 2-5 2 5" />
    <path d="M9.8 9h2.4" />
  </svg>
);

export const NotebookIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 3v18" />
    <path d="M12 8h4" />
    <path d="M12 12h4" />
  </svg>
);

export const TagIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M3 12V4h8l9 9-8 8z" />
    <circle cx="7.5" cy="8.5" r="1.2" />
  </svg>
);

export const FocusIcon = (p: IconProps) => (
  <svg {...base(p.size, p.className)}>
    <path d="M4 9V4h5" />
    <path d="M20 9V4h-5" />
    <path d="M4 15v5h5" />
    <path d="M20 15v5h-5" />
  </svg>
);
