// Sends errors from the web view to the app's log file (logging.rs), so problems seen in
// the installed app -- which has no developer tools -- can be looked at afterwards.
// Nothing is sent anywhere else.
import { invoke } from "@tauri-apps/api/core";

type Level = "error" | "warn" | "info";

const lastSeen = new Map<string, number>();

function describe(x: unknown): string {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack}` : ""}`;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

/** Writes one line to the log; the same message again within 5 seconds is skipped. */
export function logEvent(level: Level, ...parts: unknown[]) {
  const message = parts.map(describe).join(" ");
  const now = Date.now();
  if (now - (lastSeen.get(message) ?? 0) < 5000) return;
  if (lastSeen.size > 200) lastSeen.clear();
  lastSeen.set(message, now);
  invoke("log_event", { level, message }).catch(() => undefined);
}

let installed = false;

/** Uncaught exceptions, unhandled promise rejections and console errors/warnings. */
export function installErrorLog() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => logEvent("error", `Uncaught ${e.message}`, e.error ?? `at ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener("unhandledrejection", (e) => logEvent("error", "Unhandled rejection:", e.reason));
  const error = console.error.bind(console);
  const warn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    error(...args);
    logEvent("error", ...args);
  };
  console.warn = (...args: unknown[]) => {
    warn(...args);
    logEvent("warn", ...args);
  };
}
