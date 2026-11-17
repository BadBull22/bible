// The CCLI line in the saved PowerPoint and ProPresenter files: the same remembered switch as the presenter's "CCLI line" button. A song's slide carries its line (`credit`);
// it goes into the file only when the switch is on, so a church that does not want it sees nothing change.

export const CCLI_KEY = "bc-present-ccli";

export function ccliOn(): boolean {
  try {
    return localStorage.getItem(CCLI_KEY) === "1";
  } catch {
    return false;
  }
}

export function setCcliOn(on: boolean) {
  try {
    localStorage.setItem(CCLI_KEY, on ? "1" : "0");
  } catch {
    /* a convenience only */
  }
}

/** The slides as they go into a file: with their CCLI line when the switch is on, without it when it is off. */
export function withCcli<T extends { credit?: string }>(slides: T[], on: boolean = ccliOn()): T[] {
  return slides.map((s) => (on ? s : { ...s, credit: undefined }));
}
