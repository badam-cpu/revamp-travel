/**
 * Guardrails for the unified inbox (see supabase/migrations/0038_conversations.sql
 * and the /api/message-send route). Direct traveler<->operator messaging invites
 * the usual marketplace risks — swapping contact details to take the booking
 * off-platform (which breaks the PayLink loop and Revamp's role as merchant of
 * record). We don't block a message (people have legitimate reasons to share an
 * address or a maps link), we FLAG it: the message still sends, but `flagged` is
 * stored so the admin oversight view can surface it. Deliberately lightweight and
 * dependency-free — a regex pass, not an AI call.
 *
 * Since 0111, before a guest and host have a paid booking the contact details
 * are also HIDDEN in the delivered message (maskContacts / contactsAllowed
 * below); the original is kept for admins in message_originals.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
// 7+ digits, allowing spaces / dashes / parens between them (a phone number).
const PHONE_RE = /(?:\+?\d[\s().-]?){7,}\d/;
const OFFPLATFORM_RE =
  /\b(whats\s?app|telegram|viber|signal|paypal|venmo|zelle|western\s?union|cash\s?app|revolut|iban|wire\s?transfer|bank\s?transfer|pay(?:\s|-)?(?:outside|off)|off[\s-]?platform|instagram|facebook)\b/i;

export function scanMessage(body: string): { flagged: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (EMAIL_RE.test(body)) reasons.push("email");
  if (URL_RE.test(body)) reasons.push("link");
  if (PHONE_RE.test(body)) reasons.push("phone");
  if (OFFPLATFORM_RE.test(body)) reasons.push("off-platform");
  return { flagged: reasons.length > 0, reasons };
}

// ── Hiding contact details before a booking (0111) ──────────────────────────
// Between a guest and a host, contact details are HIDDEN (not just flagged)
// until they have a confirmed, paid booking: that is where off-platform deals
// happen. After a paid booking, contact is legitimately needed (late arrival,
// a stuck door — the journey messages share the host's phone then anyway), so
// messages pass as before. Admin/Revamp messages are never touched.

export const HIDDEN_CONTACT = "[contact details are shared after booking]";
/** Revamp's own links are fine to share. */
const OWN_HOSTS = /^(?:https?:\/\/)?(?:www\.)?(?:revampvacations\.com|revampstay\.com)(?:[/?#]|$)/i;
const EMAIL_G = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_G = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|am|ru|net|org|me|io|co)\/\S*/gi;
const HANDLE_G = /(^|[\s(])@[a-z0-9_]{4,32}\b/gi;
const PHONE_CANDIDATE_G = /\+?\d[\d\s().-]{6,}\d/g;
const DATE_LIKE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/;
const OFFPLATFORM_G =
  /\b(?:whats\s?app|telegram|viber|signal|instagram|insta|facebook|fb|messenger|paypal|venmo|zelle|western\s?union|cash\s?app|revolut|idram|iban|wire\s?transfer|bank\s?transfer|swift)\b/gi;

/**
 * Replaces contact details with HIDDEN_CONTACT. Dates (2026-11-14, 14.11.2026),
 * prices and short numbers are left alone: a phone needs 8+ digits.
 */
export function maskContacts(body: string): { body: string; masked: boolean; reasons: string[] } {
  const reasons = new Set<string>();
  let out = body.replace(EMAIL_G, () => (reasons.add("email"), HIDDEN_CONTACT));
  out = out.replace(URL_G, (m) => (OWN_HOSTS.test(m) ? m : (reasons.add("link"), HIDDEN_CONTACT)));
  out = out.replace(HANDLE_G, (_m, pre: string) => (reasons.add("handle"), `${pre}${HIDDEN_CONTACT}`));
  out = out.replace(PHONE_CANDIDATE_G, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 8 || DATE_LIKE.test(m.trim())) return m;
    reasons.add("phone");
    return HIDDEN_CONTACT;
  });
  out = out.replace(OFFPLATFORM_G, () => (reasons.add("off-platform"), HIDDEN_CONTACT));
  // "[hidden] [hidden]" / "[hidden], [hidden]" → one.
  const esc = HIDDEN_CONTACT.replace(/[[\]]/g, "\\$&");
  out = out.replace(new RegExp(`${esc}(?:[\\s,:;/|+-]*${esc})+`, "g"), HIDDEN_CONTACT);
  return { body: out, masked: reasons.size > 0, reasons: Array.from(reasons) };
}

/**
 * Whether contact details may pass in a conversation: support threads, or a
 * guest and host who have a confirmed/completed booking together (the
 * conversation's own booking, or any other on this host's listings). Offline
 * bookings the host entered themselves (provider 'direct') count — the host
 * already has the guest's details.
 */
export async function contactsAllowed(
  admin: SupabaseClient,
  convo: { id: string; kind?: string | null; booking_id?: string | null; listing_id?: string | null },
): Promise<boolean> {
  if (convo.kind === "support") return true;
  const paid = ["confirmed", "completed"];
  if (convo.booking_id) {
    const { data: b } = await admin.from("bookings").select("status").eq("id", convo.booking_id).maybeSingle();
    if (b && paid.includes((b as { status: string }).status)) return true;
  }
  // Any confirmed booking between this guest and this host.
  const { data: parts } = await admin.from("conversation_participants").select("user_id, role").eq("conversation_id", convo.id);
  const traveler = ((parts ?? []) as { user_id: string; role: string }[]).find((p) => p.role === "traveler")?.user_id;
  if (!traveler || !convo.listing_id) return false;
  const { data: lst } = await admin.from("listings").select("operator_id").eq("id", convo.listing_id).maybeSingle();
  const operatorId = (lst as { operator_id?: string } | null)?.operator_id;
  if (!operatorId) return false;
  const { data: hostListings } = await admin.from("listings").select("id").eq("operator_id", operatorId);
  const ids = ((hostListings ?? []) as { id: string }[]).map((l) => l.id);
  if (!ids.length) return false;
  const { data: any } = await admin.from("bookings").select("id").eq("traveler_id", traveler).in("listing_id", ids).in("status", paid).limit(1);
  return (any?.length ?? 0) > 0;
}
