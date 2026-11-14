// Content Factory: free recordings the app can fetch into the music library on request. Only public domain and CC0 recordings:
// Kimiko Ishizaka's Open Goldberg Variations (CC0, Internet Archive) and carols and hymns by the US military bands (US government
// works, public domain, Wikimedia Commons). Each is downloaded with its credit written beside it; the app downloads nothing else.
// Checked 2026-11-13: the licence of the Goldberg item on archive.org (CC0 1.0), the file names and sizes, and the Commons licence labels.

import type { MoodId } from "./music";

export interface FreeTrack {
  file: string;
  url: string;
  title: string;
  artist: string;
  credit: string;
  link: string;
  moods: MoodId[];
}

const IA = "https://archive.org/download/The_Open_Goldberg_Variations-11823/";
const IA_PAGE = "https://archive.org/details/The_Open_Goldberg_Variations-11823";
const CC = "https://upload.wikimedia.org/wikipedia/commons/";
const gold = (n: string, file: string, title: string, moods: MoodId[]): FreeTrack => ({
  file: `Ishizaka - ${n} - ${title}.ogg`,
  url: `${IA}${file}`,
  title: `${title} (Goldberg Variations)`,
  artist: "Kimiko Ishizaka",
  credit: `Music: ${title}, Goldberg Variations (J. S. Bach), played by Kimiko Ishizaka (CC0)`,
  link: IA_PAGE,
  moods,
});
const band = (file: string, path: string, title: string, band: string, moods: MoodId[], commons: string): FreeTrack => ({
  file,
  url: `${CC}${path}`,
  title,
  artist: band,
  credit: `Music: ${title}, ${band} (public domain)`,
  link: `https://commons.wikimedia.org/wiki/File:${commons}`,
  moods,
});

export const FREE_TRACKS: FreeTrack[] = [
  gold("01", "Kimiko_Ishizaka_-_01_-_Aria.ogg", "Aria", ["calm", "reverent"]),
  gold("14", "Kimiko_Ishizaka_-_14_-_Variatio_13_a_2_Clav.ogg", "Variation 13", ["calm", "reverent"]),
  gold("16", "Kimiko_Ishizaka_-_16_-_Variatio_15_a_1_Clav_Canone_alla_Quinta.ogg", "Variation 15", ["reverent", "passover"]),
  gold("22", "Kimiko_Ishizaka_-_22_-_Variatio_21_Canone_alla_Settima.ogg", "Variation 21", ["reverent", "passover"]),
  gold("26", "Kimiko_Ishizaka_-_26_-_Variatio_25_a_2_Clav.ogg", "Variation 25 (Adagio)", ["reverent", "calm"]),
  gold("32", "Kimiko_Ishizaka_-_32_-_Aria_da_Capo__Fine.ogg", "Aria da capo", ["calm", "hopeful"]),
  band("US Army Band - Lo, How a Rose.ogg", "c/c9/U.S._Army_Band_-_Lo_How_a_Rose.ogg", "Lo, How a Rose E'er Blooming", "US Army Band", ["christmas", "calm"], "U.S._Army_Band_-_Lo_How_a_Rose.ogg"),
  band("US Army Band - Coventry Carol.ogg", "6/66/U.S._Army_Band_-_Coventry_Carol.ogg", "Coventry Carol", "US Army Band", ["christmas", "reverent"], "U.S._Army_Band_-_Coventry_Carol.ogg"),
  band("US Army Band - Good King Wenceslas.ogg", "8/84/U.S._Army_Band_-_Good_King_Wenceslaus.ogg", "Good King Wenceslas", "US Army Band", ["christmas"], "U.S._Army_Band_-_Good_King_Wenceslaus.ogg"),
  band("US Army Band - Angels We Have Heard on High.ogg", "8/87/U.S._Army_Band_-_Angels_We_Have_Heard_on_High.ogg", "Angels We Have Heard on High", "US Army Band", ["christmas", "bright"], "U.S._Army_Band_-_Angels_We_Have_Heard_on_High.ogg"),
  band("US Army Band - This Endris Night.ogg", "1/19/U.S._Army_Band_-_This_Endris_Night.ogg", "This Endris Night", "US Army Band", ["christmas", "calm"], "U.S._Army_Band_-_This_Endris_Night.ogg"),
  band("US Army Band - Hark the Herald Angels Sing.ogg", "4/43/U.S._Army_Band_-_Hark%21_The_Herald_Angels_Sing.ogg", "Hark! The Herald Angels Sing", "US Army Band", ["christmas", "bright"], "U.S._Army_Band_-_Hark!_The_Herald_Angels_Sing.ogg"),
  band("US Navy Band - Eternal Father, Strong to Save.ogg", "8/80/Eternal_Father%2C_Strong_to_Save_%28instrumental%29.ogg", "Eternal Father, Strong to Save", "US Navy Band", ["reverent", "calm"], "Eternal_Father,_Strong_to_Save_(instrumental).ogg"),
];
