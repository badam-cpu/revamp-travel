/**
 * Guardrails for the unified inbox (see supabase/migrations/0038_conversations.sql
 * and the /api/message-send route). Direct traveler<->operator messaging invites
 * the usual marketplace risks — swapping contact details to take the booking
 * off-platform (which breaks the PayLink loop and Revamp's role as merchant of
 * record). We don't block a message (people have legitimate reasons to share an
 * address or a maps link), we FLAG it: the message still sends, but `flagged` is
 * stored so the admin oversight view can surface it. Deliberately lightweight and
 * dependency-free — a regex pass, not an AI call.
 */

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
