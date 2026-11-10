// Themes on the phone (since 3.0.0), the same as on the computer: a theme is a themed "Gospel" wordmark and a background (colours, small decorations,
// a glow, the verse of the season) that go together; they can be mixed and matched; near a season the app switches to that season's theme and asks
// whether to keep it; and the reader may tint the whole app with a colour of their own. The theme code, the wordmark pictures, the screen packages
// and the verses are the desktop's own files (src/themes), used from their source. A theme never changes the Bible reading font.

import { useRef, type CSSProperties, type ReactNode } from "react";
import { LOOK_GROUPS, LOOKS } from "../../src/themes/occasions";
import { declineSeason, effectiveLook, keepSeason, setAppColour, setBackgroundFrom, setChosen, setFlag, setReadingBackground, setWordmarkFrom, useThemeState } from "../../src/themes/themeStore";
import { hslToRgb, isHexColour, PALETTE, STANDARD, toHex, toHsl, parseHex } from "../../src/themes/palette";
import "../../src/themes/themes.css";

/** What the theme says to put on the app right now (the attributes the desktop's screen packages read). */
export function useLook() {
  return effectiveLook(useThemeState());
}

/** The one question near a season: the app has switched to the seasonal theme; keep it, or go back to the default theme? */
function SeasonPrompt() {
  const e = useLook();
  if (!e.pending || !e.look) return null;
  return (
    <div className="season-prompt" role="region" aria-label="Seasonal theme">
      <p>
        <strong>{e.look.lead}.</strong> We have switched to the {e.look.name} theme. Keep it, or go back to the default theme?
      </p>
      <div className="season-prompt-actions">
        <button className="browse-pill" onClick={keepSeason}>
          Keep it
        </button>
        <button className="browse-pill quiet" onClick={declineSeason}>
          Go back to the default theme
        </button>
      </div>
      <button className="season-prompt-close" onClick={keepSeason} aria-label="Close: keep the seasonal theme for now">
        ×
      </button>
    </div>
  );
}

/**
 * The Search page before anything is searched, as the computer's opening screen: the Gospel wordmark (the theme's own picture, or the coloured
 * letters), the search box under it, the theme's verse of the season, the one question near a season, and the recent searches. Once a search is
 * made this page gives way to the results, with the search box back at the top.
 */
export function HomeScreen({
  typed,
  setTyped,
  onSubmit,
  select,
  recent,
  onRecent,
  onClearRecent,
  onLook,
  resume,
  enterHint,
}: {
  typed: string;
  setTyped: (v: string) => void;
  onSubmit: () => void;
  /** the translation chooser, beside the box */
  select: ReactNode;
  recent: string[];
  onRecent: (q: string) => void;
  onClearRecent: () => void;
  onLook: () => void;
  /** "Continue reading: John 2": back to the reader where the reader left off */
  resume: { label: string; go: () => void };
  enterHint: "go" | "search";
}) {
  const look = useLook();
  const box = useRef<HTMLInputElement>(null);
  const verse = look.screenLook?.verse ?? null;
  return (
    <div className="home-screen" data-occasion={look.screenLook?.slug} data-screen={look.screenOn ? "on" : undefined} data-glow={look.defaultGlow ? "default" : undefined}>
      <div className="home-box">
        <h1 className={look.art ? "gospel-wordmark has-art" : "gospel-wordmark"} aria-label="Gospel" onClick={() => box.current?.focus()}>
          {look.art ? (
            // the theme's own wordmark (a trusted SVG that ships with the app); the real text "Gospel" stays in the label above
            <span className="wordmark-art" data-wm={look.wordmarkLook?.slug} aria-hidden="true" dangerouslySetInnerHTML={{ __html: look.art }} />
          ) : (
            ["G", "o", "s", "p", "e", "l"].map((letter, i) => (
              <span key={i} aria-hidden="true">
                {letter}
              </span>
            ))
          )}
        </h1>
        <form
          className="home-search-box"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            ref={box}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type a reference, a story, or a theme…"
            aria-label="Go to a passage, or search the Bible"
            enterKeyHint={enterHint}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {typed && (
            <button type="button" className="clear" onClick={() => setTyped("")} aria-label="Clear">
              ×
            </button>
          )}
          {select}
        </form>
        <SeasonPrompt />
        {verse && (
          <p className="occ-verse">
            “{verse.text}”<cite>{verse.ref} (BSB)</cite>
          </p>
        )}
        <p className="home-look-line">
          Theme: {look.look ? look.look.name : "Default"} ·{" "}
          <button className="link" onClick={onLook}>
            Change the theme
          </button>
        </p>
        <button className="browse-pill home-resume" onClick={resume.go}>
          Continue reading: {resume.label}
        </button>
        {recent.length > 0 && (
          <div className="home-recent" role="group" aria-label="Recent searches">
            <span className="muted">Recent</span>
            {recent.slice(0, 5).map((r) => (
              <button key={r} className="browse-pill quiet" onClick={() => onRecent(r)}>
                {r}
              </button>
            ))}
            <button className="link" onClick={onClearRecent}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A colour wheel of our own (the phone's built-in colour picker is not dependable in a web view): the angle is the hue, the distance from the middle
 * the strength of the colour. The app softens whatever is chosen to a pastel, so every point is a good choice. */
function ColourWheel({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const ring = useRef<HTMLDivElement>(null);
  const [h, s] = toHsl(parseHex(isHexColour(value) ? value : "#cfe3f6"));
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ring.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    const radius = r.width / 2;
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
    const sat = Math.min(1, Math.hypot(x, y) / radius);
    onPick(toHex(hslToRgb(hue, sat, 0.6)));
  };
  const rad = ((h - 90) * Math.PI) / 180;
  const dot: CSSProperties = { left: `${50 + Math.cos(rad) * s * 50}%`, top: `${50 + Math.sin(rad) * s * 50}%` };
  return (
    <div
      ref={ring}
      className="colour-wheel"
      role="slider"
      aria-label="Colour of the app: drag round the wheel"
      aria-valuetext={isHexColour(value) ? value : "Standard"}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => e.buttons > 0 && at(e)}
    >
      {isHexColour(value) && <i className="colour-dot" style={dot} />}
    </div>
  );
}

/** More > Appearance > Theme and colours: the theme, a wordmark and a background that can be picked on their own, the background behind the Bible text,
 * the colour of the app, and the two switches for seasons. Rows and controls only: no paragraphs. */
export function ThemeSettings() {
  const s = useThemeState();
  const showing = effectiveLook(s);
  const groups = (only?: (l: (typeof LOOKS)[number]) => boolean) =>
    LOOK_GROUPS.map((g) => (
      <optgroup key={g} label={g}>
        {LOOKS.filter((l) => l.group === g && (!only || only(l))).map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </optgroup>
    ));
  return (
    <div className="theme-settings">
      <label className="row">
        <span>Theme</span>
        <select className="select-field" value={s.chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Theme selection">
          <option value="default">Default theme</option>
          {groups()}
        </select>
      </label>
      <label className="row">
        <span>Wordmark</span>
        <select className="select-field" value={s.wordmarkFrom} onChange={(e) => setWordmarkFrom(e.target.value)} aria-label="Wordmark">
          <option value="theme">Same as the theme</option>
          <option value="none">The plain coloured Gospel</option>
          {groups((l) => !!l.svg)}
        </select>
      </label>
      <label className="row">
        <span>Background</span>
        <select className="select-field" value={s.backgroundFrom} onChange={(e) => setBackgroundFrom(e.target.value)} aria-label="Background">
          <option value="theme">Same as the theme</option>
          <option value="none">A plain background</option>
          {groups()}
        </select>
      </label>
      <label className="row">
        <span>Behind the Bible text</span>
        <select className="select-field" value={s.reading} onChange={(e) => setReadingBackground(e.target.value as "off" | "soft" | "full")} aria-label="Background behind the Bible text" disabled={!showing.screenLook}>
          <option value="off">None</option>
          <option value="soft">Soft</option>
          <option value="full">Full</option>
        </select>
      </label>
      <p className="row-label">Colour of the app</p>
      <div className="app-colour" role="radiogroup" aria-label="Colour of the app">
        <button className="swatch standard" role="radio" aria-checked={s.appColour === STANDARD} onClick={() => setAppColour(STANDARD)}>
          Standard
        </button>
        {PALETTE.map((sw) => (
          <button key={sw.id} className="swatch" role="radio" aria-checked={s.appColour.toLowerCase() === sw.hex} aria-label={sw.name} title={sw.name} style={{ "--sw": sw.hex } as CSSProperties} onClick={() => setAppColour(sw.hex)} />
        ))}
      </div>
      <ColourWheel value={s.appColour} onPick={setAppColour} />
      <label className="check">
        <input type="checkbox" checked={s.seasonal} disabled={s.keep} onChange={(e) => setFlag("seasonal", e.target.checked)} /> Switch to a seasonal theme near its season
      </label>
      <label className="check">
        <input type="checkbox" checked={s.keep} onChange={(e) => setFlag("keep", e.target.checked)} /> Keep my selection, never change it
      </label>
    </div>
  );
}
