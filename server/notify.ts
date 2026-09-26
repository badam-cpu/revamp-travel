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
import { sendSms, sendWhatsApp, sendViber } from "./sms.js";
import { sendTelegram } from "./telegram.js";
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
    smsBody?: string; // SMS + WhatsApp + Viber text; omit to skip phone channels
    whatsapp?: { templateName?: string; placeholders?: string[]; language?: string };
  },
): Promise<void> {
  await postSystemMessage(admin, {
    bookingId: opts.bookingId,
    listingId: opts.listingId,
    operatorId: opts.operatorId,
    travelerId: opts.travelerId,
    body: opts.inboxBody,
  });

  const smsBody = opts.smsBody;

  // Telegram: a free opt-in channel. The customer links it via the bot, so being
  // connected IS the consent — send whenever the traveler has a linked chat,
  // independent of the phone-channel checkbox. (Guests without an account can't
  // link, so this only reaches signed-in travelers.)
  if (opts.travelerId && smsBody) {
    const { data: tg } = await admin.from("telegram_links").select("chat_id").eq("user_id", opts.travelerId).maybeSingle();
    if (tg?.chat_id) {
      const r = await sendTelegram(tg.chat_id, smsBody);
      if (r.reason !== "not_configured") await logEvent(admin, opts.bookingId, r.sent ? "telegram_sent" : "telegram_failed", r.sent ? "telegram" : `Telegram failed (${r.reason ?? "unknown"}).`);
    }
  }

  const phone = (opts.travelerPhone || "").trim();
  if (phone && smsBody) {
    // Only text/WhatsApp/Viber a customer who explicitly opted in at checkout.
    const { data: consentRow } = await admin.from("bookings").select("messaging_consent").eq("id", opts.bookingId).maybeSingle();
    if (!consentRow?.messaging_consent) return;
    const [sms, wa, vb] = await Promise.all([
      sendSms(phone, smsBody),
      sendWhatsApp(phone, smsBody, opts.whatsapp),
      sendViber(phone, smsBody),
    ]);
    if (sms.reason !== "not_configured") await logEvent(admin, opts.bookingId, sms.sent ? "sms_sent" : "sms_failed", sms.sent ? phone : `SMS to ${phone} failed (${sms.reason ?? "unknown"}).`);
    if (wa.reason !== "not_configured") await logEvent(admin, opts.bookingId, wa.sent ? "whatsapp_sent" : "whatsapp_failed", wa.sent ? phone : `WhatsApp to ${phone} failed (${wa.reason ?? "unknown"}).`);
    if (vb.reason !== "not_configured") await logEvent(admin, opts.bookingId, vb.sent ? "viber_sent" : "viber_failed", vb.sent ? phone : `Viber to ${phone} failed (${vb.reason ?? "unknown"}).`);
  }
}
