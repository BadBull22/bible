// An emoji for each "Verses for…" page and subject, so a reader finds one by its picture before reading its name (owner, 2026-11-23,
// mockup research/mockups/verses-for-emoji-*.png approved). Only emojis that older Android phones (7 and up) can draw: newer ones
// (the hug, the bandage) show as empty boxes there. A page or subject not listed here (one added later by Fetch additional stories)
// takes the emoji of its first subject, or the open book.

const PAGE: Record<string, string> = {
  anxiety: "😟",
  fear: "😨",
  peace: "🕊️",
  hope: "🌅",
  "grief-and-loss": "💧",
  forgiveness: "🤝",
  healing: "🌿",
  prayer: "🙏",
  guidance: "⭐",
  "strength-and-courage": "💪",
  "comfort-and-loneliness": "👤",
  "trust-in-god": "⚓",
  "faith-and-doubt": "✝️",
  joy: "😊",
  thankfulness: "🙌",
  "patience-and-waiting": "⏳",
  "discouragement-and-weariness": "😔",
  "temptation-and-self-control": "🛡️",
  love: "❤️",
  wisdom: "💡",
  "worship-and-praise": "🎶",
  "heaven-and-eternal-life": "✨",
};

const SUBJECT: Record<string, string> = {
  comfort: "🤗",
  faith: "✝️",
  emotions: "💭",
  trust: "⚓",
  hope: "🌅",
  peace: "🕊️",
  prayer: "🙏",
  wisdom: "💡",
  doubt: "❓",
  fear: "😨",
  grief: "💧",
  forgiveness: "🤝",
  healing: "🌿",
  guidance: "⭐",
  strength: "💪",
  loneliness: "👤",
  joy: "😊",
  thanks: "🙌",
  patience: "⏳",
  weariness: "😔",
  temptation: "🛡️",
  love: "❤️",
  worship: "🎶",
  heaven: "✨",
  family: "🏠",
  needs: "🍞",
};

export const ALL_SUBJECTS_EMOJI = "📖";

/** The emoji of a subject chip ("comfort" -> 🤗), or "" when it has none. */
export function subjectEmoji(tag: string): string {
  return SUBJECT[tag.toLowerCase()] ?? "";
}

/** The emoji of a "Verses for…" page, by its id; else its first subject's; else the open book. */
export function pageEmoji(id: string, tags: string[] = []): string {
  return PAGE[id] ?? tags.map((t) => SUBJECT[t.toLowerCase()]).find(Boolean) ?? ALL_SUBJECTS_EMOJI;
}
