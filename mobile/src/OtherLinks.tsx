// More > Downloads > Other links: where to find e-Sword, MySword and MyBible files. A plain list; each row opens its website in the phone's browser.
// (The same four sites as the computer app's Library, without its search box.)

import { phone } from "./api";
import { LinkRow } from "./Downloads";
import { MYSWORD, MYSWORD_ABOUT, SITES, SITES_NOTE, mySwordUrl } from "./librarySites";

export function OtherLinks({ fail }: { fail: (e: unknown) => void }) {
  const open = (url: string) => void phone.openLink(url).catch(fail);
  return (
    <>
      <h3>Other links</h3>
      <p className="hint">{SITES_NOTE}</p>
      <div className="dl-list other-links">
        {SITES.map((s) => (
          <LinkRow key={s.name} title={s.name} note={s.about} onClick={() => open(s.url)} />
        ))}
      </div>
      <h4 className="row-label">MySword</h4>
      <p className="hint">{MYSWORD_ABOUT}</p>
      <div className="dl-list other-links">
        {MYSWORD.map(([label, path]) => (
          <LinkRow key={path} title={label} onClick={() => open(mySwordUrl(path))} />
        ))}
      </div>
    </>
  );
}
