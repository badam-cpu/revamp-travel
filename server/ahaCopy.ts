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
import { LISTING_TEXT_LIMITS, listingTextLimits } from "../shared/listings.js";

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

export type AhaField = "title" | "eyebrow" | "shortDescription" | "longDescription" | "highlights" | "neighborhood";
export type AhaMode = "generate" | "improve";
export type AhaListingType = "stay" | "tour" | "experience" | "eat" | "place";

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
  place: "A place to visit (museum, gallery, library, gift shop, coworking space, etc.). Lead with what it is and where, what you'll see or do there, the atmosphere, and practical good-to-knows (hours, entry). Editorial, not salesy — these are free picks.",
};

// Length ranges come from the same rules the listing forms enforce
// (shared/listings.ts LISTING_TEXT_LIMITS), so Aha's text always fits a card.
const T = LISTING_TEXT_LIMITS;
const FIELD_GUIDE: Record<AhaField, string> = {
  title: `A listing TITLE: a specific, appealing name — between ${T.title.min} and ${T.title.max} characters INCLUDING spaces (it must fit two short lines on a card), no ALL CAPS, no clickbait, no quotes, no "|" separators. Return the title only.`,
  eyebrow: `A CATEGORY LABEL (the small line above the title on a card): what kind of listing this is, in plain words — between ${T.eyebrow.min} and ${T.eyebrow.max} characters INCLUDING spaces, e.g. "City-centre apartment", "Wine & lavash class". No place names, no punctuation at the end. Return the label only.`,
  shortDescription: `A SHORT DESCRIPTION: one sentence of ${T.shortDescription.min}–${T.shortDescription.max} characters INCLUDING spaces (it must fit two short lines on a card) that leads with the place + the hook. No line breaks. Return the sentence only.`,
  longDescription: `A LONG DESCRIPTION: 2–4 short paragraphs (roughly 60–140 words, at least ${T.longDescription.min} characters). Scannable, concrete, warm. No headings, no bullet lists, no markdown. Return the paragraphs only, separated by blank lines.`,
  highlights: "HIGHLIGHTS / itinerary: 4–6 short, punchy bullet points (each ≤ ~12 words), in a sensible order. Return ONE per line, no numbering, no bullet characters, no markdown.",
  neighborhood: "A NEIGHBOURHOOD description: 1–3 short paragraphs about the area around the stay — the street, the vibe, and what's genuinely within a short walk (cafes, sights, transport, shops). Concrete and local, not generic. Only mention specific landmarks or walking distances you can infer from the city/region context — never invent them. No headings, no bullet lists, no markdown. Return the paragraphs only, separated by blank lines.",
};

const SYSTEM = `You are Aha AI, Revamp Vacations' writing assistant for operators listing on an Armenia-focused travel marketplace. You write and refine listing copy that converts and ranks.

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
      ? `TASK: Improve the operator's existing ${input.field} below — keep their true facts and intent, fix tone/clarity/structure, and apply the standards. Do not add facts they didn't state.${input.current.includes("**") ? " Keep their **bold** markers around the same words or headings." : ""}\n\nExisting ${input.field}:\n${input.current.trim()}`
      : `TASK: Write a fresh ${input.field} from the draft context. If details are thin, keep it general but never invent specifics.`;

  const userMsg = `${task}\n\nFORMAT: ${FIELD_GUIDE[input.field]}\n\nDRAFT CONTEXT:\n${ctxLines.join("\n")}`;

  const ask = async (messages: Anthropic.MessageParam[]): Promise<string> => {
    const response = await anthropic.messages.create({
      model: process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages,
    });
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  };
  // Strip accidental wrapping quotes for title/short.
  const clean = (s: string) => s.replace(/^["“']+|["”']+$/g, "").trim();

  try {
    const raw = await ask([{ role: "user", content: userMsg }]);
    if (!raw) return {};
    if (input.field === "highlights") {
      const items = raw
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(?:[-*•\d.]+\s*)/, "").trim())
        .filter(Boolean)
        .slice(0, 8);
      return { items };
    }
    let text = clean(raw);

    // Hold the card-text fields to the same length rules as the forms: one
    // corrective retry with the exact count, then trim at a word boundary as
    // a last resort (never past the max — the form would refuse it).
    if (input.field === "title" || input.field === "eyebrow" || input.field === "shortDescription" || input.field === "longDescription") {
      const { min, max } = listingTextLimits(input.field, input.listingType);
      const fits = (s: string) => s.length >= min && s.length <= max;
      if (!fits(text)) {
        const retry = clean(
          await ask([
            { role: "user", content: userMsg },
            { role: "assistant", content: text },
            {
              role: "user",
              content: `That is ${text.length} characters. It must be between ${min} and ${max} characters including spaces. ${text.length > max ? "Shorten it" : "Expand it a little"} — same facts, same standards. Return only the ${input.field}.`,
            },
          ]),
        );
        if (retry && (fits(retry) || Math.abs(retry.length - max) < Math.abs(text.length - max))) text = retry;
      }
      if (text.length > max) text = trimToWords(text, max);
    }
    return { text };
  } catch (err) {
    console.error("[aha-copy] generation failed", err);
    return {};
  }
}

/** Cut at the last whole word that fits (and drop a dangling separator). */
function trimToWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const atSpace = cut.lastIndexOf(" ");
  return (atSpace > max * 0.6 ? cut.slice(0, atSpace) : s.slice(0, max)).replace(/[\s,;:–—|&-]+$/, "").trim();
}

// ── Customer Journey (0097): draft a guest message template ──────────────────

export interface AhaJourneyInput {
  step: "checkin" | "midstay" | "checkout" | "meeting" | "after";
  listingType: "stay" | "tour" | "experience";
  current?: { subject?: string; body?: string; textBody?: string };
  context: { title?: string; city?: string; facts?: { label: string; value: string }[]; notes?: string };
  placeholders: string[];
}
export interface AhaJourneyResult {
  subject?: string;
  body?: string;
  textBody?: string;
}

const JOURNEY_STEP_GUIDE: Record<AhaJourneyInput["step"], string> = {
  checkin: "Check-in instructions sent before arrival: warm welcome, check-in time, address, how to get in (door code / key), Wi-Fi, parking, who to call.",
  midstay: "A short mid-stay check-in: hope they're settling in, ask if everything is OK, invite them to tell us in one tap so problems get fixed now.",
  checkout: "Checkout reminder the evening before: checkout time, a short friendly checklist (keys, windows, lights, belongings), offer help with late checkout or a taxi.",
  meeting: "Meeting-point instructions before a tour/experience: date and start time, exact meeting point and address, arrive early, what to bring, who to call if late.",
  after: "Thank-you after the stay/experience: genuine thanks, hope they enjoyed Armenia, ask how it went (a few seconds), invite them back.",
};

/** Draft (or improve) a Customer Journey message — subject, email body and short text. */
export async function generateJourneyTemplate(input: AhaJourneyInput): Promise<AhaJourneyResult> {
  const anthropic = getClient();
  if (!anthropic) return {};
  const c = input.context;
  const system = `You write short, warm, practical guest messages for hosts on Revamp Vacations, a travel marketplace in Armenia.
Rules:
- English. Friendly, clear, human. No clichés, no emoji, no exclamation spam, no ALL CAPS.
- Use ONLY these placeholders, in curly braces, exactly as written: ${input.placeholders.map((p) => `{${p}}`).join(" ")}. Never invent facts (codes, times, addresses) — use a placeholder instead.
- Put each detail (time, address, code, Wi-Fi, parking) on its own line as "**Label:** {placeholder}" so lines without a value can be dropped automatically.
- Bold uses **double asterisks**; nothing else (no headings, links or markdown lists other than "• " bullets).
- The email already has a button to the guest's trip page — don't paste {trip_link} in the email body.
- The text message (SMS) must be under 160 characters and end with {trip_link}.
Return ONLY JSON: {"subject": "...", "body": "...", "textBody": "..."} — body uses \\n for line breaks.`;
  const lines = [
    `Message: ${JOURNEY_STEP_GUIDE[input.step]}`,
    `Listing type: ${input.listingType}`,
    c.title ? `Listing: ${c.title}` : "",
    c.city ? `City: ${c.city}, Armenia` : "",
    c.facts?.length ? `Facts: ${c.facts.filter((f) => f.label && f.value).map((f) => `${f.label}: ${f.value}`).join("; ")}` : "",
    c.notes ? `Host notes: ${c.notes}` : "",
  ].filter(Boolean);
  const cur = input.current;
  const task =
    cur && (cur.subject?.trim() || cur.body?.trim())
      ? `Improve this message — keep the host's facts, intent and placeholders, fix tone and clarity:\nSubject: ${cur.subject ?? ""}\nBody:\n${cur.body ?? ""}\nText: ${cur.textBody ?? ""}`
      : "Write this message from scratch.";
  try {
    const response = await anthropic.messages.create({
      model: process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 900,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: `${task}\n\n${lines.join("\n")}` }],
    });
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as AhaJourneyResult;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
    return { subject: str(parsed.subject, 200), body: str(parsed.body, 6000), textBody: str(parsed.textBody, 480) };
  } catch (err) {
    console.error("[aha-journey]", err);
    return {};
  }
}

export interface AhaFaqInput {
  listingType: AhaListingType;
  facts: string[]; // "Label: value" lines, all taken from the listing itself
  existing: string[]; // questions the host already has — don't repeat them
}

/**
 * Draft guest FAQ entries (0118) from the listing's own data — the questions
 * guests usually ask before booking, answered ONLY from the facts given. A
 * question the facts can't answer is left out, never guessed. The host edits and
 * approves every item before anything is shown.
 */
export async function generateListingFaq(input: AhaFaqInput): Promise<{ q: string; a: string }[] | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  const system = `You draft the "Questions guests ask" section for a listing on Revamp Vacations, a travel marketplace in Armenia.
Rules:
- Write 5 to 8 questions a guest typically asks BEFORE booking this kind of listing (${input.listingType}): getting there, parking, check-in / meeting point, what's included, who it suits (kids, pets, accessibility), rules, cancellation, what to bring.
- Answer ONLY from the listing facts provided. If the facts don't answer a question, leave that question out — never guess, never add amenities, times, distances, prices or promises that aren't in the facts.
- Never mention reviews, ratings, awards, "best", or contact details (phone, email, WhatsApp, Telegram) — guests contact the host through Revamp.
- Don't quote prices (they change by date).
- English. Questions short and natural, as a guest would ask. Answers 1–3 friendly, plain sentences in a neutral, factual voice about the place ("The apartment has…", "The tour starts at…") — not "we"/"I".
- Don't repeat questions the host already has.
Return ONLY JSON: {"items": [{"q": "...", "a": "..."}]}`;
  const msg = [
    "Listing facts:",
    ...input.facts.map((f) => `- ${f}`),
    input.existing.length ? `\nThe host already has these questions:\n${input.existing.map((q) => `- ${q}`).join("\n")}` : "",
  ].join("\n");
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 1800,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: msg }],
    });
  } catch (err) {
    console.error("[aha-faq]", err);
    return null; // the request failed (not billed) — retry later
  }
  // A reply we can't read counts as "nothing to say" (billed — so never retried in a loop).
  const parsed = parseJsonReply(response) as { items?: unknown } | null;
  return Array.isArray(parsed?.items) ? (parsed.items as { q: string; a: string }[]) : [];
}

/** The JSON object in a model reply, or null when there isn't a readable one. */
function parseJsonReply(response: Anthropic.Message): unknown {
  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  try {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    console.error("[aha-faq] unreadable reply");
    return null;
  }
}

/**
 * Second pass for automatic FAQs (0118): keep only answers whose every claim is
 * stated in the listing facts. Anything the model can't tie to a fact is dropped,
 * so a published answer never says more than the listing does. null = the request
 * failed (retried later); an unreadable reply keeps nothing (fail closed).
 */
export async function verifyListingFaq(facts: string[], items: { q: string; a: string }[]): Promise<{ q: string; a: string }[] | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  if (!items.length) return [];
  const system = `You check a travel listing's FAQ against the listing's facts.
For each numbered question-and-answer, decide whether EVERY claim in the answer is directly stated by (or plainly follows from) the facts. Times, distances, amenities, rules, inclusions, policies and numbers must appear in the facts. General courtesy wording is fine.
Return ONLY JSON: {"supported": [list of the numbers that pass]}`;
  const msg = `Listing facts:\n${facts.map((f) => `- ${f}`).join("\n")}\n\nFAQ:\n${items.map((it, i) => `${i + 1}. Q: ${it.q}\n   A: ${it.a}`).join("\n")}`;
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: msg }],
    });
  } catch (err) {
    console.error("[aha-faq-verify]", err);
    return null;
  }
  const parsed = parseJsonReply(response) as { supported?: unknown } | null;
  const keep = new Set((Array.isArray(parsed?.supported) ? parsed.supported : []).map((n) => Number(n)));
  return items.filter((_, i) => keep.has(i + 1));
}
