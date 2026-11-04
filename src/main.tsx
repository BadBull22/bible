import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isShowWindow, ShowScreen } from "./components/SlideShow";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installErrorLog } from "./errorLog";
import { applyPrefs, loadPrefs } from "./readingPrefs";
import { api } from "./api";

installErrorLog();
// the page is running: otherwise the app, after half a minute, says that the window did not open
void api.appReady().catch(() => undefined);
// theme and colours before the first paint, so a dark-mode reader never sees a light flash
applyPrefs(loadPrefs());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isShowWindow() ? <ShowScreen /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
