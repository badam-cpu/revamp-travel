/**
 * Multi-channel notification composer for booking events. Email stays where it
 * is (server/email.ts, called at each site); this adds the NEW channels on top:
 * the customer's phone (SMS + WhatsApp via server/sms.ts) and the unified inbox
 * (a 'system' message via server/inbox.ts). Every channel is best-effort and
 * self-gating, so a missing Twilio key or messaging hiccup never affects the
 * booking. Phone channels target the traveler (the "customer"); the operator is
 * reached by email + the same inbox thread.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, sendWhatsApp } from "./sms.js";
import { postSystemMessage } from "./inbox.js";

async function logEvent(admin: SupabaseClient, bookingId: string, type: string, detail?: string): Promise<void> {
  try {
    await admin.from("booking_events").insert({ booking_id: bookingId, type, detail: detail ?? null });
  } catch {
    /* history is non-critical */
  }
}

/**
 * Mirror a confirmation into the inbox and (when we have the customer's phone
 * and an `smsBody`) text + WhatsApp them. `inboxBody` is always posted.
 */
export async function notifyBooking(
  admin: SupabaseClient,
  opts: {
    bookingId: string;
    listingId?: string;
    operatorId?: string;
    travelerId?: string | null;
    travelerPhone?: string | null;
    inboxBody: string;
    smsBody?: string; // SMS + WhatsApp text; omit to skip phone channels
    whatsapp?: { contentSid?: string; contentVariables?: Record<string, string> };
  },
): Promise<void> {
  await postSystemMessage(admin, {
    bookingId: opts.bookingId,
    listingId: opts.listingId,
    operatorId: opts.operatorId,
    travelerId: opts.travelerId,
    body: opts.inboxBody,
  });

  const phone = (opts.travelerPhone || "").trim();
  const smsBody = opts.smsBody;
  if (phone && smsBody) {
    const [sms, wa] = await Promise.all([
      sendSms(phone, smsBody),
      sendWhatsApp(phone, smsBody, opts.whatsapp),
    ]);
    if (sms.reason !== "not_configured") await logEvent(admin, opts.bookingId, sms.sent ? "sms_sent" : "sms_failed", sms.sent ? phone : `SMS to ${phone} failed (${sms.reason ?? "unknown"}).`);
    if (wa.reason !== "not_configured") await logEvent(admin, opts.bookingId, wa.sent ? "whatsapp_sent" : "whatsapp_failed", wa.sent ? phone : `WhatsApp to ${phone} failed (${wa.reason ?? "unknown"}).`);
  }
}
