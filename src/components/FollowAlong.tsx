// "Follow along": a page people on the church Wi-Fi open on their own phones to read the words of the slide on the screen as it
// changes. Read only: no buttons, and the preacher's notes and the next slide are never sent. This window switches it on (it is off
// until then, and it stops when the show ends) and shows the QR code to put on the screen or print for the room.

import type { RemoteInfo } from "../api";

interface Props {
  /** null while it is off */
  info: RemoteInfo | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onStop: () => void;
  onClose: () => void;
}

export function FollowAlong({ info, busy, error, onStart, onStop, onClose }: Props) {
  return (
    <div className="remote-overlay" role="dialog" aria-modal="true" aria-label="Follow along" onClick={onClose}>
      <div className="remote-box" onClick={(e) => e.stopPropagation()}>
        <header className="remote-head">
          <h3>Follow along</h3>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {!info ? (
          <>
            <p>
              Let people read the words on their own phones: the song or the Scripture that is on the screen, changing as you move on. Good for people
              who cannot see the screen well, and for a church that streams its service.
            </p>
            <p className="muted">
              It is read only: nobody can change the slides, and your notes and the next slide are never sent. It works over the Wi-Fi this computer is
              on (nothing goes through the internet), only for devices on the same network, and only for people who have the address below. It is off
              until you switch it on, and it stops when the show ends.
            </p>
            {error && <p className="status-error">{error}</p>}
            <button className="pill-btn" onClick={onStart} disabled={busy}>
              {busy ? "Switching on…" : "Switch follow along on"}
            </button>
          </>
        ) : (
          <>
            <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qr_svg }} aria-label="QR code for the congregation's phones" role="img" />
            <ol className="remote-steps">
              <li>
                Show this code on the screen (or print it) so people can point their phone's camera at it. They must be on the <strong>same Wi-Fi</strong> as this computer.
              </li>
              <li>The page shows the words on the screen and updates by itself.</li>
              <li>Switch it off when you are done, or end the show: the address stops working.</li>
            </ol>
            <p className="muted remote-url">
              Or type this into a phone's browser: <code>{info.url}</code>
            </p>
            <p className="muted">Guest Wi-Fi often stops phones from seeing this computer. If so, use the church's own network or a hotspot, and try it once beforehand.</p>
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
