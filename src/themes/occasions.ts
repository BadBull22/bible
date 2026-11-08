// The themes a reader can choose: occasion themes (a themed "Gospel" wordmark plus a screen package for the opening screen)
// and plain themes (only colours). A theme is only a suggested working combination: the reader can pick one by hand, switch
// its picture and its screen decorations on or off separately, and still change fonts and colours. A theme never changes
// the Bible reading font. Adding a theme = an SVG in ./wordmarks, a CSS file in ./screens (imported in themes.css), a verse in
// verses.json and a line here. (The code and the CSS call a theme a "look" and its slug the "occasion"; the reader only sees "theme".)

import verses from "./verses.json";
import type { OccasionId } from "./themeCalendar";
import adventSvg from "./wordmarks/advent.svg?raw";
import christmasSvg from "./wordmarks/christmas.svg?raw";
import newYearSvg from "./wordmarks/new-year.svg?raw";
import epiphanySvg from "./wordmarks/epiphany.svg?raw";
import lentSvg from "./wordmarks/lent.svg?raw";
import palmSundaySvg from "./wordmarks/palm-sunday.svg?raw";
import goodFridaySvg from "./wordmarks/good-friday.svg?raw";
import easterSvg from "./wordmarks/easter.svg?raw";
import ascensionSvg from "./wordmarks/ascension.svg?raw";
import pentecostSvg from "./wordmarks/pentecost.svg?raw";
import trinitySvg from "./wordmarks/trinity.svg?raw";
import passoverSvg from "./wordmarks/passover.svg?raw";
import communionSvg from "./wordmarks/communion.svg?raw";
import harvestSvg from "./wordmarks/harvest.svg?raw";
import reformationSvg from "./wordmarks/reformation.svg?raw";
import bibleSundaySvg from "./wordmarks/bible-sunday.svg?raw";
import mothersDaySvg from "./wordmarks/mothers-day.svg?raw";
import fathersDaySvg from "./wordmarks/fathers-day.svg?raw";
import childrensDaySvg from "./wordmarks/childrens-day.svg?raw";
import healingSvg from "./wordmarks/healing.svg?raw";
import miraclesSvg from "./wordmarks/miracles.svg?raw";
import seaOfGalileeSvg from "./wordmarks/sea-of-galilee.svg?raw";

export interface Look {
  /** also the value of the data-occasion attribute the CSS in ./screens uses */
  slug: string;
  name: string;
  /** the group it is listed under in Settings */
  group: string;
  /** one line for the Settings list */
  blurb: string;
  /** the calendar occasion that suggests it (null: only by hand) */
  calendar: OccasionId | null;
  /** how the keep-or-default question starts: "It's Christmas time" */
  lead: string;
  /** the themed wordmark, inline SVG (null: the plain coloured letters stay) */
  svg: string | null;
  /** the verse of the season shown under the search box (BSB, quoted exactly) */
  verse: { ref: string; text: string } | null;
}

const v = verses as Record<string, { ref: string; text: string }>;

const G1 = "Church year and seasons";
const G2 = "Other occasions";
const G3 = "Moods and plain themes";
/** the groups, in the order Settings lists them */
export const LOOK_GROUPS = [G1, G2, G3];

export const LOOKS: Look[] = [
  { slug: "advent", name: "Advent", group: G1, blurb: "A candle in an arched window at night; purple and blue, waiting in hope", calendar: "advent", lead: "It's Advent", svg: adventSvg, verse: v.advent },
  { slug: "christmas", name: "Christmas", group: G1, blurb: "Lights, a wreath and a candle; soft red and evergreen", calendar: "christmas", lead: "It's Christmas time", svg: christmasSvg, verse: v.christmas },
  { slug: "new-year", name: "New Year", group: G1, blurb: "A soft sunrise and quiet stars; hopeful blue and gold", calendar: "newyear", lead: "It's New Year", svg: newYearSvg, verse: v["new-year"] },
  { slug: "epiphany", name: "Epiphany", group: G1, blurb: "A bright star over a winding road; deep blue and gold", calendar: "epiphany", lead: "It's Epiphany", svg: epiphanySvg, verse: v.epiphany },
  { slug: "lent", name: "Lent", group: G1, blurb: "A desert path up to a wooden cross; quiet purple, stone and wood. Still, no movement", calendar: "lent", lead: "It's Lent", svg: lentSvg, verse: v.lent },
  { slug: "palm-sunday", name: "Palm Sunday", group: G1, blurb: "A donkey on a road of cloaks under a palm; fresh green and gold", calendar: "palmsunday", lead: "It's Palm Sunday", svg: palmSundaySvg, verse: v["palm-sunday"] },
  { slug: "good-friday", name: "Good Friday", group: G1, blurb: "Three crosses on a low hill; solemn muted purple and grey. Still, no movement", calendar: "goodfriday", lead: "It's Good Friday", svg: goodFridaySvg, verse: v["good-friday"] },
  { slug: "easter", name: "Resurrection Sunday", group: G1, blurb: "Lilies and a sunrise; lilac, gold and fresh green (modern reference: Easter)", calendar: "easter", lead: "It's Resurrection Sunday", svg: easterSvg, verse: v.easter },
  { slug: "ascension", name: "Ascension", group: G1, blurb: "Clouds parting and gold rays rising; sky blue and gold", calendar: "ascension", lead: "It's Ascension Day", svg: ascensionSvg, verse: v.ascension },
  { slug: "pentecost", name: "Pentecost", group: G1, blurb: "Flames and rising sparks; red and gold", calendar: "pentecost", lead: "It's Pentecost", svg: pentecostSvg, verse: v.pentecost },
  { slug: "trinity", name: "Trinity Sunday", group: G1, blurb: "Three candles on a deep-blue ground; still and dignified. Still, no movement", calendar: "trinity", lead: "It's Trinity Sunday", svg: trinitySvg, verse: v.trinity },
  { slug: "passover", name: "Passover", group: G2, blurb: "A lamb, a cup and a doorway under the moon", calendar: "passover", lead: "It's Passover", svg: passoverSvg, verse: v.passover },
  { slug: "communion", name: "Communion", group: G2, blurb: "Bread and cup; wine, wheat gold and vine green. Still, no movement", calendar: "communion", lead: "It's Communion Sunday", svg: communionSvg, verse: v.communion },
  { slug: "harvest", name: "Thanksgiving / Harvest", group: G2, blurb: "A basket of apples, grapes and wheat; autumn gold and green", calendar: "harvest", lead: "It's Thanksgiving and harvest time", svg: harvestSvg, verse: v.harvest },
  { slug: "reformation", name: "Reformation Day", group: G2, blurb: "A plain wooden door with a paper nailed to it; deep red and warm paper", calendar: "reformation", lead: "It's Reformation Day", svg: reformationSvg, verse: v.reformation },
  { slug: "bible-sunday", name: "Bible Sunday", group: G2, blurb: "An open Bible with a flame of light; warm gold and brown", calendar: "biblesunday", lead: "It's Bible Sunday", svg: bibleSundaySvg, verse: v["bible-sunday"] },
  { slug: "mothers-day", name: "Mother's Day", group: G2, blurb: "A heart-shaped o and a flower for the l; soft pinks and greens", calendar: "mothersday", lead: "It's Mother's Day", svg: mothersDaySvg, verse: v["mothers-day"] },
  { slug: "fathers-day", name: "Father's Day", group: G2, blurb: "A tree that shelters the word, with two birds; calm blues, greens and browns", calendar: "fathersday", lead: "It's Father's Day", svg: fathersDaySvg, verse: v["fathers-day"] },
  { slug: "childrens-day", name: "Children's Day", group: G2, blurb: "A balloon for the o and a growing seed for the l; bright and friendly", calendar: "childrensday", lead: "It's Children's Day", svg: childrensDaySvg, verse: v["childrens-day"] },
  { slug: "healing", name: "Healing", group: G3, blurb: "A quiet, restful look", calendar: null, lead: "", svg: healingSvg, verse: v.healing },
  { slug: "miracles", name: "Miracles", group: G3, blurb: "Light and wonder", calendar: null, lead: "", svg: miraclesSvg, verse: v.miracles },
  { slug: "sea-of-galilee", name: "Sea of Galilee", group: G3, blurb: "Blue water and a boat; gentle waves", calendar: null, lead: "", svg: seaOfGalileeSvg, verse: v["sea-of-galilee"] },
  { slug: "warm-paper", name: "Warm paper", group: G3, blurb: "A slight warm yellow glow around the search and the shortcuts", calendar: null, lead: "", svg: null, verse: null },
  { slug: "night-reading", name: "Night reading", group: G3, blurb: "A slight blue glow around the search and the shortcuts", calendar: null, lead: "", svg: null, verse: null },
];

export function lookBySlug(slug: string | null | undefined): Look | null {
  return LOOKS.find((l) => l.slug === slug) ?? null;
}

/** The theme that a calendar occasion suggests, if one has been made for it. */
export function lookForCalendar(id: OccasionId): Look | null {
  return LOOKS.find((l) => l.calendar === id) ?? null;
}
