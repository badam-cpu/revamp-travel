/**
 * "Guest reviews mention" themes — computed deterministically from the actual
 * text of imported/external reviews (keyword matching), like Airbnb's summary
 * chips. Honest by construction: each count is the number of reviews that
 * genuinely mention that theme; nothing is invented. No AI, no external calls.
 */
export interface Mention {
  key: string;
  label: string;
  emoji: string;
  count: number;
}

type Theme = { key: string; label: string; emoji: string; words: string[] };

// Stays: what a guest notices about a place they slept in.
const STAY_THEMES: Theme[] = [
  { key: "location", label: "Location", emoji: "📍", words: ["location", "located", "central", "centrally", "walk", "walking", "close", "near", "nearby", "neighborhood", "neighbourhood", "area", "metro", "downtown", "square", "center", "centre", "convenient"] },
  { key: "cleanliness", label: "Cleanliness", emoji: "🧼", words: ["clean", "spotless", "tidy", "immaculate", "hygiene", "hygienic", "fresh", "neat"] },
  { key: "communication", label: "Communication", emoji: "💬", words: ["communication", "communicate", "responsive", "replied", "reply", "answered", "answers", "contact", "helpful host", "prompt"] },
  { key: "checkin", label: "Check-in", emoji: "🔑", words: ["check-in", "checkin", "check in", "self check", "self-check", "keys", "key ", "arrival", "arrived", "access", "contactless"] },
  { key: "sleep", label: "Sleep quality", emoji: "🛏️", words: ["sleep", "slept", "bed", "beds", "comfortable", "comfy", "quiet", "peaceful", "mattress", "restful", "cozy", "cosy"] },
  { key: "hospitality", label: "Hospitality", emoji: "🎁", words: ["host", "hosts", "welcoming", "welcome", "kind", "friendly", "hospitality", "hospitable", "gratitude", "greet", "greeted", "approachable", "generous", "warm", "gracious", "accommodating"] },
  { key: "value", label: "Value", emoji: "💰", words: ["value", "worth", "affordable", "reasonable", "price", "cheap", "cheaper", "great deal"] },
  { key: "accuracy", label: "Accuracy", emoji: "✅", words: ["as described", "as shown", "exactly as", "accurate", "accurately", "as pictured", "as advertised", "matched"] },
  { key: "amenities", label: "Amenities", emoji: "🛁", words: ["wifi", "wi-fi", "kitchen", "amenities", "shower", "hot water", "aircon", "air conditioning", "heating", "equipped"] },
];

// Tours & experiences (and food outings): what a guest notices about an activity.
const ACTIVITY_THEMES: Theme[] = [
  { key: "guide", label: "The guide", emoji: "🧭", words: ["guide", "guided", "host", "knowledgable", "knowledgeable", "expert", "professional", "storyteller", "our host"] },
  { key: "knowledge", label: "Knowledge", emoji: "📚", words: ["history", "historical", "story", "stories", "learned", "learn", "learning", "insightful", "informative", "educational", "facts", "culture", "cultural"] },
  { key: "fun", label: "Fun", emoji: "🎉", words: ["fun", "enjoyable", "enjoyed", "entertaining", "laugh", "laughs", "memorable", "amazing", "awesome", "blast", "great time", "loved", "special"] },
  { key: "warmth", label: "Warmth", emoji: "🤗", words: ["warm", "warmth", "friendly", "kind", "welcoming", "genuine", "personal", "passion", "passionate", "gracious", "hospitable", "caring"] },
  { key: "food", label: "Food & drink", emoji: "☕", words: ["coffee", "food", "wine", "tasting", "taste", "tasty", "delicious", "meal", "meals", "restaurant", "dish", "dishes", "drinks", "cuisine", "snack"] },
  { key: "organization", label: "Well organized", emoji: "🗺️", words: ["organized", "organised", "punctual", "on time", "smooth", "planned", "itinerary", "schedule", "pace", "seamless"] },
  { key: "value", label: "Value", emoji: "💰", words: ["value", "worth", "affordable", "reasonable", "price", "great deal"] },
  { key: "scenery", label: "Scenery", emoji: "🏞️", words: ["views", "view", "scenery", "scenic", "beautiful", "sights", "spots", "photo", "photos", "stunning"] },
];

/** Count, per theme, how many of `texts` mention it (>=1 keyword). Sorted desc.
 *  `kind` picks a theme vocabulary appropriate to the listing (stays vs activities). */
export function computeMentions(texts: string[], kind: "stay" | "tour" | "experience" | "eat" = "stay"): Mention[] {
  const themes = kind === "stay" ? STAY_THEMES : ACTIVITY_THEMES;
  const lc = texts.map((t) => ` ${(t || "").toLowerCase()} `).filter((t) => t.trim());
  if (!lc.length) return [];
  return themes.map((th) => ({
    key: th.key,
    label: th.label,
    emoji: th.emoji,
    count: lc.filter((t) => th.words.some((w) => t.includes(w))).length,
  }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count);
}
