// Content Factory: verses for the seasons of the church year (references only; the words come from the chosen Bible). Written
// for the series "Make a series for Advent / Christmas / Lent ...". Never "Easter" in reader-facing text: Resurrection Sunday.

import type { OccasionId } from "../themes/themeCalendar.ts";

export interface SeasonList {
  /** the name shown to the reader */
  name: string;
  refs: string[];
}

const HOLY_WEEK: SeasonList = {
  name: "Holy Week",
  refs: ["Zechariah 9:9", "Matthew 21:9", "John 12:13", "John 13:34", "Luke 22:19-20", "Isaiah 53:5", "Isaiah 53:6", "Luke 23:34", "John 19:30", "Luke 23:46", "Romans 5:8", "1 Peter 2:24", "John 15:13", "Mark 15:39", "Galatians 2:20"],
};

export const SEASON_VERSES: Partial<Record<OccasionId, SeasonList>> = {
  advent: { name: "Advent", refs: ["Isaiah 9:2", "Isaiah 7:14", "Isaiah 11:1-2", "Isaiah 40:3-5", "Micah 5:2", "Jeremiah 33:14-15", "Malachi 3:1", "Luke 1:30-33", "Luke 1:46-47", "Zechariah 9:9", "Romans 13:11-12", "Titus 2:11-13", "Psalm 80:3", "Psalm 24:7", "Luke 21:28", "Revelation 22:20"] },
  christmas: { name: "Christmas", refs: ["Luke 2:10-11", "Luke 2:14", "Luke 2:7", "Matthew 1:23", "John 1:14", "John 3:16", "Isaiah 9:6", "Matthew 2:10-11", "Galatians 4:4-5", "2 Corinthians 9:15", "1 John 4:9-10", "Luke 2:19", "Philippians 2:6-7", "Hebrews 1:1-2"] },
  newyear: { name: "New Year", refs: ["Lamentations 3:22-23", "Isaiah 43:18-19", "Psalm 90:12", "Jeremiah 29:11", "Proverbs 16:3", "2 Corinthians 5:17", "Philippians 3:13-14", "Psalm 121:8", "Joshua 1:9", "Isaiah 41:10", "Numbers 6:24-26", "Proverbs 3:5-6"] },
  epiphany: { name: "Epiphany", refs: ["Matthew 2:1-2", "Matthew 2:11", "Isaiah 60:1-3", "John 8:12", "Ephesians 3:6", "Luke 2:30-32", "Isaiah 49:6", "Psalm 72:10-11"] },
  lent: { name: "Lent", refs: ["Joel 2:12-13", "Psalm 51:10", "Psalm 51:17", "Isaiah 58:6", "Matthew 4:4", "Luke 9:23", "Romans 12:1", "James 4:8", "1 John 1:9", "Psalm 139:23-24", "Matthew 6:19-21", "Hebrews 4:15-16", "2 Corinthians 5:21", "Psalm 32:1-2", "Micah 6:8"] },
  palmsunday: HOLY_WEEK,
  goodfriday: HOLY_WEEK,
  easter: { name: "Resurrection Sunday", refs: ["Matthew 28:5-6", "Luke 24:5-6", "John 11:25-26", "1 Corinthians 15:3-4", "1 Corinthians 15:20", "1 Corinthians 15:55-57", "Romans 6:4", "Romans 10:9", "1 Peter 1:3", "Revelation 1:17-18", "Colossians 3:1", "Romans 8:11", "John 20:29", "Acts 2:24"] },
  ascension: { name: "Ascension", refs: ["Acts 1:9-11", "Luke 24:50-51", "Ephesians 1:20-21", "Hebrews 4:14", "Matthew 28:18-20", "Acts 1:8", "Colossians 3:1-2", "Mark 16:19"] },
  pentecost: { name: "Pentecost", refs: ["Acts 2:1-4", "Acts 2:17", "Acts 1:8", "Joel 2:28-29", "John 14:26", "Romans 8:26", "Galatians 5:22-23", "Acts 2:38", "1 Corinthians 12:4-7", "Ephesians 5:18", "Zechariah 4:6", "John 16:13", "Romans 8:14-16"] },
  trinity: { name: "Trinity Sunday", refs: ["Matthew 28:19", "2 Corinthians 13:14", "Isaiah 6:3", "John 14:16-17", "Ephesians 4:4-6", "Revelation 4:8", "Matthew 3:16-17"] },
  passover: { name: "Passover", refs: ["Exodus 12:13", "Exodus 12:14", "Exodus 12:26-27", "Deuteronomy 16:1", "1 Corinthians 5:7", "John 1:29", "Luke 22:19-20", "Exodus 13:8", "Psalm 136:1", "Hebrews 11:28", "Exodus 14:13-14", "Luke 22:15"] },
  communion: { name: "Communion", refs: ["1 Corinthians 11:23-26", "Luke 22:19-20", "John 6:35", "John 6:51", "Matthew 26:26-28", "1 Corinthians 10:16-17", "Mark 14:22-24", "Revelation 3:20"] },
  harvest: { name: "Harvest", refs: ["Psalm 65:11", "Genesis 8:22", "Deuteronomy 8:10", "Psalm 100:4-5", "Psalm 126:5-6", "2 Corinthians 9:10", "2 Corinthians 9:6-7", "Matthew 9:37-38", "Galatians 6:9", "John 4:35", "Proverbs 3:9-10", "1 Timothy 4:4", "Psalm 67:6-7"] },
  reformation: { name: "Reformation", refs: ["Romans 1:17", "Ephesians 2:8-9", "Galatians 2:16", "Romans 3:23-24", "Romans 5:1", "Habakkuk 2:4", "2 Timothy 3:16-17", "Psalm 119:105", "Romans 10:17"] },
  biblesunday: { name: "Bible Sunday", refs: ["Psalm 119:105", "2 Timothy 3:16-17", "Hebrews 4:12", "Isaiah 40:8", "Joshua 1:8", "Psalm 119:11", "Matthew 4:4", "James 1:22", "Psalm 19:7-8", "John 17:17", "Romans 15:4", "Psalm 119:130"] },
  mothersday: { name: "Mother's Day", refs: ["Proverbs 31:25-26", "Proverbs 31:28-29", "Exodus 20:12", "Proverbs 1:8", "Isaiah 66:13", "2 Timothy 1:5"] },
  fathersday: { name: "Father's Day", refs: ["Psalm 103:13", "Proverbs 20:7", "Ephesians 6:4", "Proverbs 22:6", "Deuteronomy 6:6-7", "Colossians 3:21", "Psalm 127:3"] },
  childrensday: { name: "Children's Day", refs: ["Mark 10:14", "Matthew 18:3", "Psalm 127:3", "Proverbs 22:6", "Luke 18:16", "Psalm 8:2"] },
};

/** the seasons a series can be made for, in the order of the church year */
export const SERIES_ORDER: OccasionId[] = ["advent", "christmas", "newyear", "epiphany", "lent", "palmsunday", "easter", "ascension", "pentecost", "trinity", "passover", "communion", "harvest", "reformation", "biblesunday", "mothersday", "fathersday", "childrensday"];

export const seasonName = (id: OccasionId): string => SEASON_VERSES[id]?.name ?? id;
