/**
 * Aha writing assist for listing content. Given a listing's type + draft context,
 * it generates or improves a single field (title, short/long description, or
 * highlights) — tuned to the product type (industry), search visibility (SEO/AEO),
 * and Revamp's listing standards. Same Anthropic setup as server/operatorAssistant.ts.
 *
 * Hard rule: it writes ONLY from the facts it's given. It never invents ratings,
 * reviews, awards, "verified"/"best" claims, amenities, prices, or history —
 * mirroring the app's no-fabrication policy.
 */
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  return client;
}
export function ahaCopyConfigured(): boolean {
  return !!getClient();
}

export type AhaField = "title" | "shortDescription" | "longDescription" | "highlights";
export type AhaMode = "generate" | "improve";
export type AhaListingType = "stay" | "tour" | "experience" | "eat";

export interface AhaCopyInput {
  field: AhaField;
  mode: AhaMode;
  listingType: AhaListingType;
  current?: string; // existing text (for "improve", or highlights as newline list)
  context: {
    title?: string;
    city?: string;
    region?: string;
    venueType?: string;
    cuisine?: string;
    priceUnit?: string;
    amenities?: string[];
    facts?: { label: string; value: string }[];
    shortDescription?: string;
    longDescription?: string;
    highlights?: string[];
    notes?: string; // free-text hints the operator typed for Aha
  };
}

export interface AhaCopyResult {
  text?: string;
  items?: string[];
}

const TYPE_GUIDE: Record<AhaListingType, string> = {
  stay: "A place to stay. Lead with what the space is and where it is (neighbourhood + city), then who it suits, standout features/amenities, and the feel. Practical and reassuring.",
  tour: "A guided tour / day trip. Lead with what you'll see and do and the route, then duration, group feel, and logistics (meeting point, languages). Active, vivid verbs.",
  experience: "A hands-on experience (class, tasting, craft). Lead with what the guest will actually do and take away, the host's expertise, and the atmosphere. Personal and sensory.",
  eat: "A restaurant/cafe recommendation. Lead with cuisine/venue type and neighbourhood, the vibe, and what it's known for. Editorial, not salesy — these are free picks.",
};

const FIELD_GUIDE: Record<AhaField, string> = {
  title: "A listing TITLE: a specific, appealing name — max ~60 characters, no ALL CAPS, no clickbait, no quotes. Return the title only.",
  shortDescription: "A one-line SHORT DESCRIPTION (~110–160 characters): a single sentence that leads with the place + the hook. No line breaks. Return the sentence only.",
  longDescription: "A LONG DESCRIPTION: 2–4 short paragraphs (roughly 60–140 words total). Scannable, concrete, warm. No headings, no bullet lists, no markdown. Return the paragraphs only, separated by blank lines.",
  highlights: "HIGHLIGHTS / itinerary: 4–6 short, punchy bullet points (each ≤ ~12 words), in a sensible order. Return ONE per line, no numbering, no bullet characters, no markdown.",
};

const SYSTEM = `You are Aha, Revamp Vacations' writing assistant for operators listing on an Armenia-focused travel marketplace. You write and refine listing copy that converts and ranks.

Follow these standards on every request:
- ACCURACY: Write ONLY from the details provided. Never invent facts, amenities, prices, distances, history, or specifics you weren't given. Never fabricate ratings, reviews, review counts, awards, "verified", "#1", "best", or any social proof.
- SEO / discoverability: naturally include the place (neighbourhood + city, Armenia) and concrete specifics travellers search for. Front-load the most important words. Be specific over generic ("a 2-bedroom apartment steps from Republic Square" beats "a lovely place in a great location"). No keyword stuffing.
- Voice: warm, confident, concrete, and human. Active voice. No clichés ("nestled", "hidden gem", "home away from home"), no exclamation spam, no emoji, no ALL CAPS.
- Truthful tone: appealing but honest — no overpromising or superlatives you can't back up.
- English. Keep Armenian place names/spellings as given.

You will get the listing TYPE, the TASK (which field + whether to generate fresh or improve existing text), the DRAFT CONTEXT (facts to write from), and optional operator NOTES. Return ONLY the requested field's content in the exact format asked — no preamble, no explanation, no quotes around it.`;

export async function generateListingCopy(input: AhaCopyInput): Promise<AhaCopyResult> {
  const anthropic = getClient();
  if (!anthropic) return {};

  const c = input.context;
  const ctxLines = [
    `Listing type: ${input.listingType} — ${TYPE_GUIDE[input.listingType]}`,
    c.title ? `Name: ${c.title}` : "",
    c.city || c.region ? `Location: ${[c.city, c.region].filter(Boolean).join(", ")}, Armenia` : "",
    c.venueType ? `Venue type: ${c.venueType}` : "",
    c.cuisine ? `Cuisine: ${c.cuisine}` : "",
    c.amenities?.length ? `Amenities/features: ${c.amenities.slice(0, 30).join(", ")}` : "",
    c.facts?.length ? `Facts: ${c.facts.filter((f) => f.label && f.value).map((f) => `${f.label}: ${f.value}`).join("; ")}` : "",
    c.highlights?.length ? `Highlights/itinerary so far: ${c.highlights.join(" | ")}` : "",
    c.shortDescription && input.field !== "shortDescription" ? `Short description: ${c.shortDescription}` : "",
    c.longDescription && input.field !== "longDescription" ? `Long description: ${c.longDescription}` : "",
    c.notes ? `Operator notes for you: ${c.notes}` : "",
  ].filter(Boolean);

  const task =
    input.mode === "improve" && input.current?.trim()
      ? `TASK: Improve the operator's existing ${input.field} below — keep their true facts and intent, fix tone/clarity/structure, and apply the standards. Do not add facts they didn't state.\n\nExisting ${input.field}:\n${input.current.trim()}`
      : `TASK: Write a fresh ${input.field} from the draft context. If details are thin, keep it general but never invent specifics.`;

  const userMsg = `${task}\n\nFORMAT: ${FIELD_GUIDE[input.field]}\n\nDRAFT CONTEXT:\n${ctxLines.join("\n")}`;

  try {
    const response = await anthropic.messages.create({
      model: process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: userMsg }],
    });
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!raw) return {};
    if (input.field === "highlights") {
      const items = raw
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(?:[-*•\d.]+\s*)/, "").trim())
        .filter(Boolean)
        .slice(0, 8);
      return { items };
    }
    // Strip accidental wrapping quotes for title/short.
    const text = raw.replace(/^["“']+|["”']+$/g, "").trim();
    return { text };
  } catch (err) {
    console.error("[aha-copy] generation failed", err);
    return {};
  }
}
