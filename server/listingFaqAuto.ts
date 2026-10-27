/**
 * Automatic guest FAQ (0118). Haiku writes each published listing's FAQ from its
 * own posted details (`listingFaqFacts`), a second Haiku pass keeps only answers
 * every claim of which is in those facts (`verifyListingFaq`), and the result
 * goes live. When the details change (hash of the facts differs) it's rewritten.
 * Once the host saves their own version (`faq_host_saved_at`), that listing's
 * FAQ is never touched again. Run by netlify/functions/faq-auto.ts.
 *
 * Service-role writes (a cron, not a user). Never throws.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeCancellationPolicy } from "../shared/bookings.js";
import { cleanFaq } from "../shared/listingFaq.js";
import { ahaCopyConfigured, generateListingFaq, verifyListingFaq } from "./ahaCopy.js";

type Row = Record<string, any>;

/** The listing's posted details, as plain "Label: value" lines — the only thing Aha may answer from. */
export function listingFaqFacts(row: Row): string[] {
  const list = (label: string, v: unknown) => (Array.isArray(v) && v.length ? [`${label}: ${v.filter((x) => typeof x === "string").join(", ")}`] : []);
  const text = (label: string, v: unknown, max = 1500) => (typeof v === "string" && v.trim() ? [`${label}: ${v.trim().slice(0, max)}`] : []);
  const bookable = row.type === "stay" || row.type === "tour" || row.type === "experience";
  return [
    `Type: ${row.type}${row.multi_room ? " (a hotel / guesthouse with several rooms)" : ""}`,
    ...text("Title", row.title),
    `Location: ${Array.from(new Set([row.city, row.region].filter(Boolean))).join(", ")}, Armenia`,
    ...text("Neighbourhood", row.neighborhood, 800),
    ...text("Venue type", row.venue_type),
    ...text("Cuisine", row.cuisine),
    ...text("Summary", row.short_description),
    ...text("Description", row.long_description, 3000),
    ...(Array.isArray(row.facts) ? (row.facts as { label?: string; value?: string }[]).filter((f) => f.label && f.value).map((f) => `${f.label}: ${f.value}`) : []),
    ...(row.max_guests ? [`Maximum guests: ${row.max_guests}`] : []),
    ...list("Amenities / included", row.amenities),
    ...list("House rules", row.house_rules),
    ...list("Itinerary / highlights", row.highlights),
    ...list("Not included", row.not_included),
    ...list("What to bring", row.what_to_bring),
    ...list("Not suitable for", row.not_suitable_for),
    ...text("Important information", row.important_info),
    ...(bookable
      ? [
          `Cancellation: ${describeCancellationPolicy(row.cancellation_policy, { freeCancelDays: row.free_cancel_days ?? undefined, discountPercent: row.nonrefundable_discount_percent ?? undefined })}`,
          ...(row.booking_mode === "request" ? ["Booking: the host approves each request first, then the guest pays"] : []),
          "Payment: paid in full on Revamp by card when booking; the booking is confirmed once the payment goes through",
        ]
      : []),
  ];
}

export const factsHash = (facts: string[]) => createHash("sha256").update(facts.join("\n")).digest("hex").slice(0, 32);

/**
 * Draft + fact-check FAQ items for a listing row. `existing` = questions to avoid
 * repeating. Throws if either model call fails, so a failure is retried later
 * instead of being stored as "nothing to say".
 */
export async function draftVerifiedFaq(row: Row, existing: string[] = []): Promise<{ q: string; a: string }[]> {
  const facts = listingFaqFacts(row);
  const drafted = await generateListingFaq({ listingType: row.type, facts, existing });
  if (!drafted) throw new Error("faq draft failed");
  const verified = await verifyListingFaq(facts, cleanFaq(drafted));
  if (!verified) throw new Error("faq check failed");
  return cleanFaq(verified);
}

/** Listings whose automatic FAQ is missing or out of date (and the host hasn't taken it over). */
function needsFaq(row: Row): boolean {
  if (row.status !== "published" || row.faq_host_saved_at) return false;
  if (row.is_active === false) return false; // switched off — out of every public surface (a suspended listing's page stays up, so it still gets one)
  return row.faq_facts_hash !== factsHash(listingFaqFacts(row));
}

/** Write automatic FAQs for up to `max` listings that need one. Returns counts for logging. */
export async function runAutoFaq(
  admin: SupabaseClient,
  max = 3,
  draft: (row: Row) => Promise<{ q: string; a: string }[]> = (row) => draftVerifiedFaq(row),
): Promise<{ pending: number; updated: number; empty: number; failed: number }> {
  const out = { pending: 0, updated: 0, empty: 0, failed: 0 };
  if (!ahaCopyConfigured()) return out;
  const { data, error } = await admin.from("listings").select("*").eq("status", "published");
  if (error || !data) {
    console.error("[faq-auto] list failed", error?.message);
    out.failed++;
    return out;
  }
  const due = (data as Row[]).filter((r) => "faq_facts_hash" in r && needsFaq(r));
  out.pending = due.length;
  await Promise.all(
    due.slice(0, max).map(async (row) => {
      try {
        const items = await draft(row);
        // Too little to say from the posted details → store none, but remember the facts so it
        // isn't retried until they change.
        const faq = items.length >= 2 ? items : [];
        const { error: upErr } = await admin
          .from("listings")
          .update({ faq, faq_facts_hash: factsHash(listingFaqFacts(row)) })
          .eq("id", row.id)
          .is("faq_host_saved_at", null); // the host may have saved in the meantime — theirs wins
        if (upErr) throw upErr;
        if (faq.length) out.updated++;
        else out.empty++;
      } catch (err) {
        console.error("[faq-auto]", row.slug, err);
        out.failed++;
      }
    }),
  );
  return out;
}
