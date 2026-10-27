/**
 * Aha Voice Assistant (Phase 3, web) — what the ElevenLabs voice agent knows.
 *
 * The listing page starts a voice session with `listing_context` (from
 * `voiceContext`): the listing's own posted details + Guest FAQ, the same facts
 * the inbox AI and the automatic FAQ use — public information only (never door
 * codes, contacts or the host's private details). For dates the agent calls the
 * `check_dates` server tool → POST /api/voice/quote (`voiceQuote`), which reuses
 * the AI connector's quote (calendars, bookings, minimum stay, all-in price)
 * and answers in one speakable sentence. Read-only: nothing is held or booked.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanFaq } from "../shared/listingFaq.js";
import { listingFaqFacts } from "./listingFaqAuto.js";
import { quoteListing } from "./mcpQuote.js";

type Row = Record<string, any>;

/**
 * Listing text written for screens, rewritten so text-to-speech says it right:
 * "1BR" → "one-bedroom", "֏ / AMD" → "drams", "m²" → "square metres",
 * "3:00 PM" → "3 PM", emoji bullets dropped.
 */
const NUM = ["zero", "one", "two", "three", "four", "five", "six"];
// Built at runtime: the "u" flag isn't allowed in regex literals for this build target.
const BULLETS = new RegExp("(?:🔸|🔹|🔶|🔷|•|✅|✔️?|➤|►)\\s*", "gu");
const EMOJI = new RegExp("[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]", "gu");
export function speakable(text: string): string {
  return text
    .replace(/\b([1-6])\s?-?BR\b/gi, (_m, n) => `${NUM[Number(n)]}-bedroom`)
    .replace(/\bstudio apt\b/gi, "studio apartment")
    .replace(/\bapt\.?\b/gi, "apartment")
    .replace(/֏\s?([\d,]+)/g, "$1 drams")
    .replace(/([\d,]+)\s?(?:AMD|֏)/g, "$1 drams")
    .replace(/\bm²|\bsq\.?\s?m\b/g, " square metres")
    .replace(/\b(\d{1,2}):00\s?(AM|PM)\b/gi, (_m, h, ap) => `${Number(h)} ${ap.toUpperCase()}`)
    .replace(BULLETS, "")
    .replace(EMOJI, "")
    .replace(/[ \t]{2,}/g, " ");
}

/** What the agent calls the listing out loud — never the marketing title. */
const spokenKind = (row: Row) =>
  row.type === "tour" ? "this tour" : row.type === "experience" ? "this experience" : row.multi_room ? "this guesthouse" : "this place";

export async function voiceContext(client: SupabaseClient, slug: string): Promise<{ title: string; context: string } | null> {
  const { data } = await client.from("listings").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
  const row = data as Row | null;
  if (!row || row.is_active === false) return null;
  const faq = cleanFaq(row.faq);
  const lines = [
    `RULES FOR THIS CALL (they apply in every language, Russian included):`,
    `- Use only the facts below. Don't add adjectives, numbers or details they don't contain (a "City View" is a city view — not a "panoramic" one). If something isn't here, say you don't have that detail.`,
    `- Suggest "Ask the host a question" at most once in the whole call, and only when the guest needs something you can't answer. Don't end every answer with it.`,
    `- When you talk, call it "${spokenKind(row)}" — don't read the listing title aloud. Say prices as a number of drams.`,
    `- If the guest wants to book: check the dates with check_dates first; if they're available, call fill_booking with the same dates and guests${row.type === "tour" || row.type === "experience" ? " (and the start time they chose)" : ""}. It fills in the booking box on the page. Then tell them to tap Book there to finish and pay. Never say it's booked or reserved — only the guest can book.`,
    `LISTING (for your reference only): ${speakable(row.title)}`,
    ...listingFaqFacts(row).map((f) => `- ${speakable(f)}`),
    ...(faq.length ? ["FREQUENT QUESTIONS:", ...faq.map((f) => `- Q: ${speakable(f.q)} A: ${speakable(f.a)}`)] : []),
  ];
  return { title: row.title, context: lines.join("\n").slice(0, 12000) };
}

/**
 * Spoken like the page shows it: the site displays prices rounded to the nearest
 * 100 drams (CurrencyContext), so Aha says the same figure — "about" when rounded.
 */
const drams = (n: number) => {
  const shown = Math.round(n / 100) * 100;
  return `${shown === Math.round(n) ? "" : "about "}${shown.toLocaleString("en-US")} drams`;
};
/** "20 November" — read naturally by text-to-speech (not "2026-11-20"). */
const spoken = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** One or two sentences an assistant can say out loud. */
export async function voiceQuote(
  client: SupabaseClient,
  input: { slug: string; startDate: string; endDate?: string; guests?: number },
): Promise<{ available: boolean | null; say: string }> {
  const q = await quoteListing(client, input, "listing");
  if ("error" in q) {
    // Technical wording from the shared quote → something a host would say.
    const say = /endDate|check-out/i.test(q.error)
      ? "For a stay I need both dates — when would you check out?"
      : /past/i.test(q.error)
        ? "That date has already passed — which dates are you thinking of?"
        : q.error;
    return { available: null, say };
  }
  const when = q.endDate ? `${q.nights} night${q.nights === 1 ? "" : "s"} from ${spoken(q.startDate)} to ${spoken(q.endDate)}` : `on ${spoken(q.startDate)}`;
  if (q.available === false) return { available: false, say: `Not available ${when}. ${q.reason ?? ""} Other dates may be free — the calendar is on the listing page.`.trim() };
  const parts = [`Available ${when} for ${q.guests} guest${q.guests === 1 ? "" : "s"}.`];
  if (q.room) parts.push(`The cheapest free room is the ${q.room}.`);
  if (q.slots?.length) parts.push(`Open times: ${q.slots.map((s) => s.localTime).join(", ")}.`);
  if (q.price) parts.push(`The total is ${drams(q.price.total)}, including fees and ${q.price.tax.label.replace(/^Tax /, "").replace(/[()]/g, "")} tax.`);
  if (q.cancellation) parts.push(`${q.cancellation}.`);
  if (q.available === null && q.reason) parts.push(q.reason);
  parts.push("You can book on this page.");
  return { available: q.available, say: speakable(parts.join(" ").replace(/\.\./g, ".")) };
}
