// Content Factory: the finished pictures and videos on a phone, over the home Wi-Fi. The computer serves a small page (src-tauri/src/factory_phone.rs) while this is
// switched on: the phone opens it from the QR code, sees what the studio has saved, and saves it to the phone to post from there. No app on the phone, nothing
// through the internet, nothing can be changed from the phone.

import { useEffect, useState } from "react";
import { api, type RemoteInfo } from "../api";
import { Icon } from "./FactoryIcons";

interface Props {
  onClose: () => void;
  /** told when it is switched on or off, so the tool bar can show it */
  onState?: (on: boolean) => void;
}

export function FactoryPhone({ onClose, onState }: Props) {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // it may already be on (the window was closed with the phone still using it)
  useEffect(() => {
    void api
      .factoryPhoneInfo()
      .then((i) => {
        setInfo(i);
        onState?.(!!i);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const i = await api.factoryPhoneStart();
      setInfo(i);
      onState?.(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = () => {
    void api.factoryPhoneStop().catch(() => undefined);
    setInfo(null);
    onState?.(false);
  };

  return (
    <div className="remote-overlay fx-phone-overlay" role="dialog" aria-modal="true" aria-label="Pictures on my phone" onClick={onClose}>
      <div className="remote-box" onClick={(e) => e.stopPropagation()}>
        <header className="remote-head">
          <h3>
            <Icon name="phone" size={18} /> Pictures on my phone
          </h3>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {!info ? (
          <>
            <p>
              See the pictures and videos you have made on your phone, and save them there to post from it. Nothing to install on the phone, and nothing goes through the internet: it works over the Wi-Fi this computer is on.
            </p>
            <p className="muted">It is off until you switch it on here, it only shows the saved pictures and videos (it cannot change anything), and it switches itself off after an hour.</p>
            {error && <p className="status-error">{error}</p>}
            <button className="pill-btn" onClick={() => void start()} disabled={busy}>
              {busy ? "Switching on…" : "Show my pictures on the phone"}
            </button>
          </>
        ) : (
          <>
            <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qr_svg }} aria-label="QR code for the phone" role="img" />
            <ol className="remote-steps">
              <li>
                Join your phone to the <strong>same Wi-Fi</strong> as this computer.
              </li>
              <li>Point the phone's camera at the code, and open the link it shows.</li>
              <li>
                Tap a picture, then <strong>Save to my phone</strong>. New pictures appear on their own.
              </li>
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
              <button className="outline-btn" onClick={stop}>
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
