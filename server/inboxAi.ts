/**
 * Aha replies in the inbox (migration 0119).
 *
 * The answer comes ONLY from what Revamp knows about the listing — its posted
 * details (`listingFaqFacts`) and approved FAQ (0118) — plus the booking's own
 * status/dates and the conversation. Aha hands off (writes nothing) for booking
 * changes, cancellations, refunds, payments, discounts, complaints, safety, or
 * anything those facts don't answer. Replies in the guest's language.
 *
 *   - suggestInboxReply: the host's "Suggest a reply" button (never sent by itself)
 *   - runInboxAutoReplies: hosts who switched automatic answers on — a guest
 *     message unanswered for their delay gets an answer if Aha can give one.
 *     Labelled `ai` for both sides; at most MAX_AI_PER_DAY per conversation.
 * Never throws.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanFaq } from "../shared/listingFaq.js";
import { listingFaqFacts } from "./listingFaqAuto.js";
import { contactsAllowed, maskContacts } from "./messaging.js";
import { sendAhaAnswered, sendNewMessage } from "./email.js";

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client === undefined) client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  return client;
}
export const inboxAiConfigured = () => !!getClient();

const MAX_AI_PER_DAY = 3;
const LOOKBACK_HOURS = 24;

type Row = Record<string, any>;
export interface InboxAiResult {
  reply: string | null;
  /** Why Aha left it for the host (when reply is null). */
  reason?: string;
}

export interface Ctx {
  convo: Row;
  listing: Row | null;
  operatorId: string | null;
  hostName: string;
  booking: Row | null;
  messages: { role: string; body: string; at: string }[];
}

async function loadContext(admin: SupabaseClient, conversationId: string): Promise<Ctx | null> {
  const { data: convo } = await admin.from("conversations").select("id, kind, status, listing_id, booking_id, guest_email").eq("id", conversationId).maybeSingle();
  if (!convo || convo.kind === "support") return null;
  const [{ data: listing }, { data: booking }, { data: msgs }] = await Promise.all([
    convo.listing_id ? admin.from("listings").select("*").eq("id", convo.listing_id).maybeSingle() : Promise.resolve({ data: null }),
    convo.booking_id ? admin.from("bookings").select("status, start_date, end_date, guests").eq("id", convo.booking_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("messages").select("sender_role, body, created_at, redacted").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(12),
  ]);
  const operatorId = (listing as Row | null)?.operator_id ?? null;
  let hostName = "the host";
  if (operatorId) {
    const { data: p } = await admin.from("profiles").select("business_name, display_name").eq("id", operatorId).maybeSingle();
    hostName = p?.business_name || p?.display_name || hostName;
  }
  const messages = ((msgs ?? []) as Row[])
    .filter((m) => !m.redacted && m.sender_role !== "system")
    .reverse()
    .map((m) => ({ role: m.sender_role === "traveler" ? "Guest" : m.sender_role === "operator" ? "Host" : "Revamp", body: String(m.body).slice(0, 1500), at: m.created_at }));
  return { convo, listing: (listing as Row | null) ?? null, operatorId, hostName, booking: (booking as Row | null) ?? null, messages };
}

const SYSTEM = `You answer guest messages on behalf of a host on Revamp Vacations, a travel marketplace in Armenia. You are "Aha", Revamp's assistant.
You may ONLY use the LISTING FACTS, the FAQ and the BOOKING lines you are given. Never invent amenities, times, distances, prices, availability, rules or promises.
Hand off to the host (do not answer) when the guest:
- asks to change, extend, shorten or cancel a booking, or about refunds, payments, invoices, discounts or special prices;
- complains, reports a problem, damage, safety or health issue, or is upset;
- asks for contact details, to pay or meet outside Revamp;
- asks for private details (door codes, Wi-Fi password, exact key location) — these come in the check-in message;
- asks anything the facts don't clearly answer, or asks for the host's personal opinion or an exception.
For availability or price on specific dates: say the calendar and total are on the listing page on Revamp (don't quote numbers).
When you answer: reply in the guest's language (Armenian, Russian or English — match their last message), warm and short (1–4 sentences), no greetings like "Dear", no sign-off name, no emoji, no contact details, no links except "on Revamp". Only answer the guest's LATEST message(s) since the host last wrote.
Return ONLY JSON: {"reply": "..."} to answer, or {"handoff": "short reason for the host"} to leave it to the host.`;

async function draft(ctx: Ctx): Promise<InboxAiResult | null> {
  const anthropic = getClient();
  if (!anthropic) return null;
  if (!ctx.listing) return { reply: null, reason: "No listing is linked to this conversation." };
  const facts = listingFaqFacts(ctx.listing);
  const faq = cleanFaq(ctx.listing.faq);
  const b = ctx.booking;
  const bookingLines = b
    ? [`Booking status: ${b.status}`, `Dates: ${b.start_date}${b.end_date && b.end_date !== b.start_date ? ` to ${b.end_date}` : ""}`, b.guests ? `Guests: ${b.guests}` : ""].filter(Boolean)
    : ["No booking yet — this guest is asking before booking."];
  const msg = [
    `HOST: ${ctx.hostName}`,
    "LISTING FACTS:",
    ...facts.map((f) => `- ${f}`),
    faq.length ? `FAQ:\n${faq.map((f) => `- Q: ${f.q}\n  A: ${f.a}`).join("\n")}` : "FAQ: (none)",
    "BOOKING:",
    ...bookingLines.map((l) => `- ${l}`),
    "CONVERSATION (oldest first):",
    ...ctx.messages.map((m) => `${m.role}: ${m.body}`),
  ].join("\n");
  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: process.env.INBOX_AI_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 500,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: msg }],
    });
  } catch (err) {
    console.error("[inbox-ai]", err);
    return null; // request failed (not billed) — try again later
  }
  const raw = response.content
    .filter((x): x is Anthropic.TextBlock => x.type === "text")
    .map((x) => x.text)
    .join("\n");
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { reply?: unknown; handoff?: unknown };
    const reply = typeof j.reply === "string" ? j.reply.trim().slice(0, 1200) : "";
    if (reply) return { reply };
    return { reply: null, reason: typeof j.handoff === "string" && j.handoff.trim() ? j.handoff.trim().slice(0, 200) : "Aha couldn't answer this from your listing." };
  } catch {
    return { reply: null, reason: "Aha couldn't answer this from your listing." };
  }
}

/** The host's "Suggest a reply" — returns a draft (or why not); nothing is sent. */
export async function suggestInboxReply(admin: SupabaseClient, conversationId: string): Promise<InboxAiResult> {
  const ctx = await loadContext(admin, conversationId);
  if (!ctx) return { reply: null, reason: "Aha can't help with this conversation." };
  if (!ctx.messages.some((m) => m.role === "Guest")) return { reply: null, reason: "There's no guest message to answer yet." };
  return (await draft(ctx)) ?? { reply: null, reason: "Aha isn't available right now. Please try again in a moment." };
}

/**
 * Automatic answers for hosts who switched them on: open guest↔host conversations
 * whose latest message is the guest's, older than the host's delay (and from the
 * last day). One pass per run, a few conversations at a time.
 */
// The host's saved "Automatic first reply" (0082: auto, not ai) is a holding note, not an
// answer — the guest is still waiting for one.
const isRealReply = (m: Row) => !(m.auto && !m.ai);
/** Latest message that counts, i.e. ignoring the host's saved first-reply note. */
const lastReal = (msgs: Row[]) => msgs.find(isRealReply);

export async function runInboxAutoReplies(
  admin: SupabaseClient,
  max = 4,
  answer: (ctx: Ctx) => Promise<InboxAiResult | null> = draft,
): Promise<{ checked: number; answered: number; handedOff: number; failed: number }> {
  const out = { checked: 0, answered: 0, handedOff: 0, failed: 0 };
  if (!getClient()) return out;
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
  const { data: convos, error } = await admin
    .from("conversations")
    .select("id, kind, status, listing_id, booking_id, last_message_at, guest_email, listings!inner(operator_id, title)")
    .neq("kind", "support")
    .eq("status", "open")
    .gte("last_message_at", since)
    .order("last_message_at", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[inbox-ai] list", error.message);
    out.failed++;
    return out;
  }
  const opIds = Array.from(new Set(((convos ?? []) as Row[]).map((c) => c.listings?.operator_id).filter(Boolean)));
  if (!opIds.length) return out;
  const { data: ops } = await admin.from("profiles").select("id, ai_reply_auto, ai_reply_delay_minutes, business_name, display_name").in("id", opIds).eq("ai_reply_auto", true);
  const opMap = new Map(((ops ?? []) as Row[]).map((o) => [o.id, o]));
  const due: Row[] = [];
  for (const c of (convos ?? []) as Row[]) {
    const op = opMap.get(c.listings?.operator_id);
    if (!op) continue;
    const { data: recent } = await admin.from("messages").select("sender_role, created_at, ai, auto").eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(20);
    const last = lastReal((recent ?? []) as Row[]);
    if (!last || last.sender_role !== "traveler") continue;
    if (Date.now() - Date.parse(last.created_at) < (op.ai_reply_delay_minutes ?? 15) * 60_000) continue;
    const aiToday = ((recent ?? []) as Row[]).filter((m) => m.ai && Date.parse(m.created_at) > Date.now() - 86_400_000).length;
    if (aiToday >= MAX_AI_PER_DAY) continue;
    due.push({ ...c, op });
    if (due.length >= max) break;
  }
  out.checked = due.length;
  await Promise.all(
    due.map(async (c) => {
      try {
        const ctx = await loadContext(admin, c.id);
        const res = ctx ? await answer(ctx) : null;
        if (!res) return void out.failed++;
        if (!res.reply) {
          out.handedOff++;
          return;
        }
        // Same contact rule as a host message before a paid booking.
        const hide = !(await contactsAllowed(admin, { id: c.id, kind: c.kind, booking_id: c.booking_id, listing_id: c.listing_id }));
        const body = hide ? maskContacts(res.reply).body : res.reply;
        // Re-check the guest is still waiting (the host may have just replied).
        const { data: again } = await admin.from("messages").select("sender_role, ai, auto").eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(5);
        if (lastReal((again ?? []) as Row[])?.sender_role !== "traveler") return;
        const { error: insErr } = await admin.from("messages").insert({ conversation_id: c.id, sender_id: c.op.id, sender_role: "operator", body, auto: true, ai: true });
        if (insErr) throw insErr;
        await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", c.id);
        out.answered++;
        // Let the guest know, like a host reply.
        const { data: parts } = await admin.from("conversation_participants").select("user_id, role, muted").eq("conversation_id", c.id).eq("role", "traveler");
        let guestName = "a guest";
        for (const p of (parts ?? []) as Row[]) {
          const { data: prof } = await admin.from("profiles").select("display_name").eq("id", p.user_id).maybeSingle();
          if (prof?.display_name) guestName = String(prof.display_name).split(" ")[0];
          if (p.muted) continue;
          const { data: u } = await admin.auth.admin.getUserById(p.user_id);
          const to = u?.user?.email || c.guest_email || null;
          if (to) await sendNewMessage(to, { fromName: String(c.op.business_name || c.op.display_name || "Your host"), listingTitle: c.listings?.title, snippet: body.length > 140 ? `${body.slice(0, 140)}…` : body, recipientRole: "traveler" });
        }
        // And tell the host what Aha said — Telegram if linked, otherwise email.
        try {
          const question = ctx!.messages.filter((m) => m.role === "Guest").slice(-1)[0]?.body ?? "";
          const note = { operatorId: c.op.id, guestName, listingTitle: c.listings?.title, question, answer: body };
          const { alertOperatorAhaAnswered } = await import("./telegramBot.js");
          if (!(await alertOperatorAhaAnswered(admin, note))) {
            const { data: hu } = await admin.auth.admin.getUserById(c.op.id);
            if (hu?.user?.email) await sendAhaAnswered(hu.user.email, note);
          }
        } catch (notifyErr) {
          console.error("[inbox-ai] host notice", notifyErr);
        }
      } catch (err) {
        console.error("[inbox-ai] reply", c.id, err);
        out.failed++;
      }
    }),
  );
  return out;
}
