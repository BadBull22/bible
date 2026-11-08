import { MAX_SHORTCUTS, ShortcutTarget } from "../shortcuts";

interface Props {
  targets: ShortcutTarget[];
  /** ids already placed */
  placed: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}

/** "Add a shortcut": everything the menus open (and the default tiles that go somewhere), grouped, minus what is already placed. */
export function ShortcutPicker({ targets, placed, onPick, onClose }: Props) {
  const free = targets.filter((t) => !placed.includes(t.id));
  const groups = [...new Set(free.map((t) => t.group))];
  return (
    <div className="shortcut-picker" role="dialog" aria-label="Add a shortcut">
      <div className="shortcut-picker-head">
        <strong>Add a shortcut</strong>
        <span className="muted">
          {placed.length} of {MAX_SHORTCUTS} placed
        </span>
        <button className="text-btn" onClick={onClose}>
          Close
        </button>
      </div>
      {groups.length === 0 && <p className="muted">Everything is already placed.</p>}
      {groups.map((g) => (
        <section key={g}>
          <p className="set-section">{g}</p>
          <div className="shortcut-picker-list">
            {free
              .filter((t) => t.group === g)
              .map((t) => (
                <button key={t.id} className="shortcut-pick" onClick={() => onPick(t.id)}>
                  <span className="shortcut-pick-glyph">{t.value ?? t.icon}</span>
                  <span className="shortcut-pick-text">
                    <strong>{t.label}</strong>
                    <small>{t.sub}</small>
                  </span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
