/**
 * Transactional email for the booking loop, via Resend's REST API (native
 * fetch, no SDK — same approach as the rest of the server). Ported from rankr's
 * lib/email.mjs. Sending is a SILENT NO-OP without both env vars, so a missing
 * config never breaks a booking confirm or cancel:
 *   RESEND_API_KEY — from resend.com
 *   EMAIL_FROM     — a sender on a domain verified in Resend,
 *                    e.g. "Revamp Vacations <bookings@revamptravel.example>"
 *
 * Neither var carries a VITE_ prefix — server-only, never in the client bundle.
 */
const RESEND_URL = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function money(cents: number, currency: string): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toString() : major.toFixed(2);
  return currency === "USD" ? `$${n}` : `${n} ${currency}`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function shell(title: string, bodyHtml: string, siteUrl: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#212121;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
        <tr><td style="font-weight:800;font-size:20px;color:#212121;letter-spacing:-.02em;">revamp<span style="color:#F15822;">.</span></td></tr>
      </table>
      <h1 style="font-size:21px;line-height:1.25;margin:0 0 14px;">${esc(title)}</h1>
      ${bodyHtml}
      <p style="font-size:12px;color:#8B8478;margin-top:28px;line-height:1.5;border-top:1px solid #eee;padding-top:14px;">
        <a href="${esc(siteUrl)}" style="color:#8B8478;">Revamp Vacations</a> · Armenia's travel marketplace.
      </p>
    </div>`;
}

async function send(to: string, subject: string, html: string): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("[email] RESEND_API_KEY / EMAIL_FROM not set — skipping send.");
    return { sent: false, reason: "not_configured" };
  }
  if (!to) return { sent: false, reason: "no_recipient" };
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("[email] Resend error:", res.status, (await res.text()).slice(0, 200));
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] send threw:", err);
    return { sent: false, reason: "send_failed" };
  }
}

export interface BookingEmailInfo {
  listingTitle: string;
  startDate: string;
  endDate: string;
  guests: number;
  amountCents: number;
  currency: string;
  city?: string;
  region?: string;
  slug?: string;
}

function detailRows(b: BookingEmailInfo): string {
  const where = [b.city, b.region].filter(Boolean).join(", ");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px;line-height:1.5;border:1px solid #eee;border-radius:8px;padding:4px 0;margin:8px 0 18px;">
      <tr><td style="padding:8px 14px;color:#6B6357;">Dates</td><td style="padding:8px 14px;text-align:right;font-weight:600;">${esc(prettyDate(b.startDate))} → ${esc(prettyDate(b.endDate))}</td></tr>
      <tr><td style="padding:8px 14px;color:#6B6357;">Guests</td><td style="padding:8px 14px;text-align:right;font-weight:600;">${b.guests}</td></tr>
      ${where ? `<tr><td style="padding:8px 14px;color:#6B6357;">Where</td><td style="padding:8px 14px;text-align:right;font-weight:600;">${esc(where)}</td></tr>` : ""}
      <tr><td style="padding:8px 14px;color:#6B6357;">Total</td><td style="padding:8px 14px;text-align:right;font-weight:700;">${esc(money(b.amountCents, b.currency))}</td></tr>
    </table>`;
}

const SITE = () => (process.env.URL || "https://revamptravel.netlify.app").replace(/\/+$/, "");

/** To the traveler: their booking is confirmed. */
export function sendTravelerConfirmation(to: string, b: BookingEmailInfo) {
  const site = SITE();
  const html = shell(
    `Your trip is confirmed 🎉`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">You're booked for <strong>${esc(b.listingTitle)}</strong>. Here are the details:</p>
     ${detailRows(b)}
     <p style="margin:0 0 8px;"><a href="${esc(site)}/account?tab=trips" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View your trips</a></p>`,
    site,
  );
  return send(to, `Confirmed: ${b.listingTitle}`, html);
}

/** To the operator: a new booking came in. */
export function sendOperatorNewBooking(to: string, b: BookingEmailInfo, travelerName: string) {
  const site = SITE();
  const html = shell(
    `New booking for ${esc(b.listingTitle)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;"><strong>${esc(travelerName || "A traveler")}</strong> just booked and paid for your listing.</p>
     ${detailRows(b)}
     <p style="margin:0 0 8px;"><a href="${esc(site)}/dashboard" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open your dashboard</a></p>`,
    site,
  );
  return send(to, `New booking: ${b.listingTitle}`, html);
}

/** Cancellation notice to a party. `refundCents` (0 = none) drives the refund note. */
export function sendCancellation(to: string, b: BookingEmailInfo, opts: { toRole: "traveler" | "operator"; refundCents: number }) {
  const site = SITE();
  const who = opts.toRole === "traveler" ? "Your booking" : "A booking on your listing";
  const refundStr = money(opts.refundCents, b.currency);
  const refundNote =
    opts.refundCents > 0
      ? opts.toRole === "traveler"
        ? `<p style="font-size:14px;line-height:1.6;color:#6B6357;margin:0 0 6px;">A refund of <strong>${esc(refundStr)}</strong> is being processed and will be returned to your original payment method.</p>`
        : `<p style="font-size:14px;line-height:1.6;color:#6B6357;margin:0 0 6px;">Per the cancellation policy, please refund <strong>${esc(refundStr)}</strong> to the traveler from your PayLink account.</p>`
      : opts.toRole === "traveler"
        ? `<p style="font-size:14px;line-height:1.6;color:#6B6357;margin:0 0 6px;">Under this booking's cancellation policy, no refund applies.</p>`
        : "";
  const html = shell(
    `${who} was cancelled`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;"><strong>${esc(b.listingTitle)}</strong> — this booking has been cancelled and the dates are open again.</p>
     ${detailRows(b)}
     ${refundNote}`,
    site,
  );
  return send(to, `Cancelled: ${b.listingTitle}`, html);
}
