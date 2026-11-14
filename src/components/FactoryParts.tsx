// Content Factory: the small parts of its screen (a look's thumbnail, the names for the bottom-left corner, the closed
// "Advanced" section where the small site mark can be changed or removed).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { drawCard, PictureBank } from "../factory/draw";
import { BandConfig, Card, DEFAULT_CUT, FooterSettings, LogoCut, SIZES, SITE_MARK, SizeInfo } from "../factory/types";
import { cutLogo, inspectLogo, shrinkImage } from "../factory/logo";
import { FactorySettings } from "../factory/store";

/** One card drawn small onto a canvas. Drawn full size and scaled down, so it is exactly what will be saved. With `lazy` it is only drawn once it scrolls into view. */
export function ThumbCanvas({ card, size, footer, bank, rev, credit, width, label, lazy }: { card: Card; size: SizeInfo; footer: FooterSettings; bank: PictureBank; rev: number; credit: string | null; width: number; label?: string; lazy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(!lazy);
  useEffect(() => {
    const c = ref.current;
    if (seen || !c || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "120px" });
    io.observe(c);
    return () => io.disconnect();
  }, [seen]);
  useEffect(() => {
    const c = ref.current;
    if (!c || !seen) return;
    const full = document.createElement("canvas");
    full.width = size.w;
    full.height = size.h;
    const fctx = full.getContext("2d", { willReadFrequently: true })!;
    drawCard(fctx, card, size.w, size.h, { footer, bank, credit: credit ? { text: credit } : null });
    const k = width / size.w;
    c.width = Math.round(size.w * k);
    c.height = Math.round(size.h * k);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, c.width, c.height);
  }, [card, size, footer, bank, rev, credit, width, seen]);
  // until it is drawn, the canvas already has the right shape
  return <canvas ref={ref} width={Math.round(width)} height={Math.round((width * size.h) / size.w)} aria-label={label ?? "A picture"} />;
}

/** A card drawn small, as a button. */
export function Thumb({ card, size, footer, bank, rev, credit, width, label, on, onClick }: { card: Card; size: SizeInfo; footer: FooterSettings; bank: PictureBank; rev: number; credit: string | null; width: number; label?: string; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={"factory-thumb" + (on ? " on" : "")} onClick={onClick} aria-pressed={on} title={label}>
      <ThumbCanvas card={card} size={size} footer={footer} bank={bank} rev={rev} credit={credit} width={width} label={label} />
      {label && <span>{label}</span>}
    </button>
  );
}

/** The names a picture can carry in the footer bar: a few chips, one of them the usual, and a place to add one. */
export function NamesBox({ settings, onPatch }: { settings: FactorySettings; onPatch: (p: Partial<FactorySettings>) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const n = text.trim();
    if (!n || settings.names.includes(n)) return;
    onPatch({ names: [...settings.names, n], asked: true });
    setText("");
  };
  const remove = (i: number) => {
    const names = settings.names.filter((_, k) => k !== i);
    onPatch({ names, defaultName: Math.max(0, Math.min(settings.defaultName - (i < settings.defaultName ? 1 : 0), names.length - 1)) });
  };
  return (
    <div className="fx-names" aria-label="Names for your pictures">
      <div className="fx-namechips">
        {settings.names.length === 0 && <span className="muted">No name yet.</span>}
        {settings.names.map((n, i) => (
          <span key={n} className={"fx-namechip" + (settings.defaultName === i ? " on" : "")}>
            <button type="button" onClick={() => onPatch({ defaultName: i })} aria-pressed={settings.defaultName === i} title={settings.defaultName === i ? "The usual name" : "Use this name on every picture"}>
              {n}
            </button>
            <button type="button" className="x" onClick={() => remove(i)} aria-label={`Remove ${n}`} title="Remove">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="factory-row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add a name, e.g. Pastor Sam" aria-label="A name to add" maxLength={60} />
        <button type="button" className="outline-btn" onClick={add} disabled={!text.trim()}>
          Add
        </button>
      </div>
      <label className="fx-inline-field">
        <span>A word before it</span>
        <select value={settings.namePrefix} onChange={(e) => onPatch({ namePrefix: e.target.value })} aria-label="A word before the name">
          <option value="">None: just the name</option>
          <option value="by ">by …</option>
          <option value="Shared by ">Shared by …</option>
          <option value="From ">From …</option>
        </select>
      </label>
    </div>
  );
}

/** The closed "More" section of the footer: the small website mark and where the footer sits in tall pictures. Low key on purpose. */
export function AdvancedBox({ settings, onPatch }: { settings: FactorySettings; onPatch: (p: Partial<FactorySettings>) => void }) {
  const mark = settings.mark;
  return (
    <details className="factory-advanced">
      <summary>More: the website mark and tall pictures</summary>
      <div className="fx-advanced-body">
        <div className="fx-brow">
          <span>Website mark</span>
          <Segmented
            label="The small website mark"
            value={mark.kind}
            onChange={(k) => onPatch({ mark: { kind: k, text: mark.text } })}
            options={[
              { id: "site", label: SITE_MARK, title: "Helps other people find the free app" },
              { id: "custom", label: "My own" },
              { id: "none", label: "Nothing" },
            ]}
          />
        </div>
        {mark.kind === "custom" && <input value={mark.text} onChange={(e) => onPatch({ mark: { kind: "custom", text: e.target.value } })} placeholder="e.g. mychurch.org or @mychurch" aria-label="Your own text for the website mark" maxLength={40} />}
        <div className="fx-brow">
          <span>Tall pictures</span>
          <Segmented
            label="Where the footer sits in Story, Reel, Status and TikTok sizes"
            value={settings.place}
            onChange={(p) => onPatch({ place: p })}
            options={[
              { id: "safe", label: "Above the buttons", title: "Those apps lay their own buttons over the bottom of the screen, so the footer sits a little higher" },
              { id: "edge", label: "At the edge" },
            ]}
          />
        </div>
      </div>
    </details>
  );
}

/** the sites a finished picture is posted on (opened in the browser: the app never posts by itself) */
export const SITES = [
  { name: "WhatsApp", url: "https://web.whatsapp.com/" },
  { name: "Facebook", url: "https://www.facebook.com/" },
  { name: "Instagram", url: "https://www.instagram.com/" },
  { name: "YouTube", url: "https://studio.youtube.com/" },
  { name: "TikTok", url: "https://www.tiktok.com/upload" },
];

export const shortSize = (s: SizeInfo) => (s.id === "story" ? "Story" : s.id === "link" ? "Link" : s.label);
export const ALL_SIZES = SIZES;

type PicMode = "none" | "logo" | "banner";
const picOf = (k: BandConfig["kind"]): PicMode => (k === "logo" || k === "logotext" ? "logo" : k === "picture" ? "banner" : "none");
/** the kind of band that goes with a choice of picture and some text */
const withKind = (b: BandConfig, pic: PicMode, text: string): BandConfig => {
  const t = text.trim().length > 0;
  return { ...b, text, kind: pic === "banner" ? "picture" : pic === "logo" ? (t ? "logotext" : "logo") : t ? "text" : "none" };
};

/**
 * The header and the footer are set up the same way: a picture (a logo or a wide banner) and some text, a strip behind them (none, black, soft or a
 * colour), a size and where they sit. A logo with a plain black or white background can have the background taken off, so it sits on the strip or the
 * picture cleanly. In the footer the same choices style the footer bar, which always holds the credit, the name and the website mark.
 */
export interface PlaceInfo {
  /** has the picture on show given the logo or the text a place of its own */
  own: boolean;
  /** is there a saved default place for either */
  saved: boolean;
  onSaveDefault: () => void;
  onUseDefault: () => void;
  onBackToStrip: () => void;
}

export function BandPanel({ which, settings, onPatch, place }: { which: "header" | "footer"; settings: FactorySettings; onPatch: (p: Partial<FactorySettings>) => void; place?: PlaceInfo }) {
  const bandKey = which === "header" ? "header" : "footerBand";
  const imageKey = which === "header" ? "headerImage" : "footerImage";
  const origKey = which === "header" ? "headerOrig" : "footerOrig";
  const band: BandConfig = settings[bandKey];
  const image = settings[imageKey];
  const orig = settings[origKey];
  const cut = band.cut ?? DEFAULT_CUT;
  const pic = picOf(band.kind);
  const on = band.on !== false;
  const seq = useRef(0);
  const [note, setNote] = useState("");
  const setBand = (b: BandConfig) => onPatch({ [bandKey]: b } as Partial<FactorySettings>);
  const content = "fx-brow fx-content";
  const always = which === "footer" ? "fx-brow" : content;

  /** the picture that is drawn: the one chosen, or the same with its background taken off */
  const redraw = async (o: string, c: LogoCut) => {
    const mine = ++seq.current;
    const drawn = c.on && o ? await cutLogo(o, c).catch(() => o) : o;
    if (mine === seq.current) onPatch({ [imageKey]: drawn, [origKey]: o } as Partial<FactorySettings>);
  };
  const choose = async (file: File) => {
    const d = await shrinkImage(file, pic === "banner" ? "picture" : "logo");
    if (!d) {
      setNote("That picture could not be opened. Use a JPEG or PNG.");
      return;
    }
    let c: LogoCut = { ...cut, on: false };
    setNote("");
    if (pic === "logo") {
      const info = await inspectLogo(d);
      c = { ...cut, on: info.plain };
      if (info.plain) setNote(`The logo's ${info.colour} background is taken off. Untick “Take off the background” to keep it.`);
    }
    setBand({ ...band, cut: c });
    await redraw(d, c);
  };
  const changeCut = (c: LogoCut) => {
    setBand({ ...band, cut: c });
    void redraw(orig, c);
  };

  return (
    <div className={"fx-band" + (on ? "" : " off")}>
      <p className="muted fx-hint">{which === "header" ? "A band across the top of every picture: a logo or banner, and some text." : "The footer bar always holds the photo credit, your name and the website. Add your church's logo, banner or words to it here."}</p>
      <label className="factory-check fx-band-on">
        <input type="checkbox" checked={on} onChange={(e) => setBand({ ...band, on: e.target.checked })} /> {which === "header" ? "Show the header on my pictures" : "Add my logo, banner and church text"}
      </label>

      <div className={content}>
        <span>Picture</span>
        <Segmented
          label={`The ${which}'s picture`}
          value={pic}
          onChange={(m) => setBand(withKind(band, m, band.text))}
          options={[
            { id: "none", label: "None" },
            { id: "logo", label: "Logo", title: "A logo, small, beside the text" },
            { id: "banner", label: "Banner", title: "A wide picture across the whole width" },
          ]}
        />
      </div>
      {pic !== "none" && (
        <div className={content}>
          <span />
          <span className="fx-pickrow">
            {image && <img className="factory-logo-preview fx-checker" src={image} alt="" />}
            <label className="outline-btn factory-file fx-small">
              {image ? "Change…" : "Choose a picture…"}
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void choose(f);
                  e.target.value = "";
                }}
              />
            </label>
            {image && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setNote("");
                  onPatch({ [imageKey]: "", [origKey]: "" } as Partial<FactorySettings>);
                }}
              >
                Remove
              </button>
            )}
          </span>
        </div>
      )}
      {pic === "logo" && image && (
        <div className="fx-cut fx-content">
          <label className="factory-check" title="For a logo on a plain white or black background: the background goes see-through, so only the logo sits on the strip or the picture">
            <input type="checkbox" checked={cut.on} onChange={(e) => changeCut({ ...cut, on: e.target.checked })} /> Take off the logo's background
          </label>
          {cut.on && (
            <div className="fx-cut-more">
              <label className="fx-slider fx-slim">
                <span>
                  How much <em>{cut.tolerance}%</em>
                </span>
                <input type="range" min={0} max={100} step={2} value={cut.tolerance} onChange={(e) => changeCut({ ...cut, tolerance: Number(e.target.value) })} aria-label="How much of the background to take off" />
              </label>
              <label className="factory-check" title="Also take away the background colour inside letters and shapes">
                <input type="checkbox" checked={cut.holes} onChange={(e) => changeCut({ ...cut, holes: e.target.checked })} /> Inside the letters too
              </label>
            </div>
          )}
        </div>
      )}
      {place && ((pic === "logo" && image) || band.text.trim()) && (
        <div className="fx-place fx-content">
          <p className="muted fx-hint">Drag the logo or the text on the picture to place them. Arrow keys nudge the one that is chosen; a corner makes it bigger or smaller; the palette on the left of the picture colours a text.</p>
          <span className="fx-pickrow">
            <button type="button" className="outline-btn fx-small" onClick={place.onSaveDefault} disabled={!place.own && !place.saved} title={`Every picture, now and later, gets the ${which}'s logo and text where they are on this one`}>
              Save {which} as default
            </button>
            <button type="button" className="outline-btn fx-small" onClick={place.onUseDefault} disabled={!place.own} title="Give this picture the default places again">
              Use the default here
            </button>
            <button type="button" className="link-btn" onClick={place.onBackToStrip} disabled={!place.own && !place.saved} title="Put the logo and the text back in the strip, on every picture">
              Back in the strip
            </button>
          </span>
          <span className="muted fx-hint">{place.own ? "On this picture they have a place of their own." : place.saved ? "They are in the saved default place." : "They are in the strip."}</span>
        </div>
      )}
      {note && <p className="muted fx-hint">{note}</p>}

      <div className={content}>
        <span>Text</span>
        <input value={band.text} onChange={(e) => setBand(withKind(band, pic, e.target.value))} placeholder={which === "header" ? "e.g. Grace Community Church" : "e.g. Grace Community Church · Sundays 10:00"} maxLength={80} aria-label={`The text of the ${which}`} />
      </div>

      {(which === "footer" || pic !== "banner") && (
        <>
          <div className={always}>
            <span>Strip</span>
            <span className="fx-pickrow">
              <Segmented
                label={`The strip behind the ${which}`}
                value={band.style}
                onChange={(st) => setBand({ ...band, style: st })}
                options={[
                  { id: "clear", label: "None", title: "No strip: the words go straight on the picture" },
                  { id: "black", label: "Black" },
                  { id: "shade", label: "Soft", title: "A soft dark strip: the picture shows through" },
                  { id: "solid", label: "Colour" },
                ]}
              />
              {band.style === "solid" && <input type="color" value={band.color} onChange={(e) => setBand({ ...band, color: e.target.value })} aria-label={`The colour of the ${which}`} />}
            </span>
          </div>
          <div className={always}>
            <span>Size</span>
            <Segmented
              label={`The size of the ${which}`}
              value={band.size}
              onChange={(sz) => setBand({ ...band, size: sz })}
              options={[
                { id: "small", label: "Small" },
                { id: "medium", label: "Medium" },
                { id: "large", label: "Large" },
              ]}
            />
          </div>
        </>
      )}
      {(which === "footer" || pic !== "banner" || band.text.trim()) && (
        <div className={always}>
          <span>Placed</span>
          <Segmented
            label={`Where the ${which}'s text sits`}
            value={band.align}
            onChange={(a) => setBand({ ...band, align: a })}
            options={[
              { id: "left", label: "Left" },
              { id: "center", label: "Middle" },
              { id: "right", label: "Right" },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** A small menu that opens from a button and closes when something else is clicked or Esc is pressed. */
export function Popover({ label, icon, title, align = "left", up = false, className = "", children }: { label: ReactNode; icon?: ReactNode; title?: string; align?: "left" | "right"; up?: boolean; className?: string; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return (
    <div className={"fx-pop " + className} ref={box}>
      <button type="button" className="fx-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" title={title}>
        {icon}
        {label}
      </button>
      {open && <div className={`fx-pop-body ${align} ${up ? "up" : ""}`}>{typeof children === "function" ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

/** A row of buttons of which one is on (like tabs, but inside a panel). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="fx-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} className={value === o.id ? "on" : ""} disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
