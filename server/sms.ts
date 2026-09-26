/**
 * SMS + WhatsApp delivery via Twilio (REST, native fetch — same lightweight,
 * no-SDK style as server/email.ts and server/paylink.ts). Both channels are a
 * silent no-op when their env isn't configured, so bookings keep working without
 * them, exactly like email.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID   — Twilio account SID (starts with AC…)
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_SMS_FROM      — sender phone in E.164 (+374…) OR a Messaging Service SID (MG…)
 *   TWILIO_WHATSAPP_FROM — WhatsApp sender, e.g. "+14155238886" or "whatsapp:+14155238886"
 *
 * WhatsApp note: business-initiated messages OUTSIDE the 24-hour customer-service
 * window must use a pre-approved template. Pass `contentSid` (+ `contentVariables`)
 * for a Twilio Content template; otherwise the plain `body` is sent, which only
 * delivers inside the 24h window or the Twilio sandbox. See CLAUDE.md.
 */
const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);
}
export function whatsappConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

type SendResult = { sent: boolean; reason?: string };

/** Best-effort E.164 tidy: strip spaces/dashes/parens; 00-prefix → +; ensure a leading +. */
export function normalizePhone(raw: string): string {
  let p = (raw || "").trim().replace(/[\s()\-.]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (!p.startsWith("+")) p = "+" + p;
  return p;
}

async function twilioSend(params: Record<string, string>): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { sent: false, reason: "not_configured" };
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[sms] Twilio ${res.status}: ${text.slice(0, 300)}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn("[sms] send failed", err);
    return { sent: false, reason: "exception" };
  }
}

/** Applies From vs MessagingServiceSid depending on the configured sender shape. */
function withSmsFrom(params: Record<string, string>): Record<string, string> {
  const from = process.env.TWILIO_SMS_FROM || "";
  if (from.startsWith("MG")) return { ...params, MessagingServiceSid: from };
  return { ...params, From: from };
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!smsConfigured()) return { sent: false, reason: "not_configured" };
  if (!to) return { sent: false, reason: "no_recipient" };
  return twilioSend(withSmsFrom({ To: normalizePhone(to), Body: body }));
}

export async function sendWhatsApp(
  to: string,
  body: string,
  opts?: { contentSid?: string; contentVariables?: Record<string, string> },
): Promise<SendResult> {
  if (!whatsappConfigured()) return { sent: false, reason: "not_configured" };
  if (!to) return { sent: false, reason: "no_recipient" };
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM || "";
  const from = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:${normalizePhone(fromRaw)}`;
  const params: Record<string, string> = { To: `whatsapp:${normalizePhone(to)}`, From: from };
  if (opts?.contentSid) {
    params.ContentSid = opts.contentSid;
    if (opts.contentVariables) params.ContentVariables = JSON.stringify(opts.contentVariables);
  } else {
    params.Body = body;
  }
  return twilioSend(params);
}
