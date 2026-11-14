// A yes/no question to the reader. In the app's window the dialog plugin replaces window.confirm with a version that returns a PROMISE (a native message box;
// the answer comes later), so `if (!window.confirm(...))` never stops anything: a promise is always "true". Always ask through this: it asks the native
// dialog directly and waits for the answer. In a plain browser (no app window) it uses the browser's own confirm, which answers at once.

export async function confirmAsk(message: string): Promise<boolean> {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      return (await confirm(message, { title: "Bible Concordance", kind: "warning", okLabel: "Yes", cancelLabel: "No" })) === true;
    } catch (e) {
      console.warn("the question could not be shown:", e);
      return false;
    }
  }
  return window.confirm(message) === true;
}
