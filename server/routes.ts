/**
 * Listings CRUD used to live here (see git history / the old
 * server/store.ts) — it's gone now. Listings are a Supabase table
 * (supabase/migrations/0001_init.sql) that the client reads and writes
 * directly, protected by Row-Level Security instead of hand-written route
 * checks. Two server routes remain, both for jobs that genuinely need to
 * run server-side: the AI trip planner (holds ANTHROPIC_API_KEY) and the
 * dashboard's link-import prefill assist (fetches an arbitrary caller-
 * supplied URL, which the browser can't safely do itself — CORS aside,
 * this project's SSRF guard and size/timeout caps belong on the server).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { listPublishedForPlanner, verifyUser, userClient } from "./supabase.js";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin.js";
import { paylinkConfigured, registerPayment } from "./paylink.js";
import { reconcileUserBookings } from "./bookings.js";
import { generateSupportReply, type SupportTurn } from "./support.js";
import { generateOperatorReply, type OperatorTurn } from "./operatorAssistant.js";
import { payoutState } from "../shared/payouts.js";
import { sendCancellation, type BookingEmailInfo } from "./email.js";
import { computeBookingAmountCents, computeBookingCharge, computeRefundCents, isBookableType, promoDiscount, DEFAULT_CURRENCY } from "../shared/bookings.js";
import { planTrip, PlannerError } from "./planner.js";
import { fetchPrefill, PrefillError } from "./urlPrefill.js";
import { fetchIcalBlockedRanges } from "./ical.js";
import { SafeFetchError } from "./safeFetch.js";
import { robotsTxtHandler } from "./robots.js";
import { sitemapHandler } from "./sitemap.js";
import { renderForBot } from "./prerender.js";

const planTripSchema = z.object({
  days: z.number().int().min(1).max(21),
  startCity: z.string().trim().min(1).max(60),
  travelers: z.number().int().min(1).max(20),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  budget: z.enum(["budget", "mid-range", "comfort"]),
  interests: z.array(z.string().trim().min(1).max(40)).max(8),
});

const importListingSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});

const syncIcalSchema = z.object({
  listingId: z.string().uuid(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const startCheckoutSchema = z.object({
  listingId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
  guests: z.number().int().min(1).max(50),
  // Guest checkout: a signed-out traveler books anonymously and gives contact
  // details here (optional — signed-in travelers omit them).
  guestName: z.string().trim().max(120).optional(),
  guestEmail: z.string().trim().email().max(200).optional(),
  guestPhone: z.string().trim().max(40).optional(),
});

const cancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
});

const supportChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const supportContactSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional(),
});

const operatorAssistantSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), body: z.string().max(2000) }))
    .min(1)
    .max(20),
});

function issuesToMessage(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
}

// Soft, in-memory per-operator rate limit for the assistant. Best-effort across
// serverless instances — a light guard on the Anthropic bill, not security.
const operatorAssistantHits = new Map<string, number[]>();

function moneyByCurrency(map: Record<string, number>): string {
  const keys = Object.keys(map);
  if (!keys.length) return "0";
  return keys.map((c) => `${Math.round(map[c] / 100).toLocaleString("en-US")} ${c}`).join(", ");
}

/** Compact digest of an operator's own bookings + payouts for the assistant. */
function buildOperatorSummary(
  bookings: {
    start_date: string;
    end_date: string;
    guests: number;
    amount_cents: number;
    currency: string;
    status: string;
    listings: { title?: string; type?: string } | null;
  }[],
  payouts: { net_cents: number; currency: string; due_date: string; status: string }[],
  today: string,
): string {
  const confirmed = bookings.filter((b) => b.status === "confirmed" || b.status === "completed");
  const upcoming = confirmed.filter((b) => b.end_date >= today);
  const past = confirmed.filter((b) => b.end_date < today);
  const pending = bookings.filter((b) => b.status === "pending_payment");
  const cancelled = bookings.filter((b) => b.status === "cancelled" || b.status === "refunded");

  const revenue: Record<string, number> = {};
  for (const b of confirmed) revenue[b.currency] = (revenue[b.currency] ?? 0) + b.amount_cents;

  const owed: Record<string, number> = {};
  const paid: Record<string, number> = {};
  let nextDue: string | null = null;
  for (const p of payouts) {
    const st = payoutState(p.status as "pending" | "paid" | "cancelled", p.due_date, today);
    if (st === "unpaid" || st === "pending") {
      owed[p.currency] = (owed[p.currency] ?? 0) + p.net_cents;
      if (!nextDue || p.due_date < nextDue) nextDue = p.due_date;
    } else if (st === "paid") {
      paid[p.currency] = (paid[p.currency] ?? 0) + p.net_cents;
    }
  }

  const upcomingList = upcoming
    .slice(0, 20)
    .map(
      (b) =>
        `- ${b.listings?.title ?? "Listing"} (${b.listings?.type ?? "?"}) — ${b.start_date} to ${b.end_date}, ${b.guests} guest(s), ${Math.round(
          b.amount_cents / 100,
        ).toLocaleString("en-US")} ${b.currency}, ${b.status}`,
    );

  return [
    `Today: ${today}`,
    `Bookings — confirmed/completed: ${confirmed.length}, upcoming: ${upcoming.length}, past: ${past.length}, pending payment: ${pending.length}, cancelled/refunded: ${cancelled.length}.`,
    `Revenue (guest totals, confirmed + completed): ${moneyByCurrency(revenue)}.`,
    `Payouts you're still owed (net, not yet paid): ${moneyByCurrency(owed)}${nextDue ? `; next payout due ${nextDue}` : ""}.`,
    `Payouts already paid to you (net): ${moneyByCurrency(paid)}.`,
    "",
    "Upcoming confirmed bookings:",
    upcomingList.length ? upcomingList.join("\n") : "- (none)",
  ].join("\n");
}

export function registerApiRoutes(app: Express) {
  // Dynamic robots.txt / sitemap.xml. Registered at both the public path (for
  // the long-running server in server/index.ts, and local `pnpm start`) and
  // an /api-prefixed alias — on Netlify the CDN serves the SPA, so these are
  // reached only via the function, whose path normalizer forces everything
  // under /api (see netlify/functions/api.ts + the /robots.txt, /sitemap.xml
  // redirects in netlify.toml).
  app.get("/robots.txt", robotsTxtHandler);
  app.get("/api/robots.txt", robotsTxtHandler);
  app.get("/sitemap.xml", sitemapHandler);
  app.get("/api/sitemap.xml", sitemapHandler);

  // Bot-facing prerendered HTML for a given SPA route. Called by the Netlify
  // Edge Function (netlify/edge-functions/prerender.ts), which does the UA
  // sniffing at the edge and, for a known crawler, fetches this and returns
  // its HTML instead of the empty SPA shell. `path` is the SPA pathname to
  // render; `origin` is the real public origin (passed by the edge function
  // so canonical/OG/JSON-LD URLs are correct behind the proxy).
  app.get("/api/prerender", async (req: Request, res: Response) => {
    const rawPath = typeof req.query.path === "string" ? req.query.path : "/";
    const path = rawPath.startsWith("/") && rawPath.length <= 512 ? rawPath : "/";
    const origin =
      typeof req.query.origin === "string" && /^https?:\/\/[^\s/]+$/.test(req.query.origin)
        ? req.query.origin
        : `${req.protocol}://${req.get("host")}`;
    try {
      const { status, body } = await renderForBot(path, origin);
      res.status(status).set("Content-Type", "text/html; charset=utf-8").send(body);
    } catch (err) {
      console.error("prerender failed", err);
      // 500 (not 200) so the edge function knows to fall back to the SPA shell.
      res.status(500).set("Content-Type", "text/plain").send("prerender error");
    }
  });

  app.post("/api/plan-trip", async (req: Request, res: Response) => {
    const parsed = planTripSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    try {
      const listings = await listPublishedForPlanner();
      const itinerary = await planTrip(parsed.data, listings);
      res.json({ itinerary });
    } catch (err) {
      if (err instanceof PlannerError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("plan-trip failed", err);
      res.status(502).json({ error: "The trip planner is temporarily unavailable. Please try again." });
    }
  });

  app.post("/api/import-listing", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId) {
      return res.status(401).json({ error: "Sign in to use the link-import assist." });
    }

    const parsed = importListingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    try {
      const prefill = await fetchPrefill(parsed.data.url);
      res.json(prefill);
    } catch (err) {
      if (err instanceof PrefillError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("import-listing failed", err);
      res.status(502).json({ error: "Couldn't fetch that link — you can still fill the form in by hand." });
    }
  });

  // Refresh a listing's availability from its Airbnb (or any) iCal export URL.
  // Signed-in + scoped to the caller's own listing by RLS (userClient) — no
  // service-role privilege. One-way: reads the feed, caches blocked ranges.
  app.post("/api/sync-ical", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) {
      return res.status(401).json({ error: "Sign in to sync a calendar." });
    }
    const parsed = syncIcalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    const supa = userClient(token);
    if (!supa) {
      return res.status(503).json({ error: "Calendar sync isn't configured on the server." });
    }
    const { listingId } = parsed.data;

    const { data: listing, error: readErr } = await supa.from("listings").select("id, ical_url").eq("id", listingId).maybeSingle();
    if (readErr || !listing) {
      return res.status(404).json({ error: "Listing not found." });
    }
    if (!listing.ical_url) {
      return res.status(400).json({ error: "Add an Airbnb calendar export URL to this listing first." });
    }

    try {
      const blockedRanges = await fetchIcalBlockedRanges(listing.ical_url);
      const syncedAt = new Date().toISOString();
      const { error: upErr } = await supa
        .from("listings")
        .update({ blocked_ranges: blockedRanges, ical_synced_at: syncedAt, ical_error: null })
        .eq("id", listingId);
      if (upErr) throw new Error(upErr.message);
      res.json({ count: blockedRanges.length, blockedRanges, syncedAt });
    } catch (err) {
      const message = err instanceof SafeFetchError ? err.message : "Couldn't read that calendar. Check it's the Airbnb calendar *export* URL (ends in .ics).";
      // Record the failure on the listing so the operator sees it, but don't wipe existing availability.
      await supa.from("listings").update({ ical_error: message, ical_synced_at: new Date().toISOString() }).eq("id", listingId);
      console.error("sync-ical failed", err);
      res.status(err instanceof SafeFetchError ? err.status : 502).json({ error: message });
    }
  });

  // --- PayLink booking loop --------------------------------------------
  // POST /api/start-checkout — begin a booking for the signed-in traveler. The
  // client sends only listingId + dates + guests; the amount is computed
  // server-side from the listing (shared/bookings.ts) so it can't be tampered
  // with. Creates a `pending_payment` booking and returns the PayLink
  // redirectUrl. Access is NOT granted here — only confirm-checkout (server-
  // verified) flips a booking to `confirmed`.
  app.post("/api/start-checkout", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to book." });
    if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });

    const parsed = startCheckoutSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const { listingId, startDate, endDate, guests, guestName, guestEmail, guestPhone } = parsed.data;

    if (endDate <= startDate) return res.status(400).json({ error: "Check-out must be after check-in." });
    const today = new Date().toISOString().slice(0, 10);
    if (startDate < today) return res.status(400).json({ error: "Pick a start date in the future." });

    const supa = userClient(token);
    if (!supa) return res.status(503).json({ error: "Booking isn't configured on the server." });

    // Read the listing under RLS — published listings are publicly readable.
    const { data: listing, error: readErr } = await supa
      .from("listings")
      .select("id, type, title, status, price_cents, price_unit, blocked_ranges, cancellation_policy, free_cancel_days, nonrefundable_discount_percent, cleaning_fee_cents, discount_type, discount_value, discount_start, discount_end")
      .eq("id", listingId)
      .maybeSingle();
    if (readErr || !listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.status !== "published") return res.status(400).json({ error: "This listing isn't open for booking." });
    if (!isBookableType(listing.type)) return res.status(400).json({ error: "This listing can't be booked online." });

    // Accommodation is discount-aware (non-refundable listing charged at its
    // discount); base = accommodation + the flat cleaning fee; the guest is
    // then charged base + tax on top.
    const accommodationCents = computeBookingAmountCents(
      {
        priceCents: listing.price_cents,
        priceUnit: listing.price_unit,
        cancellationPolicy: listing.cancellation_policy ?? "flexible",
        nonrefundableDiscountPercent: listing.nonrefundable_discount_percent ?? 0,
      },
      { startDate, endDate, guests },
    );
    if (accommodationCents <= 0) return res.status(400).json({ error: "This listing is rate-on-request — contact the operator to book." });
    // Apply the operator's promo discount when the check-in date is in the sale window.
    const { netCents: netAccommodationCents } = promoDiscount(
      accommodationCents,
      { discountType: listing.discount_type, discountValue: listing.discount_value, discountStart: listing.discount_start, discountEnd: listing.discount_end },
      startDate,
    );
    const charge = computeBookingCharge(netAccommodationCents + (listing.cleaning_fee_cents ?? 0)); // base + tax = total the guest pays

    // Availability: reject if the dates clash with the listing's iCal blocked
    // ranges, an existing confirmed booking, or a live (recent) pending hold.
    const blocked: { start: string; end: string }[] = Array.isArray(listing.blocked_ranges) ? listing.blocked_ranges : [];
    const overlapsBlocked = blocked.some((r) => r.start < endDate && r.end > startDate);
    if (overlapsBlocked) return res.status(409).json({ error: "Those dates aren't available." });

    const admin = supabaseAdmin();
    if (admin) {
      // Overlap = existing.start < new.end AND existing.end > new.start.
      const { data: clashes } = await admin
        .from("bookings")
        .select("id, status, created_at")
        .eq("listing_id", listingId)
        .in("status", ["confirmed", "pending_payment"])
        .lt("start_date", endDate)
        .gt("end_date", startDate);
      const holdCutoff = Date.now() - 15 * 60_000; // pending holds older than 15m are stale
      const taken = (clashes ?? []).some(
        (c) => c.status === "confirmed" || (c.status === "pending_payment" && Date.parse(c.created_at) > holdCutoff),
      );
      if (taken) return res.status(409).json({ error: "Those dates were just taken. Try different dates." });
    }

    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
    try {
      const pay = await registerPayment({
        // PayLink's `amount` is in major currency units; charge the tax-inclusive
        // total. AMD (our settlement currency) has no minor unit, so round to a
        // whole dram — every stored *_cents value is AMD hundredths.
        amount: currency === "AMD" ? Math.round(charge.totalCents / 100) : charge.totalCents / 100,
        currency,
        returnUrl: `${site}/account?checkout=return`,
        info: `Revamp booking · ${listing.title}`,
      });
      if (!pay.redirectUrl) return res.status(502).json({ error: "Couldn't start checkout." });

      // Insert the pending hold as the traveler (RLS allows own + pending only).
      // Snapshot the cancellation terms so a later listing change can't alter them.
      const bookingRow: Record<string, unknown> = {
        listing_id: listingId,
        traveler_id: userId,
        start_date: startDate,
        end_date: endDate,
        guests,
        amount_cents: charge.totalCents,
        base_cents: charge.baseCents,
        tax_cents: charge.taxCents,
        currency,
        status: "pending_payment",
        provider: "paylink",
        paylink_request_id: pay.requestId,
        paylink_order_id: pay.orderId,
        cancellation_policy: listing.cancellation_policy ?? "flexible",
        free_cancel_days: listing.free_cancel_days ?? 7,
      };
      // Only touch the guest_* columns for an actual guest checkout, so a
      // signed-in booking still works even if migration 0024 hasn't run yet.
      if (guestName || guestEmail || guestPhone) {
        bookingRow.guest_name = guestName || null;
        bookingRow.guest_email = guestEmail || null;
        bookingRow.guest_phone = guestPhone || null;
      }
      const { error: insErr } = await supa.from("bookings").insert(bookingRow);
      if (insErr) {
        console.error("[start-checkout] insert failed", insErr.message);
        return res.status(500).json({ error: "Couldn't record your booking." });
      }
      res.json({ redirectUrl: pay.redirectUrl });
    } catch (err) {
      console.error("[start-checkout]", err);
      res.status(502).json({ error: "Couldn't start checkout." });
    }
  });

  // POST /api/confirm-checkout — server-verified confirmation. Called when the
  // traveler returns from PayLink (/account?checkout=return) and on account
  // load. Polls PayLink for the user's pending bookings and confirms any it
  // reports approved. This is the SOLE path that confirms a booking — hitting
  // the return URL without a real approved payment confirms nothing.
  app.post("/api/confirm-checkout", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to confirm your booking." });
    if (!adminConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Payments aren't available yet." });
    try {
      const r = await reconcileUserBookings(admin, userId);
      res.json({ confirmed: r.confirmed, pending: r.checked > 0 && r.confirmed === 0 });
    } catch (err) {
      console.error("[confirm-checkout]", err);
      res.status(500).json({ error: "Couldn't confirm your payment." });
    }
  });

  // POST /api/cancel-booking — cancel a booking. Allowed for the traveler who
  // made it, the operator whose listing it's on, or an admin. Flips the status
  // to `cancelled` (which releases the dates — the exclusion constraint is
  // confirmed-only) and emails the counterparty. PayLink has no refund API, so
  // a paid booking's refund is flagged as manual (refundOwed), not auto-issued.
  app.post("/api/cancel-booking", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to cancel a booking." });

    const parsed = cancelBookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Cancellation isn't available right now." });

    const { data: booking } = await admin
      .from("bookings")
      .select("id, listing_id, traveler_id, status, start_date, end_date, guests, amount_cents, currency, paid_at, cancellation_policy, free_cancel_days")
      .eq("id", parsed.data.bookingId)
      .maybeSingle();
    if (!booking) return res.status(404).json({ error: "Booking not found." });

    const { data: listing } = await admin
      .from("listings")
      .select("title, city, region, slug, operator_id")
      .eq("id", booking.listing_id)
      .maybeSingle();

    // Authorize: traveler who booked, the listing's operator, or an admin.
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    const isAdmin = profile?.role === "admin";
    const isTraveler = userId === booking.traveler_id;
    const isOperator = !!listing && userId === listing.operator_id;
    if (!isTraveler && !isOperator && !isAdmin) return res.status(403).json({ error: "You can't cancel this booking." });

    if (booking.status !== "pending_payment" && booking.status !== "confirmed") {
      return res.status(400).json({ error: `This booking is already ${booking.status.replace(/_/g, " ")}.` });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (booking.start_date < today) return res.status(400).json({ error: "This trip has already started or passed." });

    // Refund owed is computed from the policy SNAPSHOT on the booking (fair to
    // the traveler even if the listing changed since). PayLink has no refund
    // API, so this is what the operator issues by hand; we record it.
    const refundCents = computeRefundCents(
      {
        status: booking.status,
        paidAt: booking.paid_at,
        amountCents: booking.amount_cents,
        startDate: booking.start_date,
        cancellationPolicy: booking.cancellation_policy,
        freeCancelDays: booking.free_cancel_days,
      },
      new Date().toISOString(),
    );
    const refundOwed = refundCents > 0;

    const { data: upd, error: updErr } = await admin
      .from("bookings")
      .update({ status: "cancelled", refund_amount_cents: refundCents })
      .eq("id", booking.id)
      .in("status", ["pending_payment", "confirmed"])
      .select("id");
    if (updErr || !upd || upd.length === 0) {
      return res.status(409).json({ error: "Couldn't cancel — it may have already changed." });
    }

    // Void the operator payout for this booking (unless it was already paid out).
    await admin.from("payouts").update({ status: "cancelled" }).eq("booking_id", booking.id).neq("status", "paid");

    // Notify the counterparty (best-effort). Traveler cancels → tell operator; operator/admin cancels → tell traveler.
    if (listing) {
      const info: BookingEmailInfo = {
        listingTitle: listing.title,
        startDate: booking.start_date,
        endDate: booking.end_date,
        guests: booking.guests,
        amountCents: booking.amount_cents,
        currency: booking.currency,
        city: listing.city,
        region: listing.region,
        slug: listing.slug,
      };
      try {
        if (isTraveler) {
          const { data: op } = await admin.auth.admin.getUserById(listing.operator_id);
          if (op?.user?.email) await sendCancellation(op.user.email, info, { toRole: "operator", refundCents });
        } else {
          const { data: tr } = await admin.auth.admin.getUserById(booking.traveler_id);
          if (tr?.user?.email) await sendCancellation(tr.user.email, info, { toRole: "traveler", refundCents });
        }
      } catch (err) {
        console.error("[cancel-booking] email failed", err);
      }
    }

    res.json({ cancelled: true, refundOwed, refundCents });
  });

  // POST /api/support-chat — the traveler's message to Revamp support. Stores
  // it in their central thread, has the AI answer first (grounded in the
  // catalog + booking rules), stores the reply, and routes the thread to a
  // human when the AI flags it. Messages are written with the service role so
  // an 'ai' message can't be forged; the traveler only ever writes 'traveler'.
  app.post("/api/support-chat", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to chat with support." });

    const parsed = supportChatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Support chat isn't available right now." });

    try {
      // One thread per traveler — get it or create it.
      let { data: thread } = await admin.from("support_threads").select("id, status").eq("traveler_id", userId).maybeSingle();
      if (!thread) {
        const { data: created, error: cErr } = await admin.from("support_threads").insert({ traveler_id: userId }).select("id, status").single();
        if (cErr || !created) throw new Error(cErr?.message || "thread create failed");
        thread = created;
      }

      // Rate limit (DB-backed so it holds across serverless instances): cap
      // traveler messages per thread per minute. Checked BEFORE the AI call so
      // a burst can't run up the Anthropic bill.
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await admin
        .from("support_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", thread.id)
        .eq("sender", "traveler")
        .gte("created_at", since);
      if ((count ?? 0) >= 12) {
        return res.status(429).json({ error: "You're sending messages very quickly — give it a few seconds and try again." });
      }

      await admin.from("support_messages").insert({ thread_id: thread.id, sender: "traveler", body: parsed.data.message });

      const { data: hist } = await admin
        .from("support_messages")
        .select("sender, body")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true })
        .limit(30);

      const listings = await listPublishedForPlanner();
      const { reply, needsHuman } = await generateSupportReply((hist ?? []) as SupportTurn[], listings);

      await admin.from("support_messages").insert({ thread_id: thread.id, sender: "ai", body: reply });
      await admin
        .from("support_threads")
        .update({ status: needsHuman || thread.status === "needs_human" ? "needs_human" : "open", last_message_at: new Date().toISOString() })
        .eq("id", thread.id);

      res.json({ reply, needsHuman });
    } catch (err) {
      console.error("[support-chat]", err);
      res.status(500).json({ error: "Couldn't send your message. Please try again." });
    }
  });

  // POST /api/support-contact — a guest optionally leaves an email/name so
  // Revamp can follow up after they leave. Stored on their support thread
  // (service role, after validation); never required to chat.
  app.post("/api/support-contact", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Start a chat first." });

    const parsed = supportContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Support isn't available right now." });

    try {
      let { data: thread } = await admin.from("support_threads").select("id").eq("traveler_id", userId).maybeSingle();
      if (!thread) {
        const { data: created, error: cErr } = await admin.from("support_threads").insert({ traveler_id: userId }).select("id").single();
        if (cErr || !created) throw new Error(cErr?.message || "thread create failed");
        thread = created;
      }
      const { error } = await admin
        .from("support_threads")
        .update({ guest_email: parsed.data.email, guest_name: parsed.data.name || null })
        .eq("id", thread.id);
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    } catch (err) {
      console.error("[support-contact]", err);
      res.status(500).json({ error: "Couldn't save your details. Please try again." });
    }
  });

  // POST /api/operator-assistant — data-only Q&A for an operator about THEIR OWN
  // bookings + payouts. Fetches their data RLS-scoped (userClient), builds a
  // digest, and lets the AI answer from it. Never sees another operator's data.
  app.post("/api/operator-assistant", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to use the assistant." });

    const parsed = operatorAssistantSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const now = Date.now();
    const hits = (operatorAssistantHits.get(userId) ?? []).filter((t) => t > now - 60_000);
    if (hits.length >= 15) return res.status(429).json({ error: "You're asking very quickly — give it a few seconds and try again." });
    hits.push(now);
    operatorAssistantHits.set(userId, hits);

    const supa = userClient(token);
    if (!supa) return res.status(503).json({ error: "The assistant isn't available right now." });
    const today = new Date().toISOString().slice(0, 10);
    try {
      const [bookingsRes, payoutsRes] = await Promise.all([
        supa
          .from("bookings")
          .select("start_date, end_date, guests, amount_cents, currency, status, listings!inner(title, type, operator_id)")
          .eq("listings.operator_id", userId)
          .order("start_date", { ascending: true })
          .limit(200),
        supa.from("payouts").select("net_cents, currency, due_date, status").order("due_date", { ascending: true }).limit(200),
      ]);
      const bookings = (bookingsRes.data ?? []) as unknown as Parameters<typeof buildOperatorSummary>[0];
      const payouts = (payoutsRes.data ?? []) as unknown as Parameters<typeof buildOperatorSummary>[1];
      const summary = buildOperatorSummary(bookings, payouts, today);
      const reply = await generateOperatorReply(parsed.data.messages as OperatorTurn[], summary);
      res.json({ reply });
    } catch (err) {
      console.error("[operator-assistant]", err);
      res.status(500).json({ error: "Couldn't answer that right now. Please try again." });
    }
  });
}
