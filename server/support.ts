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
  const byType = (type: CatalogEntry["type"]) =>
    listings
      .filter((l) => l.type === type)
      .map((l) => `- ${l.title} (${l.city}, ${l.region}) — ${l.priceLabel}/${l.priceUnit}`)
      .join("\n") || "(none listed)";
  return [
    "STAYS:", byType("stay"),
    "RESTAURANTS:", byType("eat"),
    "TOURS:", byType("tour"),
    "EXPERIENCES:", byType("experience"),
  ].join("\n");
}

const SYSTEM = `You are the customer-support assistant for Revamp Travel, an Armenia-focused travel marketplace. You speak for "Revamp" (never for an individual operator). Be warm, concise, and genuinely helpful.

How Revamp works (answer only from this — do not invent details):
- Travelers book stays, tours, and experiences. Restaurants are editorial listings and are not booked online.
- Booking: pick dates (and guests) on a listing, pay securely via PayLink; a booking is confirmed once payment clears.
- Cancellation depends on the listing's policy: "flexible" = free cancellation until a set number of days before check-in, no refund after; "non-refundable" = a cheaper rate with no refunds. The exact terms and any refund amount are shown on each booking.
- Accounts: travelers can save places, see their trips, and manage their profile at /account.
- Revamp does NOT have ratings or reviews — never claim a listing has a rating, review count, or "verified" badge.

Rules:
- Never invent prices, availability, policies, refund amounts, ratings, or reviews. If you don't know a specific listing's detail, say so and offer to connect them to the team.
- For anything account-specific, payment/refund disputes, changing or cancelling a specific booking, complaints, or anything you cannot answer confidently, set needsHuman to true and tell the traveler you're connecting them with the Revamp team who will follow up.
- Keep replies short (2-4 sentences unless steps are needed).

Reply with ONLY a JSON object: {"reply": "your message to the traveler", "needsHuman": true|false}`;

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

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  // Map our roles to the Anthropic conversation: traveler → user, ai/support → assistant.
  const messages = history
    .filter((m) => m.body.trim())
    .slice(-12)
    .map((m) => ({ role: m.sender === "traveler" ? ("user" as const) : ("assistant" as const), body: m.body }));
  // The API requires the first message to be from the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return fallback;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 700,
      system: `${SYSTEM}\n\nCURRENT CATALOG:\n${catalogDigest(listings)}`,
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
