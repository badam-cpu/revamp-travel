/**
 * Guest contact details are private until a booking is paid (migration 0113).
 * Hosts can read the bookings on their listings, so an UNPAID Revamp booking
 * keeps the guest's email + phone in booking_guest_contacts (server/admin only)
 * instead of on the row; the DB trigger copies them onto the booking when it
 * becomes confirmed. Anonymous pre-booking questions keep the guest's email in
 * conversation_guest_contacts. The server (service role) always reads both.
 *
 * Use holdContactFields() when inserting a booking, contactFor() whenever the
 * server needs to email/text the guest, and the conversation helpers for
 * listing inquiries. Every call is failure-tolerant: before 0113 the contact
 * simply stays on the row as it always did.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PAID = new Set(["confirmed", "completed"]);

export interface HeldContact {
  guest_email: string | null;
  guest_phone: string | null;
}

/**
 * Splits a booking row about to be inserted: for an unpaid Revamp booking the
 * email/phone come off the row (returned to hold privately after insert).
 * Paid-at-insert bookings (gift/credit-covered) and host-entered offline
 * bookings keep them.
 */
export function holdContactFields(row: Record<string, unknown>): HeldContact | null {
  const status = String(row.status ?? "");
  if (PAID.has(status) || row.provider === "direct") return null;
  const email = (row.guest_email as string | null | undefined) ?? null;
  const phone = (row.guest_phone as string | null | undefined) ?? null;
  if (!email && !phone) return null;
  delete row.guest_email;
  delete row.guest_phone;
  return { guest_email: email, guest_phone: phone };
}

/**
 * Stores held contacts for inserted bookings. If the private table isn't there
 * yet (before 0113), puts them back on the bookings so nothing is lost.
 */
export async function storeHeldContacts(admin: SupabaseClient, held: { bookingId: string; contact: HeldContact }[]): Promise<void> {
  if (!held.length) return;
  const { error } = await admin.from("booking_guest_contacts").upsert(
    held.map((h) => ({ booking_id: h.bookingId, ...h.contact })),
    { onConflict: "booking_id" },
  );
  if (!error) return;
  console.error("[guest contacts] hold failed — keeping on the booking", error.message);
  for (const h of held) await admin.from("bookings").update(h.contact).eq("id", h.bookingId);
}

/** The guest's email/phone for a booking: on the row (paid / direct) or held privately (unpaid). */
export async function contactFor(admin: SupabaseClient, booking: { id: string; guest_email?: string | null; guest_phone?: string | null }): Promise<{ email: string | null; phone: string | null }> {
  let email = booking.guest_email ?? null;
  let phone = booking.guest_phone ?? null;
  if (email && phone) return { email, phone };
  const { data } = await admin.from("booking_guest_contacts").select("guest_email, guest_phone").eq("booking_id", booking.id).maybeSingle();
  const c = data as HeldContact | null;
  email ||= c?.guest_email ?? null;
  phone ||= c?.guest_phone ?? null;
  return { email, phone };
}

/** Anonymous question: keep the guest's email out of the host's reach (0113; falls back to the conversation row before it). */
export async function setConversationGuestEmail(admin: SupabaseClient, conversationId: string, email: string | null): Promise<void> {
  if (!email) return;
  const { error } = await admin.from("conversation_guest_contacts").upsert({ conversation_id: conversationId, guest_email: email }, { onConflict: "conversation_id" });
  if (error) await admin.from("conversations").update({ guest_email: email }).eq("id", conversationId);
}

export async function conversationGuestEmail(admin: SupabaseClient, conversationId: string, onRow?: string | null): Promise<string | null> {
  if (onRow) return onRow;
  const { data } = await admin.from("conversation_guest_contacts").select("guest_email").eq("conversation_id", conversationId).maybeSingle();
  return (data as { guest_email: string | null } | null)?.guest_email ?? null;
}

/** holdContactFields on a copy: [row to insert, contact to hold after insert]. */
export function splitContact<T extends Record<string, unknown>>(row: T): [T, HeldContact | null] {
  const copy = { ...row };
  return [copy, holdContactFields(copy)];
}
