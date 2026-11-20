// Said wherever a feature needs Strong's numbers and the Bible being read does not have them loaded (the Bibles built in that do: BSB, KJV, ASV, WEB; a Bible
// added from a file that carries Strong's numbers keeps them).

import type { Version } from "../api";

/** Does this Bible have Strong's numbers loaded? Unknown (the list is not there yet) counts as yes, so nothing is said wrongly. */
export function hasStrongs(versions: Version[] | undefined, code: string): boolean {
  const v = versions?.find((x) => x.code === code);
  return v ? v.has_strongs === true : true;
}

export function versionLabel(versions: Version[] | undefined, code: string): string {
  return versions?.find((x) => x.code === code)?.name ?? code;
}

export function NoStrongsNote({ name, what }: { name: string; what: string }) {
  return (
    <p className="no-strongs-note" role="note">
      <strong>{name}</strong> does not have Strong&rsquo;s numbers loaded, so {what}. Using the BSB or KJV as your default Bible gives you this feature.
    </p>
  );
}
