// The timing of a slide show: how long each slide stays before the next comes by itself, whether it starts over at the end, and the
// fade between slides. Used on the notices and music pages (kept with the deck) and in the presenter (for this show).

import { AutoPlay, FADES } from "../autoplay";

interface Props {
  value: AutoPlay;
  onChange: (next: AutoPlay) => void;
}

export function AutoPlayBox({ value, onChange }: Props) {
  return (
    <div className="auto-box">
      <label className="auto-field">
        <span>Move on by itself after</span>
        <input
          type="number"
          min={0}
          max={600}
          value={value.seconds}
          onChange={(e) => onChange({ ...value, seconds: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })}
          aria-label="Seconds each slide stays"
        />
        <span>seconds</span>
        <span className="muted">(0: wait for a click)</span>
      </label>
      <label className="auto-field">
        <input type="checkbox" checked={value.loop} onChange={(e) => onChange({ ...value, loop: e.target.checked })} />
        <span>Start again at the end</span>
      </label>
      <label className="auto-field">
        <span>Fade between slides</span>
        <select value={value.fade} onChange={(e) => onChange({ ...value, fade: Number(e.target.value) })} aria-label="How the slides change">
          {FADES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
