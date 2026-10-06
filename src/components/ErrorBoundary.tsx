import { Component, ErrorInfo, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logEvent } from "../errorLog";

interface State {
  error: Error | null;
}

/** If a screen fails to draw, show a way out (and log it) instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logEvent("error", "Screen failed to draw:", error, info.componentStack ?? "");
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <h2>Something went wrong</h2>
        <p>
          Part of the app couldn't be shown. Your notes, highlights and downloads are safe. Reloading usually fixes it; if it keeps
          happening, the details have been written to the app's log (Settings › Diagnostics).
        </p>
        <pre>{this.state.error.message}</pre>
        <div className="crash-actions">
          <button className="pill-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="text-btn" onClick={() => invoke("open_log_folder").catch(() => undefined)}>
            Show the log
          </button>
        </div>
      </div>
    );
  }
}
