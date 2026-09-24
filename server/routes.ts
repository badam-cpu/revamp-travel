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
import { listPublishedForPlanner, verifyUser, userClient, getListingBusyRanges, getOperatorGooglePlaceId } from "./supabase.js";
import { fetchPlaceReviews, fetchPlaceDetails, placesServerKeySet } from "./googlePlaces.js";
import { matchTripadvisor, tripadvisorConfigured } from "./tripadvisor.js";
import { translateTexts } from "./translate.js";
import { pricelabsListings, syncOperatorPrices } from "./pricelabs.js";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin.js";
import { paylinkConfigured, registerPayment } from "./paylink.js";
import { reconcileUserBookings, logBookingEvent, finalizeConfirmedBooking } from "./bookings.js";
import { startOperatorSubscription, reconcileOperatorSubscriptions, cancelOperatorSubscription, ensurePlanRegistered, type PlanRow } from "./subscriptions.js";
import { generateSupportReply, type SupportTurn } from "./support.js";
import { generateOperatorReply, type OperatorTurn } from "./operatorAssistant.js";
import { scanMessage } from "./messaging.js";
import { reserveGift, releaseGift, refundGiftForBooking, lookupRedeemableGift, reconcilePurchaserGiftCards, logGiftEvent, voidGiftCard } from "./giftcards.js";
import { isAllowedGiftAmount } from "../shared/giftcards.js";
import { payoutState } from "../shared/payouts.js";
import { sendCancellation, sendSupportAlert, sendNewMessage, type BookingEmailInfo } from "./email.js";
import { computeBookingAmountCents, computeBookingCharge, computeRefundCents, isBookableType, promoDiscount, addonUnitCost, nightsBetween, type Addon, DEFAULT_CURRENCY } from "../shared/bookings.js";
import { planTrip, PlannerError } from "./planner.js";
import { fetchPrefill, PrefillError } from "./urlPrefill.js";
import { fetchMergedBlockedRanges, buildIcalFeed, type IcalFeed } from "./ical.js";
import { SafeFetchError } from "./safeFetch.js";

/** Normalize a listing's stored feeds into a clean list, falling back to the
 *  legacy single `ical_url` (as an "Airbnb" feed) when no feeds are set. */
function normalizeFeeds(icalFeeds: unknown, legacyUrl: unknown): IcalFeed[] {
  const feeds: IcalFeed[] = [];
  if (Array.isArray(icalFeeds)) {
    for (const f of icalFeeds as { url?: unknown; label?: unknown }[]) {
      const url = typeof f?.url === "string" ? f.url.trim() : "";
      if (url) feeds.push({ url, label: typeof f?.label === "string" && f.label.trim() ? f.label.trim() : "Calendar" });
    }
  }
  if (feeds.length === 0 && typeof legacyUrl === "string" && legacyUrl.trim()) {
    feeds.push({ url: legacyUrl.trim(), label: "Airbnb" });
  }
  return feeds;
}
import { robotsTxtHandler } from "./robots.js";
import { sitemapHandler } from "./sitemap.js";
import { llmsTxtHandler } from "./llms.js";
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
  // Selected concierge add-ons (priced server-side from the admin catalog).
  addons: z.array(z.object({ id: z.string().max(80), qty: z.number().int().min(1).max(20) })).max(20).optional(),
  // Optional gift-card code to apply to this booking.
  giftCode: z.string().trim().max(40).optional(),
});

const giftCardStartSchema = z.object({
  amountCents: z.number().int().positive(),
  recipientName: z.string().trim().min(1).max(120),
  recipientEmail: z.string().trim().email().max(200),
  message: z.string().trim().max(500).optional(),
  // Must tick "I accept the terms" — recorded (with time + IP) for chargebacks.
  acceptTerms: z.literal(true),
});

const giftLookupSchema = z.object({
  code: z.string().trim().min(4).max(40),
});

const giftVoidSchema = z.object({
  giftCardId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
});

const cancelBookingSchema = z.object({
  bookingId: z.string().uuid(),
});

const directBookingSchema = z.object({
  listingId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1).max(50).default(1),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().max(200).optional().default(""),
  guestPhone: z.string().trim().max(40).optional().default(""),
  baseCents: z.number().int().min(0).max(1_000_000_000), // pre-tax: rate×nights + cleaning, or the tour total
  paymentStatus: z.enum(["paid", "unpaid"]).default("unpaid"),
});

const bookingPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  paymentStatus: z.enum(["paid", "unpaid"]),
});

const supportChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const supportContactSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional(),
});

const messageThreadSchema = z.object({
  bookingId: z.string().uuid(),
});

const messageSendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

const adminModerateSchema = z.object({
  action: z.enum(["redact", "close", "reopen"]),
  messageId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

const adminSetRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["traveler", "operator"]),
});

const operatorAssistantSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), body: z.string().max(2000) }))
    .min(1)
    .max(20),
});

// --- Operator subscriptions (recurring platform billing via PayLink) ---
const adminSubscriptionPlanSchema = z.object({
  id: z.string().uuid().optional(), // present → update; absent → create
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional().default(""),
  amountCents: z.number().int().positive().max(1_000_000_000), // AMD hundredths
  monthsQuantity: z.number().int().min(1).max(120).optional().default(12),
  isActive: z.boolean().optional().default(true),
  sort: z.number().int().min(0).max(9999).optional().default(0),
});
const subscriptionStartSchema = z.object({
  planId: z.string().uuid(),
  phone: z.string().trim().min(6).max(40), // PayLink Person requires a mobile
});
const subscriptionCancelSchema = z.object({
  rowId: z.string().uuid(),
});

function issuesToMessage(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
}

// Soft, in-memory per-operator rate limit for the assistant. Best-effort across
// serverless instances — a light guard on the Anthropic bill, not security.
const operatorAssistantHits = new Map<string, number[]>();
// Same soft per-user cap for inbox message sends (spam guard, not security).
const messageSendHits = new Map<string, number[]>();
// Per-user caps for gift-card code lookups (anti-enumeration) and purchases (spam).
const giftLookupHits = new Map<string, number[]>();
const giftPurchaseHits = new Map<string, number[]>();
// Per-IP cap for the public (unauthenticated) AI trip planner — protects the Anthropic bill.
const planTripHits = new Map<string, number[]>();
function rateLimited(map: Map<string, number[]>, key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (map.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return true;
  hits.push(now);
  map.set(key, hits);
  return false;
}

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
  app.get("/llms.txt", llmsTxtHandler);
  app.get("/api/llms.txt", llmsTxtHandler);

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
    // Public (no sign-in) but hits Anthropic — throttle per IP so it can't be
    // hammered to run up the AI bill. trust proxy is set, so req.ip is the real client.
    // 20/min/IP: generous enough that even a shared IP (café/office/mobile NAT)
    // won't hit it in normal use, but still stops a runaway script cold.
    if (rateLimited(planTripHits, req.ip || "unknown", 20)) {
      return res.status(429).json({ error: "You're planning a lot of trips very fast — give it a minute and try again." });
    }
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

    // select("*") so a not-yet-run 0034 (ical_feeds) migration doesn't break sync.
    const { data: listing, error: readErr } = await supa.from("listings").select("*").eq("id", listingId).maybeSingle();
    if (readErr || !listing) {
      return res.status(404).json({ error: "Listing not found." });
    }
    const feeds = normalizeFeeds(listing.ical_feeds, listing.ical_url);
    if (feeds.length === 0) {
      return res.status(400).json({ error: "Add a calendar export URL (Airbnb or Booking.com) to this listing first." });
    }

    try {
      const { ranges, errors } = await fetchMergedBlockedRanges(feeds);
      const syncedAt = new Date().toISOString();
      // Only overwrite availability when at least one feed was read; if every
      // feed failed, keep the last-known-good ranges and just record the error.
      const patch: Record<string, unknown> = { ical_synced_at: syncedAt, ical_error: errors.length ? errors.join("; ") : null };
      if (errors.length < feeds.length) patch.blocked_ranges = ranges;
      const { error: upErr } = await supa.from("listings").update(patch).eq("id", listingId);
      if (upErr) throw new Error(upErr.message);
      res.json({ count: ranges.length, feeds: feeds.length, errors, syncedAt });
    } catch (err) {
      const message = err instanceof SafeFetchError ? err.message : "Couldn't read that calendar. Check it's the calendar *export* URL (ends in .ics).";
      await supa.from("listings").update({ ical_error: message, ical_synced_at: new Date().toISOString() }).eq("id", listingId);
      console.error("sync-ical failed", err);
      res.status(err instanceof SafeFetchError ? err.status : 502).json({ error: message });
    }
  });

  // GET /api/ical/:id(.ics) — PUBLIC availability export for a published listing,
  // pasted into Airbnb/Booking.com so Revamp bookings + blocks propagate there.
  // Merges confirmed bookings + imported blocks + manual blocks. No auth (OTAs
  // fetch it unauthenticated); reads only already-public data via the anon key.
  app.get("/api/ical/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").replace(/\.ics$/i, "");
    const data = await getListingBusyRanges(id);
    if (!data) return res.status(404).type("text/plain").send("Listing not found or not published.");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="revamp-${id}.ics"`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(buildIcalFeed(`${data.title} — Revamp`, data.ranges));
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
    const { listingId, startDate, endDate, guests, guestName, guestEmail, guestPhone, addons } = parsed.data;

    if (endDate <= startDate) return res.status(400).json({ error: "Check-out must be after check-in." });
    const today = new Date().toISOString().slice(0, 10);
    if (startDate < today) return res.status(400).json({ error: "Pick a start date in the future." });

    const supa = userClient(token);
    if (!supa) return res.status(503).json({ error: "Booking isn't configured on the server." });

    // Read the listing under RLS — published listings are publicly readable.
    const { data: listing, error: readErr } = await supa
      .from("listings")
      .select("*")
      .eq("id", listingId)
      .maybeSingle();
    if (readErr || !listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.status !== "published") return res.status(400).json({ error: "This listing isn't open for booking." });
    if (!isBookableType(listing.type)) return res.status(400).json({ error: "This listing can't be booked online." });

    // Enforce the operator's minimum stay (stays only; stored in facts).
    if (listing.type === "stay") {
      const facts = Array.isArray(listing.facts) ? (listing.facts as { label?: string; value?: string }[]) : [];
      const raw = facts.find((f) => f.label?.toLowerCase() === "minimum stay")?.value;
      const minStay = raw ? parseInt(raw, 10) : 0;
      if (Number.isFinite(minStay) && minStay > 1 && nightsBetween(startDate, endDate) < minStay) {
        return res.status(400).json({ error: `This stay has a ${minStay}-night minimum.` });
      }
    }

    // Accommodation is discount-aware (non-refundable listing charged at its
    // discount); base = accommodation + the flat cleaning fee; the guest is
    // then charged base + tax on top.
    const accommodationCents = computeBookingAmountCents(
      {
        priceCents: listing.price_cents,
        priceUnit: listing.price_unit,
        cancellationPolicy: listing.cancellation_policy ?? "flexible",
        nonrefundableDiscountPercent: listing.nonrefundable_discount_percent ?? 0,
        seasonalRates: Array.isArray(listing.seasonal_rates) ? listing.seasonal_rates : [],
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
    const charge = computeBookingCharge(netAccommodationCents + (listing.cleaning_fee_cents ?? 0)); // base + tax = accommodation portion the guest pays

    // Concierge add-ons — priced server-side from the admin catalog (never trust
    // client prices). Added on top of the booking; not part of the operator base.
    let addonsCents = 0;
    const addonSnapshot: { id: string; name: string; unit: string; qty: number; amountCents: number; onRequest: boolean }[] = [];
    if (addons && addons.length && listing.type === "stay") {
      const { data: ss } = await supa.from("site_settings").select("addons").eq("id", 1).maybeSingle();
      const catalog: Addon[] = Array.isArray(ss?.addons) ? (ss!.addons as Addon[]) : [];
      const nights = nightsBetween(startDate, endDate);
      for (const sel of addons) {
        // Only enabled, real, priced entries are chargeable (mirrors the
        // checkout page's own filter).
        const a = catalog.find((c) => c.id === sel.id && c.enabled && c.name && (c.priceCents > 0 || c.onRequest));
        if (!a) continue;
        const amt = addonUnitCost(a, { nights, guests }) * sel.qty;
        addonsCents += amt;
        addonSnapshot.push({ id: a.id, name: a.name, unit: a.unit, qty: sel.qty, amountCents: amt, onRequest: !!a.onRequest });
      }
    }
    const finalTotalCents = charge.totalCents + addonsCents;

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
    const adminClient = supabaseAdmin();

    // --- Optional gift-card redemption ---------------------------------
    // Validate + reserve the applied amount up front (conditional decrement, so
    // no double-spend). Released again on any path where the booking doesn't
    // stand (register/insert failure, later payment failure, expiry). Gift cards
    // are non-refundable, so a *cancelled confirmed* booking forfeits the gift.
    let giftId: string | null = null;
    let giftApplied = 0;
    let giftBalanceAfter = 0;
    if (parsed.data.giftCode) {
      if (!adminClient) return res.status(503).json({ error: "Gift cards aren't available right now." });
      const look = await lookupRedeemableGift(adminClient, parsed.data.giftCode, currency);
      if ("error" in look) return res.status(400).json({ error: look.error });
      giftApplied = Math.min(look.balanceCents, finalTotalCents);
      const reserved = await reserveGift(adminClient, look.id, giftApplied);
      if (!reserved) return res.status(409).json({ error: "That gift card balance just changed — please try again." });
      giftId = look.id;
      giftBalanceAfter = look.balanceCents - giftApplied;
    }
    const remainingCents = finalTotalCents - giftApplied;

    // Shared booking fields. Snapshot the cancellation terms so a later listing
    // change can't alter them.
    const baseRow: Record<string, unknown> = {
      listing_id: listingId,
      traveler_id: userId,
      start_date: startDate,
      end_date: endDate,
      guests,
      amount_cents: finalTotalCents,
      base_cents: charge.baseCents,
      tax_cents: charge.taxCents,
      addons: addonSnapshot,
      addons_cents: addonsCents,
      currency,
      cancellation_policy: listing.cancellation_policy ?? "flexible",
      free_cancel_days: listing.free_cancel_days ?? 7,
      gift_card_id: giftId,
      gift_applied_cents: giftApplied,
    };
    if (guestName || guestEmail || guestPhone) {
      baseRow.guest_name = guestName || null;
      baseRow.guest_email = guestEmail || null;
      baseRow.guest_phone = guestPhone || null;
    }

    // Fully covered by the gift card → no PayLink charge; confirm server-side now.
    if (remainingCents <= 0 && giftId && adminClient) {
      const { data: created, error: insErr } = await adminClient
        .from("bookings")
        .insert({ ...baseRow, status: "confirmed", provider: "gift", paid_at: new Date().toISOString() })
        .select("id")
        .single();
      if (insErr) {
        await releaseGift(adminClient, giftId, giftApplied);
        if ((insErr as { code?: string }).code === "23P01") return res.status(409).json({ error: "Those dates were just taken. Try different dates." });
        console.error("[start-checkout] gift-covered insert failed", insErr.message);
        return res.status(500).json({ error: "Couldn't record your booking." });
      }
      await logGiftEvent(adminClient, giftId, "redeemed", { amountCents: giftApplied, balanceAfter: giftBalanceAfter, bookingId: created.id, detail: `Fully covered booking · ${listing.title}` });
      try {
        await finalizeConfirmedBooking(adminClient, created.id);
      } catch (e) {
        console.error("[start-checkout] gift-covered finalize failed", e);
      }
      return res.json({ confirmed: true, fullyCovered: true, bookingId: created.id });
    }

    // Otherwise charge the remainder via PayLink.
    try {
      const pay = await registerPayment({
        // PayLink's `amount` is in major currency units. AMD (our settlement
        // currency) has no minor unit, so round to a whole dram — every stored
        // *_cents value is AMD hundredths. Charge only the amount left after any gift.
        amount: currency === "AMD" ? Math.round(remainingCents / 100) : remainingCents / 100,
        currency,
        returnUrl: `${site}/account?checkout=return`,
        info: `Revamp booking · ${listing.title}`,
      });
      if (!pay.redirectUrl) {
        if (giftId && adminClient) await releaseGift(adminClient, giftId, giftApplied);
        return res.status(502).json({ error: "Couldn't start checkout." });
      }
      // Insert the pending hold as the traveler (RLS allows own + pending only).
      const { data: pendingRow, error: insErr } = await supa
        .from("bookings")
        .insert({
          ...baseRow,
          status: "pending_payment",
          provider: "paylink",
          paylink_request_id: pay.requestId,
          paylink_order_id: pay.orderId,
        })
        .select("id")
        .maybeSingle();
      if (insErr) {
        if (giftId && adminClient) await releaseGift(adminClient, giftId, giftApplied);
        console.error("[start-checkout] insert failed", insErr.message);
        return res.status(500).json({ error: "Couldn't record your booking." });
      }
      if (giftId && adminClient) {
        await logGiftEvent(adminClient, giftId, "redeemed", { amountCents: giftApplied, balanceAfter: giftBalanceAfter, bookingId: pendingRow?.id ?? null, detail: `Applied to booking · ${listing.title}` });
      }
      res.json({ redirectUrl: pay.redirectUrl });
    } catch (err) {
      if (giftId && adminClient) await releaseGift(adminClient, giftId, giftApplied);
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
      res.json({ confirmed: r.confirmed, pending: r.checked > 0 && r.confirmed === 0, amountCents: r.amountCents, currency: r.currency, bookingIds: r.bookingIds });
    } catch (err) {
      console.error("[confirm-checkout]", err);
      res.status(500).json({ error: "Couldn't confirm your payment." });
    }
  });

  // POST /api/operator-direct-booking — an operator records an OFFLINE booking
  // (phone/email/walk-in) that blocks the dates. Created server-side as a
  // confirmed booking with provider='direct' and no traveler account; money is
  // handled offline, so no PayLink, no Revamp payout, no automated email. The
  // 10% tax is still recorded on top of the operator-entered base for their
  // records.
  app.post("/api/operator-direct-booking", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in as an operator." });
    if (!adminConfigured()) return res.status(503).json({ error: "Direct bookings aren't available yet." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Direct bookings aren't available yet." });

    const parsed = directBookingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const { listingId, startDate, endDate, guests, guestName, guestEmail, guestPhone, baseCents, paymentStatus } = parsed.data;
    if (endDate <= startDate) return res.status(400).json({ error: "The end date must be after the start date." });

    // The caller must own the listing.
    const { data: listing, error: readErr } = await admin.from("listings").select("id, operator_id").eq("id", listingId).maybeSingle();
    if (readErr || !listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.operator_id !== userId) return res.status(403).json({ error: "That listing isn't yours." });

    const charge = computeBookingCharge(baseCents);
    const { data, error } = await admin
      .from("bookings")
      .insert({
        listing_id: listingId,
        traveler_id: null,
        start_date: startDate,
        end_date: endDate,
        guests,
        amount_cents: charge.totalCents,
        base_cents: charge.baseCents,
        tax_cents: charge.taxCents,
        currency: DEFAULT_CURRENCY,
        status: "confirmed",
        provider: "direct",
        payment_status: paymentStatus,
        guest_name: guestName,
        guest_email: guestEmail || null,
        guest_phone: guestPhone || null,
      })
      .select("id")
      .single();
    if (error) {
      // 23P01 = exclusion_violation: overlaps an existing confirmed booking.
      if ((error as { code?: string }).code === "23P01") {
        return res.status(409).json({ error: "Those dates already have a confirmed booking." });
      }
      console.error("[direct-booking]", error);
      return res.status(500).json({ error: "Couldn't create the booking." });
    }
    await logBookingEvent(admin, data.id, "direct_created", `Direct booking recorded by the operator (${paymentStatus}).`);
    res.json({ id: data.id, totalCents: charge.totalCents });
  });

  // POST /api/operator-booking-payment — flip a direct booking's payment status
  // (paid/unpaid). Operator-only, scoped to their own listings; service-role
  // update (bookings have no client UPDATE policy).
  app.post("/api/operator-booking-payment", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in as an operator." });
    if (!adminConfigured()) return res.status(503).json({ error: "Not available yet." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available yet." });

    const parsed = bookingPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const { bookingId, paymentStatus } = parsed.data;

    const { data: bk, error: readErr } = await admin
      .from("bookings")
      .select("id, listings!inner(operator_id)")
      .eq("id", bookingId)
      .maybeSingle();
    if (readErr || !bk) return res.status(404).json({ error: "Booking not found." });
    if ((bk as unknown as { listings: { operator_id: string } }).listings.operator_id !== userId) {
      return res.status(403).json({ error: "That booking isn't on your listing." });
    }
    const { error: upErr } = await admin.from("bookings").update({ payment_status: paymentStatus }).eq("id", bookingId);
    if (upErr) return res.status(500).json({ error: "Couldn't update the payment status." });
    await logBookingEvent(admin, bookingId, "payment_status", `Marked ${paymentStatus} by the operator.`);
    res.json({ ok: true });
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
      .select("id, listing_id, traveler_id, status, start_date, end_date, guests, amount_cents, currency, paid_at, cancellation_policy, free_cancel_days, guest_email, gift_card_id, gift_applied_cents")
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
    const giftApplied = (booking as { gift_applied_cents?: number }).gift_applied_cents ?? 0;
    let refundCents = computeRefundCents(
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
    // Gift cards are NON-REFUNDABLE. On a confirmed booking, only the cash the
    // guest actually paid (total minus the gift portion) can be refunded per
    // policy — the gift value is forfeited. (A never-completed pending hold is
    // different: its gift reservation is released below, no cash was captured.)
    if (booking.status === "confirmed") {
      refundCents = Math.max(0, Math.min(refundCents, booking.amount_cents - giftApplied));
    } else {
      refundCents = 0;
    }
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

    // A never-completed pending hold releases its gift reservation (no purchase
    // happened). A confirmed booking's gift is non-refundable → left forfeited.
    if (booking.status === "pending_payment" && giftApplied > 0) await refundGiftForBooking(admin, booking.id);

    // Void the operator payout for this booking (unless it was already paid out).
    await admin.from("payouts").update({ status: "cancelled" }).eq("booking_id", booking.id).neq("status", "paid");
    await logBookingEvent(admin, booking.id, "status_cancelled", isTraveler ? "Cancelled by guest" : isOperator ? "Cancelled by operator" : "Cancelled by admin");

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
          if (op?.user?.email) {
            await sendCancellation(op.user.email, info, { toRole: "operator", refundCents });
            await logBookingEvent(admin, booking.id, "email_cancellation", op.user.email);
          }
        } else {
          const { data: tr } = await admin.auth.admin.getUserById(booking.traveler_id);
          const to = tr?.user?.email || booking.guest_email || "";
          if (to) {
            await sendCancellation(to, info, { toRole: "traveler", refundCents });
            await logBookingEvent(admin, booking.id, "email_cancellation", to);
          }
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
      const aiResult = await generateSupportReply((hist ?? []) as SupportTurn[], listings);
      // Deterministic escalation: if the traveler explicitly asks for a human,
      // always route to a person regardless of what the model decided.
      const explicitHuman = /\b(human|real person|live (agent|person|chat)|customer (service|support)|representative|agent|speak (to|with) (a|an|someone|somebody|the team)|talk to (a|an|someone|somebody|the team)|connect me|contact (the|your) team)\b/i.test(parsed.data.message);
      const needsHuman = aiResult.needsHuman || explicitHuman;
      const reply = aiResult.reply;

      await admin.from("support_messages").insert({ thread_id: thread.id, sender: "ai", body: reply });
      await admin
        .from("support_threads")
        .update({ status: needsHuman || thread.status === "needs_human" ? "needs_human" : "open", last_message_at: new Date().toISOString() })
        .eq("id", thread.id);

      // Email the admin(s) when a chat escalates to a human: on the first
      // escalation, and again whenever the traveler explicitly asks for one
      // (best-effort).
      if (needsHuman && (thread.status !== "needs_human" || explicitHuman)) {
        try {
          const emails = new Set<string>();
          if (process.env.ADMIN_EMAIL) emails.add(process.env.ADMIN_EMAIL);
          const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
          for (const a of admins ?? []) {
            const { data: u } = await admin.auth.admin.getUserById(a.id);
            if (u?.user?.email) emails.add(u.user.email);
          }
          // Last-resort recipient: the verified sender mailbox, so an alert still
          // lands even if no admin email resolved.
          if (emails.size === 0 && process.env.EMAIL_FROM) emails.add(process.env.EMAIL_FROM);
          const { data: prof } = await admin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
          if (emails.size === 0) {
            console.warn("[support-chat] escalation had NO recipients — set ADMIN_EMAIL (and RESEND_API_KEY/EMAIL_FROM), or ensure an admin profile has a resolvable email.");
          }
          const results = await Promise.all(Array.from(emails).map((email) => sendSupportAlert(email, { travelerName: prof?.display_name ?? "A traveler", message: parsed.data.message })));
          if (results.length && !results.some((r) => r?.sent)) {
            console.warn("[support-chat] escalation alert not delivered:", results.map((r) => r?.reason).join(","));
          }
        } catch (alertErr) {
          console.error("[support-chat] admin alert failed", alertErr);
        }
      }

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
      // Ground the assistant in the Partner Hub: published articles (RLS lets an
      // operator read published). Pinned + newest first so the most important
      // articles ground in full; per-article and total caps keep the prompt lean.
      const { data: hub } = await supa
        .from("hub_articles")
        .select("title, category, excerpt, body, slug")
        .eq("status", "published")
        .order("pinned", { ascending: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(60);
      const PER_ARTICLE = 3500; // chars — enough for a full Hub article
      const TOTAL_BUDGET = 48000; // chars — overall knowledge-base ceiling
      let used = 0;
      const knowledgeBase = (hub ?? [])
        .map((a: { title: string; category: string; excerpt: string | null; body: string | null; slug: string }) => {
          if (used >= TOTAL_BUDGET) return null;
          const full = (a.body || a.excerpt || "").replace(/\r\n/g, "\n").trim();
          const room = Math.min(PER_ARTICLE, TOTAL_BUDGET - used);
          const text = full.length > room ? full.slice(0, room).trimEnd() + "…" : full;
          used += text.length;
          return `## ${a.title} [${a.category}] (slug: ${a.slug})\n${text}`;
        })
        .filter(Boolean)
        .join("\n\n");
      const reply = await generateOperatorReply(parsed.data.messages as OperatorTurn[], summary, knowledgeBase);
      res.json({ reply });
    } catch (err) {
      console.error("[operator-assistant]", err);
      res.status(500).json({ error: "Couldn't answer that right now. Please try again." });
    }
  });

  // POST /api/message-thread — ensure (or fetch) the conversation for a booking,
  // seeding both participants. Created server-side so the operator is derived
  // from the listing (never client-supplied) and the caller must be one of the
  // two parties. Idempotent — returns the same conversation on repeat calls.
  app.post("/api/message-thread", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to send a message." });

    const parsed = messageThreadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Messaging isn't available right now." });

    try {
      const { data: booking } = await admin
        .from("bookings")
        .select("id, traveler_id, listing_id, listings!inner(operator_id)")
        .eq("id", parsed.data.bookingId)
        .maybeSingle();
      if (!booking) return res.status(404).json({ error: "Booking not found." });

      const b = booking as unknown as { id: string; traveler_id: string | null; listing_id: string; listings: { operator_id: string } | null };
      const operatorId = b.listings?.operator_id;
      if (!operatorId) return res.status(400).json({ error: "This booking can't be messaged." });
      if (!b.traveler_id) return res.status(400).json({ error: "This booking has no traveler account to message." });
      if (userId !== b.traveler_id && userId !== operatorId) return res.status(403).json({ error: "You're not part of this booking." });

      // Existing thread?
      const { data: existing } = await admin.from("conversations").select("id").eq("booking_id", b.id).eq("kind", "booking").maybeSingle();
      if (existing) return res.json({ conversationId: existing.id });

      const { data: convo, error: cErr } = await admin
        .from("conversations")
        .insert({ kind: "booking", booking_id: b.id, listing_id: b.listing_id })
        .select("id")
        .single();
      if (cErr || !convo) throw new Error(cErr?.message || "conversation create failed");

      const { error: pErr } = await admin.from("conversation_participants").insert([
        { conversation_id: convo.id, user_id: b.traveler_id, role: "traveler" },
        { conversation_id: convo.id, user_id: operatorId, role: "operator" },
      ]);
      if (pErr) throw new Error(pErr.message);

      res.json({ conversationId: convo.id });
    } catch (err) {
      console.error("[message-thread]", err);
      res.status(500).json({ error: "Couldn't open the conversation. Please try again." });
    }
  });

  // POST /api/message-send — post a message into a conversation. The caller must
  // be a participant (posts as their role) or an admin (posts as 'support', i.e.
  // "Revamp", to intervene). Rate-limited and guardrail-scanned server-side; the
  // message always sends but a contact/off-platform hit is flagged for admins.
  app.post("/api/message-send", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to send a message." });

    const parsed = messageSendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Messaging isn't available right now." });

    // Soft per-user rate limit.
    const now = Date.now();
    const hits = (messageSendHits.get(userId) ?? []).filter((t) => t > now - 60_000);
    if (hits.length >= 20) return res.status(429).json({ error: "You're sending messages very quickly — give it a few seconds and try again." });

    try {
      // The conversation must exist and be open.
      const { data: convo } = await admin
        .from("conversations")
        .select("id, status, listing_id, listings(title)")
        .eq("id", parsed.data.conversationId)
        .maybeSingle();
      if (!convo) return res.status(404).json({ error: "Conversation not found." });
      if ((convo as { status?: string }).status === "closed") return res.status(403).json({ error: "This conversation has been closed by Revamp." });

      // Determine the caller's role in this conversation. A participant posts as
      // their own role; an admin who isn't a participant posts as 'support'.
      const { data: part } = await admin
        .from("conversation_participants")
        .select("role")
        .eq("conversation_id", parsed.data.conversationId)
        .eq("user_id", userId)
        .maybeSingle();

      let senderRole = part?.role as string | undefined;
      if (!senderRole) {
        const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
        if (prof?.role === "admin") senderRole = "support";
        else return res.status(403).json({ error: "You're not part of this conversation." });
      }

      const { flagged } = scanMessage(parsed.data.body);

      const { data: msg, error: mErr } = await admin
        .from("messages")
        .insert({ conversation_id: parsed.data.conversationId, sender_id: userId, sender_role: senderRole, body: parsed.data.body, flagged })
        .select("id, conversation_id, sender_id, sender_role, body, flagged, created_at")
        .single();
      if (mErr || !msg) throw new Error(mErr?.message || "message insert failed");

      await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", parsed.data.conversationId);

      hits.push(now);
      messageSendHits.set(userId, hits);
      res.json({ message: msg });

      // Best-effort email notification to the OTHER participants — after responding
      // so it never delays the send. Skips muted participants and anyone active in
      // the last 5 min (avoids pinging someone mid-conversation).
      try {
        const senderName =
          senderRole === "support"
            ? "Revamp"
            : (await admin.from("profiles").select("display_name, business_name").eq("id", userId).maybeSingle()).data?.business_name ||
              (await admin.from("profiles").select("display_name").eq("id", userId).maybeSingle()).data?.display_name ||
              "Someone";
        const { data: recips } = await admin
          .from("conversation_participants")
          .select("user_id, role, muted, last_read_at")
          .eq("conversation_id", parsed.data.conversationId)
          .neq("user_id", userId);
        const listingTitle = (convo as { listings?: { title?: string } | null }).listings?.title;
        const snippet = parsed.data.body.length > 140 ? `${parsed.data.body.slice(0, 140)}…` : parsed.data.body;
        const activeCutoff = Date.now() - 5 * 60_000;
        for (const r of recips ?? []) {
          const rr = r as { user_id: string; role: string; muted: boolean; last_read_at: string | null };
          if (rr.muted || rr.role === "support") continue;
          if (rr.last_read_at && Date.parse(rr.last_read_at) > activeCutoff) continue;
          const { data: u } = await admin.auth.admin.getUserById(rr.user_id);
          const to = u?.user?.email;
          if (to) await sendNewMessage(to, { fromName: String(senderName), listingTitle, snippet, recipientRole: rr.role === "operator" ? "operator" : "traveler" });
        }
      } catch (emailErr) {
        console.error("[message-send] notify failed", emailErr);
      }
    } catch (err) {
      console.error("[message-send]", err);
      res.status(500).json({ error: "Couldn't send your message. Please try again." });
    }
  });

  // POST /api/admin-moderate — admin-only moderation for the unified inbox:
  // redact a message, or close/reopen a conversation (a closed conversation
  // rejects new sends). Service-role writes, gated by an admin role check.
  app.post("/api/admin-moderate", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });

    const parsed = adminModerateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });

    const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (prof?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    try {
      if (parsed.data.action === "redact") {
        if (!parsed.data.messageId) return res.status(400).json({ error: "messageId required." });
        const { error } = await admin.from("messages").update({ redacted: true }).eq("id", parsed.data.messageId);
        if (error) throw new Error(error.message);
      } else {
        if (!parsed.data.conversationId) return res.status(400).json({ error: "conversationId required." });
        const status = parsed.data.action === "close" ? "closed" : "open";
        const { error } = await admin.from("conversations").update({ status }).eq("id", parsed.data.conversationId);
        if (error) throw new Error(error.message);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin-moderate]", err);
      res.status(500).json({ error: "Couldn't apply that action. Please try again." });
    }
  });

  // POST /api/admin-set-role — admin-only: promote a traveler to operator (so
  // they can own/manage listings and appear in the assign dropdown) or demote an
  // operator back. Service-role write (profiles RLS lets a user edit only their
  // own non-role fields). Never touches admin accounts; refuses to demote an
  // operator who still owns listings (would orphan editable products).
  app.post("/api/admin-set-role", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });

    const parsed = adminSetRoleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });

    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    try {
      const { data: target } = await admin.from("profiles").select("role").eq("id", parsed.data.userId).maybeSingle();
      if (!target) return res.status(404).json({ error: "Account not found." });
      if (target.role === "admin") return res.status(400).json({ error: "Admin accounts can't be changed here." });

      if (parsed.data.role === "traveler" && target.role === "operator") {
        const { count } = await admin.from("listings").select("id", { count: "exact", head: true }).eq("operator_id", parsed.data.userId);
        if ((count ?? 0) > 0) return res.status(400).json({ error: "Reassign this operator's listings before demoting them." });
      }

      const { error } = await admin.from("profiles").update({ role: parsed.data.role }).eq("id", parsed.data.userId);
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin-set-role]", err);
      res.status(500).json({ error: "Couldn't change that account's role. Please try again." });
    }
  });

  // GET /api/admin-place-details?placeId=… — admin-only Google Place Details used
  // to pre-fill a curated "eat" recommendation (name, rating, address, website,
  // price band). Server-side so the Places key stays private.
  app.get("/api/admin-place-details", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    const placeId = String(req.query.placeId || "");
    if (!placeId) return res.status(400).json({ error: "Missing placeId." });
    if (!placesServerKeySet()) {
      return res.status(502).json({ error: "Set GOOGLE_PLACES_API_KEY in Netlify (a Places API New server key, no HTTP-referrer restriction), then redeploy. Fill the details in manually for now." });
    }
    try {
      const details = await fetchPlaceDetails(placeId);
      res.json(details);
    } catch (err) {
      // The route is admin-only, so it's safe to surface Google's own reason.
      const msg = err instanceof Error ? err.message : "Couldn't fetch that place from Google.";
      console.error("[admin-place-details]", msg);
      res.status(502).json({ error: `Google: ${msg}` });
    }
  });

  // GET /api/admin-tripadvisor?name=…&lat=&lng= — admin-only: find a restaurant
  // on Tripadvisor by name (near coords) and return its rating + attribution.
  app.get("/api/admin-tripadvisor", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    if (!tripadvisorConfigured()) {
      return res.status(502).json({ error: "Set TRIPADVISOR_API_KEY in Netlify (a Tripadvisor Terra API key), then redeploy." });
    }
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name." });
    const geo = String(req.query.geo || "").trim() || undefined;
    try {
      const match = await matchTripadvisor(name, geo);
      if (!match) return res.status(404).json({ error: "No Tripadvisor match found for that name." });
      res.json(match);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't reach Tripadvisor.";
      console.error("[admin-tripadvisor]", msg);
      res.status(502).json({ error: `Tripadvisor: ${msg}` });
    }
  });

  // GET /api/google-reviews?operatorId=… — public Google Business reviews for an
  // operator's business (their Place ID lives on their profile). Server-side +
  // cached; returns { configured:false } when the operator hasn't set a Place ID
  // or the Places key isn't set. Attributed to Google on the client.
  app.get("/api/google-reviews", async (req: Request, res: Response) => {
    const operatorId = String(req.query.operatorId || "");
    if (!/^[0-9a-f-]{36}$/i.test(operatorId)) return res.status(400).json({ error: "Bad operator id." });
    if (rateLimited(giftLookupHits, `gr:${req.ip || "?"}`, 60)) return res.status(429).json({ error: "Slow down." });
    const placeId = await getOperatorGooglePlaceId(operatorId);
    if (!placeId) return res.json({ configured: false });
    const data = await fetchPlaceReviews(placeId);
    if (!data) return res.json({ configured: false });
    res.setHeader("Cache-Control", "public, max-age=900");
    res.json({ configured: true, ...data });
  });

  // POST /api/translate — translate up to 50 short texts to a target language
  // (default en) for the "Translate reviews" toggle. Public, rate-limited, cached
  // server-side. Returns [] silently if the Translation API isn't configured.
  app.post("/api/translate", async (req: Request, res: Response) => {
    if (rateLimited(giftLookupHits, `tr:${req.ip || "?"}`, 30)) return res.status(429).json({ error: "Slow down." });
    const body = req.body as { texts?: unknown; target?: unknown };
    const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === "string").slice(0, 50) : [];
    const target = typeof body.target === "string" && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(body.target) ? body.target : "en";
    if (!texts.length) return res.json({ results: [] });
    // Cap total size to keep costs bounded.
    if (texts.join("").length > 20000) return res.status(413).json({ error: "Too much text." });
    const results = await translateTexts(texts, target);
    res.json({ results });
  });

  // --- PriceLabs price sync -------------------------------------------
  // The operator's PriceLabs API key is a SECRET: stored in operator_secrets
  // (service-role only, migration 0048), never returned to any client. All these
  // routes require an operator sign-in and act only on that operator's data.
  const requireOperator = async (req: Request): Promise<{ userId: string; admin: NonNullable<ReturnType<typeof supabaseAdmin>> } | null> => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId) return null;
    const admin = supabaseAdmin();
    if (!admin) return null;
    return { userId, admin };
  };

  // POST /api/pricelabs/connect { apiKey } — validate the key against PriceLabs,
  // then store it (service role). Returns the account's listings for mapping.
  app.post("/api/pricelabs/connect", async (req: Request, res: Response) => {
    const ctx = await requireOperator(req);
    if (!ctx) return res.status(401).json({ error: "Sign in as an operator." });
    const apiKey = typeof (req.body as { apiKey?: unknown }).apiKey === "string" ? (req.body as { apiKey: string }).apiKey.trim() : "";
    if (apiKey.length < 8) return res.status(400).json({ error: "Enter your PriceLabs API key." });
    try {
      const listings = await pricelabsListings(apiKey); // throws on a bad key
      const { error: storeErr } = await ctx.admin
        .from("operator_secrets")
        .upsert({ operator_id: ctx.userId, pricelabs_api_key: apiKey, updated_at: new Date().toISOString() }, { onConflict: "operator_id" });
      if (storeErr) {
        // Almost always: migration 0048 (operator_secrets) hasn't been run yet.
        console.error("[pricelabs/connect] store failed", storeErr.message);
        return res.status(500).json({ error: "Your key is valid, but couldn't be saved — the price-sync tables aren't set up yet (run migration 0048)." });
      }
      res.json({ ok: true, listings });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Couldn't connect to PriceLabs." });
    }
  });

  // GET /api/pricelabs/data — connection status + PriceLabs listings + current
  // mappings, for the operator's Integrations UI. Never returns the key.
  app.get("/api/pricelabs/data", async (req: Request, res: Response) => {
    const ctx = await requireOperator(req);
    if (!ctx) return res.status(401).json({ error: "Sign in as an operator." });
    const { data: secret } = await ctx.admin.from("operator_secrets").select("pricelabs_api_key").eq("operator_id", ctx.userId).maybeSingle();
    const apiKey = secret?.pricelabs_api_key as string | undefined;
    if (!apiKey) return res.json({ connected: false });
    const { data: maps } = await ctx.admin.from("pricelabs_listing_map").select("revamp_listing_id, pricelabs_listing_id, pricelabs_pms, currency, last_synced_at").eq("operator_id", ctx.userId);
    let listings: unknown[] = [];
    try {
      listings = await pricelabsListings(apiKey);
    } catch {
      /* key may have been revoked upstream — still report connected + let them reconnect */
    }
    res.json({ connected: true, listings, maps: maps ?? [] });
  });

  // POST /api/pricelabs/disconnect — remove the key + mappings.
  app.post("/api/pricelabs/disconnect", async (req: Request, res: Response) => {
    const ctx = await requireOperator(req);
    if (!ctx) return res.status(401).json({ error: "Sign in as an operator." });
    await ctx.admin.from("pricelabs_listing_map").delete().eq("operator_id", ctx.userId);
    await ctx.admin.from("operator_secrets").delete().eq("operator_id", ctx.userId);
    res.json({ ok: true });
  });

  // POST /api/pricelabs/map { revampListingId, pricelabsListingId, pricelabsPms } —
  // link a Revamp listing (must be the caller's) to a PriceLabs listing.
  app.post("/api/pricelabs/map", async (req: Request, res: Response) => {
    const ctx = await requireOperator(req);
    if (!ctx) return res.status(401).json({ error: "Sign in as an operator." });
    const b = req.body as { revampListingId?: string; pricelabsListingId?: string; pricelabsPms?: string };
    if (!b.revampListingId || !b.pricelabsListingId || !b.pricelabsPms) return res.status(400).json({ error: "Missing fields." });
    const { data: listing } = await ctx.admin.from("listings").select("operator_id").eq("id", b.revampListingId).maybeSingle();
    if (!listing || listing.operator_id !== ctx.userId) return res.status(403).json({ error: "That listing isn't yours." });
    await ctx.admin.from("pricelabs_listing_map").upsert(
      { revamp_listing_id: b.revampListingId, operator_id: ctx.userId, pricelabs_listing_id: b.pricelabsListingId, pricelabs_pms: b.pricelabsPms },
      { onConflict: "revamp_listing_id" },
    );
    res.json({ ok: true });
  });

  // POST /api/pricelabs/unmap { revampListingId }
  app.post("/api/pricelabs/unmap", async (req: Request, res: Response) => {
    const ctx = await requireOperator(req);
    if (!ctx) return res.status(401).json({ error: "Sign in as an operator." });
    const id = (req.body as { revampListingId?: string }).revampListingId;
    if (!id) return res.status(400).json({ error: "Missing listing." });
    await ctx.admin.from("pricelabs_listing_map").delete().eq("revamp_listing_id", id).eq("operator_id", ctx.userId);
    res.json({ ok: true });
  });

  // POST /api/pricelabs/sync { revampListingId? } — pull prices now.
  app.post("/api/pricelabs/sync", async (req: Request, res: Response) => {
    const ctx = await requireOperator(req);
    if (!ctx) return res.status(401).json({ error: "Sign in as an operator." });
    if (rateLimited(giftPurchaseHits, `pls:${ctx.userId}`, 6)) return res.status(429).json({ error: "You're syncing very fast — wait a moment." });
    try {
      const result = await syncOperatorPrices(ctx.admin, ctx.userId, (req.body as { revampListingId?: string }).revampListingId);
      res.json(result);
    } catch (err) {
      console.error("[pricelabs/sync]", err);
      res.status(500).json({ error: "Sync failed. Please try again." });
    }
  });

  // --- Gift cards ------------------------------------------------------
  // POST /api/gift-card/start-checkout — buy a fixed-denomination gift card. The
  // buyer must be signed in and must accept the terms (recorded with time + IP
  // for chargebacks). Creates a pending card + a PayLink link; the card is only
  // activated (code assigned, recipient emailed) once payment is server-verified.
  app.post("/api/gift-card/start-checkout", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to buy a gift card." });
    if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });

    if (rateLimited(giftPurchaseHits, userId, 8)) return res.status(429).json({ error: "You're going a bit fast — give it a few seconds and try again." });
    const parsed = giftCardStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    if (!isAllowedGiftAmount(parsed.data.amountCents)) return res.status(400).json({ error: "Pick one of the available gift-card amounts." });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Gift cards aren't available right now." });

    const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const { data: buyer } = await admin.auth.admin.getUserById(userId);
    try {
      const pay = await registerPayment({
        amount: currency === "AMD" ? Math.round(parsed.data.amountCents / 100) : parsed.data.amountCents / 100,
        currency,
        returnUrl: `${site}/gift-cards?purchase=return`,
        info: `Revamp gift card · ${parsed.data.recipientName}`,
      });
      if (!pay.redirectUrl) return res.status(502).json({ error: "Couldn't start checkout." });

      const { error: insErr } = await admin.from("gift_cards").insert({
        status: "pending_payment",
        initial_amount_cents: parsed.data.amountCents,
        balance_cents: 0,
        currency,
        purchaser_id: userId,
        purchaser_email: buyer?.user?.email ?? null,
        recipient_name: parsed.data.recipientName,
        recipient_email: parsed.data.recipientEmail,
        message: parsed.data.message ?? null,
        paylink_request_id: pay.requestId,
        terms_accepted_at: new Date().toISOString(),
        terms_ip: req.ip ?? null,
      });
      if (insErr) {
        console.error("[gift-card/start] insert failed", insErr.message);
        return res.status(500).json({ error: "Couldn't record your gift card." });
      }
      res.json({ redirectUrl: pay.redirectUrl });
    } catch (err) {
      console.error("[gift-card/start]", err);
      res.status(502).json({ error: "Couldn't start checkout." });
    }
  });

  // POST /api/gift-card/confirm — server-verified activation on the buyer's
  // return (mirrors confirm-checkout). The reconcile cron also sweeps these.
  app.post("/api/gift-card/confirm", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    try {
      const r = await reconcilePurchaserGiftCards(admin, userId);
      res.json({ activated: r.activated });
    } catch (err) {
      console.error("[gift-card/confirm]", err);
      res.status(500).json({ error: "Couldn't confirm your purchase." });
    }
  });

  // POST /api/gift-card/lookup — check a code's balance for redemption preview at
  // booking checkout. Signed-in only (the booking flow is anyway).
  app.post("/api/gift-card/lookup", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    if (rateLimited(giftLookupHits, userId, 20)) return res.status(429).json({ error: "Too many attempts — wait a moment and try again." });
    const parsed = giftLookupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
    const look = await lookupRedeemableGift(admin, parsed.data.code, currency);
    if ("error" in look) return res.status(404).json({ error: look.error });
    res.json({ balanceCents: look.balanceCents, currency: look.currency });
  });

  // POST /api/admin-subscription-plan — admin-only: create or update a recurring
  // billing plan. Creating a plan also registers it with PayLink (so it has a
  // subscription id + hosted subscribe URL). Server-side because it holds the
  // PayLink credentials and writes a service-role-only table.
  app.post("/api/admin-subscription-plan", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = adminSubscriptionPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
    const { id, name, description, amountCents, monthsQuantity, isActive, sort } = parsed.data;
    try {
      // Upsert the plan row first. On an amount/duration change we drop the old
      // PayLink subscription id so it re-registers with the new terms.
      let planId = id;
      if (id) {
        const { data: prev } = await admin.from("subscription_plans").select("amount_cents, months_quantity, paylink_subscription_id").eq("id", id).maybeSingle();
        const termsChanged = prev && (prev.amount_cents !== amountCents || prev.months_quantity !== monthsQuantity);
        const { error } = await admin
          .from("subscription_plans")
          .update({ name, description, amount_cents: amountCents, months_quantity: monthsQuantity, is_active: isActive, sort, ...(termsChanged ? { paylink_subscription_id: null, request_url: null, paylink_request_id: null } : {}) })
          .eq("id", id);
        if (error) throw new Error(error.message);
      } else {
        const { data: created, error } = await admin
          .from("subscription_plans")
          .insert({ name, description, amount_cents: amountCents, months_quantity: monthsQuantity, currency, is_active: isActive, sort })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        planId = created.id;
      }

      // Register (or re-register) the plan with PayLink now, so the subscribe
      // link exists before any operator tries to enroll. Best-effort: if PayLink
      // is down the plan still saves and registers lazily on first subscribe.
      let paylinkSynced = false;
      if (paylinkConfigured() && isActive) {
        const { data: planRow } = await admin.from("subscription_plans").select("id, name, description, amount_cents, months_quantity, currency, paylink_subscription_id, paylink_request_id, request_url, is_active").eq("id", planId!).maybeSingle();
        if (planRow) {
          try {
            await ensurePlanRegistered(admin, planRow as PlanRow);
            paylinkSynced = true;
          } catch (e) {
            console.error("[admin-subscription-plan] PayLink register failed", e);
          }
        }
      }
      res.json({ ok: true, id: planId, paylinkSynced });
    } catch (err) {
      console.error("[admin-subscription-plan]", err);
      res.status(500).json({ error: "Couldn't save that plan." });
    }
  });

  // POST /api/subscription/start — operator begins (or resumes) enrollment in a
  // plan. Returns a PayLink hosted-payment redirect URL (or alreadyActive).
  app.post("/api/subscription/start", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    if (!paylinkConfigured()) return res.status(503).json({ error: "Billing isn't available yet." });
    const parsed = subscriptionStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Billing isn't available yet." });

    const { data: me } = await admin.from("profiles").select("role, display_name, business_name").eq("id", userId).maybeSingle();
    if (me?.role !== "operator" && me?.role !== "admin") return res.status(403).json({ error: "Only operators can subscribe." });
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email || "";
    if (!email) return res.status(400).json({ error: "Your account has no email on file." });
    const displayName = (me?.display_name || me?.business_name || "").trim();
    const [firstName, ...rest] = displayName.split(/\s+/);

    try {
      const result = await startOperatorSubscription(admin, {
        operatorId: userId,
        planId: parsed.data.planId,
        email,
        phone: parsed.data.phone,
        firstName: firstName || undefined,
        lastName: rest.join(" ") || undefined,
      });
      res.json(result);
    } catch (err) {
      console.error("[subscription/start]", err);
      res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't start your subscription." });
    }
  });

  // POST /api/subscription/confirm — poll PayLink for the operator's pending
  // enrollments and activate any now-subscribed. Idempotent; safe on every load.
  app.post("/api/subscription/confirm", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Billing isn't available yet." });
    try {
      const r = await reconcileOperatorSubscriptions(admin, userId);
      res.json(r);
    } catch (err) {
      console.error("[subscription/confirm]", err);
      res.status(500).json({ error: "Couldn't confirm your subscription." });
    }
  });

  // POST /api/subscription/cancel — operator (or admin) cancels their enrollment.
  app.post("/api/subscription/cancel", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = subscriptionCancelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Billing isn't available yet." });
    // Admins can cancel any row; operators only their own.
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    let ownerId = userId;
    if (me?.role === "admin") {
      const { data: row } = await admin.from("operator_subscriptions").select("operator_id").eq("id", parsed.data.rowId).maybeSingle();
      if (row?.operator_id) ownerId = row.operator_id;
    }
    try {
      const ok = await cancelOperatorSubscription(admin, { operatorId: ownerId, rowId: parsed.data.rowId });
      if (!ok) return res.status(404).json({ error: "Subscription not found." });
      res.json({ ok: true });
    } catch (err) {
      console.error("[subscription/cancel]", err);
      res.status(500).json({ error: "Couldn't cancel your subscription." });
    }
  });

  // POST /api/admin-gift-void — admin-only: void a gift card so it can no longer
  // be redeemed (fraud / chargeback). Keeps the row + balance + full ledger.
  app.post("/api/admin-gift-void", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = giftVoidSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (prof?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const ok = await voidGiftCard(admin, parsed.data.giftCardId, parsed.data.reason ? `Voided by admin: ${parsed.data.reason}` : "Voided by admin");
    if (!ok) return res.status(400).json({ error: "Couldn't void that gift card." });
    res.json({ ok: true });
  });
}
