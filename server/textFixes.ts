/**
 * Admin bulk text fixes: find published listings whose card text (title,
 * eyebrow, short description) breaks the shared length rules
 * (shared/listings.ts LISTING_TEXT_LIMITS — introduced after most listings were
 * written), have Aha suggest a version that fits with the same facts, and save
 * ONLY what an admin approves. Service role (admin-gated in routes.ts):
 * restaurants/places have no operator write path, and an admin fixing an
 * operator's listing must not touch its review status — a service-role update
 * skips the review-gate trigger and changes only the approved columns.
 *
 * Long descriptions are out of scope: expanding one would mean inventing
 * content, and none exceed the 5000 max. Restaurant/place eyebrows are derived
 * from their venue type / category on every admin save, so they're skipped too.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listingTextLimits, listingTextProblem, type ListingType } from "../shared/listings.js";
import { generateListingCopy, type AhaListingType } from "./ahaCopy.js";

export type FixField = "title" | "eyebrow" | "shortDescription";
const COLUMN: Record<FixField, string> = { title: "title", eyebrow: "eyebrow", shortDescription: "short_description" };
const CURATED = new Set(["eat", "place"]);

function fieldsFor(type: string): FixField[] {
  return CURATED.has(type) ? ["title", "shortDescription"] : ["title", "eyebrow", "shortDescription"];
}

export interface TextFixProblem {
  field: FixField;
  current: string;
  problem: string;
  min: number;
  max: number;
}
export interface TextFixListing {
  id: string;
  slug: string;
  type: ListingType;
  title: string;
  city: string;
  problems: TextFixProblem[];
}

type Row = {
  id: string; slug: string; type: ListingType; title: string; eyebrow: string | null; short_description: string | null;
  long_description: string | null; city: string | null; region: string | null; venue_type: string | null; cuisine: string | null;
};
const COLS = "id, slug, type, title, eyebrow, short_description, long_description, city, region, venue_type, cuisine";

function valueOf(row: Row, field: FixField): string {
  return (field === "title" ? row.title : field === "eyebrow" ? row.eyebrow : row.short_description) ?? "";
}

function problemsOf(row: Row): TextFixProblem[] {
  return fieldsFor(row.type).flatMap((field) => {
    const current = valueOf(row, field);
    const problem = listingTextProblem(field, current, { listingType: row.type });
    if (!problem) return [];
    const { min, max } = listingTextLimits(field, row.type);
    return [{ field, current, problem, min, max }];
  });
}

/** Every published listing with at least one card-text field outside the rules. */
export async function scanTextFixes(admin: SupabaseClient): Promise<TextFixListing[]> {
  const { data, error } = await admin.from("listings").select(COLS).eq("status", "published").order("type").order("title");
  if (error) throw error;
  return ((data ?? []) as Row[])
    .map((row) => ({ id: row.id, slug: row.slug, type: row.type, title: row.title, city: row.city ?? "", problems: problemsOf(row) }))
    .filter((l) => l.problems.length > 0);
}

export interface TextFixSuggestion {
  field: FixField;
  current: string;
  suggested: string;
  /** null when the suggestion fits the rules; otherwise why it doesn't (admin can edit). */
  problem: string | null;
}

/**
 * Aha suggestion for ONE out-of-range field of one listing (nothing is saved).
 * One field per request keeps each call well inside the serverless time limit.
 * Returns null if the listing is gone or that field already fits.
 */
export async function suggestTextFix(admin: SupabaseClient, listingId: string, field: FixField): Promise<TextFixSuggestion | null> {
  const { data, error } = await admin.from("listings").select(COLS).eq("id", listingId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Row;
  const listingType = row.type as AhaListingType;
  const out: TextFixSuggestion[] = [];
  for (const p of problemsOf(row).filter((x) => x.field === field)) {
    const { text } = await generateListingCopy({
      field: p.field,
      mode: "improve",
      listingType,
      current: p.current,
      context: {
        title: p.field === "title" ? undefined : row.title,
        city: row.city ?? undefined,
        region: row.region ?? undefined,
        venueType: row.venue_type ?? undefined,
        cuisine: row.cuisine ?? undefined,
        shortDescription: row.short_description ?? undefined,
        longDescription: row.long_description ? row.long_description.slice(0, 1500) : undefined,
        notes: `Rewrite the existing ${p.field} so it fits ${p.min}–${p.max} characters. Keep the same facts, names and meaning — don't add anything new.`,
      },
    });
    const suggested = (text ?? "").trim();
    out.push({
      field: p.field,
      current: p.current,
      suggested,
      problem: suggested ? listingTextProblem(p.field, suggested, { listingType: row.type }) : "Aha AI couldn't draft this one — type a version yourself.",
    });
  }
  return out[0] ?? null;
}

/**
 * Save admin-approved text. Every value is re-checked against the rules here
 * (never trust the client), and only the given card-text columns change.
 */
export async function applyTextFixes(
  admin: SupabaseClient,
  listingId: string,
  changes: Partial<Record<FixField, string>>,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data, error } = await admin.from("listings").select("id, type, status").eq("id", listingId).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 404, error: "That listing no longer exists." };
  const type = data.type as ListingType;
  const allowed = fieldsFor(type);
  const update: Record<string, string> = {};
  for (const [field, raw] of Object.entries(changes) as [FixField, string | undefined][]) {
    if (raw === undefined) continue;
    if (!allowed.includes(field)) return { ok: false, status: 400, error: "That field can't be changed here." };
    const value = raw.replace(/\s+/g, " ").trim();
    const problem = listingTextProblem(field, value, { listingType: type });
    if (problem) return { ok: false, status: 400, error: problem };
    update[COLUMN[field]] = value;
  }
  if (Object.keys(update).length === 0) return { ok: false, status: 400, error: "Nothing to save." };
  const { error: upErr } = await admin.from("listings").update(update).eq("id", listingId);
  if (upErr) throw upErr;
  return { ok: true };
}
