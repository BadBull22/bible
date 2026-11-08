import { LOOK_GROUPS, LOOKS, lookBySlug } from "./occasions";
import { effectiveLook, setAppColour, setBackgroundFrom, setChosen, setFlag, setReadingBackground, setWordmarkFrom, useThemeState } from "./themeStore";
import { isHexColour, PALETTE, STANDARD } from "./palette";
import { MAX_SHORTCUTS } from "../shortcuts";
import { backToDefaultTiles, useShortcuts } from "../shortcutsStore";
import { showHighlightsAgain, useClosedHighlights } from "../highlights";

/** Settings > Appearance: the theme of the opening screen. A theme is a suggested wordmark and background; each can be mixed and matched. */
export function ThemeSettings() {
  const s = useThemeState();
  const chosen = lookBySlug(s.chosen);
  const showing = effectiveLook(s);
  const shortcuts = useShortcuts();
  const closedNotes = useClosedHighlights();
  return (
    <>
    <div className="theme-settings">
      <label>
        <span>Theme selection</span>
        <select value={s.chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Theme selection">
          <option value="default">Default theme (the plain coloured wordmark)</option>
          {LOOK_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {LOOKS.filter((l) => l.group === g).map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="search-hint">
        {chosen ? chosen.blurb : "The plain coloured Gospel wordmark. Near a season the app can switch to that season's theme and ask whether to keep it."}
        {showing.look && !chosen ? ` Showing now: ${showing.look.name}.` : ""}
      </p>

      <p className="theme-mix-heading">
        <strong>Mix and match.</strong> Picking a theme sets both of these. Change either one to build your own combination.
      </p>
      <label>
        <span>Wordmark</span>
        <select value={s.wordmarkFrom} onChange={(e) => setWordmarkFrom(e.target.value)} aria-label="Wordmark">
          <option value="theme">Same as the theme</option>
          <option value="none">The plain coloured Gospel wordmark</option>
          {LOOK_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {LOOKS.filter((l) => l.group === g && l.svg).map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        <span>Background</span>
        <select value={s.backgroundFrom} onChange={(e) => setBackgroundFrom(e.target.value)} aria-label="Background">
          <option value="theme">Same as the theme</option>
          <option value="none">A plain background</option>
          {LOOK_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {LOOKS.filter((l) => l.group === g).map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="search-hint">
        {showing.mixed
          ? `Showing: ${showing.wordmarkLook ? `the ${showing.wordmarkLook.name} wordmark` : "the plain wordmark"} on ${showing.screenLook ? `the ${showing.screenLook.name} background` : "a plain background"}.`
          : "The background is a theme's colours, small decorations and verse of the season."}
      </p>

      <label>
        <span>Background behind the Bible text</span>
        <select value={s.reading} onChange={(e) => setReadingBackground(e.target.value as "off" | "soft" | "full")} aria-label="Background behind the Bible text" disabled={!showing.screenLook}>
          <option value="off">None: the Bible text stays on plain paper</option>
          <option value="soft">Soft: a hint of the background (easiest to read)</option>
          <option value="full">Full: the whole background and its corner pictures</option>
        </select>
      </label>
      <p className="search-hint">
        {showing.screenLook
          ? "Shows the background above behind the Bible when you read a chapter. Your own paper colour is laid over it so that the text stays easy to read, and the reading font is never changed."
          : "Choose a background above first (a theme, or a background on its own), then it can show behind the Bible text too."}
      </p>

      <p className="theme-mix-heading">
        <strong>Colour of the app.</strong> Tints every window: the page, the panels and the bars. It is always softened to a pastel (a deep, muted shade in dark mode), and text keeps
        exactly the contrast it has now. Standard keeps the app's own colours.
      </p>
      <div className="app-colour" role="radiogroup" aria-label="Colour of the app">
        <button className="swatch standard" role="radio" aria-checked={s.appColour === STANDARD} onClick={() => setAppColour(STANDARD)}>
          Standard
        </button>
        {PALETTE.map((sw) => (
          <button
            key={sw.id}
            className="swatch"
            role="radio"
            aria-checked={s.appColour.toLowerCase() === sw.hex}
            aria-label={sw.name}
            title={sw.name}
            style={{ "--sw": sw.hex } as React.CSSProperties}
            onClick={() => setAppColour(sw.hex)}
          />
        ))}
        <label className="swatch custom" title="Choose any other colour (it is softened to a pastel)" aria-label="Choose another colour">
          <input type="color" value={isHexColour(s.appColour) ? s.appColour : "#cfe3f6"} onChange={(e) => setAppColour(e.target.value)} />
        </label>
      </div>

      <label className="set-check">
        <input type="checkbox" checked={s.seasonal} disabled={s.keep} onChange={(e) => setFlag("seasonal", e.target.checked)} />
        <span>Switch to a seasonal theme near its season, and ask whether to keep it</span>
      </label>
      <label className="set-check">
        <input type="checkbox" checked={s.keep} onChange={(e) => setFlag("keep", e.target.checked)} />
        <span>Keep my selection as the default and never change it</span>
      </label>
      <p className="search-hint">
        With this on, whatever is selected above stays as it is: no theme is ever switched for a season, and nothing asks. A theme is only a
        suggested combination of colours, a wordmark and small decorations for the opening screen. You can still choose light or dark, the text colour and the fonts yourself below. No theme ever changes your Bible reading font.
      </p>
    </div>
    <div className="theme-shortcuts">
      <strong>Shortcuts on the opening screen</strong>
      <p className="muted">
        {shortcuts.custom
          ? `You have placed ${shortcuts.ids.length} of ${MAX_SHORTCUTS}. Use the + on the opening screen to add more, or the × on a shortcut to remove it.`
          : `The six tiles under the search box are the default. Use "Make these your own" on the opening screen to put up to ${MAX_SHORTCUTS} shortcuts of your own there instead.`}
      </p>
      {shortcuts.custom && (
        <button className="text-btn" onClick={backToDefaultTiles}>
          Back to the default tiles
        </button>
      )}
      <p className="muted">
        New features are mentioned in a small note on the opening screen, which you can close with the ×.
        {closedNotes.length > 0 ? " " : " They are showing now."}
      </p>
      {closedNotes.length > 0 && (
        <button className="text-btn" onClick={showHighlightsAgain}>
          Show the notes about new features again
        </button>
      )}
    </div>
    </>
  );
}
