/**
 * AI trip planner — a deliberate, documented backend addition (see
 * CLAUDE.md). Calls the Anthropic API directly from the server so the API
 * key never reaches the browser. Requires `ANTHROPIC_API_KEY`; see
 * ENVIRONMENT.md.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Listing } from "../shared/listings.js";

export class PlannerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PlanTripParams {
  days: number;
  startCity: string;
  travelers: number;
  pace: "relaxed" | "balanced" | "packed";
  budget: "budget" | "mid-range" | "comfort";
  interests: string[];
}

export interface ItineraryDay {
  day: number;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  tip?: string;
}

export interface Itinerary {
  tripTitle: string;
  summary: string;
  days: ItineraryDay[];
  estimatedBudget: string;
  packingTip: string;
}

let client: Anthropic | null | undefined;

function getClient(): Anthropic {
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  if (!client) {
    throw new PlannerError(
      503,
      "The AI trip planner isn't configured yet — set ANTHROPIC_API_KEY on the server (see ENVIRONMENT.md) and restart.",
    );
  }
  return client;
}

function catalogDigest(listings: Listing[]): string {
  const byType = (type: Listing["type"]) =>
    listings
      .filter((l) => l.type === type)
      .map((l) => `- ${l.title} (${l.city}, ${l.region}) — ${l.priceLabel}/${l.priceUnit} — ${l.shortDescription}`)
      .join("\n") || "(none listed)";

  return [
    "STAYS:",
    byType("stay"),
    "",
    "RESTAURANTS & TABLES:",
    byType("eat"),
    "",
    "TOURS & EXPERIENCES:",
    byType("tour"),
  ].join("\n");
}

function buildPrompt(params: PlanTripParams, listings: Listing[]): string {
  return `You are the trip-planning assistant for Revamp Travel, an Armenia-focused travel marketplace. Build a ${params.days}-day Armenia itinerary starting from ${params.startCity}, for ${params.travelers} traveler(s), at a "${params.pace}" pace and "${params.budget}" budget level. Focus on these interests: ${params.interests.length ? params.interests.join(", ") : "a good general mix"}.

Ground the plan in Revamp Travel's real catalog below — mention specific stays, restaurants, and tours by name where they genuinely fit the route (you don't need to use all of them, and you may add small logistics like driving time or a market stop even if it's not in the catalog). Do not invent star ratings, review counts, or "verified" claims — none of these listings have them.

${catalogDigest(listings)}

Reply with ONLY a JSON object, no other text, in exactly this shape:
{
  "tripTitle": "short evocative title",
  "summary": "one sentence overview of the trip's shape",
  "days": [
    {"day": 1, "title": "short title for the day", "morning": "text", "afternoon": "text", "evening": "text", "tip": "one practical tip for this day"}
  ],
  "estimatedBudget": "one short line, e.g. $650-800 per person total (illustrative)",
  "packingTip": "one short practical packing or logistics tip for the whole trip"
}
Include exactly ${params.days} entries in "days", numbered 1 to ${params.days}.`;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to a tolerant extraction
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new PlannerError(502, "The trip planner returned an unexpected response. Please try again.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PlannerError(502, "The trip planner returned an unexpected response. Please try again.");
  }
}

function validateItinerary(value: unknown): Itinerary {
  if (typeof value !== "object" || value === null) {
    throw new PlannerError(502, "The trip planner returned an unexpected response. Please try again.");
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.days) || v.days.length === 0) {
    throw new PlannerError(502, "The trip planner didn't return any days. Please try again.");
  }
  return {
    tripTitle: typeof v.tripTitle === "string" ? v.tripTitle : "Your Armenia itinerary",
    summary: typeof v.summary === "string" ? v.summary : "",
    estimatedBudget: typeof v.estimatedBudget === "string" ? v.estimatedBudget : "—",
    packingTip: typeof v.packingTip === "string" ? v.packingTip : "",
    days: (v.days as unknown[]).map((d, i) => {
      const day = (d ?? {}) as Record<string, unknown>;
      return {
        day: typeof day.day === "number" ? day.day : i + 1,
        title: typeof day.title === "string" ? day.title : `Day ${i + 1}`,
        morning: typeof day.morning === "string" ? day.morning : "",
        afternoon: typeof day.afternoon === "string" ? day.afternoon : "",
        evening: typeof day.evening === "string" ? day.evening : "",
        tip: typeof day.tip === "string" ? day.tip : undefined,
      };
    }),
  };
}

export async function planTrip(params: PlanTripParams, listings: Listing[]): Promise<Itinerary> {
  const anthropic = getClient();
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      messages: [{ role: "user", content: buildPrompt(params, listings) }],
    });
  } catch (err: unknown) {
    const anyErr = err as { status?: number; message?: string };
    if (anyErr?.status === 401 || anyErr?.status === 403) {
      throw new PlannerError(503, "The AI trip planner's API key was rejected — check ANTHROPIC_API_KEY.");
    }
    if (anyErr?.status === 429) {
      throw new PlannerError(429, "The trip planner is getting a lot of requests right now — please try again in a moment.");
    }
    throw new PlannerError(502, "Couldn't reach the AI trip planner. Please try again.");
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new PlannerError(502, "The trip planner didn't return a plan. Please try again.");
  }

  return validateItinerary(extractJson(text));
}
