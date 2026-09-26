/**
 * SMS + WhatsApp + Viber delivery via Infobip (REST, native fetch — same
 * lightweight, no-SDK style as server/email.ts and server/paylink.ts). Chosen
 * over Twilio because Infobip onboards in Armenia and covers Viber, which is a
 * primary messaging channel there. Each channel is a silent no-op when its env
 * isn't configured, so bookings keep working without them, exactly like email.
 *
 * Env (all from your Infobip account — the base URL is account-specific):
 *   INFOBIP_BASE_URL     — e.g. "https://xxxxx.api.infobip.com" (no trailing slash needed)
 *   INFOBIP_API_KEY      — API key (sent as `Authorization: App <key>`)
 *   INFOBIP_SMS_FROM     — registered SMS Sender ID / number (Armenia requires registration)
 *   INFOBIP_WHATSAPP_FROM— your WhatsApp sender number
 *   INFOBIP_VIBER_FROM   — your registered Viber sender name
 *
 * WhatsApp note: business-initiated messages OUTSIDE the 24-hour customer-service
 * window must use a pre-approved template. Pass `templateName` (+ `placeholders`)
 * for a template send; otherwise the plain `text` is sent, which only delivers
 * inside the 24h window.
 */
export function smsConfigured(): boolean {
  return infobipReady() && !!process.env.INFOBIP_SMS_FROM;
}
export function whatsappConfigured(): boolean {
  return infobipReady() && !!process.env.INFOBIP_WHATSAPP_FROM;
}
export function viberConfigured(): boolean {
  return infobipReady() && !!process.env.INFOBIP_VIBER_FROM;
}

function infobipReady(): boolean {
  return !!(process.env.INFOBIP_API_KEY && process.env.INFOBIP_BASE_URL);
}

type SendResult = { sent: boolean; reason?: string };

/** Best-effort E.164 tidy: strip spaces/dashes/parens; 00-prefix → +; ensure a leading +. */
export function normalizePhone(raw: string): string {
  let p = (raw || "").trim().replace(/[\s()\-.]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (!p.startsWith("+")) p = "+" + p;
  return p;
}

/** Infobip expects international format WITHOUT the leading '+'. */
function intl(raw: string): string {
  return normalizePhone(raw).replace(/^\+/, "");
}

async function post(path: string, body: unknown): Promise<SendResult> {
  const key = process.env.INFOBIP_API_KEY;
  const base = (process.env.INFOBIP_BASE_URL || "").replace(/\/+$/, "");
  if (!key || !base) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `App ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[sms] Infobip ${path} ${res.status}: ${text.slice(0, 300)}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn("[sms] send failed", err);
    return { sent: false, reason: "exception" };
  }
}

export async function sendSms(to: string, text: string): Promise<SendResult> {
  if (!smsConfigured()) return { sent: false, reason: "not_configured" };
  if (!to) return { sent: false, reason: "no_recipient" };
  return post("/sms/2/text/advanced", {
    messages: [{ from: process.env.INFOBIP_SMS_FROM, destinations: [{ to: intl(to) }], text }],
  });
}

export async function sendWhatsApp(
  to: string,
  text: string,
  opts?: { templateName?: string; placeholders?: string[]; language?: string },
): Promise<SendResult> {
  if (!whatsappConfigured()) return { sent: false, reason: "not_configured" };
  if (!to) return { sent: false, reason: "no_recipient" };
  const from = process.env.INFOBIP_WHATSAPP_FROM;
  if (opts?.templateName) {
    return post("/whatsapp/1/message/template", {
      messages: [
        {
          from,
          to: intl(to),
          content: {
            templateName: opts.templateName,
            templateData: { body: { placeholders: opts.placeholders ?? [] } },
            language: opts.language ?? "en",
          },
        },
      ],
    });
  }
  return post("/whatsapp/1/message/text", { from, to: intl(to), content: { text } });
}

export async function sendViber(to: string, text: string): Promise<SendResult> {
  if (!viberConfigured()) return { sent: false, reason: "not_configured" };
  if (!to) return { sent: false, reason: "no_recipient" };
  return post("/viber/1/message/text", {
    messages: [{ from: process.env.INFOBIP_VIBER_FROM, to: intl(to), content: { text } }],
  });
}
