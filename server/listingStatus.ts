/**
 * Operator listing availability (migration 0101): switch a listing off/on
 * (replaces Delete in the dashboard) and suspend / resume bookings for a period.
 * Existing bookings always stand — the operator must honour them — so every
 * change reports how many upcoming bookings are affected, and every change
 * emails the admins (resolveAdminEmails). Writes go through the service role
 * after the route has checked the caller owns the listing (or is an admin); the
 * review status is never touched.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdminEmails } from "./alerts.js";
import { sendListingStatusAlert } from "./email.js";
import { suspensionRange } from "../shared/listings.js";

export type ListingStatusAction = "suspend" | "resume" | "deactivate" | "activate";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIVE_STATUSES = ["requested", "awaiting_payment", "pending_payment", "confirmed"];

export interface ListingStatusResult {
  isActive: boolean;
  suspendedFrom: string | null;
  suspendedUntil: string | null;
  /** Upcoming bookings the operator still has to honour (in the period, or all future ones). */
  bookingsToHonour: number;
}

/** Upcoming live bookings on the listing — within [from, until] when given. */
export async function upcomingBookings(admin: SupabaseClient, listingId: string, from?: string | null, until?: string | null): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  let q = admin.from("bookings").select("id", { count: "exact", head: true }).eq("listing_id", listingId).in("status", LIVE_STATUSES).gt("end_date", today);
  const r = from ? suspensionRange({ suspendedFrom: from, suspendedUntil: until ?? null }) : null;
  if (r) q = q.lt("start_date", r.end).gt("end_date", r.start);
  const { count, error } = await q;
  if (error) {
    console.error("[listing-status] booking count failed", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function changeListingStatus(
  admin: SupabaseClient,
  opts: { listingId: string; actorId: string; action: ListingStatusAction; from?: string; until?: string | null; note?: string },
): Promise<ListingStatusResult> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: listing, error } = await admin.from("listings").select("*").eq("id", opts.listingId).maybeSingle();
  if (error || !listing) throw new Error("Listing not found.");

  let patch: Record<string, unknown>;
  if (opts.action === "suspend") {
    const from = opts.from ?? "";
    const until = opts.until || null;
    if (!ISO.test(from)) throw new Error("Pick the first day you can't take bookings.");
    if (from < today) throw new Error("The suspension can't start in the past.");
    if (until && (!ISO.test(until) || until < from)) throw new Error("The last day has to be on or after the first day.");
    patch = { suspended_from: from, suspended_until: until };
  } else if (opts.action === "resume") {
    patch = { suspended_from: null, suspended_until: null };
  } else {
    patch = { is_active: opts.action === "activate" };
  }

  const { data: saved, error: upErr } = await admin.from("listings").update(patch).eq("id", opts.listingId).select("*").single();
  if (upErr || !saved) {
    console.error("[listing-status] update failed", upErr?.message);
    throw new Error("Couldn't save that change. Please try again.");
  }

  const isActive = saved.is_active !== false;
  const suspendedFrom = (saved.suspended_from as string | null) ?? null;
  const suspendedUntil = (saved.suspended_until as string | null) ?? null;
  const bookingsToHonour =
    opts.action === "suspend" ? await upcomingBookings(admin, opts.listingId, suspendedFrom, suspendedUntil) : opts.action === "deactivate" ? await upcomingBookings(admin, opts.listingId) : 0;

  // Tell the admins — never let a mail failure undo the change.
  try {
    const { data: actor } = await admin.from("profiles").select("display_name, business_name, role").eq("id", opts.actorId).maybeSingle();
    const { data: owner } = await admin.from("profiles").select("display_name, business_name").eq("id", listing.operator_id).maybeSingle();
    const actorName = (actor?.business_name || actor?.display_name || "An operator") as string;
    const to = await resolveAdminEmails(admin);
    await Promise.all(
      to.map((addr) =>
        sendListingStatusAlert(addr, {
          action: opts.action,
          listingTitle: listing.title as string,
          listingSlug: listing.slug as string,
          operatorName: (owner?.business_name || owner?.display_name || "the operator") as string,
          byAdmin: actor?.role === "admin" ? actorName : null,
          from: suspendedFrom,
          until: suspendedUntil,
          note: opts.note?.trim() || null,
          bookingsToHonour,
        }).catch((e) => console.error("[listing-status] alert email failed", e)),
      ),
    );
  } catch (e) {
    console.error("[listing-status] alert failed", e);
  }

  return { isActive, suspendedFrom, suspendedUntil, bookingsToHonour };
}
