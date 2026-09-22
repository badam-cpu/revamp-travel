/**
 * Operator assistant AI — a data-only Q&A helper for a signed-in operator about
 * THEIR OWN bookings and payouts. Called by POST /api/operator-assistant, which
 * fetches the operator's data (RLS-scoped) and passes a compact summary here as
 * the sole source of truth. Same Anthropic key/pattern and Haiku default as
 * server/support.ts, with the stable instructions prompt-cached.
 *
 * It never invents figures, never sees another operator's data, and gives no
 * tax/accounting/financial advice — it only reports and summarizes the numbers
 * it's given.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface OperatorTurn {
  role: "user" | "assistant";
  body: string;
}

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    client = apiKey ? new Anthropic({ apiKey }) : null;
  }
  return client;
}

export function operatorAssistantConfigured(): boolean {
  return !!getClient();
}

const SYSTEM = `You are Aha, the AI assistant for Revamp Vacations, an Armenia-focused travel marketplace. You help an operator (a host) with two things: (1) THEIR OWN bookings and payouts, and (2) how to be a great host, using Revamp's Partner Hub knowledge base.

You are given two context sections. Rules:

For numbers — answer ONLY from the "OPERATOR DATA" section (the single source of truth):
- Never invent or estimate bookings, guests, amounts, dates, or payout figures. If the data doesn't contain the answer, say so plainly and point to the dashboard (Bookings or Payouts).
- Do NOT give tax, accounting, legal, or investment advice. You only report and summarize the operator's own numbers.
- Money amounts are already in the currency shown next to each figure (usually Armenian dram, AMD). Don't convert currencies.
- This is one operator's private data. Never reference other operators or the wider marketplace's numbers.

For hosting guidance (listing quality, reviews, hosting standards, local news) — answer from the "KNOWLEDGE BASE" section (Partner Hub articles):
- SUMMARIZE in your own words — a few crisp sentences or 2-4 short bullets. NEVER reproduce, quote, or paste the article's text. Give the operator the gist, not the whole guide.
- Then point them to the source with a link, using EXACTLY this Markdown, filling in the article's title and its slug from the KNOWLEDGE BASE entry: [Read the full guide: TITLE](/dashboard?section=hub&article=SLUG)
- Cite at most one or two articles. If the knowledge base doesn't cover it, say so rather than inventing Revamp policy.
- You may combine both: e.g. use the operator's own listings/data to make the advice specific.

Be concise, warm, and specific — aim for under ~120 words unless asked for more. Reply in short Markdown: **bold** for emphasis, "- " bullets, and links are allowed. No headings, no tables, no code blocks.`;

/**
 * Generate the assistant's reply. `dataSummary` is the operator's own
 * bookings/payouts digest (built server-side). Never throws — returns a safe
 * fallback string on any AI/config problem.
 */
export async function generateOperatorReply(history: OperatorTurn[], dataSummary: string, knowledgeBase = ""): Promise<string> {
  const anthropic = getClient();
  const fallback = "I can't reach the assistant right now — your bookings and payouts are always on the Bookings and Payouts tabs.";
  if (!anthropic) return fallback;

  const model = process.env.SUPPORT_MODEL || "claude-haiku-4-5";
  const messages = history.filter((m) => m.body.trim()).slice(-12);
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return fallback;

  // Cache the stable instructions; the per-operator data changes each call, so
  // it goes in a second, uncached system block.
  const system = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: `KNOWLEDGE BASE — Partner Hub articles (cite by title; the source for hosting guidance):\n${knowledgeBase || "(no articles published yet)"}` },
    { type: "text", text: `OPERATOR DATA (the only source of truth for this operator's numbers):\n${dataSummary}` },
  ] as unknown as Anthropic.MessageCreateParams["system"];

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 600,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.body })),
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallback;
  } catch (err) {
    console.error("[operator-assistant] AI reply failed", err);
    return fallback;
  }
}
