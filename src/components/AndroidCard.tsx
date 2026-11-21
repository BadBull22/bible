// "Bible Concordance is on Android too": a QR code to scan with a phone, and a button for the same page. Shown in the What's new window of the version that
// announces it, and kept in Settings > About.

import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { ANDROID_LINK, ANDROID_PAGE } from "../androidNotice";

export function AndroidCard() {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.qrForUrl(ANDROID_LINK).then((s) => live && setSvg(s)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="android-card">
      {svg && <div className="android-qr" role="img" aria-label="QR code for the Android app in Google Play" dangerouslySetInnerHTML={{ __html: svg }} />}
      <div className="android-text">
        <h3>Bible Concordance is now on Google Play</h3>
        <p>
          Scan the code with your phone's camera to open Bible Concordance for Android in Google Play. It is free, works offline and has no account and no adverts. Your notes, highlights and
          reading plans can keep in step with this app over your own Wi-Fi (Settings &rarr; Keep in step).
        </p>
        <p className="android-actions">
          <button className="outline-btn" onClick={() => void openUrl(ANDROID_LINK).catch(() => undefined)} title={ANDROID_LINK}>
            Open on Google Play
          </button>
          <button className="link-btn" onClick={() => void openUrl(ANDROID_PAGE).catch(() => undefined)} title={ANDROID_PAGE}>
            bible4me.org/android
          </button>
        </p>
      </div>
    </div>
  );
}
