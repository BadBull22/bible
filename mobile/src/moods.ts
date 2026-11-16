// "How are you today?": a short list of how a person may feel, each leading to a "Verses for..." page (Scripture first, then the page's own note). Pure data and
// one chooser, so Node tests it (scripts/test_moods.mts).

export interface Mood {
  id: string;
  /** what the reader taps */
  label: string;
  /** a short word of welcome shown above the verse */
  line: string;
  /** the "Verses for..." page (src/browse/data/topics.json) the verses come from */
  topic: string;
  /** what the prayer list starts with when "Pray about this" is pressed */
  prayer: string;
}

export const MOODS: Mood[] = [
  { id: "anxious", label: "Anxious", line: "You do not have to carry this alone.", topic: "anxiety", prayer: "I am anxious. Lord, give me Your peace about " },
  { id: "afraid", label: "Afraid", line: "God is near to those who are afraid.", topic: "fear", prayer: "I am afraid. Lord, be my strength about " },
  { id: "sad", label: "Sad or grieving", line: "God is close to the brokenhearted.", topic: "grief-and-loss", prayer: "I am grieving. Lord, comfort me about " },
  { id: "lonely", label: "Lonely", line: "You are not forgotten.", topic: "comfort-and-loneliness", prayer: "I feel alone. Lord, be with me in " },
  { id: "tired", label: "Tired or discouraged", line: "He gives strength to the weary.", topic: "discouragement-and-weariness", prayer: "I am weary. Lord, renew my strength for " },
  { id: "doubting", label: "Doubting", line: "Honest questions are brought to God.", topic: "faith-and-doubt", prayer: "I am struggling to believe. Lord, help my unbelief about " },
  { id: "guilty", label: "Guilty", line: "There is forgiveness with God.", topic: "forgiveness", prayer: "I need Your forgiveness, Lord, for " },
  { id: "tempted", label: "Tempted", line: "God provides a way out.", topic: "temptation-and-self-control", prayer: "I am being tempted. Lord, keep me from " },
  { id: "hurting", label: "Unwell or hurting", line: "He is the Lord who heals.", topic: "healing", prayer: "Lord, please heal " },
  { id: "waiting", label: "Waiting", line: "Those who wait on the Lord are not put to shame.", topic: "patience-and-waiting", prayer: "I am waiting, Lord, for " },
  { id: "confused", label: "Need direction", line: "He promises to guide you.", topic: "guidance", prayer: "Lord, please guide me about " },
  { id: "weak", label: "Need strength", line: "His strength is made perfect in weakness.", topic: "strength-and-courage", prayer: "Lord, give me strength and courage for " },
  { id: "hopeless", label: "Without hope", line: "There is a living hope.", topic: "hope", prayer: "Lord, give me hope about " },
  { id: "peace", label: "Want peace", line: "His peace is a gift.", topic: "peace", prayer: "Lord, give me Your peace in " },
  { id: "thankful", label: "Thankful", line: "Give thanks to the Lord.", topic: "thankfulness", prayer: "Thank You, Lord, for " },
  { id: "joyful", label: "Joyful", line: "Rejoice in the Lord.", topic: "joy", prayer: "Thank You, Lord, for the joy of " },
];

/** Which of a page's passages to show first today: a different one each day, the same one all day. `day` is days since a fixed day. */
export function passageIndex(mood: string, day: number, count: number, skip = 0): number {
  if (count <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < mood.length; i++) h = Math.imul(h ^ mood.charCodeAt(i), 16777619) >>> 0;
  return (((h >>> 0) + day * 7 + skip) % count + count) % count;
}
