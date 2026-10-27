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

export async function voiceContext(client: SupabaseClient, slug: string): Promise<{ title: string; context: string } | null> {
  const { data } = await client.from("listings").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
  const row = data as Row | null;
  if (!row || row.is_active === false) return null;
  const faq = cleanFaq(row.faq);
  const lines = [
    `LISTING: ${row.title} (slug: ${row.slug})`,
    ...listingFaqFacts(row).map((f) => `- ${f}`),
    ...(faq.length ? ["FREQUENT QUESTIONS:", ...faq.map((f) => `- Q: ${f.q} A: ${f.a}`)] : []),
  ];
  return { title: row.title, context: lines.join("\n").slice(0, 12000) };
}

const drams = (n: number) => `${Math.round(n).toLocaleString("en-US")} drams`;
/** "20 November" — read naturally by text-to-speech (not "2026-11-20"). */
const spoken = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** One or two sentences an assistant can say out loud. */
export async function voiceQuote(
  client: SupabaseClient,
  input: { slug: string; startDate: string; endDate?: string; guests?: number },
): Promise<{ available: boolean | null; say: string }> {
  const q = await quoteListing(client, input, "listing");
  if ("error" in q) return { available: null, say: q.error };
  const when = q.endDate ? `${q.nights} night${q.nights === 1 ? "" : "s"} from ${spoken(q.startDate)} to ${spoken(q.endDate)}` : `on ${spoken(q.startDate)}`;
  if (q.available === false) return { available: false, say: `Not available ${when}. ${q.reason ?? ""} Other dates may be free — the calendar is on the listing page.`.trim() };
  const parts = [`Available ${when} for ${q.guests} guest${q.guests === 1 ? "" : "s"}.`];
  if (q.room) parts.push(`The cheapest free room is the ${q.room}.`);
  if (q.slots?.length) parts.push(`Open times: ${q.slots.map((s) => s.localTime).join(", ")}.`);
  if (q.price) parts.push(`The total is ${drams(q.price.total)}, including fees and ${q.price.tax.label.replace(/^Tax /, "").replace(/[()]/g, "")} tax.`);
  if (q.cancellation) parts.push(`${q.cancellation}.`);
  if (q.available === null && q.reason) parts.push(q.reason);
  parts.push("You can book on this page.");
  return { available: q.available, say: parts.join(" ").replace(/\.\./g, ".") };
}
