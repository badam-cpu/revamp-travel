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
  const n = major % 1 === 0 ? major.toLocaleString("en-US") : major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "USD" ? `$${n}` : currency === "AMD" ? `֏${n}` : `${n} ${currency}`;
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
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
