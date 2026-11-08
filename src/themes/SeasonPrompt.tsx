import { declineSeason, effectiveLook, keepSeason, useThemeState } from "./themeStore";

/** The one question near a season: the app has switched to the seasonal look; keep it, or go back to the default look?
 * Closing it with the cross keeps the look for now (nothing is lost; the reader can still change it in Settings). */
export function SeasonPrompt() {
  const e = effectiveLook(useThemeState());
  if (!e.pending || !e.look) return null;
  return (
    <div className="season-prompt" role="region" aria-label="Seasonal theme">
      <p>
        <strong>{e.look.lead}.</strong> We have switched to the {e.look.name} theme. Keep it, or go back to the default theme?
      </p>
      <div className="season-prompt-actions">
        <button className="pill-btn small" onClick={keepSeason}>
          Keep it
        </button>
        <button className="outline-btn" onClick={declineSeason}>
          Go back to the default theme
        </button>
      </div>
      <button className="season-prompt-close" onClick={keepSeason} aria-label="Close: keep the seasonal theme for now" title="Close (keeps the theme for now)">
        ×
      </button>
    </div>
  );
}
