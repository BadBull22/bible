// The phone remote's window inside the presenter: switch it on, show the QR code and the address a phone opens, switch it off.
// The phone then works Next, Back, Black and "hide the words" from a small web page this computer serves on the home
// Wi-Fi (src-tauri/src/remote.rs). Nothing goes through the internet.

import type { RemoteInfo } from "../api";

interface Props {
  /** null while the remote is off */
  info: RemoteInfo | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}

export function PhoneRemote({ info, busy, error, onStart, onStop, onClose }: Props) {
  return (
    <div className="remote-overlay" role="dialog" aria-modal="true" aria-label="Phone remote" onClick={onClose}>
      <div className="remote-box" onClick={(e) => e.stopPropagation()}>
        <header className="remote-head">
          <h3>Phone remote</h3>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {!info ? (
          <>
            <p>
              Use your phone as the clicker: <strong>Next</strong>, <strong>Back</strong>, <strong>Black</strong> and <strong>Hide the words</strong>, with the slide and your notes on the phone.
              Nothing to install on the phone, and nothing goes through the internet: it works over the Wi-Fi this computer is on.
            </p>
            <p className="muted">It is off until you switch it on here, and it stops when the show ends.</p>
            {error && <p className="status-error">{error}</p>}
            <button className="pill-btn" onClick={onStart} disabled={busy}>
              {busy ? "Switching on…" : "Switch the phone remote on"}
            </button>
          </>
        ) : (
          <>
            <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qr_svg }} aria-label="QR code for the phone" role="img" />
            <ol className="remote-steps">
              <li>Join your phone to the <strong>same Wi-Fi</strong> as this computer.</li>
              <li>Point the phone's camera at the code, and open the link it shows.</li>
              <li>Use the big buttons. The remote stays on until you switch it off or the show ends.</li>
            </ol>
            <p className="muted remote-url">
              Or type this into the phone's browser: <code>{info.url}</code>
            </p>
            <details className="muted">
              <summary>It won't open on the phone</summary>
              <ul>
                <li>If Windows asks to allow the app on <em>private</em> networks, choose Allow.</li>
                <li>Church and guest Wi-Fi often stops devices from seeing each other. Turn on your phone's hotspot and join this computer to it instead.</li>
                <li>A phone on mobile data only can't reach the computer: it has to be on the same Wi-Fi.</li>
              </ul>
            </details>
            <div className="remote-actions">
              <button className="outline-btn" onClick={onStop}>
                Switch it off
              </button>
              <button className="pill-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
