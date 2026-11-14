// Content Factory: the gallery of finished work. The factory saves one file for each picture in each size and one for each video, named
// "<project> 03 of 07 - Square 1080x1080.png" and "<project> - Story video.mp4". The gallery shows one tile for each project (a week of verses
// is one tile, not fourteen files), newest first. Pure functions, so they can be tested under Node (scripts/test_factory.mts).

export interface GalleryFile {
  path: string;
  name: string;
  folder: string;
  size: number;
  /** seconds since 1970 */
  modified: number;
}

export interface Project<F extends GalleryFile = GalleryFile> {
  /** the project's name, as it was saved: "2026-11-13 This week" */
  title: string;
  files: F[];
  /** the file to show on the tile: the first picture, or the first video when there are no pictures */
  cover: F;
  modified: number;
  pictures: number;
  videos: number;
}

const isVideoName = (name: string) => /\.mp4$/i.test(name);

/** The project a saved file belongs to: its name without the extension, the " (2)" added when the same name was saved again, the " 03 of 07" and the " - Square 1080x1080" or " - Story video" at the end. */
export function projectName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\s\(\d+\)$/, "")
    .replace(/\s-\s[A-Za-z]+\s(?:\d+x\d+|video)$/, "")
    .replace(/\s\d+\sof\s\d+$/, "")
    .trim();
}

/** Groups saved files by project, the project saved most lately first; inside a project the pictures come first, in the order saved (01, 02, ...). */
export function groupFiles<F extends GalleryFile>(files: F[]): Project<F>[] {
  const by = new Map<string, F[]>();
  for (const f of files) {
    const k = projectName(f.name) || f.name;
    const list = by.get(k);
    if (list) list.push(f);
    else by.set(k, [f]);
  }
  const out: Project<F>[] = [];
  for (const [title, list] of by) {
    const sorted = [...list].sort((a, b) => Number(isVideoName(a.name)) - Number(isVideoName(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    out.push({
      title,
      files: sorted,
      cover: sorted[0],
      modified: Math.max(...list.map((f) => f.modified)),
      pictures: sorted.filter((f) => !isVideoName(f.name)).length,
      videos: sorted.filter((f) => isVideoName(f.name)).length,
    });
  }
  return out.sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
}

/** What a project holds, in words: "7 pictures", "a video", "2 pictures and a video". */
export function projectCount(p: Pick<Project, "pictures" | "videos">): string {
  const pic = p.pictures === 1 ? "a picture" : `${p.pictures} pictures`;
  const vid = p.videos === 1 ? "a video" : `${p.videos} videos`;
  return p.pictures && p.videos ? `${pic} and ${vid}` : p.pictures ? pic : vid;
}
