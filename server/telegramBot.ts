/**
 * The two-way Telegram bot (migration 0110). One entry point for every update
 * the webhook receives (handleTelegramUpdate), plus the operator alerts and the
 * morning summary the rest of the server calls.
 *
 * Operators act from Telegram:
 *   • a new confirmed booking → alert with Open booking / Message guest;
 *   • a new request-to-book → alert with Approve / Decline (Decline asks once
 *     more), running the SAME approve/decline code as the dashboard (injected
 *     by routes.ts) under the host's own identity — the chat is matched to its
 *     telegram_links user, never trusted from the button;
 *   • /today, /bookings, and a morning summary (cron, once a day after 08:00
 *     Armenia time; /summary off|on).
 * Guests: /trip (their next booking + trip page / directions / message host),
 * and anything else they write goes to the AI concierge (telegramConcierge.ts).
 *
 * Telegram retries an update it thinks failed, so each chat's last handled
 * update_id is remembered (telegram_chats) and repeats are ignored.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { answerTelegramCallback, editTelegramMessage, sendTelegram, type TgButton } from "./telegram.js";
import { ensureTripToken, tripLinkFor, type JourneyBooking } from "./journey.js";
import { formatSlotTime, slotLocalDate } from "../shared/sessions.js";
import { roomUnitLabel } from "../shared/rooms.js";
import { handleConciergeMessage } from "./telegramConcierge.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");
const yerevanNow = () => new Date(Date.now() + 4 * 3_600_000);
export const yerevanToday = () => yerevanNow().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sun 27 Sep" (fixed short names — some ICU builds print "Sept"). */
const day = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const guestsText = (n: number) => `${n} guest${n === 1 ? "" : "s"}`;
const money = (cents: number, currency = "AMD") =>
  currency === "AMD" ? `֏${Math.round(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const bookingLink = (id: string) => `${SITE()}/dashboard?section=bookings&booking=${id}`;

export interface BotDeps {
  approve: (admin: SupabaseClient, bookingId: string, actorId: string, site: string) => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  decline: (admin: SupabaseClient, bookingId: string, actorId: string) => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
}

// ── Reading a booking for a message ─────────────────────────────────────────

interface BookingView {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  startsAt: string | null;
  guests: number;
  amountCents: number;
  currency: string;
  guestName: string;
  travelerId: string | null;
  listing: { id: string; title: string; type: string; operatorId: string; lat: number | null; lng: number | null; slug: string };
  room: string | null;
}

const BOOKING_SELECT =
  "id, status, start_date, end_date, starts_at, guests, amount_cents, currency, guest_name, traveler_id, listings!inner(id, title, type, operator_id, lat, lng, slug), profiles!traveler_id(display_name)";

type BookingRow = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  starts_at: string | null;
  guests: number;
  amount_cents: number;
  currency: string | null;
  guest_name: string | null;
  traveler_id: string | null;
  listings: { id: string; title: string; type: string; operator_id: string; lat: number | null; lng: number | null; slug: string };
  profiles: { display_name: string | null } | null;
};

function viewOf(r: BookingRow, room: string | null = null): BookingView {
  const name = r.guest_name || (r.profiles?.display_name && r.profiles.display_name !== "Guest" ? r.profiles.display_name : "") || "Guest";
  return {
    id: r.id,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    startsAt: r.starts_at,
    guests: r.guests,
    amountCents: r.amount_cents,
    currency: r.currency || "AMD",
    guestName: name,
    travelerId: r.traveler_id,
    listing: { id: r.listings.id, title: r.listings.title, type: r.listings.type, operatorId: r.listings.operator_id, lat: r.listings.lat, lng: r.listings.lng, slug: r.listings.slug },
    room,
  };
}

async function roomNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data, error } = await admin.from("bookings").select("id, room_types(name), room_units(name)").in("id", ids).not("room_type_id", "is", null);
  if (error) return out;
  for (const r of (data ?? []) as unknown as { id: string; room_types: { name?: string } | null; room_units: { name?: string } | null }[]) {
    const label = [r.room_types?.name, r.room_units?.name ? roomUnitLabel(r.room_units.name) : ""].filter(Boolean).join(" · ");
    if (label) out.set(r.id, label);
  }
  return out;
}

async function loadBooking(admin: SupabaseClient, id: string): Promise<BookingView | null> {
  const { data } = await admin.from("bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const rooms = await roomNames(admin, [id]);
  return viewOf(data as unknown as BookingRow, rooms.get(id) ?? null);
}

function whenLine(b: BookingView): string {
  if (b.listing.type === "stay") {
    const n = Math.max(1, Math.round((Date.parse(`${b.endDate}T00:00:00Z`) - Date.parse(`${b.startDate}T00:00:00Z`)) / 86_400_000));
    return `${day(b.startDate)} → ${day(b.endDate)} · ${n} night${n === 1 ? "" : "s"}`;
  }
  const d = b.startsAt ? slotLocalDate(b.startsAt) : b.startDate;
  return `${day(d)}${b.startsAt ? ` at ${formatSlotTime(b.startsAt)}` : ""}`;
}

async function chatOf(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from("telegram_links").select("chat_id").eq("user_id", userId).maybeSingle();
  return (data as { chat_id: string | null } | null)?.chat_id ?? null;
}

// ── Operator alerts ─────────────────────────────────────────────────────────

/** Aha answered a guest for this host (0119) — so the host stays in the loop. */
export async function alertOperatorAhaAnswered(
  admin: SupabaseClient,
  opts: { operatorId: string; guestName: string; listingTitle?: string; question: string; answer: string },
): Promise<boolean> {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return false;
    const chat = await chatOf(admin, opts.operatorId);
    if (!chat) return false;
    const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
    await sendTelegram(
      chat,
      [
        `✨ <b>Aha answered ${esc(opts.guestName)}</b>${opts.listingTitle ? ` — ${esc(opts.listingTitle)}` : ""}`,
        `💬 ${esc(clip(opts.question, 300))}`,
        `↪️ ${esc(clip(opts.answer, 500))}`,
      ].join("\n"),
      { html: true, keyboard: [[{ text: "Open conversation", url: `${SITE()}/dashboard?section=messages` }]] },
    );
    return true;
  } catch (err) {
    console.error("[telegram] aha alert", err);
    return false;
  }
}

function requestMessage(b: BookingView, status?: string): string {
  return [
    `🙋 <b>New request to book</b> — ${esc(b.listing.title)}`,
    esc(whenLine(b)),
    `👤 ${esc(b.guestName)} · ${b.guests} guest${b.guests === 1 ? "" : "s"}`,
    `💳 ${money(b.amountCents, b.currency)} — not charged yet`,
    status ?? "Approve to send the guest a secure pay link.",
  ].join("\n");
}

function requestKeyboard(b: BookingView): TgButton[][] {
  return [
    [
      { text: "✅ Approve", data: `ap:${b.id}` },
      { text: "❌ Decline", data: `dc:${b.id}` },
    ],
    [{ text: "Open booking", url: bookingLink(b.id) }],
  ];
}

/**
 * Tells the host about a booking in Telegram (if they linked it). `kind`:
 * "new" (confirmed), "request" (request-to-book). Best-effort, never throws.
 */
export async function alertOperatorTelegram(admin: SupabaseClient, bookingId: string, kind: "new" | "request"): Promise<void> {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    const b = await loadBooking(admin, bookingId);
    if (!b) return;
    const chat = await chatOf(admin, b.listing.operatorId);
    if (!chat) return;
    const title = `${esc(b.listing.title)}${b.room ? ` · ${esc(b.room)}` : ""}`;
    if (kind === "request") {
      await sendTelegram(chat, requestMessage(b), { html: true, keyboard: requestKeyboard(b) });
      return;
    }
    const rows: TgButton[][] = [[{ text: "Open booking", url: bookingLink(b.id) }]];
    if (b.travelerId) rows[0].push({ text: "Message guest", url: `${SITE()}/dashboard?section=messages` });
    await sendTelegram(
      chat,
      [`🛎 <b>New booking</b> — ${title}`, esc(whenLine(b)), `👤 ${esc(b.guestName)} · ${b.guests} guest${b.guests === 1 ? "" : "s"}`, `💳 ${money(b.amountCents, b.currency)} paid`].join("\n"),
      { html: true, keyboard: rows },
    );
  } catch (err) {
    console.error("[telegram bot] operator alert", err);
  }
}

// ── /today, /bookings and the morning summary ───────────────────────────────

async function operatorListings(admin: SupabaseClient, operatorId: string): Promise<string[]> {
  const { data } = await admin.from("listings").select("id").eq("operator_id", operatorId);
  return ((data ?? []) as { id: string }[]).map((l) => l.id);
}

/** The host's day: check-ins, check-outs, tours/experiences and requests waiting. `null` when there's nothing. */
export async function todaySummary(admin: SupabaseClient, operatorId: string, opts: { always?: boolean } = {}): Promise<string | null> {
  const ids = await operatorListings(admin, operatorId);
  if (!ids.length) return opts.always ? "You don't have any listings yet." : null;
  const today = yerevanToday();
  const { data } = await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .in("listing_id", ids)
    .or(`status.eq.requested,and(status.in.(confirmed,completed),or(start_date.eq.${today},end_date.eq.${today}))`)
    .limit(100);
  const rows = (data ?? []) as unknown as BookingRow[];
  const rooms = await roomNames(admin, rows.map((r) => r.id));
  const views = rows.map((r) => viewOf(r, rooms.get(r.id) ?? null));
  const stay = (v: BookingView) => v.listing.type === "stay";
  const name = (v: BookingView) => `${esc(v.listing.title)}${v.room ? ` · ${esc(v.room)}` : ""}`;
  const who = (v: BookingView) => `${esc(v.guestName)} · ${guestsText(v.guests)}`;
  const checkIns = views.filter((v) => stay(v) && v.status !== "requested" && v.startDate === today);
  const checkOuts = views.filter((v) => stay(v) && v.status !== "requested" && v.endDate === today);
  const sessions = views
    .filter((v) => !stay(v) && v.status !== "requested" && (v.startsAt ? slotLocalDate(v.startsAt) : v.startDate) === today)
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  // Only requests whose date is still ahead — a request for a day that has passed
  // can't be answered any more.
  const requests = views.filter((v) => v.status === "requested" && (v.startsAt ? slotLocalDate(v.startsAt) : v.startDate) >= today);

  const parts: string[] = [];
  if (checkIns.length) parts.push(`<b>Check-ins (${checkIns.length})</b>\n${checkIns.map((v) => `• ${name(v)} — ${who(v)}`).join("\n")}`);
  if (checkOuts.length) parts.push(`<b>Check-outs (${checkOuts.length})</b>\n${checkOuts.map((v) => `• ${name(v)} — ${who(v)}`).join("\n")}`);
  if (sessions.length) parts.push(`<b>Tours & experiences (${sessions.length})</b>\n${sessions.map((v) => `• ${v.startsAt ? formatSlotTime(v.startsAt) + " " : ""}${name(v)} — ${who(v)}`).join("\n")}`);
  if (requests.length) parts.push(`<b>Waiting for your answer (${requests.length})</b>\n${requests.slice(0, 8).map((v) => `• ${name(v)}, ${esc(whenLine(v))} — ${who(v)}`).join("\n")}`);
  if (!parts.length) return opts.always ? `☀️ <b>Today, ${day(today)}</b>\n\nNothing on today — no check-ins, check-outs or requests.` : null;
  return `☀️ <b>Today, ${day(today)}</b>\n\n${parts.join("\n\n")}`;
}

async function upcomingList(admin: SupabaseClient, operatorId: string): Promise<string> {
  const ids = await operatorListings(admin, operatorId);
  if (!ids.length) return "You don't have any listings yet.";
  const today = yerevanToday();
  const { data } = await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .in("listing_id", ids)
    .eq("status", "confirmed")
    .gte("start_date", today)
    .lte("start_date", addDays(today, 7))
    .order("start_date", { ascending: true })
    .limit(15);
  const rows = (data ?? []) as unknown as BookingRow[];
  if (!rows.length) return "No bookings in the next 7 days.";
  const rooms = await roomNames(admin, rows.map((r) => r.id));
  const lines = rows.map((r) => {
    const v = viewOf(r, rooms.get(r.id) ?? null);
    return `• ${esc(whenLine(v))} — ${esc(v.listing.title)}${v.room ? ` · ${esc(v.room)}` : ""} · ${esc(v.guestName)} · ${guestsText(v.guests)}`;
  });
  return `<b>Next 7 days (${rows.length})</b>\n${lines.join("\n")}`;
}

/**
 * Morning summary for hosts, once a day between 08:00 and 12:00 Armenia time
 * (10-minute cron). Outside that window nothing is sent — a summary that
 * missed the morning waits for tomorrow rather than arriving mid-afternoon.
 */
export async function runTelegramDailySummaries(admin: SupabaseClient): Promise<{ sent: number; checked: number }> {
  const hour = yerevanNow().getUTCHours();
  if (!process.env.TELEGRAM_BOT_TOKEN || hour < 8 || hour >= 12) return { sent: 0, checked: 0 };
  const today = yerevanToday();
  const { data, error } = await admin
    .from("telegram_links")
    .select("user_id, chat_id, summary_sent_on")
    .not("chat_id", "is", null)
    .eq("daily_summary", true)
    .or(`summary_sent_on.is.null,summary_sent_on.lt.${today}`)
    .limit(200);
  if (error) return { sent: 0, checked: 0 }; // before 0110
  const links = (data ?? []) as { user_id: string; chat_id: string }[];
  if (!links.length) return { sent: 0, checked: 0 };
  const { data: profs } = await admin.from("profiles").select("id, role").in("id", links.map((l) => l.user_id));
  const hosts = new Set(((profs ?? []) as { id: string; role: string }[]).filter((p) => p.role === "operator").map((p) => p.id));
  let sent = 0;
  for (const l of links) {
    // Claim today's slot first so a slow run can't send twice.
    const { data: claimed } = await admin
      .from("telegram_links")
      .update({ summary_sent_on: today })
      .eq("user_id", l.user_id)
      .or(`summary_sent_on.is.null,summary_sent_on.lt.${today}`)
      .select("user_id");
    if (!claimed?.length || !hosts.has(l.user_id)) continue;
    const text = await todaySummary(admin, l.user_id);
    if (!text) continue;
    const r = await sendTelegram(l.chat_id, `${text}\n\n<i>Morning summary · /summary off to stop</i>`, { html: true, keyboard: [[{ text: "Open bookings", url: `${SITE()}/dashboard?section=bookings` }]] });
    if (r.sent) sent += 1;
  }
  return { sent, checked: links.length };
}

// ── Guests: /trip ───────────────────────────────────────────────────────────

async function tripMessage(admin: SupabaseClient, userId: string): Promise<{ text: string; keyboard: TgButton[][] }> {
  const today = yerevanToday();
  const { data } = await admin
    .from("bookings")
    .select(`${BOOKING_SELECT}, listing_id, guest_email, guest_phone, room_type_id, room_unit_id, trip_token, booking_group_id`)
    .eq("traveler_id", userId)
    .in("status", ["confirmed", "awaiting_payment", "requested"])
    .gte("end_date", today)
    .order("start_date", { ascending: true })
    .limit(4);
  const rows = (data ?? []) as unknown as (BookingRow & JourneyBooking)[];
  if (!rows.length) {
    return { text: "You don't have an upcoming trip yet. Tell me what you're looking for — e.g. <i>a cabin in Dilijan for 2 next weekend</i>.", keyboard: [[{ text: "Browse stays", url: `${SITE()}/explore/stay` }]] };
  }
  const rooms = await roomNames(admin, rows.map((r) => r.id));
  const next = viewOf(rows[0], rooms.get(rows[0].id) ?? null);
  const state =
    next.status === "confirmed" ? "✅ Confirmed" : next.status === "awaiting_payment" ? "💳 Approved — pay to confirm" : "⏳ Waiting for the host to approve";
  const lines = [
    `🧳 <b>${esc(next.listing.title)}</b>${next.room ? ` · ${esc(next.room)}` : ""}`,
    esc(whenLine(next)),
    `${next.guests} guest${next.guests === 1 ? "" : "s"} · ${state}`,
  ];
  if (rows.length > 1) {
    lines.push("", "<b>Also coming up</b>");
    for (const r of rows.slice(1)) lines.push(`• ${esc(viewOf(r).listing.title)} — ${esc(whenLine(viewOf(r)))}`);
  }
  const keyboard: TgButton[][] = [];
  const first: TgButton[] = [];
  if (next.status === "confirmed") {
    try {
      const token = await ensureTripToken(admin, rows[0]);
      first.push({ text: "Trip page", url: tripLinkFor(token) });
    } catch {
      /* no trip page — the other buttons still help */
    }
  } else if (next.status === "awaiting_payment") {
    first.push({ text: "Pay to confirm", url: `${SITE()}/account?tab=trips` });
  }
  if (next.listing.lat != null && next.listing.lng != null) first.push({ text: "Directions", url: `https://www.google.com/maps/dir/?api=1&destination=${next.listing.lat},${next.listing.lng}` });
  if (first.length) keyboard.push(first);
  keyboard.push([
    { text: "Message host", url: `${SITE()}/account?tab=messages` },
    { text: "Listing", url: `${SITE()}/listing/${next.listing.slug}` },
  ]);
  return { text: lines.join("\n"), keyboard };
}

// ── The webhook ─────────────────────────────────────────────────────────────

interface TgUpdate {
  update_id?: number;
  message?: { text?: string; chat?: { id?: number | string; type?: string }; from?: { first_name?: string; language_code?: string } };
  callback_query?: { id: string; data?: string; message?: { message_id?: number; chat?: { id?: number | string } } };
}

/** Telegram resends an update it thinks failed — handle each update_id once per chat. */
async function firstTime(admin: SupabaseClient, chatId: string, updateId: number | undefined): Promise<boolean> {
  if (updateId == null) return true;
  const { data, error } = await admin.from("telegram_chats").select("last_update_id").eq("chat_id", chatId).maybeSingle();
  if (error) return true; // before 0110: no dedupe, still answer
  const last = (data as { last_update_id: number | null } | null)?.last_update_id ?? null;
  if (last != null && updateId <= last) return false;
  await admin.from("telegram_chats").upsert({ chat_id: chatId, last_update_id: updateId, updated_at: new Date().toISOString() }, { onConflict: "chat_id" });
  return true;
}

async function linkedUser(admin: SupabaseClient, chatId: string): Promise<{ id: string; role: string } | null> {
  const { data } = await admin.from("telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
  const uid = (data as { user_id: string } | null)?.user_id;
  if (!uid) return null;
  const { data: p } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
  return { id: uid, role: (p as { role?: string } | null)?.role ?? "traveler" };
}

const HELP_GUEST =
  "I'm Revamp's trip helper. Tell me what you're looking for and I'll find real places on Revamp — for example:\n• <i>A cabin in Dilijan for 2, 14–16 Nov</i>\n• <i>Wine tour near Yerevan this Saturday</i>\n• <i>Do I need a visa for Armenia?</i>\n\n/trip — your upcoming booking";
const HELP_HOST = `${HELP_GUEST}\n\n<b>For hosts</b>\n/today — today's check-ins, check-outs and requests\n/bookings — the next 7 days\n/summary off · /summary on — morning summary\nNew bookings and requests arrive here with buttons to act on them.`;

export async function handleTelegramUpdate(admin: SupabaseClient, update: TgUpdate, deps: BotDeps): Promise<void> {
  // Buttons
  const cb = update.callback_query;
  if (cb) {
    const chatId = cb.message?.chat?.id != null ? String(cb.message.chat.id) : "";
    const messageId = cb.message?.message_id;
    const [action, bookingId] = (cb.data ?? "").split(":");
    const user = chatId ? await linkedUser(admin, chatId) : null;
    if (!user || !bookingId) {
      await answerTelegramCallback(cb.id, "Connect this chat to your Revamp account first.", true);
      return;
    }
    const b = await loadBooking(admin, bookingId);
    if (!b) {
      await answerTelegramCallback(cb.id, "That booking couldn't be found.", true);
      return;
    }
    const edit = (status: string, keyboard: TgButton[][] = [[{ text: "Open booking", url: bookingLink(b.id) }]]) =>
      messageId ? editTelegramMessage(chatId, messageId, requestMessage(b, status), { html: true, keyboard }) : Promise.resolve(false);
    if (action === "dc") {
      await answerTelegramCallback(cb.id);
      await edit("Decline this request? The guest is told and the seats are released.", [
        [
          { text: "Yes, decline", data: `dy:${b.id}` },
          { text: "Keep it", data: `kp:${b.id}` },
        ],
      ]);
      return;
    }
    if (action === "kp") {
      await answerTelegramCallback(cb.id);
      await edit("Approve to send the guest a secure pay link.", requestKeyboard(b));
      return;
    }
    if (action === "ap" || action === "dy") {
      const r = action === "ap" ? await deps.approve(admin, b.id, user.id, SITE()) : await deps.decline(admin, b.id, user.id);
      if (!r.ok) {
        await answerTelegramCallback(cb.id, r.error, true);
        // Already decided elsewhere: show where it stands, without the buttons.
        if (r.status === 400 || r.status === 409) await edit(`Already handled — ${r.error.replace(/^This request is already /, "").replace(/\.$/, "")}.`);
        return;
      }
      await answerTelegramCallback(cb.id, action === "ap" ? "Approved" : "Declined");
      await edit(action === "ap" ? "✅ <b>Approved</b> — the guest has been emailed a secure pay link." : "❌ <b>Declined</b> — the guest has been told; no charge was made.");
      return;
    }
    await answerTelegramCallback(cb.id);
    return;
  }

  // Messages (private chats only)
  const msg = update.message;
  const text = msg?.text?.trim();
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : "";
  if (!text || !chatId || (msg?.chat?.type && msg.chat.type !== "private")) return;
  if (!(await firstTime(admin, chatId, update.update_id))) return;

  // Account linking (deep link from /account or the dashboard).
  if (text.startsWith("/start")) {
    const startToken = text.split(/\s+/)[1];
    if (startToken) {
      const { data: link } = await admin.from("telegram_links").select("user_id").eq("connect_token", startToken).maybeSingle();
      if (link) {
        await admin.from("telegram_links").update({ chat_id: chatId, connect_token: null, updated_at: new Date().toISOString() }).eq("user_id", (link as { user_id: string }).user_id);
        const u = await linkedUser(admin, chatId);
        await sendTelegram(chatId, `✅ Connected to Revamp. ${u?.role === "operator" ? "New bookings and requests will arrive here — you can approve them right in this chat.\n\n" : "Your booking updates will arrive here.\n\n"}${u?.role === "operator" ? HELP_HOST : HELP_GUEST}`, { html: true });
      } else {
        await sendTelegram(chatId, "That link has expired. Open your Revamp account and tap ‘Connect Telegram’ again.");
      }
      return;
    }
    await sendTelegram(chatId, `👋 Welcome to Revamp!\n\n${HELP_GUEST}\n\nHave a Revamp account? Open it on revampvacations.com and tap ‘Connect Telegram’ to get your booking updates here.`, { html: true });
    return;
  }

  const user = await linkedUser(admin, chatId);
  const command = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : "";
  const hostOnly = "This is for hosts. Connect your host account in Dashboard → Settings → Account → Telegram.";

  if (command === "/help") {
    await sendTelegram(chatId, user?.role === "operator" ? HELP_HOST : HELP_GUEST, { html: true });
    return;
  }
  if (command === "/today") {
    if (user?.role !== "operator") return void (await sendTelegram(chatId, hostOnly));
    await sendTelegram(chatId, (await todaySummary(admin, user.id, { always: true })) ?? "", { html: true, keyboard: [[{ text: "Open bookings", url: `${SITE()}/dashboard?section=bookings` }]] });
    return;
  }
  if (command === "/bookings") {
    if (user?.role !== "operator") return void (await sendTelegram(chatId, hostOnly));
    await sendTelegram(chatId, await upcomingList(admin, user.id), { html: true, keyboard: [[{ text: "Open bookings", url: `${SITE()}/dashboard?section=bookings` }]] });
    return;
  }
  if (command === "/summary") {
    if (user?.role !== "operator") return void (await sendTelegram(chatId, hostOnly));
    const off = /\boff\b|\bstop\b/i.test(text);
    const on = /\bon\b|\bstart\b/i.test(text);
    if (!off && !on) return void (await sendTelegram(chatId, "Send /summary off to stop the morning summary, or /summary on to get it again."));
    const { error } = await admin.from("telegram_links").update({ daily_summary: on }).eq("user_id", user.id);
    await sendTelegram(chatId, error ? "Couldn't change that right now — please try again later." : on ? "☀️ Morning summary is on — you'll get it each day after 8:00." : "Morning summary is off. Send /summary on to bring it back.");
    return;
  }
  if (command === "/trip") {
    if (!user) {
      await sendTelegram(chatId, "Connect this chat to your Revamp account to see your trips: open revampvacations.com → Account → Security → Connect Telegram.", {
        keyboard: [[{ text: "Open my account", url: `${SITE()}/account?tab=security` }]],
      });
      return;
    }
    const t = await tripMessage(admin, user.id);
    await sendTelegram(chatId, t.text, { html: true, keyboard: t.keyboard });
    return;
  }
  if (command) {
    await sendTelegram(chatId, user?.role === "operator" ? HELP_HOST : HELP_GUEST, { html: true });
    return;
  }

  // Everything else: the AI trip concierge.
  await handleConciergeMessage(admin, { chatId, text, userId: user?.id ?? null, firstName: msg?.from?.first_name ?? null });
}
