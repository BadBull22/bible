// Content Factory: the little colour palette on the left of the picture, like the one in Paint. Choose a text on the picture (the words, the reference
// under them, the header's text or the footer's text) and click a colour; "Automatic" gives it back to the app, which picks white or dark by what is behind it.
// Under the usual colours are some taken from the picture itself, so the text can match it.

export type PaletteTarget = "words" | "reference" | "header" | "footer";

const SWATCHES = ["#ffffff", "#f6dea0", "#ffd166", "#ff9f43", "#ff6b6b", "#e63946", "#f78fb3", "#c084fc", "#7c5cff", "#4dabf7", "#22d3ee", "#2ee6a6", "#8bd450", "#1d1a16", "#14213d", "#8a8a8a"];

const LABEL: Record<PaletteTarget, string> = {
  words: "The words",
  reference: "The reference",
  header: "Header text",
  footer: "Footer text",
};

interface Props {
  /** what the colour is for; none while nothing is chosen on the picture */
  target: PaletteTarget | null;
  /** its colour now (none: automatic) */
  value: string | undefined;
  onPick: (colour: string | undefined) => void;
  /** the words have two colours, their own and the reference's: a choice between them */
  verse: boolean;
  onTarget: (t: "words" | "reference") => void;
  /** colours that belong to the picture */
  fromPicture: string[];
}

export function FactoryPalette(p: Props) {
  const off = !p.target;
  const swatch = (c: string, title: string) => (
    <button key={c} type="button" className={"fx-swatch" + (p.value?.toLowerCase() === c.toLowerCase() ? " on" : "")} style={{ background: c }} disabled={off} onClick={() => p.onPick(c)} title={title} aria-label={title} />
  );
  return (
    <aside className={"fx-palette" + (off ? " idle" : "")} aria-label="Text colours">
      <strong className="fx-pal-title">Colour</strong>
      <span className="fx-pal-for">{p.target ? LABEL[p.target] : "Click a text on the picture"}</span>
      {p.verse && p.target && (
        <div className="fx-pal-tabs" role="tablist" aria-label="Which colour of the words">
          <button type="button" role="tab" aria-selected={p.target === "words"} className={p.target === "words" ? "on" : ""} onClick={() => p.onTarget("words")}>
            Words
          </button>
          <button type="button" role="tab" aria-selected={p.target === "reference"} className={p.target === "reference" ? "on" : ""} onClick={() => p.onTarget("reference")} title="The line under the words, and the small line over them">
            Ref
          </button>
        </div>
      )}
      <div className="fx-swatches">{SWATCHES.map((c) => swatch(c, c))}</div>
      {p.fromPicture.length > 0 && (
        <>
          <span className="fx-pal-sub">From the picture</span>
          <div className="fx-swatches">{p.fromPicture.map((c) => swatch(c, `${c}, from the picture`))}</div>
        </>
      )}
      <label className="fx-pal-custom" title="Any colour">
        <span>Other…</span>
        <input type="color" value={p.value && /^#[0-9a-f]{6}$/i.test(p.value) ? p.value : "#ffffff"} onChange={(e) => p.onPick(e.target.value)} disabled={off} aria-label="Choose any colour" />
      </label>
      <button type="button" className="link-btn" onClick={() => p.onPick(undefined)} disabled={off} title="Let the app choose: white or dark, by what is behind the text">
        Automatic
      </button>
    </aside>
  );
}
