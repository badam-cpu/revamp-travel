/**
 * Admin email broadcasts (marketing). Resolves an audience segment to a deduped,
 * suppression-filtered recipient list and sends a composed email to it via Resend's
 * batch API. Every email carries an unsubscribe link (tokenized so it can't be
 * forged for arbitrary addresses) + a List-Unsubscribe header. Service-role only.
 *
 * Segments: operators / travelers (from profiles + auth users), guests (emails
 * captured on bookings, inquiries, gift cards, vouchers — people who transacted
 * without an account), or everyone (the union). Admins are never marketed to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { renderMarkdown } from "../shared/markdown.js";

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";

export type Audience = "everyone" | "operators" | "travelers" | "guests" | "contacts";
export interface Recipient { email: string; name?: string | null }

export function marketingConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function emailGenConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Names that aren't a real person's first name — often an operator's business
// name or a role inbox — so we greet with the neutral fallback instead.
const GENERIC_NAMES = new Set(["guest", "revamp", "admin", "team", "host", "operator", "owner", "info", "support", "hello", "hi", "sales", "contact", "the"]);

/** First name for personalization; falls back to "there" for blanks/brand/role names. */
function firstName(name?: string | null): string {
  const n = (name || "").trim().split(/\s+/)[0];
  if (!n || GENERIC_NAMES.has(n.toLowerCase())) return "there";
  return n;
}

/** Email clients drop CSS classes, so inline the brand link color on body links. */
function styleEmailLinks(html: string): string {
  return html.replace(/<a (?![^>]*\bstyle=)/g, '<a style="color:#F15822;text-decoration:underline;" ');
}

/** Replace supported merge tags with this recipient's values. */
export function personalize(text: string, r: Recipient): string {
  return text.replace(/\{\s*(?:first_name|name|guest_first_name)\s*\}/gi, firstName(r.name));
}

let anthropicClient: Anthropic | null | undefined;
function anthropic(): Anthropic | null {
  if (anthropicClient === undefined) {
    const key = process.env.ANTHROPIC_API_KEY;
    anthropicClient = key ? new Anthropic({ apiKey: key }) : null;
  }
  return anthropicClient;
}

const EMAIL_SYSTEM = `You are Revamp Vacations' email copywriter. Revamp is an Armenia-focused travel marketplace (stays, tours, experiences, restaurant guides). Write a marketing/announcement email BODY in Markdown from the admin's brief.
Voice: warm, human, concise, a little editorial — never spammy or ALL CAPS. Short paragraphs; a link or a clear call to action when it fits (Markdown links).
You may use the personalization tag {first_name} (it's replaced per recipient) — e.g. "Hi {first_name},".
STRICT: do NOT invent facts, prices, discounts, dates, reviews, ratings, or claims that aren't in the brief. If the brief doesn't give a specific offer, don't fabricate one.
Return ONLY the email body in Markdown — no subject line, no "Subject:", no preamble, no sign-off block beyond a simple friendly closing.`;

/** Draft a marketing email body (Markdown) from a short brief. */
export async function generateEmailBody(prompt: string): Promise<string | null> {
  const a = anthropic();
  if (!a) return null;
  try {
    const res = await a.messages.create({
      model: process.env.SUPPORT_MODEL || "claude-haiku-4-5",
      max_tokens: 900,
      system: [{ type: "text", text: EMAIL_SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: `Write the email body. Brief: ${prompt}` }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return raw || null;
  } catch (err) {
    console.error("[marketing] generate failed", err);
    return null;
  }
}

function normEmail(e?: string | null): string | null {
  if (!e) return null;
  const t = String(e).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}

// --- CSV contact import ---------------------------------------------------

/** Split a CSV line, honoring simple double-quoted fields. */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a pasted/uploaded CSV (or TSV) of contacts into deduped recipients.
 * Accepts a header row (email/name columns, any order, common aliases) or a
 * plain "email[,name]" per line with no header. Invalid emails are skipped.
 */
export function parseContactsCsv(text: string): { recipients: Recipient[]; skipped: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { recipients: [], skipped: 0 };

  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const first = splitCsvLine(lines[0], delim).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => /^(e-?mail|email address)$/.test(c)) || (first.some((c) => c.includes("mail")) && !first.some((c) => c.includes("@")));

  let emailIdx = 0;
  let nameIdx = 1;
  let start = 0;
  if (hasHeader) {
    start = 1;
    const findIdx = (pred: (c: string) => boolean, fallback: number) => {
      const i = first.findIndex(pred);
      return i >= 0 ? i : fallback;
    };
    emailIdx = findIdx((c) => c.includes("mail"), 0);
    nameIdx = findIdx((c) => c === "name" || c.includes("full") || c.includes("first") || c.includes("guest"), 1);
  }

  const seen = new Map<string, Recipient>();
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    const email = normEmail(cols[emailIdx]);
    if (!email) { skipped++; continue; }
    const name = (cols[nameIdx] || "").trim() || null;
    if (!seen.has(email)) seen.set(email, { email, name });
  }
  return { recipients: Array.from(seen.values()), skipped };
}

/** Upsert imported contacts into email_contacts. Returns how many landed. */
export async function importContacts(
  admin: SupabaseClient,
  recipients: Recipient[],
  source: string,
  createdBy: string,
): Promise<{ imported: number }> {
  if (recipients.length === 0) return { imported: 0 };
  const now = new Date().toISOString();
  let imported = 0;
  for (let i = 0; i < recipients.length; i += 500) {
    const chunk = recipients.slice(i, i + 500).map((r) => ({
      email: r.email,
      name: r.name ?? null,
      source,
      created_by: createdBy,
      updated_at: now,
    }));
    const { error } = await admin.from("email_contacts").upsert(chunk, { onConflict: "email" });
    if (!error) imported += chunk.length;
    else console.warn("[marketing] contact upsert", error.message);
  }
  return { imported };
}

function unsubSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY || "revamp-unsub";
}
export function unsubToken(email: string): string {
  return crypto.createHmac("sha256", unsubSecret()).update(email.toLowerCase()).digest("hex").slice(0, 32);
}
export function verifyUnsub(email: string, token: string): boolean {
  const expected = unsubToken(email);
  if (!token || token.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Map auth user id → email, paginated. */
async function authEmails(admin: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const users = data?.users ?? [];
    if (error || users.length === 0) break;
    for (const u of users) if (u.email) map.set(u.id, u.email);
    if (users.length < 1000) break;
  }
  return map;
}

export async function resolveAudience(admin: SupabaseClient, audience: Audience): Promise<Recipient[]> {
  const { data: opt } = await admin.from("email_optouts").select("email");
  const optouts = new Set((opt ?? []).map((r) => String((r as { email: string }).email).toLowerCase()));

  const out = new Map<string, Recipient>();
  const add = (email?: string | null, name?: string | null) => {
    const e = normEmail(email);
    if (!e || optouts.has(e) || out.has(e)) return;
    out.set(e, { email: e, name: name ?? null });
  };

  if (audience === "everyone" || audience === "operators" || audience === "travelers") {
    const emails = await authEmails(admin);
    const { data: profs } = await admin.from("profiles").select("id, role, display_name");
    for (const p of (profs ?? []) as { id: string; role: string; display_name: string | null }[]) {
      const email = emails.get(p.id);
      if (!email) continue;
      if (p.role === "admin") continue; // never market to admins
      if (audience === "operators" && p.role !== "operator") continue;
      if (audience === "travelers" && p.role !== "traveler") continue;
      add(email, p.display_name);
    }
  }

  if (audience === "everyone" || audience === "guests") {
    const [bk, cv, gc, rv] = await Promise.all([
      admin.from("bookings").select("guest_email, guest_name"),
      admin.from("conversations").select("guest_email, guest_name"),
      admin.from("gift_cards").select("recipient_email, purchaser_email, recipient_name"),
      admin.from("restaurant_vouchers").select("purchaser_email"),
    ]);
    for (const r of (bk.data ?? []) as { guest_email: string | null; guest_name: string | null }[]) add(r.guest_email, r.guest_name);
    for (const r of (cv.data ?? []) as { guest_email: string | null; guest_name: string | null }[]) add(r.guest_email, r.guest_name);
    for (const r of (gc.data ?? []) as { recipient_email: string | null; purchaser_email: string | null; recipient_name: string | null }[]) {
      add(r.recipient_email, r.recipient_name);
      add(r.purchaser_email);
    }
    for (const r of (rv.data ?? []) as { purchaser_email: string | null }[]) add(r.purchaser_email);
  }

  if (audience === "everyone" || audience === "contacts") {
    const { data: contacts } = await admin.from("email_contacts").select("email, name");
    for (const c of (contacts ?? []) as { email: string; name: string | null }[]) add(c.email, c.name);
  }

  return Array.from(out.values());
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A per-send marker keeps the header/footer boilerplate from being byte-identical
// across campaigns, so Gmail doesn't fold it away as repeated/quoted content when
// two emails land in the same conversation. `nonce` is hidden; `sentLabel` shows.
function shell(bodyHtml: string, siteUrl: string, unsubUrl: string, nonce: string, sentLabel: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F5F2EC;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#212121;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(nonce)}</div>
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid rgba(33,33,33,.1);border-radius:14px;overflow:hidden;">
      <div style="padding:20px 28px;border-bottom:1px solid rgba(33,33,33,.08);"><span style="font-size:22px;font-weight:700;color:#212121;">revamp</span><span style="font-size:22px;font-weight:700;color:#F15822;">.</span></div>
      <div style="padding:24px 28px;font-size:15px;line-height:1.65;">${bodyHtml}</div>
      <div style="padding:16px 28px;border-top:1px solid rgba(33,33,33,.08);font-size:12px;color:#8a857c;">
        <p style="margin:0 0 6px;">Revamp Vacations · <a href="${esc(siteUrl)}" style="color:#8a857c;">revampvacations.com</a> · ${esc(sentLabel)}</p>
        <p style="margin:0;">Don't want these emails? <a href="${esc(unsubUrl)}" style="color:#8a857c;text-decoration:underline;">Unsubscribe</a>.</p>
      </div>
    </div>
  </body></html>`;
}

/** Send a campaign to the resolved recipients via Resend batch (chunks of 100). */
export async function sendCampaign(
  opts: { subject: string; markdown: string; recipients: Recipient[]; siteUrl: string },
): Promise<{ sent: number; failed: number }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: 0, failed: opts.recipients.length };
  let sent = 0;
  let failed = 0;
  // One marker for this whole campaign — unique vs. any other send, so Gmail
  // won't collapse the repeated header/footer across campaigns in a thread.
  const nonce = `rv-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const sentLabel = `Sent ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  for (let i = 0; i < opts.recipients.length; i += 100) {
    const chunk = opts.recipients.slice(i, i + 100);
    const batch = chunk.map((r) => {
      const unsubUrl = `${opts.siteUrl}/api/email/unsubscribe?e=${encodeURIComponent(r.email)}&t=${unsubToken(r.email)}`;
      const html = shell(styleEmailLinks(renderMarkdown(personalize(opts.markdown, r))), opts.siteUrl, unsubUrl, nonce, sentLabel);
      return { from, to: r.email, subject: personalize(opts.subject, r), html, headers: { "List-Unsubscribe": `<${unsubUrl}>` } };
    });
    try {
      const res = await fetch(RESEND_BATCH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (res.ok) sent += chunk.length;
      else {
        failed += chunk.length;
        console.warn("[marketing] batch", res.status, (await res.text().catch(() => "")).slice(0, 200));
      }
    } catch (e) {
      failed += chunk.length;
      console.warn("[marketing] batch error", e);
    }
  }
  return { sent, failed };
}
