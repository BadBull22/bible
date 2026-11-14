// More > Backup and restore: keeps what the reader has made (notes, highlights, bookmarks, reading plans, settings, and a Bible they added) safe and
// brings it back, on this phone or a new one. The file is the same as the computer's study backup, so either app can restore the other's.
// (The automatic copies, Share and "Restore latest" are added as the phone plugin gets their commands.)

import { lastText } from "./backupPlan";

interface Props {
  /** makes today's copy in Documents now */
  onBackUp: () => void;
  /** saves a backup file where the reader chooses */
  onSave: () => void;
  /** builds a backup and opens the share sheet */
  onShare: () => void;
  /** restores the newest backup this phone made (asks for a file only if there is none) */
  onRestoreLatest: () => void;
  /** asks for a backup file and restores from it */
  onRestore: () => void;
  /** when the last copy was made (ms), 0 if never; `stamp` changes when it does, so the line is drawn again */
  lastAt: number;
  stamp: number;
  /** what the last action did (or why it failed) */
  note: string | null;
}

export function BackupRestore({ onBackUp, onSave, onShare, onRestoreLatest, onRestore, lastAt, note }: Props) {
  return (
    <>
      <p className="hint">
        The phone makes a backup by itself, in Documents &gt; Bible Concordance backup, after you change a highlight, bookmark, note or setting. It keeps the last three days. It holds your notes, highlights, bookmarks, reading plans
        and settings, and the Bible you read if you added it yourself. Books, commentaries and picture packs are not in it: download them again from More. Restoring only adds what is missing; nothing you have now is removed.
      </p>
      <p className="hint">
        Last automatic backup: <strong>{lastText(lastAt, new Date())}</strong>
      </p>
      <div className="actions">
        <button onClick={onBackUp}>Back up now</button>
        <button onClick={onRestoreLatest}>Restore latest</button>
      </div>
      <div className="actions">
        <button onClick={onShare}>Share a backup</button>
        <button onClick={onSave}>Save a backup file</button>
        <button onClick={onRestore}>Restore from a file…</button>
      </div>
      {note && (
        <p className="hint status" role="status">
          {note}
        </p>
      )}
      <h3>On a new phone</h3>
      <ol className="hint">
        <li>Install Bible Concordance and open it once. If Google's backup is on, your last backup may already be there: press <strong>Restore latest</strong>.</li>
        <li>Otherwise put your backup file on the phone (from e-mail, WhatsApp, or the computer).</li>
        <li>Press <strong>Restore from a file…</strong> and choose it.</li>
      </ol>
      <p className="hint">The same file can be restored in the Windows app (My Study → Restore).</p>
    </>
  );
}
