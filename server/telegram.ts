/**
 * Telegram delivery via the Bot API (REST, native fetch — same no-SDK style as
 * server/sms.ts / server/email.ts). Telegram is a FREE channel and has no Armenia
 * onboarding friction, but a bot can only message a user who has connected to it
 * first, so this is opt-in: the customer taps a t.me deep link, the webhook
 * captures their chat id (see routes /api/telegram-webhook + /api/telegram/*),
 * and from then on their booking notifications are delivered here for free.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN    — from @BotFather
 *   TELEGRAM_BOT_USERNAME — the bot's @username (without @), used to build deep links
 *   TELEGRAM_WEBHOOK_SECRET — optional; if set, must match the webhook's secret token
 */
const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

export function telegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME || "";
}

type SendResult = { sent: boolean; reason?: string };

async function call(method: string, body: unknown): Promise<{ ok: boolean; status: number; json?: unknown }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, status: 0 };
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: unknown;
  try { json = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, json };
}

/**
 * Send a message to a connected chat. Best-effort. Plain text by default;
 * `html` sends Telegram's HTML subset (<b> <i> <a> <code>) and `buttons` adds
 * tappable link buttons under the message (one per row).
 */
export async function sendTelegram(
  chatId: string,
  text: string,
  opts: {
    html?: boolean;
    buttons?: { text: string; url: string }[];
    /** Show this URL (e.g. an image) as a large preview ABOVE the text — one message, full 4096-char text. */
    previewUrl?: string;
  } = {},
): Promise<SendResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { sent: false, reason: "not_configured" };
  if (!chatId) return { sent: false, reason: "no_recipient" };
  try {
    const r = await call("sendMessage", {
      chat_id: chatId,
      text,
      ...(opts.previewUrl
        ? { link_preview_options: { url: opts.previewUrl, prefer_large_media: true, show_above_text: true } }
        : { disable_web_page_preview: true }),
      ...(opts.html ? { parse_mode: "HTML" } : {}),
      ...(opts.buttons?.length ? { reply_markup: { inline_keyboard: opts.buttons.map((b) => [{ text: b.text, url: b.url }]) } } : {}),
    });
    if (!r.ok) {
      console.warn(`[telegram] sendMessage ${r.status}`, JSON.stringify(r.json)?.slice(0, 300));
      return { sent: false, reason: `http_${r.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn("[telegram] send failed", err);
    return { sent: false, reason: "exception" };
  }
}

/**
 * Send a photo (public https URL) with a caption (≤ 1024 characters — Telegram's
 * caption limit) and optional link buttons. Best-effort.
 */
export async function sendTelegramPhoto(
  chatId: string,
  photoUrl: string,
  caption: string,
  opts: { html?: boolean; buttons?: { text: string; url: string }[] } = {},
): Promise<SendResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { sent: false, reason: "not_configured" };
  if (!chatId) return { sent: false, reason: "no_recipient" };
  try {
    const r = await call("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      ...(opts.html ? { parse_mode: "HTML" } : {}),
      ...(opts.buttons?.length ? { reply_markup: { inline_keyboard: opts.buttons.map((b) => [{ text: b.text, url: b.url }]) } } : {}),
    });
    if (!r.ok) {
      console.warn(`[telegram] sendPhoto ${r.status}`, JSON.stringify(r.json)?.slice(0, 300));
      return { sent: false, reason: `http_${r.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn("[telegram] photo send failed", err);
    return { sent: false, reason: "exception" };
  }
}

/** Register the webhook with Telegram (one-time, after deploy). */
export async function setTelegramWebhook(url: string, secret?: string): Promise<{ ok: boolean; description?: string }> {
  const r = await call("setWebhook", { url, secret_token: secret || undefined, allowed_updates: ["message"] });
  const j = (r.json ?? {}) as { ok?: boolean; description?: string };
  return { ok: !!j.ok, description: j.description };
}

/** Build the opt-in deep link a customer taps to connect their Telegram. */
export function telegramConnectLink(startToken: string): string {
  return `https://t.me/${telegramBotUsername()}?start=${encodeURIComponent(startToken)}`;
}
