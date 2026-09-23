/**
 * Support-chat AI — the first responder for the central Revamp support thread
 * (see supabase/migrations/0013_support_chat.sql). Calls Anthropic server-side
 * (same key/pattern as server/planner.ts), grounded in the live catalog and the
 * real booking/cancellation rules so it never invents prices, policies, or
 * reviews. Returns a reply plus a `needsHuman` flag it sets when a question is
 * account/payment-specific, a complaint, a refund request, or beyond what it
 * can answer — which routes the thread to a human admin.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CatalogEntry } from "./planner.js";

export interface SupportTurn {
  sender: "traveler" | "ai" | "support";
  body: string;
}

export interface SupportReply {
  reply: string;
  needsHuman: boolean;
}

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  return client;
}

export function supportAiConfigured(): boolean {
  return !!getClient();
}

function catalogDigest(listings: CatalogEntry[]): string {
  const line = (l: CatalogEntry) => {
    // Eat = free recommendation: describe by venue type + cuisine + price band,
    // never a bookable price. Everything else shows its price. Include the slug
    // so the model can link the listing.
    const meta =
      l.type === "eat"
        ? [l.venueType, l.cuisine, l.priceBand].filter(Boolean).join(" · ") || "restaurant"
        : `${l.priceLabel}/${l.priceUnit}`;
    return `- ${l.title} — ${meta} (${l.city}, ${l.region}) [slug: ${l.slug}]`;
  };
  const byType = (type: CatalogEntry["type"]) =>
    listings.filter((l) => l.type === type).map(line).join("\n") || "(none listed)";
  return [
    "STAYS:", byType("stay"),
    "RESTAURANTS & CAFÉS (each line shows its venue type — do not miscategorize; a bar/restrobar is not a coffee shop):", byType("eat"),
    "TOURS:", byType("tour"),
    "EXPERIENCES:", byType("experience"),
  ].join("\n");
}

const SYSTEM = `You are the customer-support assistant for Revamp Vacations, an Armenia-focused travel marketplace. You speak for "Revamp Vacations" (never for an individual operator). Be warm, concise, and genuinely helpful.

How Revamp works (answer only from this — do not invent details):
- Travelers book stays, tours, and experiences. Restaurants are editorial listings and are not booked online.
- Booking: pick dates (and guests) on a listing, pay securely via PayLink; a booking is confirmed once payment clears.
- Cancellation depends on the listing's policy: "flexible" = free cancellation until a set number of days before check-in, no refund after; "non-refundable" = a cheaper rate with no refunds. The exact terms and any refund amount are shown on each booking.
- Accounts: travelers can save places, see their trips, and manage their profile at /account.
- Revamp does NOT have ratings or reviews — never claim a listing has a rating, review count, or "verified" badge.

Rules:
- Never invent prices, availability, policies, refund amounts, ratings, or reviews. If you don't know a specific listing's detail, say so and offer to connect them to the team.
- Recommend only listings in CURRENT CATALOG, and describe each one accurately by its stated venue type — never call a bar, restrobar, or restaurant a "coffee shop" (or vice versa). Only suggest a coffee spot if its venue type actually is a café/coffee shop.
- When you name a listing, LINK it as a Markdown link to its page using its slug: [Listing Name](/listing/SLUG). Use the exact slug from the catalog. Only link listings that are in the catalog.
- Keep replies short (2-4 sentences unless steps are needed). You may use short Markdown (links, **bold**, "- " bullets) — no headings or tables.
- For anything account-specific, payment/refund disputes, changing or cancelling a specific booking, complaints, or anything you cannot answer confidently, set needsHuman to true and tell the traveler you're connecting them with the Revamp team who will follow up.

Reply with ONLY a JSON object: {"reply": "your message to the traveler (Markdown allowed)", "needsHuman": true|false}`;

function extractJson(text: string): { reply?: unknown; needsHuman?: unknown } | null {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  return (
    tryParse(text) ??
    (() => {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      return start !== -1 && end > start ? tryParse(text.slice(start, end + 1)) : null;
    })()
  );
}

/**
 * Generate the assistant's reply to the latest traveler message. Never throws
 * on an AI/config problem — returns a safe fallback with needsHuman=true so the
 * conversation still routes to a person.
 */
export async function generateSupportReply(history: SupportTurn[], listings: CatalogEntry[]): Promise<SupportReply> {
  const anthropic = getClient();
  const fallback: SupportReply = {
    reply: "Thanks for reaching out! I'm connecting you with the Revamp team — someone will follow up here shortly.",
    needsHuman: true,
  };
  if (!anthropic) return fallback;

  // Support runs on Haiku by default — support Q&A is simpler than trip planning,
  // and Haiku is ~3× cheaper. Override with SUPPORT_MODEL if needed. (Separate
  // from ANTHROPIC_MODEL so the trip planner can stay on a stronger model.)
  const model = process.env.SUPPORT_MODEL || "claude-haiku-4-5";
  // Map our roles to the Anthropic conversation: traveler → user, ai/support → assistant.
  const messages = history
    .filter((m) => m.body.trim())
    .slice(-12)
    .map((m) => ({ role: m.sender === "traveler" ? ("user" as const) : ("assistant" as const), body: m.body }));
  // The API requires the first message to be from the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return fallback;

  // Cache the stable system + catalog prefix — it's identical across every
  // message and every user, so repeat calls read it at ~10% cost instead of
  // re-sending the whole catalog each time. `cache_control` is a valid wire
  // field the API honors; the installed SDK (0.32) just doesn't type it on
  // system blocks yet, hence the cast.
  const systemPrompt = [
    { type: "text", text: `${SYSTEM}\n\nCURRENT CATALOG:\n${catalogDigest(listings)}`, cache_control: { type: "ephemeral" } },
  ] as unknown as Anthropic.MessageCreateParams["system"];

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 700,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.body })),
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const parsed = extractJson(text);
    if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) return fallback;
    return { reply: parsed.reply.trim(), needsHuman: parsed.needsHuman === true };
  } catch (err) {
    console.error("[support] AI reply failed", err);
    return fallback;
  }
}
