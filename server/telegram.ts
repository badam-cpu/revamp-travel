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

type SendResult = { sent: boolean; reason?: string; messageId?: number };

/** A button under a message: opens a link, or (data) reports back to the webhook as a callback. */
export type TgButton = { text: string; url: string } | { text: string; data: string };
const toKeyboard = (rows: TgButton[][]) => ({
  inline_keyboard: rows.map((row) => row.map((b) => ("url" in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data.slice(0, 64) }))),
});

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
    /** Rows of link and/or callback buttons (wins over `buttons`). */
    keyboard?: TgButton[][];
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
      ...(opts.keyboard?.length
        ? { reply_markup: toKeyboard(opts.keyboard) }
        : opts.buttons?.length
          ? { reply_markup: { inline_keyboard: opts.buttons.map((b) => [{ text: b.text, url: b.url }]) } }
          : {}),
    });
    if (!r.ok) {
      console.warn(`[telegram] sendMessage ${r.status}`, JSON.stringify(r.json)?.slice(0, 300));
      return { sent: false, reason: `http_${r.status}` };
    }
    return { sent: true, messageId: (r.json as { result?: { message_id?: number } })?.result?.message_id };
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
  opts: { html?: boolean; buttons?: { text: string; url: string }[]; keyboard?: TgButton[][] } = {},
): Promise<SendResult> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { sent: false, reason: "not_configured" };
  if (!chatId) return { sent: false, reason: "no_recipient" };
  try {
    const r = await call("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      ...(opts.html ? { parse_mode: "HTML" } : {}),
      ...(opts.keyboard?.length
        ? { reply_markup: toKeyboard(opts.keyboard) }
        : opts.buttons?.length
          ? { reply_markup: { inline_keyboard: opts.buttons.map((b) => [{ text: b.text, url: b.url }]) } }
          : {}),
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

/** Replace a sent message's text and buttons (e.g. "✅ Approved" once a host taps Approve). */
export async function editTelegramMessage(chatId: string, messageId: number, text: string, opts: { html?: boolean; keyboard?: TgButton[][] } = {}): Promise<boolean> {
  try {
    const r = await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      ...(opts.html ? { parse_mode: "HTML" } : {}),
      reply_markup: toKeyboard(opts.keyboard ?? []),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Stop the button's spinner, optionally with a short toast (or an alert box). */
export async function answerTelegramCallback(callbackId: string, text?: string, alert = false): Promise<void> {
  try {
    await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 190), show_alert: alert } : {}) });
  } catch {
    /* best-effort */
  }
}

/** "typing…" in the chat while the bot works. */
export async function telegramTyping(chatId: string): Promise<void> {
  try {
    await call("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* best-effort */
  }
}

/** The command menu shown in Telegram's "/" list. */
export const TELEGRAM_COMMANDS = [
  { command: "trip", description: "Your upcoming trip" },
  { command: "today", description: "Hosts: today's check-ins, check-outs and requests" },
  { command: "bookings", description: "Hosts: bookings in the next 7 days" },
  { command: "summary", description: "Hosts: morning summary on/off" },
  { command: "help", description: "What I can do" },
];

/** Register the webhook with Telegram (one-time, after deploy) and the command menu. */
export async function setTelegramWebhook(url: string, secret?: string): Promise<{ ok: boolean; description?: string }> {
  const r = await call("setWebhook", { url, secret_token: secret || undefined, allowed_updates: ["message", "callback_query"] });
  const j = (r.json ?? {}) as { ok?: boolean; description?: string };
  if (j.ok) await call("setMyCommands", { commands: TELEGRAM_COMMANDS }).catch(() => undefined);
  return { ok: !!j.ok, description: j.description };
}

/**
 * Keeps the webhook able to receive button taps (callback_query, 0110) and the
 * command menu current. Called by the 10-minute cron: one cheap getWebhookInfo;
 * re-registers only when the webhook already points at THIS site's endpoint
 * (or none is set) but is missing callback_query — never takes over a webhook
 * pointed elsewhere.
 */
export async function ensureTelegramWebhook(siteUrl: string): Promise<"ok" | "updated" | "skipped"> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return "skipped";
  const expected = `${siteUrl.replace(/\/+$/, "")}/api/telegram-webhook`;
  try {
    const r = await call("getWebhookInfo", {});
    const info = ((r.json ?? {}) as { result?: { url?: string; allowed_updates?: string[] } }).result ?? {};
    if (info.url && info.url !== expected) return "skipped";
    if (info.url === expected && (info.allowed_updates ?? []).includes("callback_query")) return "ok";
    const set = await setTelegramWebhook(expected, process.env.TELEGRAM_WEBHOOK_SECRET);
    return set.ok ? "updated" : "skipped";
  } catch {
    return "skipped";
  }
}

/** Build the opt-in deep link a customer taps to connect their Telegram. */
export function telegramConnectLink(startToken: string): string {
  return `https://t.me/${telegramBotUsername()}?start=${encodeURIComponent(startToken)}`;
}
