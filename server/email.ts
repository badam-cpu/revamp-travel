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
import { boldToHtml } from "../shared/richText.js";

const RESEND_URL = "https://api.resend.com/emails";

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function money(cents: number, currency: string): string {
  const major = cents / 100;
  const n = major % 1 === 0 ? major.toLocaleString("en-US") : major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${n}` : currency === "AMD" ? `֏${n}` : `${n} ${currency}`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Full timestamp (date + time, UTC) for operational alerts, e.g. "Sep 19, 2026, 20:23 UTC". */
function prettyDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

// Brand tokens (inline — email clients don't share the app's CSS): apricot
// #F15822, charcoal #212121, paper #FFFFFF, chalk #F6F3EC.
function shell(title: string, bodyHtml: string, siteUrl: string): string {
  return `
    <div style="background:#f6f3ec;padding:24px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:544px;margin:0 auto;background:#ffffff;border:1px solid #e4ded3;border-radius:16px;overflow:hidden;">
        <div style="height:4px;background:#F15822;"></div>
        <div style="padding:30px 30px 0;">
          <span style="font-weight:800;font-size:22px;letter-spacing:-.03em;color:#212121;">revamp.</span>
        </div>
        <div style="padding:6px 30px 30px;color:#212121;">
          <h1 style="font-size:23px;line-height:1.22;letter-spacing:-.02em;margin:14px 0 16px;">${esc(title)}</h1>
          ${bodyHtml}
          <div style="border-top:1px solid #eee;margin-top:24px;padding-top:20px;">
            <p style="margin:0;font-weight:800;font-size:26px;line-height:.92;letter-spacing:-.04em;color:#212121;">Stay.<br /><span style="color:#F15822;">Experience.</span><br />Repeat.</p>
          </div>
        </div>
        <div style="padding:18px 30px;border-top:1px solid #eee;background:#faf9f5;">
          <p style="font-size:12px;color:#8B8478;margin:0;line-height:1.6;">
            <a href="${esc(siteUrl)}" style="color:#8B8478;text-decoration:none;font-weight:700;">Revamp Vacations</a> · Armenia's travel marketplace<br />
            © 2026 Revamp Hospitality LLC
          </p>
        </div>
      </div>
    </div>`;
}

async function send(to: string, subject: string, html: string, opts: { replyTo?: string } = {}): Promise<{ sent: boolean; reason?: string }> {
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
      body: JSON.stringify({ from, to: [to], subject, html, ...(opts.replyTo ? { reply_to: opts.replyTo } : {}) }),
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
  addons?: { name: string; amountCents: number; qty: number; onRequest?: boolean }[];
  // Tour/experience extras.
  type?: string;
  /** Slot time label (e.g. "10:00"), Armenia local — shown for time-slot bookings. */
  time?: string;
  lat?: number;
  lng?: number;
  meetingPoint?: string;
  duration?: string;
  languages?: string;
  // Stay extras.
  checkIn?: string;
  checkOut?: string;
}

function detailRows(b: BookingEmailInfo): string {
  // City, then region only when it differs from the city (avoids "Yerevan,
  // Yerevan"), then the country. Armenia's code is AM (AR is Argentina).
  const parts = [b.city, b.region && b.region !== b.city ? b.region : null].filter(Boolean);
  const where = [...parts, "Armenia"].join(", ");
  const isActivity = b.type === "tour" || b.type === "experience";
  const td = 'style="padding:8px 14px;color:#6B6357;"';
  const tdR = 'style="padding:8px 14px;text-align:right;font-weight:600;"';
  const row = (label: string, value: string) => `<tr><td ${td}>${label}</td><td ${tdR}>${value}</td></tr>`;

  // Tours/experiences are a single day → show one date, and reveal the meeting
  // point (hyperlinked to Google Maps from the listing's coordinates).
  const dateRow = isActivity
    ? row("Date", `${esc(prettyDate(b.startDate))}${b.time ? ` · ${esc(b.time)}` : ""}`)
    : row("Dates", `${esc(prettyDate(b.startDate))} → ${esc(prettyDate(b.endDate))}`);

  const mapUrl = typeof b.lat === "number" && typeof b.lng === "number" ? `https://www.google.com/maps?q=${b.lat},${b.lng}` : undefined;
  let meetingRow = "";
  if (isActivity) {
    if (b.meetingPoint) {
      const text = esc(b.meetingPoint);
      meetingRow = row("Meeting point", mapUrl ? `<a href="${esc(mapUrl)}" style="color:#F15822;text-decoration:underline;">${text}</a>` : text);
    } else if (mapUrl) {
      meetingRow = row("Meeting point", `<a href="${esc(mapUrl)}" style="color:#F15822;text-decoration:underline;">View on map</a>`);
    }
  }
  const durationRow = isActivity && b.duration ? row("Duration", esc(b.duration)) : "";
  const languagesRow = isActivity && b.languages ? row("Languages", esc(b.languages)) : "";
  // Stays: check-in / checkout times when the operator set them.
  const checkInRow = !isActivity && b.checkIn ? row("Check-in", esc(b.checkIn)) : "";
  const checkOutRow = !isActivity && b.checkOut ? row("Checkout", esc(b.checkOut)) : "";
  const addonsRow = (b.addons ?? []).length
    ? row("Add-ons", (b.addons ?? []).map((a) => esc(`${a.name}${a.qty > 1 ? ` ×${a.qty}` : ""}${a.onRequest ? " (on request)" : ""}`)).join("<br />"))
    : "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px;line-height:1.5;border:1px solid #eee;border-radius:8px;padding:4px 0;margin:8px 0 18px;">
      ${dateRow}
      ${checkInRow}
      ${checkOutRow}
      ${meetingRow}
      ${durationRow}
      ${languagesRow}
      ${row("Guests", String(b.guests))}
      ${where ? row("Where", esc(where)) : ""}
      ${addonsRow}
      ${row("Total", esc(money(b.amountCents, b.currency)))}
    </table>`;
}

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");

/** To the traveler: their booking is confirmed. */
export function sendTravelerConfirmation(to: string, b: BookingEmailInfo) {
  const site = SITE();
  // Link the title to its listing page when we have a slug.
  const titleHtml = b.slug ? `<a href="${esc(`${site}/listing/${b.slug}`)}" style="color:#212121;text-decoration:underline;">${esc(b.listingTitle)}</a>` : `<strong>${esc(b.listingTitle)}</strong>`;
  const isActivity = b.type === "tour" || b.type === "experience";
  const html = shell(
    `Your ${isActivity ? "booking" : "trip"} is confirmed 🎉`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">You're booked for ${titleHtml}. Here are the details:</p>
     ${detailRows(b)}
     ${isActivity && b.meetingPoint ? `<p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#6B6357;">Please arrive at the meeting point a few minutes early. Tap the meeting point above to open it in maps.</p>` : ""}
     <p style="margin:0 0 8px;"><a href="${esc(site)}/account?tab=trips" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View your ${isActivity ? "booking" : "trips"}</a></p>`,
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

/** To the operator: a guest requested a slot and is awaiting your approval. */
export function sendOperatorBookingRequest(to: string, b: BookingEmailInfo, travelerName: string) {
  const site = SITE();
  const html = shell(
    `New booking request for ${esc(b.listingTitle)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;"><strong>${esc(travelerName || "A traveler")}</strong> wants to book a slot. No charge has been made — approve to send them a secure payment link, or decline to release the seats.</p>
     ${detailRows(b)}
     <p style="margin:0 0 8px;"><a href="${esc(site)}/dashboard?section=bookings" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Review the request</a></p>`,
    site,
  );
  return send(to, `Booking request: ${b.listingTitle}`, html);
}

/** To the guest: we received your request; the host will confirm. */
export function sendGuestRequestReceived(to: string, b: BookingEmailInfo) {
  const site = SITE();
  const html = shell(
    `Request received for ${esc(b.listingTitle)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Thanks! We've sent your request to the host. You won't be charged until they confirm — we'll email you a secure payment link as soon as they do.</p>
     ${detailRows(b)}`,
    site,
  );
  return send(to, `Request received: ${b.listingTitle}`, html);
}

/** To the guest: the host approved — pay now to confirm. */
export function sendGuestBookingApproved(to: string, b: BookingEmailInfo, payUrl: string) {
  const site = SITE();
  const html = shell(
    `Your booking is approved — pay to confirm`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Good news — the host confirmed availability for ${esc(b.listingTitle)}. Complete your payment to lock it in (your seats are held for now).</p>
     ${detailRows(b)}
     <p style="margin:0 0 8px;"><a href="${esc(payUrl)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Pay securely via PayLink</a></p>`,
    site,
  );
  return send(to, `Approved — pay to confirm: ${b.listingTitle}`, html);
}

/** To the customer: an operator arranged a booking and is requesting payment via a PayLink link. */
export function sendPaymentLink(to: string, b: BookingEmailInfo, payUrl: string) {
  const site = SITE();
  const html = shell(
    `Complete your booking — ${esc(b.listingTitle)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Your host has set up a booking for <strong>${esc(b.listingTitle)}</strong>. Complete your payment below to confirm it — your spot is held until then.</p>
     ${detailRows(b)}
     <p style="margin:0 0 8px;"><a href="${esc(payUrl)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Pay securely via PayLink</a></p>
     <p style="font-size:13px;line-height:1.6;color:#6B6357;margin:0;">If you didn't arrange this booking, you can ignore this email — nothing will be charged.</p>`,
    site,
  );
  return send(to, `Complete your booking: ${b.listingTitle}`, html);
}

/**
 * To the guest: their invoice (server/invoices.ts). The email carries the whole
 * invoice (shared/invoice.ts, drawn without its own wordmark — this frame has
 * it) plus a link to the private page where they can save it as a PDF.
 */
export function sendInvoiceEmail(
  to: string,
  inv: { number: string; sellerName: string; listingTitle: string; totalLabel: string; due: boolean; invoiceHtml: string; url: string; replyTo?: string },
) {
  const lead = inv.due
    ? `Here's your invoice for <strong>${esc(inv.listingTitle)}</strong>. Balance due: <strong>${esc(inv.totalLabel)}</strong>.`
    : `Here's your invoice for <strong>${esc(inv.listingTitle)}</strong> — paid in full, thank you.`;
  const html = shell(
    `Your invoice from ${inv.sellerName}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${lead}</p>
     <p style="margin:0 0 22px;"><a href="${esc(inv.url)}" style="background:#212121;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">View and download PDF</a></p>
     <div style="border:1px solid #e4ded3;border-radius:12px;padding:16px 14px;">${inv.invoiceHtml}</div>
     <p style="font-size:13px;line-height:1.6;color:#6B6357;margin:16px 0 0;">Questions about this invoice? Just reply to this email.</p>`,
    SITE(),
  );
  return send(to, `Invoice ${inv.number} · ${inv.listingTitle}`, html, { replyTo: inv.replyTo });
}

/** To the buyer: their restaurant voucher is active — the code to show in-venue. */
export function sendVoucherPurchased(
  to: string,
  opts: { restaurantTitle: string; code: string; faceCents: number; currency: string; expiresAt: string },
) {
  const site = SITE();
  const face = `${Math.round(opts.faceCents / 100).toLocaleString("en-US")} ${esc(opts.currency)}`;
  const expiry = new Date(opts.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const html = shell(
    `Your voucher for ${esc(opts.restaurantTitle)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Your <strong>${face}</strong> dining voucher for <strong>${esc(opts.restaurantTitle)}</strong> is ready. Show this code (or open it in your Revamp account) when you dine — the staff will redeem it.</p>
     <p style="font-size:22px;font-weight:700;letter-spacing:2px;margin:14px 0;text-align:center;background:#F7F4EF;padding:14px;border-radius:8px;">${esc(opts.code)}</p>
     <p style="font-size:13px;line-height:1.6;color:#6B6357;margin:0 0 8px;">Valid until ${esc(expiry)}. One-time use.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/account?tab=vouchers" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View in my account</a></p>`,
    site,
  );
  return send(to, `Your voucher: ${opts.restaurantTitle}`, html);
}

/** To the guest: the host couldn't accommodate the request. */
export function sendGuestBookingDeclined(to: string, b: BookingEmailInfo) {
  const site = SITE();
  const html = shell(
    `Update on your request for ${esc(b.listingTitle)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Unfortunately the host couldn't accommodate this request, so it's been released — you have not been charged. You're welcome to pick another time or a different experience.</p>
     ${detailRows(b)}
     <p style="margin:0 0 8px;"><a href="${esc(site)}/explore/experience" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Browse experiences</a></p>`,
    site,
  );
  return send(to, `Update on your request: ${b.listingTitle}`, html);
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

/** Ask a traveler to review a listing after their trip completes. Type-aware
 *  ("your stay" / "tour" / "experience") and leads with the listing's cover photo. */
export function sendReviewRequest(
  to: string,
  opts: { listingTitle: string; slug?: string; bookingId: string; type?: string; image?: string },
) {
  const site = SITE();
  const link = `${site}/account?tab=trips&review=${encodeURIComponent(opts.bookingId)}`;
  const noun = opts.type === "stay" ? "stay" : opts.type === "tour" ? "tour" : opts.type === "experience" ? "experience" : "trip";
  // Brand illustrations are root-relative (/images/…) and need the origin;
  // operator-uploaded photos are already absolute URLs.
  const img = opts.image ? (opts.image.startsWith("/") ? `${site}${opts.image}` : opts.image) : "";
  const cover = img
    ? `<img src="${esc(img)}" alt="" width="100%" style="display:block;width:100%;height:auto;max-height:220px;object-fit:cover;border-radius:10px;margin:0 0 18px;" />`
    : "";
  const html = shell(
    `How was your ${noun}? ✨`,
    `${cover}<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">We hope <strong>${esc(opts.listingTitle)}</strong> was everything you'd hoped for. A quick review helps other travelers — and the host — a lot.</p>
     <p style="font-size:14px;line-height:1.6;color:#6B6357;margin:0 0 16px;">It takes less than a minute.</p>
     <p style="margin:0 0 8px;"><a href="${esc(link)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Leave a review</a></p>`,
    site,
  );
  return send(to, `How was your ${noun}?`, html);
}

/** Revamp credit (0105): the guest earned credit from a finished trip. */
export function sendCreditEarned(to: string, c: { listingTitle: string; earnedCents: number; balanceCents: number; expiresAt: string }) {
  const site = SITE();
  const amd = (cents: number) => `֏${Math.round(cents / 100).toLocaleString("en-US")}`;
  const until = new Date(c.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Yerevan" });
  const html = shell(
    `You earned ${amd(c.earnedCents)} Revamp credit`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Thanks for travelling with us — your trip to <strong>${esc(c.listingTitle)}</strong> earned you <strong>${amd(c.earnedCents)}</strong> in Revamp credit.</p>
     <p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Your balance is now <strong>${amd(c.balanceCents)}</strong>. It's applied automatically at checkout on your next stay, tour or experience.</p>
     <p style="font-size:13px;line-height:1.6;color:#6B6357;margin:0 0 16px;">This credit is valid until ${esc(until)}.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/explore" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Plan your next trip</a></p>
     <p style="font-size:12px;line-height:1.6;color:#8B8478;margin:14px 0 0;">See your credit any time in <a href="${esc(site)}/account?tab=credit" style="color:#8B8478;">your account</a>.</p>`,
    site,
  );
  return send(to, `You earned ${amd(c.earnedCents)} Revamp credit`, html);
}

/** Revamp credit guardrail (0106): tell admins a credit was held for review or refused. */
export function sendCreditReviewAlert(to: string, a: { kind: "held" | "refused"; listingTitle: string; cents: number; reason: string; bookingId: string }) {
  const site = SITE();
  const amd = `֏${Math.round(a.cents / 100).toLocaleString("en-US")}`;
  const title = a.kind === "held" ? `Revamp credit held for review: ${amd}` : `Revamp credit refused: ${amd}`;
  const html = shell(
    title,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">A guest's trip to <strong>${esc(a.listingTitle)}</strong> would earn <strong>${amd}</strong> in Revamp credit — ${esc(a.reason)}.</p>
     <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${
       a.kind === "held"
         ? "It's on hold: the guest can't spend it until you approve it."
         : "It breaks a hard ceiling, so it was not created. Check the booking — its price may be wrong."
     }</p>
     <p style="font-size:13px;color:#6B6357;margin:0 0 16px;">Booking #${esc(a.bookingId.slice(0, 8).toUpperCase())}</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/admin?section=credit" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open Guest credit</a></p>`,
    site,
  );
  return send(to, title, html);
}

/** Customer Journey (0097): an operator's step message (check-in, meeting point,
 *  mid-stay, checkout, thank-you). The body is operator text: escaped, `**bold**`
 *  kept, line breaks kept. The button opens the guest's private trip page.
 *  Replies go to the operator when they set a reply-to address. */
export function sendJourneyEmail(
  to: string,
  m: { subject: string; body: string; ctaLabel: string; tripLink: string; hostName?: string; replyTo?: string },
) {
  const site = SITE();
  const paragraphs = m.body
    .split(/\n{2,}/)
    .map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${boldToHtml(esc(p)).replace(/\n/g, "<br />")}</p>`)
    .join("");
  const html = shell(
    m.subject,
    `${paragraphs}
     ${m.tripLink ? `<p style="margin:6px 0 8px;"><a href="${esc(m.tripLink)}" style="display:inline-block;background:#F15822;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;line-height:1.35;max-width:100%;box-sizing:border-box;">${esc(m.ctaLabel)}</a></p>` : ""}
     ${m.hostName ? `<p style="font-size:13px;line-height:1.6;margin:12px 0 0;color:#6B6357;">— ${esc(m.hostName)}, via Revamp</p>` : ""}`,
    site,
  );
  return send(to, m.subject, html, { replyTo: m.replyTo || undefined });
}

/** Customer Journey: a guest scored their stay/experience 1–3 — tell the operator now. */
export function sendSurveyAlert(
  to: string,
  a: { listingTitle: string; guestName: string; rating: number; comment: string; stepLabel: string; startDate: string; endDate: string },
) {
  const site = SITE();
  const stars = "★".repeat(a.rating) + "☆".repeat(5 - a.rating);
  const html = shell(
    `${a.guestName} rated ${a.listingTitle} ${a.rating}/5`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">${esc(a.stepLabel)} survey · ${esc(prettyDate(a.startDate))} → ${esc(prettyDate(a.endDate))}</p>
     <p style="font-size:22px;letter-spacing:2px;color:#F15822;margin:0 0 10px;">${stars}</p>
     ${a.comment ? `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #F15822;background:#faf9f5;font-size:15px;line-height:1.6;">${esc(a.comment)}</blockquote>` : ""}
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">A quick personal reply now often turns the stay around. The guest was shown a “we'd like to make it right” note.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/dashboard?section=bookings" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open bookings</a></p>`,
    site,
  );
  return send(to, `Guest feedback ${a.rating}/5 — ${a.listingTitle}`, html);
}

/** Notify an inbox participant that they received a new message (unified inbox). */
export function sendNewMessage(
  to: string,
  opts: { fromName: string; listingTitle?: string; snippet: string; recipientRole: "traveler" | "operator" },
) {
  const site = SITE();
  const dest = opts.recipientRole === "operator" ? `${site}/dashboard?section=messages` : `${site}/account?tab=messages`;
  const html = shell(
    `New message from ${esc(opts.fromName)}`,
    `${opts.listingTitle ? `<p style="font-size:13px;color:#6B6357;margin:0 0 8px;">Re: ${esc(opts.listingTitle)}</p>` : ""}
     <p style="font-size:15px;line-height:1.6;margin:0 0 14px;padding:12px 14px;background:#f6f3ec;border-radius:8px;">${esc(opts.snippet)}</p>
     <p style="margin:0 0 8px;"><a href="${esc(dest)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Reply on Revamp</a></p>
     <p style="font-size:12px;color:#8B8478;margin:8px 0 0;">Keep the conversation on Revamp so your booking stays protected.</p>`,
    site,
  );
  return send(to, `New message from ${opts.fromName}`, html);
}

/** To the recipient: they've received a Revamp gift card. */
export function sendGiftCard(
  to: string,
  opts: { code: string; amountCents: number; currency: string; recipientName?: string; message?: string; expiresAt: string },
) {
  const site = SITE();
  const expiry = prettyDate(opts.expiresAt.slice(0, 10));
  const html = shell(
    "You've received a Revamp gift card 🎁",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${opts.recipientName ? `Hi ${esc(opts.recipientName)}, ` : ""}someone sent you a Revamp Vacations gift card to spend on stays, tours, and experiences across Armenia.</p>
     ${opts.message ? `<p style="font-size:14px;line-height:1.6;color:#6B6357;font-style:italic;margin:0 0 14px;padding:12px 14px;background:#f6f3ec;border-radius:8px;">“${esc(opts.message)}”</p>` : ""}
     <div style="border:1px dashed #c9c2b4;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px;">
       <p style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#8B8478;margin:0 0 6px;">Gift card value</p>
       <p style="font-size:30px;font-weight:800;letter-spacing:-.02em;color:#212121;margin:0 0 10px;">${esc(money(opts.amountCents, opts.currency))}</p>
       <p style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#8B8478;margin:0 0 4px;">Your code</p>
       <p style="font-size:22px;font-weight:700;letter-spacing:.08em;color:#F15822;margin:0;font-family:monospace;">${esc(opts.code)}</p>
     </div>
     <p style="margin:0 0 12px;"><a href="${esc(site)}/explore" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Browse & book</a></p>
     <p style="font-size:13px;line-height:1.6;color:#6B6357;margin:0;">Enter your code at checkout to apply the balance. You can use it across multiple bookings until it runs out. Valid until <strong>${esc(expiry)}</strong>. Non-refundable and not exchangeable for cash.</p>`,
    site,
  );
  return send(to, `You've received a ${money(opts.amountCents, opts.currency)} Revamp gift card`, html);
}

/** To the purchaser: their gift-card payment went through. */
export function sendGiftReceipt(to: string, opts: { amountCents: number; currency: string; recipientName: string }) {
  const site = SITE();
  const html = shell(
    "Your gift card is on its way 🎁",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;">Thanks for your purchase. A <strong>${esc(money(opts.amountCents, opts.currency))}</strong> Revamp gift card has been emailed to <strong>${esc(opts.recipientName)}</strong>.</p>
     <p style="font-size:14px;line-height:1.6;color:#6B6357;margin:0;">They can redeem it at checkout on any stay, tour, or experience.</p>`,
    site,
  );
  return send(to, "Your Revamp gift card purchase", html);
}

/** Alert an admin that a support chat needs a human reply. */
export function sendPrepaidTopupAlert(to: string, opts: { restaurantTitle: string; balanceCents: number; outstandingCents: number; currency: string }) {
  const site = SITE();
  const money = (c: number) => `${opts.currency === "USD" ? "$" : "֏"}${Math.round(c / 100).toLocaleString("en-US")}`;
  const html = shell(
    "A restaurant's prepaid balance needs a top-up 💳",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Customers now hold more voucher credit at <strong>${esc(opts.restaurantTitle)}</strong> than its remaining Revamp balance — top it up so redemptions don't get blocked.</p>
     <p style="margin:0 0 4px;font-size:14px;">Remaining balance: <strong>${money(opts.balanceCents)}</strong></p>
     <p style="margin:0 0 16px;font-size:14px;">Outstanding voucher credit: <strong>${money(opts.outstandingCents)}</strong></p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/admin" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Top up in Admin → Vouchers</a></p>`,
    site,
  );
  return send(to, `Top up ${opts.restaurantTitle}'s prepaid balance`, html);
}

/**
 * Admin alert (0112, server/venueStatus.ts): Google now reports a restaurant /
 * place to visit as temporarily or permanently closed — or open again.
 * Nothing changed on the site automatically; the admin decides.
 */
export function sendVenueStatusAlert(
  to: string,
  opts: { title: string; type: "eat" | "place"; slug: string; status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY"; previous: string | null; mapsUri: string | null },
) {
  const site = SITE();
  const label = { OPERATIONAL: "open again", CLOSED_TEMPORARILY: "temporarily closed", CLOSED_PERMANENTLY: "permanently closed" }[opts.status];
  const kind = opts.type === "eat" ? "restaurant" : "place to visit";
  const advice =
    opts.status === "CLOSED_PERMANENTLY"
      ? "Consider unpublishing it so guests aren't sent to a closed venue — and check any active vouchers or prepaid balance."
      : opts.status === "CLOSED_TEMPORARILY"
        ? "Check whether to pause it or add a note until it reopens."
        : "If you paused it, you can put it back.";
  const adminSection = opts.type === "eat" ? "eateries" : "places";
  const html = shell(
    `${opts.title} is ${label}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">Google now lists the ${kind} <strong>${esc(opts.title)}</strong> as <strong>${label}</strong>${opts.previous ? ` (was ${esc(opts.previous.toLowerCase().replace(/_/g, " "))})` : ""}.</p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 16px;color:#55514b;">Nothing was changed on the site. ${advice}</p>
     <p style="margin:0 0 8px;">
       <a href="${esc(`${site}/admin?section=${adminSection}`)}" style="background:#F15822;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;margin:0 8px 8px 0;">Open in Admin</a>
       <a href="${esc(`${site}/listing/${opts.slug}`)}" style="color:#212121;font-weight:600;margin-right:14px;">View listing</a>
       ${opts.mapsUri ? `<a href="${esc(opts.mapsUri)}" style="color:#212121;font-weight:600;">Google Maps</a>` : ""}
     </p>`,
    site,
  );
  return send(to, `${opts.title}: ${label} (Google)`, html);
}

/**
 * Admin alert: an operator switched a listing off/on, or suspended / resumed its
 * bookings (0101, server/listingStatus.ts). Says how many upcoming bookings the
 * operator still has to honour.
 */
export function sendListingStatusAlert(
  to: string,
  opts: {
    action: "suspend" | "resume" | "deactivate" | "activate";
    listingTitle: string;
    listingSlug: string;
    operatorName: string;
    /** Set when an admin made the change on the operator's behalf. */
    byAdmin: string | null;
    from: string | null;
    until: string | null;
    note: string | null;
    bookingsToHonour: number;
  },
) {
  const site = SITE();
  const day = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const who = opts.byAdmin ? `${esc(opts.byAdmin)} (admin, for ${esc(opts.operatorName)})` : esc(opts.operatorName);
  const what = {
    suspend: `suspended bookings for <strong>${esc(opts.listingTitle)}</strong>`,
    resume: `resumed bookings for <strong>${esc(opts.listingTitle)}</strong>`,
    deactivate: `switched <strong>${esc(opts.listingTitle)}</strong> to inactive`,
    activate: `switched <strong>${esc(opts.listingTitle)}</strong> back on`,
  }[opts.action];
  const period =
    opts.action === "suspend" && opts.from
      ? `<p style="margin:0 0 6px;font-size:14px;">Period: <strong>${esc(day(opts.from))}</strong> → <strong>${opts.until ? esc(day(opts.until)) : "until they resume"}</strong></p>`
      : "";
  const effect =
    opts.action === "deactivate"
      ? "It's hidden from the site and can't be booked."
      : opts.action === "suspend"
        ? "Guests can't book those dates, and the listing is out of search while the period is on."
        : "It's bookable again.";
  const honour =
    opts.action === "suspend" || opts.action === "deactivate"
      ? `<p style="margin:0 0 6px;font-size:14px;">Upcoming bookings they must still honour: <strong>${opts.bookingsToHonour}</strong></p>`
      : "";
  const note = opts.note ? `<blockquote style="margin:10px 0 16px;padding:12px 16px;border-left:3px solid #F15822;background:#faf9f5;font-size:14px;line-height:1.6;color:#3f3b36;">${esc(opts.note)}</blockquote>` : "";
  const subject = {
    suspend: `Suspended: ${opts.listingTitle}`,
    resume: `Bookings resumed: ${opts.listingTitle}`,
    deactivate: `Inactive: ${opts.listingTitle}`,
    activate: `Active again: ${opts.listingTitle}`,
  }[opts.action];
  const html = shell(
    "A listing's availability changed",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">${who} ${what}. ${effect}</p>
     ${period}${honour}${note}
     <p style="margin:16px 0 8px;"><a href="${esc(site)}/listing/${esc(opts.listingSlug)}" style="background:#212121;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View the listing</a></p>`,
    site,
  );
  return send(to, subject, html);
}

export function sendSupportAlert(to: string, opts: { travelerName: string; message: string }) {
  const site = SITE();
  const html = shell(
    "A traveler needs a hand 💬",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;"><strong>${esc(opts.travelerName || "A traveler")}</strong> sent a message the assistant couldn't fully handle:</p>
     <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #F15822;background:#faf9f5;font-size:14px;line-height:1.6;color:#3f3b36;">${esc(opts.message)}</blockquote>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/admin" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open the support inbox</a></p>`,
    site,
  );
  return send(to, "Support: a traveler needs a reply", html);
}

/**
 * A scheduled job (cron) looks down: its last successful run is older than
 * expected, or it has been failing. `reason` describes which. Sent to admins so
 * a silently-stopped cron (e.g. the iCal availability refresh) gets noticed
 * instead of leaving listings stale for weeks.
 */
export function sendCronAlert(
  to: string,
  opts: { job: string; reason: string; lastSuccessAt: string | null; lastError?: string | null },
) {
  const site = SITE();
  const last = opts.lastSuccessAt ? prettyDateTime(opts.lastSuccessAt) : "never";
  const html = shell(
    "A background job looks stuck ⚠️",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">The scheduled job <strong>${esc(opts.job)}</strong> isn't running as expected.</p>
     <p style="margin:0 0 4px;font-size:14px;">What's wrong: <strong>${esc(opts.reason)}</strong></p>
     <p style="margin:0 0 4px;font-size:14px;">Last successful run: <strong>${esc(last)}</strong></p>
     ${opts.lastError ? `<p style="margin:0 0 12px;font-size:14px;">Last error: <span style="color:#b4451f;">${esc(opts.lastError)}</span></p>` : ""}
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">Check the function's logs in Netlify (Logs → Functions → <em>${esc(opts.job)}</em>). If it's the iCal refresh, operator calendars (Airbnb/Booking.com availability) may be out of date until it runs again.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/admin" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open Admin</a></p>`,
    site,
  );
  return send(to, `⚠️ Cron "${opts.job}" looks stuck`, html);
}

/**
 * A referral the operator made just qualified — their referred host got their
 * first booking, so the referrer earned credit. Referrer-only reward.
 */
export function sendReferralReward(to: string, opts: { rewardCents: number; currency: string }) {
  const site = SITE();
  const html = shell(
    "You earned a referral reward 🎉",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Great news — a host you referred to Revamp just got their first confirmed booking. You've earned <strong>${money(opts.rewardCents, opts.currency)}</strong> in referral credit.</p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">It's now showing in your dashboard. Keep inviting great hosts — every one who makes their first booking earns you more.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/dashboard?section=referrals" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">See your referrals</a></p>`,
    site,
  );
  return send(to, "You earned a Revamp referral reward", html);
}

export interface CommissionStatementEmail {
  periodLabel: string; // e.g. "October 2026"
  commissionCents: number;
  addonsCents: number;
  giftCreditCents: number;
  adjustmentCents: number;
  totalDueCents: number;
  currency: string;
  dueDate: string; // YYYY-MM-DD
  payUrl: string | null;
}

function statementTable(s: CommissionStatementEmail): string {
  const row = (label: string, cents: number, sign = "") =>
    `<tr><td style="padding:6px 12px;color:#3f3b36;">${esc(label)}</td><td style="padding:6px 12px;text-align:right;white-space:nowrap;">${sign}${money(Math.abs(cents), s.currency)}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px;line-height:1.5;border:1px solid #eee;border-radius:8px;padding:4px 0;margin:8px 0 18px;">
    ${row("Revamp commission", s.commissionCents)}
    ${s.addonsCents ? row("Checkout add-ons", s.addonsCents) : ""}
    ${s.giftCreditCents ? row("Gift-card amounts Revamp owes you", s.giftCreditCents, "− ") : ""}
    ${s.adjustmentCents ? row("Credits for cancelled bookings", s.adjustmentCents, "− ") : ""}
    <tr><td style="padding:8px 12px;border-top:1px solid #eee;font-weight:700;">Total due</td><td style="padding:8px 12px;border-top:1px solid #eee;text-align:right;font-weight:700;white-space:nowrap;">${money(s.totalDueCents, s.currency)}</td></tr>
  </table>`;
}

/** Monthly commission statement for an operator paid directly via their own PayLink. */
export function sendCommissionStatement(to: string, s: CommissionStatementEmail) {
  const site = SITE();
  const html = shell(
    `Your Revamp statement — ${s.periodLabel}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Guests paid you directly through your PayLink account last month. Here's what's due to Revamp for ${esc(s.periodLabel)}.</p>
     ${statementTable(s)}
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">Please pay by <strong>${esc(prettyDate(s.dueDate))}</strong>. If it's still unpaid after that, direct payments pause and new bookings are paid to Revamp until it's settled.</p>
     ${s.payUrl ? `<p style="margin:0 0 8px;"><a href="${esc(s.payUrl)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Pay ${money(s.totalDueCents, s.currency)}</a></p>` : ""}
     <p style="font-size:13px;line-height:1.6;margin:10px 0 0;"><a href="${esc(site)}/dashboard?section=billing" style="color:#F15822;">See all statements</a></p>`,
    site,
  );
  return send(to, `Revamp statement — ${s.periodLabel}: ${money(s.totalDueCents, s.currency)} due`, html);
}

/** Reminder a few days before a statement's due date. */
export function sendCommissionStatementReminder(to: string, s: CommissionStatementEmail) {
  const site = SITE();
  const html = shell(
    `Reminder: statement due ${prettyDate(s.dueDate)}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Your Revamp statement for ${esc(s.periodLabel)} (<strong>${money(s.totalDueCents, s.currency)}</strong>) is due on <strong>${esc(prettyDate(s.dueDate))}</strong>. After that, direct payments pause until it's paid.</p>
     ${s.payUrl ? `<p style="margin:0 0 8px;"><a href="${esc(s.payUrl)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Pay now</a></p>` : ""}
     <p style="font-size:13px;line-height:1.6;margin:10px 0 0;"><a href="${esc(site)}/dashboard?section=billing" style="color:#F15822;">See your statements</a></p>`,
    site,
  );
  return send(to, `Reminder: your Revamp statement is due ${prettyDate(s.dueDate)}`, html);
}

/** Direct payments paused because a statement is overdue. */
export function sendDirectPaymentsPaused(to: string, s: CommissionStatementEmail) {
  const site = SITE();
  const html = shell(
    "Direct payments are paused",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">Your Revamp statement for ${esc(s.periodLabel)} (<strong>${money(s.totalDueCents, s.currency)}</strong>) is overdue, so new bookings are now paid to Revamp instead of your PayLink account. You'll still receive those earnings through your regular Revamp payouts.</p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">Paying the statement switches direct payments back on automatically.</p>
     ${s.payUrl ? `<p style="margin:0 0 8px;"><a href="${esc(s.payUrl)}" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Pay ${money(s.totalDueCents, s.currency)}</a></p>` : ""}
     <p style="font-size:13px;line-height:1.6;margin:10px 0 0;"><a href="${esc(site)}/dashboard?section=billing" style="color:#F15822;">See your statements</a></p>`,
    site,
  );
  return send(to, "Revamp: direct payments are paused", html);
}

/** Hotels (0096): a room's imported Airbnb/Booking.com calendar now shows a booking
 *  on nights a Revamp guest already holds in that room — likely a double booking. */
export function sendRoomCalendarConflict(
  to: string,
  c: { hotel: string; room: string; guestName: string; checkIn: string; checkOut: string; source: string },
) {
  const site = SITE();
  const html = shell(
    `Possible double booking — ${c.room}`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 10px;">${esc(c.source)} now shows <strong>${esc(c.room)}</strong> at ${esc(c.hotel)} as booked on nights a Revamp guest already has.</p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">Revamp booking: <strong>${esc(c.guestName)}</strong>, ${esc(prettyDate(c.checkIn))} → ${esc(prettyDate(c.checkOut))}.</p>
     <p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3f3b36;">Open the booking and use <strong>Move to another room</strong> to give the Revamp guest a free room — or sort it out on ${esc(c.source)}.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/dashboard?section=bookings" style="background:#F15822;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open bookings</a></p>`,
    site,
  );
  return send(to, `Possible double booking: ${c.room}, ${prettyDate(c.checkIn)}`, html);
}

/** A previously-alerting cron has recovered — sent once when it comes back. */
export function sendCronRecovered(to: string, opts: { job: string }) {
  const site = SITE();
  const html = shell(
    "Background job recovered ✅",
    `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">The scheduled job <strong>${esc(opts.job)}</strong> is running again — it just completed successfully. No action needed.</p>
     <p style="margin:0 0 8px;"><a href="${esc(site)}/admin" style="background:#212121;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Open Admin</a></p>`,
    site,
  );
  return send(to, `✅ Cron "${opts.job}" recovered`, html);
}
