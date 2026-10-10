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
import { listPublishedForPlanner, verifyUser, userClient, getListingBusyRanges, getOperatorGooglePlaceId, pingDb } from "./supabase.js";
import { collectHealth } from "./health.js";
import { getReferralSummary, attachReferral, listAllReferrals, markReferralPaid, setReferralConfig } from "./referrals.js";
import { handlePublicMcp } from "./mcp.js";
import { handleAdminMcp } from "./mcpAdmin.js";
import { mcpStreamingEnabled, handlePublicMcpStreaming, handleAdminMcpStreaming } from "./mcpStreaming.js";
import { fetchPlaceReviews, fetchPlaceDetails, placesServerKeySet } from "./googlePlaces.js";
import { matchTripadvisor, tripadvisorConfigured } from "./tripadvisor.js";
import { translateTexts } from "./translate.js";
import { pricelabsListings, syncOperatorPrices } from "./pricelabs.js";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin.js";
import { paylinkConfigured, registerPayment, checkPayment } from "./paylink.js";
import { reconcileUserBookings, logBookingEvent, finalizeConfirmedBooking } from "./bookings.js";
import { startOperatorSubscription, reconcileOperatorSubscriptions, cancelOperatorSubscription, ensurePlanRegistered, type PlanRow } from "./subscriptions.js";
import { syncListingSessions, reserveSeats, releaseSeats } from "./sessions.js";
import { generateListingCopy, ahaCopyConfigured } from "./ahaCopy.js";
import { generateSupportReply, type SupportTurn } from "./support.js";
import { generateOperatorReply, type OperatorTurn } from "./operatorAssistant.js";
import { scanMessage } from "./messaging.js";
import { reserveGift, releaseGift, refundGiftForBooking, lookupRedeemableGift, reconcilePurchaserGiftCards, logGiftEvent, voidGiftCard } from "./giftcards.js";
import { reconcilePurchaserVouchers, redeemVoucher, redeemVoucherByCode } from "./vouchers.js";
import { voucherPriceCents, isAllowedVoucherAmount } from "../shared/vouchers.js";
import { resolvePromo } from "./promo.js";
import { promoDiscountCents } from "../shared/promo.js";
import { resolveAudience, sendCampaign, marketingConfigured, verifyUnsub, generateEmailBody, emailGenConfigured, parseContactsCsv, importContacts, sendTelegramCampaign, resolveTelegramRecipients, telegramBroadcastConfigured } from "./marketing.js";
import { listAdminUsers } from "./adminUsers.js";
import { listManagedVenues, venueSummary } from "./restaurant.js";
import { isAllowedGiftAmount } from "../shared/giftcards.js";
import { payoutState } from "../shared/payouts.js";
import { sendCancellation, sendSupportAlert, sendNewMessage, sendOperatorBookingRequest, sendGuestRequestReceived, sendGuestBookingApproved, sendGuestBookingDeclined, sendPaymentLink, type BookingEmailInfo } from "./email.js";
import { notifyBooking } from "./notify.js";
import { telegramConfigured, telegramConnectLink, telegramBotUsername, setTelegramWebhook, sendTelegram } from "./telegram.js";
import { isCrawlerUserAgent } from "./botDetect.js";
import { randomUUID } from "crypto";
import { formatSlotTime, slotLocalDate } from "../shared/sessions.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBookingAmountCents, computeBookingCharge, computeRefundCents, isBookableType, promoDiscount, addonUnitCost, nightsBetween, type Addon, DEFAULT_CURRENCY, PLATFORM_COMMISSION_PERCENT } from "../shared/bookings.js";
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
  // Slot booking (tour/experience with a time-slot schedule): the chosen session.
  sessionId: z.string().uuid().optional(),
  // Guest checkout: a signed-out traveler books anonymously and gives contact
  // details here (optional — signed-in travelers omit them).
  guestName: z.string().trim().max(120).optional(),
  guestEmail: z.string().trim().email().max(200).optional(),
  guestPhone: z.string().trim().max(40).optional(),
  // Explicit opt-in to phone-channel notifications (SMS/WhatsApp/Viber/Telegram).
  messagingConsent: z.boolean().optional().default(false),
  // Selected concierge add-ons (priced server-side from the admin catalog).
  addons: z.array(z.object({ id: z.string().max(80), qty: z.number().int().min(1).max(20) })).max(20).optional(),
  // Optional gift-card code to apply to this booking.
  giftCode: z.string().trim().max(40).optional(),
  // Optional operator promo code (discount).
  promoCode: z.string().trim().max(40).optional(),
});

const promoValidateSchema = z.object({
  listingId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  startDate: isoDate,
  endDate: isoDate,
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
  // For a tour/experience with a time-slot schedule, the operator books a
  // specific session; the seat is reserved in the same inventory online
  // bookings draw from. Omitted for stays and legacy day-level tours.
  sessionId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1).max(50).default(1),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().max(200).optional().default(""),
  guestPhone: z.string().trim().max(40).optional().default(""),
  baseCents: z.number().int().min(0).max(1_000_000_000), // pre-tax: rate×nights + cleaning, or the tour total
  paymentStatus: z.enum(["paid", "unpaid"]).default("unpaid"),
  // "offline" (default): confirmed now, money handled offline. "paylink": create a
  // pending booking + email the customer a PayLink payment link to pay themselves.
  collectVia: z.enum(["offline", "paylink"]).optional().default("offline"),
});

const bookingPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  paymentStatus: z.enum(["paid", "unpaid"]),
});

const bookingContactSchema = z.object({
  bookingId: z.string().uuid(),
  guestName: z.string().trim().max(120).optional().default(""),
  guestEmail: z.string().trim().max(200).optional().default(""),
  guestPhone: z.string().trim().max(40).optional().default(""),
});

const bookingIdSchema = z.object({ bookingId: z.string().uuid() });

const voucherStartSchema = z.object({ listingId: z.string().uuid(), faceCents: z.number().int().positive() });
const voucherRedeemSchema = z.object({ voucherId: z.string().uuid() });
const voucherRedeemStaffSchema = z.object({ token: z.string().trim().min(8).max(64), code: z.string().trim().min(1).max(40) });

const emailAudienceSchema = z.object({ audience: z.enum(["everyone", "operators", "travelers", "guests", "contacts"]) });
const emailSendSchema = z.object({
  audience: z.enum(["everyone", "operators", "travelers", "guests", "contacts"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  channel: z.enum(["email", "telegram"]).optional().default("email"),
});

const trackSchema = z.object({
  events: z
    .array(
      z.object({
        listingId: z.string().uuid(),
        kind: z.enum(["impression", "view", "directions", "website", "call", "menu", "save", "share", "card_click"]),
        surface: z.string().max(24).optional().default(""),
      }),
    )
    .min(1)
    .max(30),
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

const listingInquirySchema = z.object({
  listingId: z.string().uuid(),
  guestName: z.string().trim().max(120).optional().default(""),
  guestEmail: z.string().trim().max(200).optional().default(""),
});

// revampstay: a monthly-rental or sale viewing request. Records a structured
// row (viewing_requests, migration 0091) AND drops the details into the host's
// unified inbox, reusing the listing_inquiry conversation.
const viewingRequestSchema = z.object({
  listingId: z.string().uuid(),
  offerType: z.enum(["nightly", "monthly", "sale"]),
  mode: z.enum(["in_person", "video"]).optional().default("in_person"),
  preferredTimes: z.array(z.string().trim().max(200)).max(5).optional().default([]),
  message: z.string().trim().max(2000).optional().default(""),
  guestName: z.string().trim().max(120).optional().default(""),
  guestEmail: z.string().trim().max(200).optional().default(""),
  guestPhone: z.string().trim().max(40).optional().default(""),
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
  amountCents: z.number().int().positive().max(1_000_000_000), // flat: price; per_listing: unit price. AMD hundredths
  monthsQuantity: z.number().int().min(1).max(120).optional().default(12),
  pricingMode: z.enum(["flat", "per_listing"]).optional().default("flat"),
  commissionPercent: z.number().min(0).max(100).nullable().optional(), // rate subscribers pay; null = default
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

// --- Time-slot sessions (tours & experiences) ---
const sessionRuleSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24),
});
const sessionScheduleSchema = z
  .object({
    durationMin: z.number().int().min(15).max(1440),
    capacity: z.number().int().min(1).max(1000),
    rules: z.array(sessionRuleSchema).max(14),
    leadTimeHours: z.number().int().min(0).max(720).optional(),
    horizonDays: z.number().int().min(1).max(365).optional(),
  })
  .nullable();
const saveScheduleSchema = z.object({
  listingId: z.string().uuid(),
  schedule: sessionScheduleSchema,
  bookingMode: z.enum(["instant", "request"]),
});
const bookingDecisionSchema = z.object({ bookingId: z.string().uuid() });

// --- Aha writing assist (listing copy) ---
const ahaCopySchema = z.object({
  field: z.enum(["title", "shortDescription", "longDescription", "highlights", "neighborhood"]),
  mode: z.enum(["generate", "improve"]),
  listingType: z.enum(["stay", "tour", "experience", "eat"]),
  current: z.string().max(6000).optional(),
  context: z
    .object({
      title: z.string().max(200).optional(),
      city: z.string().max(120).optional(),
      region: z.string().max(120).optional(),
      venueType: z.string().max(80).optional(),
      cuisine: z.string().max(80).optional(),
      priceUnit: z.string().max(40).optional(),
      amenities: z.array(z.string().max(80)).max(60).optional(),
      facts: z.array(z.object({ label: z.string().max(60), value: z.string().max(200) })).max(30).optional(),
      shortDescription: z.string().max(2000).optional(),
      longDescription: z.string().max(6000).optional(),
      highlights: z.array(z.string().max(200)).max(30).optional(),
      notes: z.string().max(1000).optional(),
    })
    .default({}),
});

function issuesToMessage(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
}

/** Build the shared email payload for a slot booking from its listing + row. */
/* eslint-disable @typescript-eslint/no-explicit-any */
function slotBookingEmailInfo(listing: any, bk: any): BookingEmailInfo {
  const facts = Array.isArray(listing.facts) ? (listing.facts as { label?: string; value?: string }[]) : [];
  const fact = (...labels: string[]) => facts.find((f) => f.label && labels.includes(f.label.toLowerCase()))?.value || undefined;
  return {
    listingTitle: listing.title,
    startDate: slotLocalDate(bk.starts_at),
    endDate: slotLocalDate(bk.starts_at),
    time: formatSlotTime(bk.starts_at),
    guests: bk.guests,
    amountCents: bk.amount_cents,
    currency: bk.currency,
    city: listing.city,
    region: listing.region,
    slug: listing.slug,
    type: listing.type,
    lat: typeof listing.lat === "number" ? listing.lat : undefined,
    lng: typeof listing.lng === "number" ? listing.lng : undefined,
    meetingPoint: fact("starting point", "meeting point", "start"),
    duration: fact("duration"),
    languages: fact("languages", "language"),
  };
}

/** Email the operator (and confirm to the guest) that a slot was requested. */
async function notifyOperatorOfRequest(admin: SupabaseClient, listing: any, bookingId: string): Promise<void> {
  const { data: bk } = await admin
    .from("bookings")
    .select("starts_at, guests, amount_cents, currency, guest_email, guest_phone, guest_name, traveler_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!bk) return;
  const info = slotBookingEmailInfo(listing, bk);
  const [op, trav, travProfile] = await Promise.all([
    admin.auth.admin.getUserById(listing.operator_id),
    admin.auth.admin.getUserById(bk.traveler_id),
    admin.from("profiles").select("display_name").eq("id", bk.traveler_id).maybeSingle(),
  ]);
  const travName = (travProfile.data?.display_name && travProfile.data.display_name !== "Guest" ? travProfile.data.display_name : bk.guest_name) || "A traveler";
  if (op.data?.user?.email) await sendOperatorBookingRequest(op.data.user.email, info, travName);
  const guestEmail = trav.data?.user?.email || bk.guest_email;
  if (guestEmail) await sendGuestRequestReceived(guestEmail, info);
  const whenLine = `${info.startDate}${info.time ? ` at ${info.time}` : ""}`;
  await notifyBooking(admin, {
    bookingId,
    listingId: listing.id,
    operatorId: listing.operator_id,
    travelerId: bk.traveler_id,
    travelerPhone: bk.guest_phone,
    inboxBody: `📩 Booking request received — ${info.listingTitle}, ${whenLine}, ${info.guests} guest${info.guests === 1 ? "" : "s"}. Awaiting the host's approval; no charge yet.`,
    smsBody: `Revamp: we received your booking request for ${info.listingTitle}, ${whenLine}. The host will approve it — no charge yet.`,
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
const ahaCopyHits = new Map<string, number[]>();
const trackHits = new Map<string, number[]>();
const voucherPurchaseHits = new Map<string, number[]>();
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
  // GET /api/health — liveness probe for external uptime monitors (UptimeRobot,
  // etc.). Verifies the API function is running AND the database answers, so a DB
  // outage shows as down even when the CDN still serves the SPA. Returns 200 when
  // healthy, 503 otherwise. No auth, no secrets, read-only.
  app.get("/api/health", async (_req: Request, res: Response) => {
    const db = await pingDb();
    const healthy = db.ok;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      db: db.ok ? "up" : db.configured ? "down" : "unconfigured",
      time: new Date().toISOString(),
    });
  });

  // GET /api/admin-health — admin-only operational snapshot for /admin → Health:
  // cron heartbeats, per-listing calendar freshness, stuck payments, and which
  // integrations are configured (booleans only, no secrets). Read-only.
  app.get("/api/admin-health", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    try {
      res.json(await collectHealth(admin));
    } catch (err) {
      console.error("[admin-health]", err);
      res.status(500).json({ error: "Couldn't load the health snapshot." });
    }
  });

  // ── Referral program (operators refer operators) ───────────────────────────
  // GET /api/referral/me — the signed-in operator's code, link, stats, and list.
  app.get("/api/referral/me", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "operator") return res.status(403).json({ error: "Operators only." });
    try {
      res.json(await getReferralSummary(admin, userId));
    } catch (err) {
      console.error("[referral/me]", err);
      res.status(500).json({ error: "Couldn't load your referrals." });
    }
  });

  // POST /api/referral/attach — link the signed-in new operator to a referral
  // code (called right after signup). Guard rails live in attachReferral().
  app.post("/api/referral/attach", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!code.trim()) return res.status(400).json({ error: "Missing code." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const result = await attachReferral(admin, userId, code);
    // Soft-fail: a bad/duplicate code is not an error the user needs to see as a
    // 500 — report ok:false with the reason so the client can decide quietly.
    res.json(result);
  });

  // GET /api/referral/admin — admin: all referrals + config + totals.
  app.get("/api/referral/admin", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    try {
      res.json(await listAllReferrals(admin));
    } catch (err) {
      console.error("[referral/admin]", err);
      res.status(500).json({ error: "Couldn't load referrals." });
    }
  });

  // POST /api/referral/admin-pay — admin: mark a qualified referral paid.
  app.post("/api/referral/admin-pay", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const referralId = typeof req.body?.referralId === "string" ? req.body.referralId : "";
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const ok = await markReferralPaid(admin, referralId);
    res.json({ ok });
  });

  // POST /api/referral/admin-settings — admin: toggle program / set reward.
  app.post("/api/referral/admin-settings", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;
    const rewardCents = typeof req.body?.rewardCents === "number" ? req.body.rewardCents : undefined;
    try {
      await setReferralConfig(admin, { enabled, rewardCents });
      res.json({ ok: true });
    } catch (err) {
      console.error("[referral/admin-settings]", err);
      res.status(500).json({ error: "Couldn't save settings." });
    }
  });

  // POST /api/track — anonymous, first-party engagement events (impressions,
  // views, intent clicks) for per-listing analytics. Bot-filtered, rate-limited,
  // best-effort (always 204). Increments daily counters via the bump RPC.
  app.post("/api/track", async (req: Request, res: Response) => {
    if (isCrawlerUserAgent(req.get("user-agent"))) return res.status(204).end();
    if (rateLimited(trackHits, req.ip || "?", 240)) return res.status(204).end();
    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(204).end();
    const admin = supabaseAdmin();
    if (!admin) return res.status(204).end();
    const day = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    await Promise.all(
      parsed.data.events.map(async (e) => {
        const key = `${e.listingId}:${e.kind}:${e.surface}`;
        if (seen.has(key)) return;
        seen.add(key);
        try {
          await admin.rpc("bump_listing_metric", { p_listing: e.listingId, p_day: day, p_kind: e.kind, p_surface: e.surface || "" });
        } catch {
          /* best-effort */
        }
      }),
    );
    res.status(204).end();
  });

  // GET /api/document-url?id=&download=1 — a short-lived signed URL for an
  // operator document. Access is checked against the documents table (admin, an
  // all-operators doc, or the operator it's targeted to/owned by) so the bucket
  // stays fully private. `download=1` forces a download; otherwise it opens inline.
  app.get("/api/document-url", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const id = String(req.query.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing document id." });
    try {
      const { data: doc } = await admin.from("documents").select("file_path, file_name, file_type, audience, operator_id").eq("id", id).maybeSingle();
      if (!doc) return res.status(404).json({ error: "Document not found." });
      const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      const isAdmin = me?.role === "admin";
      const allowed = isAdmin || doc.audience === "all_operators" || doc.operator_id === userId;
      if (!allowed) return res.status(403).json({ error: "You don't have access to this document." });
      const download = req.query.download === "1";
      const { data: signed, error } = await admin.storage
        .from("operator-documents")
        .createSignedUrl(doc.file_path, 300, download ? { download: doc.file_name || true } : undefined);
      if (error || !signed) return res.status(500).json({ error: "Couldn't open that document." });
      res.json({ url: signed.signedUrl, fileType: doc.file_type ?? null, fileName: doc.file_name ?? null });
    } catch (err) {
      console.error("[document-url]", err);
      res.status(500).json({ error: "Couldn't open that document." });
    }
  });

  // GET /api/qr-resolve?code= — public landing resolver for a dynamic QR code.
  // Loads the active code (service role), counts the scan, and returns what the
  // /q/<code> landing needs. No auth: guests scan these. Payment types return
  // their config too (landing handles "coming soon" until payments ship).
  app.get("/api/qr-resolve", async (req: Request, res: Response) => {
    const code = String(req.query.code || "").trim();
    if (!code) return res.status(400).json({ error: "Missing code." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available." });
    try {
      const { data: qr } = await admin
        .from("qr_codes")
        .select("id, name, type, config, listing_id, active")
        .eq("slug", code)
        .maybeSingle();
      if (!qr || !qr.active) return res.status(404).json({ error: "This QR code isn't active." });
      // Count the scan (best-effort read-modify-write; never blocks the response).
      try {
        const { data: cur } = await admin.from("qr_codes").select("scans").eq("id", qr.id).maybeSingle();
        await admin.from("qr_codes").update({ scans: (cur?.scans ?? 0) + 1 }).eq("id", qr.id);
      } catch { /* ignore scan-count failures */ }
      let listingSlug: string | null = null;
      if (qr.type === "listing" && qr.listing_id) {
        const { data: l } = await admin.from("listings").select("slug").eq("id", qr.listing_id).maybeSingle();
        listingSlug = l?.slug ?? null;
      }
      res.json({ type: qr.type, name: qr.name, config: qr.config ?? {}, listingSlug });
    } catch (err) {
      console.error("[qr-resolve]", err);
      res.status(500).json({ error: "Couldn't open that code." });
    }
  });

  // POST /api/qr-payment/start — public: a guest pays a tip/service QR code via
  // PayLink (no account needed). Revamp takes a 12.5% commission; NO tax. The
  // pending payment is recorded; it's marked paid on return (confirm) or by the
  // reconcile sweep. Amount is guest-chosen for a tip, fixed for a service code.
  app.post("/api/qr-payment/start", async (req: Request, res: Response) => {
    if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });
    if (rateLimited(giftPurchaseHits, `qrpay:${req.ip || "?"}`, 10)) return res.status(429).json({ error: "You're going a bit fast — try again in a moment." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Payments aren't available right now." });
    const code = String(req.body?.code || "").trim();
    let amountCents = Math.round(Number(req.body?.amountCents));
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : null;
    const payerName = typeof req.body?.payerName === "string" ? req.body.payerName.slice(0, 120) : null;
    if (!code) return res.status(400).json({ error: "Missing code." });
    try {
      const { data: qr } = await admin.from("qr_codes").select("id, owner_id, type, name, active, config").eq("slug", code).maybeSingle();
      if (!qr || !qr.active || (qr.type !== "tip" && qr.type !== "service")) return res.status(404).json({ error: "This payment code isn't active." });
      // Service codes charge their configured fixed amount; tips use the guest's amount.
      if (qr.type === "service") {
        const fixed = Number((qr.config as { amountCents?: number } | null)?.amountCents);
        if (Number.isFinite(fixed) && fixed > 0) amountCents = Math.round(fixed);
      }
      if (!Number.isFinite(amountCents) || amountCents < 10000 || amountCents > 100_000_000) {
        return res.status(400).json({ error: "Enter an amount between ֏100 and ֏1,000,000." });
      }
      const commission = Math.round((amountCents * PLATFORM_COMMISSION_PERCENT) / 100);
      const net = amountCents - commission;
      const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
      const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const paymentId = crypto.randomUUID();
      const pay = await registerPayment({
        amount: currency === "AMD" ? Math.round(amountCents / 100) : amountCents / 100,
        currency,
        returnUrl: `${site}/q/${code}?pay=${paymentId}`,
        info: `Revamp · ${qr.name}`.slice(0, 120),
        allowAnonymous: true,
      });
      if (!pay.redirectUrl) return res.status(502).json({ error: "Couldn't start checkout." });
      const { error } = await admin.from("qr_payments").insert({
        id: paymentId,
        qr_code_id: qr.id,
        owner_id: qr.owner_id,
        amount_cents: amountCents,
        commission_cents: commission,
        net_cents: net,
        currency,
        kind: qr.type,
        payer_name: payerName,
        note,
        paylink_request_id: pay.requestId,
      });
      if (error) {
        console.error("[qr-payment/start] insert", error.message);
        return res.status(500).json({ error: "Couldn't start the payment." });
      }
      res.json({ redirectUrl: pay.redirectUrl, paymentId });
    } catch (err) {
      console.error("[qr-payment/start]", err);
      res.status(502).json({ error: "Couldn't start checkout." });
    }
  });

  // POST /api/qr-payment/confirm — public: server-verify a QR payment on the
  // guest's return. Idempotent; the reconcile sweep also confirms stragglers.
  app.post("/api/qr-payment/confirm", async (req: Request, res: Response) => {
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available." });
    const id = String(req.body?.paymentId || "").trim();
    if (!id) return res.status(400).json({ error: "Missing payment id." });
    try {
      const { data: row } = await admin.from("qr_payments").select("id, status, paylink_request_id, paylink_order_id, amount_cents").eq("id", id).maybeSingle();
      if (!row) return res.status(404).json({ error: "Payment not found." });
      if (row.status === "paid") return res.json({ status: "paid", amountCents: row.amount_cents });
      const check = await checkPayment({ requestId: row.paylink_request_id, orderId: row.paylink_order_id });
      if (check.approved) {
        await admin.from("qr_payments").update({ status: "paid", paid_at: new Date().toISOString(), paylink_order_id: check.orderId ?? row.paylink_order_id }).eq("id", id).eq("status", "pending_payment");
        return res.json({ status: "paid", amountCents: row.amount_cents });
      }
      res.json({ status: "pending", amountCents: row.amount_cents });
    } catch (err) {
      console.error("[qr-payment/confirm]", err);
      res.status(500).json({ error: "Couldn't confirm the payment." });
    }
  });

  // GET /api/qr-earnings — admin: QR payment earnings owed to each operator
  // (paid, not yet settled) + settled totals. Revamp is merchant of record and
  // pays operators their net (gross − 12.5%) via this settlement.
  app.get("/api/qr-earnings", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    try {
      const { data } = await admin
        .from("qr_payments")
        .select("owner_id, net_cents, currency, settled_at, profiles:owner_id(display_name, business_name)")
        .eq("status", "paid");
      type Prof = { display_name: string | null; business_name: string | null };
      const rows = (data ?? []) as Array<{ owner_id: string; net_cents: number; currency: string; settled_at: string | null; profiles: Prof | Prof[] | null }>;
      const byOp = new Map<string, { operatorId: string; name: string; currency: string; owedCents: number; owedCount: number; paidCents: number }>();
      let owedTotal = 0;
      let paidTotal = 0;
      for (const r of rows) {
        const key = r.owner_id;
        const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
        const entry = byOp.get(key) ?? { operatorId: key, name: (prof?.business_name || prof?.display_name || "Operator").trim(), currency: r.currency, owedCents: 0, owedCount: 0, paidCents: 0 };
        if (r.settled_at) { entry.paidCents += r.net_cents; paidTotal += r.net_cents; }
        else { entry.owedCents += r.net_cents; entry.owedCount += 1; owedTotal += r.net_cents; }
        byOp.set(key, entry);
      }
      const operators = Array.from(byOp.values()).sort((a, b) => b.owedCents - a.owedCents);
      res.json({ operators, totals: { owedCents: owedTotal, paidCents: paidTotal } });
    } catch (err) {
      console.error("[qr-earnings]", err);
      res.status(500).json({ error: "Couldn't load QR earnings." });
    }
  });

  // POST /api/qr-earnings/settle — admin: mark an operator's owed QR earnings
  // paid out (sets settled_at on their paid, not-yet-settled rows).
  app.post("/api/qr-earnings/settle", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const operatorId = typeof req.body?.operatorId === "string" ? req.body.operatorId : "";
    if (!operatorId) return res.status(400).json({ error: "Missing operator." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    try {
      const { data, error } = await admin
        .from("qr_payments")
        .update({ settled_at: new Date().toISOString(), settled_by: userId })
        .eq("owner_id", operatorId)
        .eq("status", "paid")
        .is("settled_at", null)
        .select("net_cents");
      if (error) throw new Error(error.message);
      const settled = (data ?? []) as Array<{ net_cents: number }>;
      res.json({ ok: true, count: settled.length, amountCents: settled.reduce((s, r) => s + r.net_cents, 0) });
    } catch (err) {
      console.error("[qr-earnings/settle]", err);
      res.status(500).json({ error: "Couldn't settle these earnings." });
    }
  });

  // Dynamic robots.txt / sitemap.xml. Registered at both the public path (for
  // the long-running server in server/index.ts, and local `pnpm start`) and
  // an /api-prefixed alias — on Netlify the CDN serves the SPA, so these are
  // reached only via the function, whose path normalizer forces everything
  // under /api (see netlify/functions/api.ts + the /robots.txt, /sitemap.xml
  // redirects in netlify.toml).
  // ── Public MCP server (read-only) — Streamable HTTP, stateless. Registered at
  // both /mcp (bare path, via the netlify.toml redirect + server/index.ts) and
  // /api/mcp (the Netlify function normalizes everything under /api). CORS is
  // open because MCP clients connect cross-origin.
  const mcpCors = (res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  };
  const MCP_PROTOCOL_VERSION = "2025-06-18";
  for (const mcpPath of ["/mcp", "/api/mcp"]) {
    app.options(mcpPath, (_req: Request, res: Response) => {
      mcpCors(res);
      res.status(204).end();
    });
    // GET is the server→client notification stream. In streaming mode (a
    // persistent host, MCP_STREAMING=1) it's held open by the SDK transport —
    // this is what the claude.ai connector subscribes to. On the stateless
    // Netlify path a function can't hold it, so answer 405 (clients fall back to
    // POST-only; a 200 JSON page here breaks the connector's stream probe).
    app.get(mcpPath, async (req: Request, res: Response) => {
      mcpCors(res);
      if (mcpStreamingEnabled()) {
        try { await handlePublicMcpStreaming(req, res); }
        catch (err) { console.error("[mcp]", err); if (!res.headersSent) res.status(500).end(); }
        return;
      }
      res.setHeader("Allow", "POST, DELETE, OPTIONS");
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed: use POST for MCP requests." }, id: null });
    });
    // End-of-session DELETE: tears down the streaming session; on the stateless
    // path there's nothing to tear down, so just acknowledge it.
    app.delete(mcpPath, async (req: Request, res: Response) => {
      mcpCors(res);
      if (mcpStreamingEnabled()) {
        try { await handlePublicMcpStreaming(req, res); }
        catch (err) { console.error("[mcp]", err); if (!res.headersSent) res.status(500).end(); }
        return;
      }
      res.status(204).end();
    });
    app.post(mcpPath, async (req: Request, res: Response) => {
      mcpCors(res);
      res.setHeader("Mcp-Protocol-Version", MCP_PROTOCOL_VERSION);
      try {
        if (mcpStreamingEnabled()) await handlePublicMcpStreaming(req, res);
        else await handlePublicMcp(req, res);
      } catch (err) {
        console.error("[mcp]", err);
        if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    });
  }

  // Internal (team) MCP — API-key gated; private business data. Same transport.
  for (const adminPath of ["/mcp/admin", "/api/mcp/admin"]) {
    app.options(adminPath, (_req: Request, res: Response) => {
      mcpCors(res);
      res.status(204).end();
    });
    app.get(adminPath, async (req: Request, res: Response) => {
      mcpCors(res);
      if (mcpStreamingEnabled()) {
        try { await handleAdminMcpStreaming(req, res); }
        catch (err) { console.error("[mcp-admin]", err); if (!res.headersSent) res.status(500).end(); }
        return;
      }
      res.setHeader("Allow", "POST, DELETE, OPTIONS");
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed: use POST for MCP requests." }, id: null });
    });
    app.delete(adminPath, async (req: Request, res: Response) => {
      mcpCors(res);
      if (mcpStreamingEnabled()) {
        try { await handleAdminMcpStreaming(req, res); }
        catch (err) { console.error("[mcp-admin]", err); if (!res.headersSent) res.status(500).end(); }
        return;
      }
      res.status(204).end();
    });
    app.post(adminPath, async (req: Request, res: Response) => {
      mcpCors(res);
      res.setHeader("Mcp-Protocol-Version", MCP_PROTOCOL_VERSION);
      try {
        if (mcpStreamingEnabled()) await handleAdminMcpStreaming(req, res);
        else await handleAdminMcp(req, res);
      } catch (err) {
        console.error("[mcp-admin]", err);
        if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    });
  }

  // OAuth discovery probes (RFC 9728 / RFC 8414) for the MCP endpoints. Neither
  // MCP server uses OAuth — the public one is open, the admin one uses a static
  // bearer key — so answer with a clean 404 (not the SPA's 200 HTML). Otherwise a
  // connector that probes these tries to parse HTML as auth metadata and fails
  // with "Couldn't reach". Reached via the netlify.toml /.well-known/oauth-*
  // redirects (and directly at /api/wk-oauth after the function normalizer).
  app.all(
    [
      "/api/wk-oauth",
      // Bare paths (local self-host / direct hits) and the /api-prefixed form the
      // Netlify function normalizer produces for the same incoming request.
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/*",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/*",
      "/api/.well-known/oauth-protected-resource",
      "/api/.well-known/oauth-protected-resource/*",
      "/api/.well-known/oauth-authorization-server",
      "/api/.well-known/oauth-authorization-server/*",
    ],
    (_req: Request, res: Response) => {
      mcpCors(res);
      res.status(404).json({ error: "not_found", message: "This server does not use OAuth." });
    },
  );

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
    const { listingId, startDate, endDate, guests, guestName, guestEmail, guestPhone, messagingConsent, addons } = parsed.data;

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

    // Resolve an optional operator promo code once, validated against the booking
    // context (code/travel window, weekday, min stay, usage caps, listing scope).
    // The per-path base below applies the discount and snapshots it on the booking.
    let promoResolved: { id: string; discount_type: "percent" | "amount"; discount_value: number } | null = null;
    if (parsed.data.promoCode) {
      const adminForPromo = supabaseAdmin();
      if (!adminForPromo) return res.status(503).json({ error: "Promo codes aren't available right now." });
      const pr = await resolvePromo(adminForPromo, {
        listingId,
        operatorId: listing.operator_id,
        code: parsed.data.promoCode,
        travelerId: userId,
        startDate,
        endDate,
        listingType: listing.type,
      });
      if (!pr.ok) return res.status(400).json({ error: pr.error });
      promoResolved = pr.promo;
    }

    // ── Slot booking (tour/experience with a time-slot schedule) ──────────────
    // Governed by per-session capacity, not the daterange exclusion. Seats are
    // reserved atomically before any charge; instant mode goes to PayLink now,
    // request mode creates a 'requested' booking the operator approves first.
    const sched = listing.session_schedule as { rules?: unknown[] } | null;
    const isSlotListing = (listing.type === "tour" || listing.type === "experience") && !!sched && Array.isArray(sched.rules) && sched.rules.length > 0;
    if (isSlotListing) {
      const admin = supabaseAdmin();
      if (!admin) return res.status(503).json({ error: "Booking isn't available right now." });
      const { sessionId } = parsed.data;
      if (!sessionId) return res.status(400).json({ error: "Pick a time slot." });

      const { data: session } = await admin.from("listing_sessions").select("id, listing_id, starts_at, capacity, seats_taken, status").eq("id", sessionId).maybeSingle();
      if (!session || session.listing_id !== listingId) return res.status(404).json({ error: "That time slot wasn't found." });
      if (session.status !== "open") return res.status(409).json({ error: "That time is no longer available." });
      if (Date.parse(session.starts_at as string) < Date.now()) return res.status(400).json({ error: "That time has already passed." });

      const perTotal = computeBookingAmountCents(
        {
          priceCents: listing.price_cents,
          priceUnit: listing.price_unit,
          cancellationPolicy: listing.cancellation_policy ?? "flexible",
          nonrefundableDiscountPercent: listing.nonrefundable_discount_percent ?? 0,
          seasonalRates: [],
        },
        { startDate, endDate, guests },
      );
      if (perTotal <= 0) return res.status(400).json({ error: "This listing is rate-on-request — contact the operator to book." });
      const { netCents } = promoDiscount(
        perTotal,
        { discountType: listing.discount_type, discountValue: listing.discount_value, discountStart: listing.discount_start, discountEnd: listing.discount_end },
        startDate,
      );
      let slotBase = netCents;
      let slotPromoDisc = 0;
      if (promoResolved) {
        slotPromoDisc = promoDiscountCents(slotBase, promoResolved.discount_type, promoResolved.discount_value);
        slotBase -= slotPromoDisc;
      }
      const slotCharge = computeBookingCharge(slotBase);
      const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;

      // Reserve seats atomically FIRST — if this fails the slot just filled up.
      const reserved = await reserveSeats(admin, sessionId, guests);
      if (!reserved) return res.status(409).json({ error: "That time just filled up — pick another slot." });

      const slotRow: Record<string, unknown> = {
        listing_id: listingId,
        traveler_id: userId,
        start_date: startDate,
        end_date: endDate,
        starts_at: session.starts_at,
        session_id: sessionId,
        guests,
        amount_cents: slotCharge.totalCents,
        base_cents: slotCharge.baseCents,
        tax_cents: slotCharge.taxCents,
        currency,
        cancellation_policy: listing.cancellation_policy ?? "flexible",
        free_cancel_days: listing.free_cancel_days ?? 7,
        promo_code_id: promoResolved?.id ?? null,
        promo_discount_cents: slotPromoDisc,
      };
      if (guestName || guestEmail || guestPhone) {
        slotRow.guest_name = guestName || null;
        slotRow.guest_email = guestEmail || null;
        slotRow.guest_phone = guestPhone || null;
      }
      slotRow.messaging_consent = messagingConsent;

      // Request-to-book: no charge now — create a pending request for the operator.
      if (listing.booking_mode === "request") {
        const { data: created, error: insErr } = await admin.from("bookings").insert({ ...slotRow, status: "requested", provider: "paylink" }).select("id").single();
        if (insErr) {
          await releaseSeats(admin, sessionId, guests);
          console.error("[start-checkout] request insert failed", insErr.message);
          return res.status(500).json({ error: "Couldn't record your request." });
        }
        try {
          await notifyOperatorOfRequest(admin, listing, created.id);
        } catch (e) {
          console.error("[start-checkout] request notify failed", e);
        }
        return res.json({ requested: true, bookingId: created.id });
      }

      // Instant: charge via PayLink now.
      const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      try {
        const pay = await registerPayment({
          amount: currency === "AMD" ? Math.round(slotCharge.totalCents / 100) : slotCharge.totalCents / 100,
          currency,
          returnUrl: `${site}/account?checkout=return`,
          info: `Revamp booking · ${listing.title}`,
        });
        if (!pay.redirectUrl) {
          await releaseSeats(admin, sessionId, guests);
          return res.status(502).json({ error: "Couldn't start checkout." });
        }
        const { error: insErr } = await admin
          .from("bookings")
          .insert({ ...slotRow, status: "pending_payment", provider: "paylink", paylink_request_id: pay.requestId, paylink_order_id: pay.orderId })
          .select("id")
          .maybeSingle();
        if (insErr) {
          await releaseSeats(admin, sessionId, guests);
          console.error("[start-checkout] slot insert failed", insErr.message);
          return res.status(500).json({ error: "Couldn't record your booking." });
        }
        return res.json({ redirectUrl: pay.redirectUrl });
      } catch (err) {
        await releaseSeats(admin, sessionId, guests);
        console.error("[start-checkout] slot", err);
        return res.status(502).json({ error: "Couldn't start checkout." });
      }
    }

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
        guestsIncluded: listing.guests_included ?? undefined,
        extraGuestFeeCents: listing.extra_guest_fee_cents ?? undefined,
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
    let nsBase = netAccommodationCents + (listing.cleaning_fee_cents ?? 0);
    let promoDisc = 0;
    if (promoResolved) {
      promoDisc = promoDiscountCents(nsBase, promoResolved.discount_type, promoResolved.discount_value);
      nsBase -= promoDisc;
    }
    const charge = computeBookingCharge(nsBase); // base + tax = accommodation portion the guest pays (after any promo)

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
      promo_code_id: promoResolved?.id ?? null,
      promo_discount_cents: promoDisc,
    };
    if (guestName || guestEmail || guestPhone) {
      baseRow.guest_name = guestName || null;
      baseRow.guest_email = guestEmail || null;
      baseRow.guest_phone = guestPhone || null;
    }
    baseRow.messaging_consent = messagingConsent;

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
    const { listingId, sessionId, startDate, endDate, guests, guestName, guestEmail, guestPhone, baseCents, paymentStatus, collectVia } = parsed.data;
    if (endDate <= startDate) return res.status(400).json({ error: "The end date must be after the start date." });

    // The caller must own the listing.
    const { data: listing, error: readErr } = await admin.from("listings").select("id, operator_id, title, city, region, slug, type").eq("id", listingId).maybeSingle();
    if (readErr || !listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.operator_id !== userId) return res.status(403).json({ error: "That listing isn't yours." });

    const viaPayLink = collectVia === "paylink";
    if (viaPayLink) {
      if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });
      if (!guestEmail) return res.status(400).json({ error: "Add the customer's email to send them a payment link." });
    }

    // Resolve a time slot (tour/experience) and reserve its seat, if one was picked,
    // so an operator's sale and online bookings can't oversell the same session.
    let slotStartsAt: string | null = null;
    let rowStart = startDate;
    let rowEnd = endDate;
    if (sessionId) {
      const { data: session } = await admin
        .from("listing_sessions")
        .select("id, listing_id, starts_at, capacity, seats_taken, status")
        .eq("id", sessionId)
        .maybeSingle();
      if (!session || session.listing_id !== listingId) return res.status(404).json({ error: "That time slot wasn't found." });
      if (Date.parse(session.starts_at as string) < Date.now()) return res.status(400).json({ error: "That time slot has already passed." });
      const reserved = await reserveSeats(admin, sessionId, guests);
      if (!reserved) return res.status(409).json({ error: "That time slot doesn't have enough seats left." });
      slotStartsAt = session.starts_at as string;
      rowStart = slotLocalDate(slotStartsAt);
      rowEnd = new Date(Date.parse(rowStart + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
    }
    const releaseSlot = async () => { if (sessionId) await releaseSeats(admin, sessionId, guests); };

    const charge = computeBookingCharge(baseCents);
    const row: Record<string, unknown> = {
      listing_id: listingId,
      traveler_id: null,
      start_date: rowStart,
      end_date: rowEnd,
      guests,
      amount_cents: charge.totalCents,
      base_cents: charge.baseCents,
      tax_cents: charge.taxCents,
      currency: DEFAULT_CURRENCY,
      guest_name: guestName,
      guest_email: guestEmail || null,
      guest_phone: guestPhone || null,
    };
    if (slotStartsAt) { row.session_id = sessionId; row.starts_at = slotStartsAt; }

    const emailInfo: BookingEmailInfo = {
      listingTitle: listing.title,
      startDate: rowStart,
      endDate: rowEnd,
      guests,
      amountCents: charge.totalCents,
      currency: DEFAULT_CURRENCY,
      city: listing.city,
      region: listing.region,
      slug: listing.slug,
      type: listing.type,
      time: slotStartsAt ? formatSlotTime(slotStartsAt) : undefined,
    };

    // PayLink: create a PENDING booking and email the customer a payment link.
    // They pay themselves; the reconcile cron confirms it (and fires the usual
    // confirmation notifications) once the payment clears — same as online.
    if (viaPayLink) {
      const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
      const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      let pay;
      try {
        pay = await registerPayment({
          amount: currency === "AMD" ? Math.round(charge.totalCents / 100) : charge.totalCents / 100,
          currency,
          returnUrl: `${site}/`,
          info: `Revamp booking · ${listing.title}`,
        });
      } catch (e) {
        await releaseSlot();
        console.error("[direct-booking:paylink] register", e);
        return res.status(502).json({ error: "Couldn't create the payment link." });
      }
      if (!pay.redirectUrl) { await releaseSlot(); return res.status(502).json({ error: "Couldn't create the payment link." }); }
      const { data: created, error: insErr } = await admin
        .from("bookings")
        .insert({ ...row, currency, status: "pending_payment", provider: "paylink", paylink_request_id: pay.requestId, paylink_order_id: pay.orderId })
        .select("id")
        .single();
      if (insErr) {
        await releaseSlot();
        console.error("[direct-booking:paylink] insert", insErr);
        return res.status(500).json({ error: "Couldn't create the booking." });
      }
      try { await sendPaymentLink(guestEmail as string, emailInfo, pay.redirectUrl); } catch (e) { console.error("[direct-booking:paylink] email", e); }
      await logBookingEvent(admin, created.id, "payment_link_sent", `Operator created a booking and emailed a PayLink link to ${guestEmail}.`);
      return res.json({ id: created.id, totalCents: charge.totalCents, paymentLinkSent: true, redirectUrl: pay.redirectUrl });
    }

    // Offline: confirmed now, money handled outside Revamp.
    const { data, error } = await admin
      .from("bookings")
      .insert({ ...row, status: "confirmed", provider: "direct", payment_status: paymentStatus })
      .select("id")
      .single();
    if (error) {
      await releaseSlot();
      // 23P01 = exclusion_violation: overlaps an existing confirmed booking.
      if ((error as { code?: string }).code === "23P01") return res.status(409).json({ error: "Those dates already have a confirmed booking." });
      console.error("[direct-booking]", error);
      return res.status(500).json({ error: "Couldn't create the booking." });
    }
    await logBookingEvent(admin, data.id, "direct_created", `Direct booking recorded by the operator (${paymentStatus}${sessionId ? ", slot" : ""}).`);
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

  // POST /api/operator-booking-contact — edit the guest's contact details on a
  // booking (name / email / phone). Useful for direct bookings entered by hand.
  // Allowed for the owning operator or an admin; service-role update.
  app.post("/api/operator-booking-contact", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in as an operator." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available yet." });

    const parsed = bookingContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const { bookingId, guestName, guestEmail, guestPhone } = parsed.data;

    const { data: bk, error: readErr } = await admin
      .from("bookings")
      .select("id, listings!inner(operator_id)")
      .eq("id", bookingId)
      .maybeSingle();
    if (readErr || !bk) return res.status(404).json({ error: "Booking not found." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if ((bk as unknown as { listings: { operator_id: string } }).listings.operator_id !== userId && me?.role !== "admin") {
      return res.status(403).json({ error: "That booking isn't on your listing." });
    }
    const { error: upErr } = await admin
      .from("bookings")
      .update({ guest_name: guestName || null, guest_email: guestEmail || null, guest_phone: guestPhone || null })
      .eq("id", bookingId);
    if (upErr) return res.status(500).json({ error: "Couldn't update the contact details." });
    await logBookingEvent(admin, bookingId, "contact_updated", "Guest contact details updated by the operator.");
    res.json({ ok: true });
  });

  // POST /api/operator-booking-send-link — for an existing (usually offline/direct)
  // booking, register a PayLink payment and email the customer a pay link. The
  // booking becomes pending_payment/paylink and the reconcile cron confirms it —
  // and fires the usual confirmations — once they pay. Owner/admin only.
  app.post("/api/operator-booking-send-link", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in as an operator." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available yet." });
    if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });

    const parsed = bookingIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const { bookingId } = parsed.data;

    const { data: bk, error: readErr } = await admin
      .from("bookings")
      .select("id, start_date, end_date, guests, amount_cents, currency, status, guest_email, starts_at, listings!inner(operator_id, title, city, region, slug, type)")
      .eq("id", bookingId)
      .maybeSingle();
    if (readErr || !bk) return res.status(404).json({ error: "Booking not found." });
    const L = (bk as unknown as { listings: { operator_id: string; title: string; city: string; region: string; slug: string; type: string } }).listings;
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (L.operator_id !== userId && me?.role !== "admin") return res.status(403).json({ error: "That booking isn't on your listing." });
    if ((bk as { status: string }).status === "cancelled") return res.status(400).json({ error: "This booking is cancelled." });
    const email = (bk as { guest_email: string | null }).guest_email;
    if (!email) return res.status(400).json({ error: "Add the customer's email first, then send the link." });

    const currency = (bk as { currency: string }).currency || DEFAULT_CURRENCY;
    const amountCents = (bk as { amount_cents: number }).amount_cents;
    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    let pay;
    try {
      pay = await registerPayment({
        amount: currency === "AMD" ? Math.round(amountCents / 100) : amountCents / 100,
        currency,
        returnUrl: `${site}/`,
        info: `Revamp booking · ${L.title}`,
      });
    } catch (e) {
      console.error("[booking-send-link] register", e);
      return res.status(502).json({ error: "Couldn't create the payment link." });
    }
    if (!pay.redirectUrl) return res.status(502).json({ error: "Couldn't create the payment link." });

    const { error: upErr } = await admin
      .from("bookings")
      .update({ status: "pending_payment", provider: "paylink", paylink_request_id: pay.requestId, paylink_order_id: pay.orderId })
      .eq("id", bookingId);
    if (upErr) return res.status(500).json({ error: "Couldn't update the booking." });

    const info: BookingEmailInfo = {
      listingTitle: L.title,
      startDate: (bk as { start_date: string }).start_date,
      endDate: (bk as { end_date: string }).end_date,
      guests: (bk as { guests: number }).guests,
      amountCents,
      currency,
      city: L.city,
      region: L.region,
      slug: L.slug,
      type: L.type,
      time: (bk as { starts_at: string | null }).starts_at ? formatSlotTime((bk as { starts_at: string }).starts_at) : undefined,
    };
    try { await sendPaymentLink(email, info, pay.redirectUrl); } catch (e) { console.error("[booking-send-link] email", e); }
    await logBookingEvent(admin, bookingId, "payment_link_sent", `Payment link emailed to ${email}.`);
    res.json({ ok: true, redirectUrl: pay.redirectUrl });
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
      .select("id, listing_id, traveler_id, status, start_date, end_date, guests, amount_cents, currency, paid_at, cancellation_policy, free_cancel_days, guest_email, guest_phone, gift_card_id, gift_applied_cents, session_id")
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

    const cancellable = ["pending_payment", "confirmed", "requested", "awaiting_payment"];
    if (!cancellable.includes(booking.status)) {
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
      .in("status", ["pending_payment", "confirmed", "requested", "awaiting_payment"])
      .select("id");
    if (updErr || !upd || upd.length === 0) {
      return res.status(409).json({ error: "Couldn't cancel — it may have already changed." });
    }

    // A never-completed pending hold releases its gift reservation (no purchase
    // happened). A confirmed booking's gift is non-refundable → left forfeited.
    if (booking.status === "pending_payment" && giftApplied > 0) await refundGiftForBooking(admin, booking.id);
    // Slot booking → free the seats it was holding, regardless of prior status.
    if (booking.session_id) await releaseSeats(admin, booking.session_id, booking.guests);

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
      // Inbox mirror + text/WhatsApp the traveler (the customer) either way.
      const refundLine = refundCents > 0 ? ` A refund of ${Math.round(refundCents / 100).toLocaleString("en-US")} ${booking.currency} applies per the cancellation policy.` : "";
      await notifyBooking(admin, {
        bookingId: booking.id,
        listingId: booking.listing_id,
        operatorId: listing.operator_id,
        travelerId: booking.traveler_id,
        travelerPhone: booking.guest_phone,
        inboxBody: `🚫 Booking cancelled — ${listing.title}.${refundLine}`,
        smsBody: `Revamp: your booking for ${listing.title} has been cancelled.${refundLine}`,
      });
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

  // POST /api/listing-inquiry-thread — a traveler opens a PRE-BOOKING question
  // thread with a listing's host (unified inbox, kind='listing_inquiry'). No
  // booking required. One thread per (listing, traveler); the operator is derived
  // from the listing (never client-supplied). Only published listings, and not a
  // host inquiring on their own listing.
  app.post("/api/listing-inquiry-thread", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to message the host." });

    const parsed = listingInquirySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Messaging isn't available right now." });

    try {
      const { data: listing } = await admin
        .from("listings")
        .select("id, operator_id, status")
        .eq("id", parsed.data.listingId)
        .maybeSingle();
      if (!listing || listing.status !== "published") return res.status(404).json({ error: "Listing not found." });
      if (listing.operator_id === userId) return res.status(400).json({ error: "That's your own listing." });

      // Existing inquiry thread for this (listing, traveler)?
      const { data: candidates } = await admin
        .from("conversations")
        .select("id")
        .eq("kind", "listing_inquiry")
        .eq("listing_id", listing.id);
      const guestName = parsed.data.guestName.trim();
      const guestEmail = parsed.data.guestEmail.trim();

      // Show the host who's asking: an anonymous guest's profile is "Guest", so
      // set their display_name to the name they gave (never overwrite a real
      // traveler's name).
      if (guestName) {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        if (u?.user?.is_anonymous) await admin.from("profiles").update({ display_name: guestName }).eq("id", userId);
      }

      const ids = (candidates ?? []).map((c) => c.id as string);
      if (ids.length) {
        const { data: mine } = await admin
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", userId)
          .in("conversation_id", ids)
          .maybeSingle();
        if (mine) {
          // Keep the latest contact details on the thread for host follow-up.
          if (guestEmail || guestName) await admin.from("conversations").update({ guest_email: guestEmail || null, guest_name: guestName || null }).eq("id", mine.conversation_id);
          return res.json({ conversationId: mine.conversation_id });
        }
      }

      const { data: convo, error: cErr } = await admin
        .from("conversations")
        .insert({ kind: "listing_inquiry", listing_id: listing.id, guest_email: guestEmail || null, guest_name: guestName || null })
        .select("id")
        .single();
      if (cErr || !convo) throw new Error(cErr?.message || "conversation create failed");

      const { error: pErr } = await admin.from("conversation_participants").insert([
        { conversation_id: convo.id, user_id: userId, role: "traveler" },
        { conversation_id: convo.id, user_id: listing.operator_id, role: "operator" },
      ]);
      if (pErr) throw new Error(pErr.message);

      res.json({ conversationId: convo.id });
    } catch (err) {
      console.error("[listing-inquiry-thread]", err);
      res.status(500).json({ error: "Couldn't open the conversation. Please try again." });
    }
  });

  // POST /api/viewing-request — revampstay lead primitive. A prospect asks to
  // VIEW a monthly rental or a property for sale (no booking/checkout — these
  // listings have no nightly offer). Records a structured viewing_requests row
  // (0091) AND lands the details in the host's unified inbox, reusing the
  // listing_inquiry conversation so the host answers in one place. Anonymous
  // callers are allowed (same silent-guest pattern as the inquiry thread), so a
  // prospect never needs an account to enquire. The operator is always derived
  // from the listing, never client-supplied.
  app.post("/api/viewing-request", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to request a viewing." });

    const parsed = viewingRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Viewing requests aren't available right now." });

    const { listingId, offerType, mode, preferredTimes, message } = parsed.data;
    const guestName = parsed.data.guestName.trim();
    const guestEmail = parsed.data.guestEmail.trim();
    const guestPhone = parsed.data.guestPhone.trim();

    try {
      const { data: listing } = await admin
        .from("listings")
        .select("id, operator_id, status, title, type, offer_types")
        .eq("id", listingId)
        .maybeSingle();
      if (!listing || listing.status !== "published") return res.status(404).json({ error: "Listing not found." });
      if (listing.operator_id === userId) return res.status(400).json({ error: "That's your own listing." });
      // Guard: the chosen offer must actually be advertised on the listing.
      const offers = (listing as { offer_types?: string[] | null }).offer_types ?? ["nightly"];
      if (!offers.includes(offerType)) return res.status(400).json({ error: "That option isn't available on this listing." });

      // Show the host who's asking: an anonymous guest's profile is "Guest", so
      // adopt the name they gave (never overwrite a real traveler's name).
      if (guestName) {
        const { data: u } = await admin.auth.admin.getUserById(userId);
        if (u?.user?.is_anonymous) await admin.from("profiles").update({ display_name: guestName }).eq("id", userId);
      }

      // Find-or-create the (listing, traveler) inquiry thread — same shape as
      // /api/listing-inquiry-thread so a prospect's viewing request and any
      // follow-up chat share one conversation.
      const { data: candidates } = await admin
        .from("conversations")
        .select("id")
        .eq("kind", "listing_inquiry")
        .eq("listing_id", listing.id);
      const ids = (candidates ?? []).map((c) => c.id as string);
      let conversationId: string | null = null;
      if (ids.length) {
        const { data: mine } = await admin
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", userId)
          .in("conversation_id", ids)
          .maybeSingle();
        if (mine) conversationId = mine.conversation_id as string;
      }
      if (conversationId) {
        if (guestEmail || guestName) await admin.from("conversations").update({ guest_email: guestEmail || null, guest_name: guestName || null }).eq("id", conversationId);
      } else {
        const { data: convo, error: cErr } = await admin
          .from("conversations")
          .insert({ kind: "listing_inquiry", listing_id: listing.id, guest_email: guestEmail || null, guest_name: guestName || null })
          .select("id")
          .single();
        if (cErr || !convo) throw new Error(cErr?.message || "conversation create failed");
        conversationId = convo.id as string;
        const { error: pErr } = await admin.from("conversation_participants").insert([
          { conversation_id: conversationId, user_id: userId, role: "traveler" },
          { conversation_id: conversationId, user_id: listing.operator_id, role: "operator" },
        ]);
        if (pErr) throw new Error(pErr.message);
      }

      // Record the structured lead.
      const { error: vErr } = await admin.from("viewing_requests").insert({
        listing_id: listing.id,
        requester_id: userId,
        guest_name: guestName || null,
        guest_email: guestEmail || null,
        guest_phone: guestPhone || null,
        offer_type: offerType,
        mode,
        preferred_times: preferredTimes,
        message: message || null,
        conversation_id: conversationId,
      });
      if (vErr) throw new Error(vErr.message);

      // Mirror the request into the inbox as a message from the prospect, so the
      // host sees it (and gets the new-message email) exactly like any inquiry.
      const offerLabel = offerType === "sale" ? "Property for sale" : offerType === "monthly" ? "Long-term rental" : "Short stay";
      const modeLabel = mode === "video" ? "Video call" : "In person";
      const lines = [
        `📅 Viewing request — ${offerLabel}`,
        `Format: ${modeLabel}`,
        `Preferred times: ${preferredTimes.length ? preferredTimes.join(", ") : "Flexible / to be arranged"}`,
      ];
      const contact = [guestPhone && `phone ${guestPhone}`, guestEmail && `email ${guestEmail}`].filter(Boolean).join(", ");
      if (contact) lines.push(`Contact: ${contact}`);
      if (message) lines.push("", message);
      const body = lines.join("\n");

      const { flagged } = scanMessage(body);
      await admin.from("messages").insert({ conversation_id: conversationId, sender_id: userId, sender_role: "traveler", body, flagged });
      const nowIso = new Date().toISOString();
      await admin.from("conversations").update({ last_message_at: nowIso, first_guest_at: nowIso }).eq("id", conversationId).is("first_guest_at", null);
      await admin.from("conversations").update({ last_message_at: nowIso }).eq("id", conversationId);

      res.json({ conversationId });

      // Best-effort: email the host that a viewing was requested (fire-and-forget
      // after responding, mirroring /api/message-send).
      try {
        const senderName = guestName || "A prospective guest";
        const { data: u } = await admin.auth.admin.getUserById(listing.operator_id);
        const to = u?.user?.email || null;
        if (to) await sendNewMessage(to, { fromName: senderName, listingTitle: (listing as { title?: string }).title, snippet: `${offerLabel} — ${modeLabel} viewing requested`, recipientRole: "operator" });
      } catch (emailErr) {
        console.error("[viewing-request] notify failed", emailErr);
      }
    } catch (err) {
      console.error("[viewing-request]", err);
      res.status(500).json({ error: "Couldn't send your viewing request. Please try again." });
    }
  });

  // --- Telegram opt-in notifications (free channel) -------------------------
  // POST /api/telegram/connect — issue a one-time deep link the customer taps to
  // link their Telegram chat to their account.
  app.post("/api/telegram/connect", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in first." });
    if (!telegramConfigured()) return res.status(503).json({ error: "Telegram isn't available right now." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Telegram isn't available right now." });
    const connectToken = randomUUID().replace(/-/g, "");
    const { error } = await admin
      .from("telegram_links")
      .upsert({ user_id: userId, connect_token: connectToken, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) {
      console.error("[telegram/connect]", error);
      return res.status(500).json({ error: "Couldn't start the connection." });
    }
    res.json({ url: telegramConnectLink(connectToken), username: telegramBotUsername() });
  });

  // GET /api/telegram/status — is this account's Telegram linked?
  app.get("/api/telegram/status", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in first." });
    const admin = supabaseAdmin();
    if (!admin) return res.json({ connected: false, configured: telegramConfigured() });
    const { data } = await admin.from("telegram_links").select("chat_id").eq("user_id", userId).maybeSingle();
    res.json({ connected: !!data?.chat_id, configured: telegramConfigured() });
  });

  // POST /api/telegram/disconnect — unlink.
  app.post("/api/telegram/disconnect", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in first." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    await admin.from("telegram_links").update({ chat_id: null, connect_token: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
    res.json({ ok: true });
  });

  // POST /api/telegram-webhook — Telegram calls this. A `/start <token>` from the
  // deep link links the sender's chat id to the account that owns the token.
  // Always acknowledges (200) so Telegram doesn't retry-storm.
  app.post("/api/telegram-webhook", async (req: Request, res: Response) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.get("X-Telegram-Bot-Api-Secret-Token") !== secret) return res.status(401).end();
    const admin = supabaseAdmin();
    if (!admin) return res.status(200).json({ ok: true });
    try {
      const msg = (req.body as { message?: { text?: string; chat?: { id?: number | string } } })?.message;
      const text = msg?.text;
      const chatId = msg?.chat?.id;
      if (text && chatId != null && text.startsWith("/start")) {
        const startToken = text.split(/\s+/)[1];
        if (startToken) {
          const { data: link } = await admin.from("telegram_links").select("user_id").eq("connect_token", startToken).maybeSingle();
          if (link) {
            await admin.from("telegram_links").update({ chat_id: String(chatId), connect_token: null, updated_at: new Date().toISOString() }).eq("user_id", link.user_id);
            await sendTelegram(String(chatId), "✅ Connected to Revamp. You'll get your booking updates right here.");
          } else {
            await sendTelegram(String(chatId), "That link has expired. Open your Revamp account and tap ‘Connect Telegram’ again.");
          }
        } else {
          await sendTelegram(String(chatId), "Welcome to Revamp! Open your account on revampvacations.com and tap ‘Connect Telegram’ to link this chat.");
        }
      }
    } catch (e) {
      console.error("[telegram-webhook]", e);
    }
    res.status(200).json({ ok: true });
  });

  // POST /api/telegram/set-webhook — admin: register the webhook with Telegram
  // (one-time after deploy, or when the URL/secret changes).
  app.post("/api/telegram/set-webhook", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    if (!telegramConfigured()) return res.status(503).json({ error: "Set TELEGRAM_BOT_TOKEN first." });
    const admin = supabaseAdmin();
    if (admin) {
      const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    }
    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const r = await setTelegramWebhook(`${site}/api/telegram-webhook`, process.env.TELEGRAM_WEBHOOK_SECRET);
    res.json(r);
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
        .select("id, status, listing_id, guest_email, first_guest_at, first_operator_at, listings(title)")
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

      // First-response tracking: stamp the first guest message and the operator's
      // first reply, so we can report response times (operator + admin). Only the
      // FIRST of each is recorded; auto/support messages don't count as the
      // operator's human reply.
      const nowIso = new Date().toISOString();
      const convoPatch: Record<string, unknown> = { last_message_at: nowIso };
      const c = convo as { first_guest_at?: string | null; first_operator_at?: string | null };
      if (senderRole === "traveler" && !c.first_guest_at) convoPatch.first_guest_at = nowIso;
      if (senderRole === "operator" && !c.first_operator_at && c.first_guest_at) convoPatch.first_operator_at = nowIso;
      await admin.from("conversations").update(convoPatch).eq("id", parsed.data.conversationId);

      // Automatic initial message: when a guest opens a conversation and the
      // operator has an auto-reply set, post it immediately (once per thread) so
      // no inquiry sits unanswered. Marked `auto` so it never counts as the
      // operator's human first reply in response metrics. Best-effort.
      if (senderRole === "traveler") {
        try {
          const listingId = (convo as { listing_id?: string | null }).listing_id;
          const { data: existingOp } = await admin
            .from("messages")
            .select("id")
            .eq("conversation_id", parsed.data.conversationId)
            .eq("sender_role", "operator")
            .limit(1);
          if ((existingOp?.length ?? 0) === 0 && listingId) {
            const { data: lst } = await admin.from("listings").select("operator_id").eq("id", listingId).maybeSingle();
            const operatorId = (lst as { operator_id?: string } | null)?.operator_id;
            if (operatorId) {
              const { data: op } = await admin.from("profiles").select("auto_reply_enabled, auto_reply_message").eq("id", operatorId).maybeSingle();
              const autoBody = (op as { auto_reply_enabled?: boolean; auto_reply_message?: string | null } | null);
              if (autoBody?.auto_reply_enabled && autoBody.auto_reply_message?.trim()) {
                await admin.from("messages").insert({
                  conversation_id: parsed.data.conversationId,
                  sender_id: operatorId,
                  sender_role: "operator",
                  body: autoBody.auto_reply_message.trim(),
                  auto: true,
                });
                await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", parsed.data.conversationId);
              }
            }
          }
        } catch (autoErr) {
          console.error("[message-send] auto-reply failed", autoErr);
        }
      }

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
          // Anonymous guests have no auth email — fall back to the contact email
          // they left on a listing_inquiry so they still get the host's reply.
          const to = u?.user?.email || (rr.role === "traveler" ? (convo as { guest_email?: string | null }).guest_email || null : null);
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

  // POST /api/restaurant/summary — a venue manager's own dashboard data. Lists
  // the venues the caller manages, and (for a chosen/first one) returns analytics
  // + voucher performance. Membership is verified here; data is service-role.
  app.post("/api/restaurant/summary", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    const isAdmin = me?.role === "admin";
    const venues = await listManagedVenues(admin, userId);
    // Admins may inspect any venue; managers only their own.
    const requested = typeof req.body?.listingId === "string" ? req.body.listingId : null;
    let selectedId = venues[0]?.id ?? null;
    if (requested) {
      if (isAdmin || venues.some((v) => v.id === requested)) selectedId = requested;
      else return res.status(403).json({ error: "You don't manage that venue." });
    }
    const windowDays = [7, 30, 90].includes(Number(req.body?.windowDays)) ? Number(req.body.windowDays) : 30;
    if (!selectedId) return res.json({ venues, selected: null });
    const summary = await venueSummary(admin, selectedId, windowDays);
    res.json({ venues, selectedId, summary });
  });

  // POST /api/admin-prepaid — admin: manage a restaurant's prepaid balance.
  // actions: topup (pay X for Y face → balance += face), adjust (manual +/- delta),
  // active (enable/disable), threshold (low-balance warning line).
  app.post("/api/admin-prepaid", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });

    const b = (req.body ?? {}) as Record<string, unknown>;
    const listingId = String(b.listingId || "");
    const action = String(b.action || "");
    if (!listingId) return res.status(400).json({ error: "Pick a restaurant." });
    const { data: listing } = await admin.from("listings").select("type").eq("id", listingId).maybeSingle();
    if (!listing || (listing as { type: string }).type !== "eat") return res.status(400).json({ error: "Prepaid balances are for restaurants." });

    // Ensure a row exists.
    await admin.from("restaurant_prepaid").upsert({ listing_id: listingId }, { onConflict: "listing_id", ignoreDuplicates: true });
    const { data: cur } = await admin.from("restaurant_prepaid").select("*").eq("listing_id", listingId).maybeSingle();
    const row = (cur ?? { balance_cents: 0, total_paid_cents: 0, total_face_cents: 0, low_threshold_cents: 0, active: true }) as { balance_cents: number; total_paid_cents: number; total_face_cents: number; low_threshold_cents: number; active: boolean };

    try {
      if (action === "topup") {
        const paid = Math.max(0, Math.round(Number(b.paidCents) || 0));
        const face = Math.max(0, Math.round(Number(b.faceCents) || 0));
        if (face <= 0) return res.status(400).json({ error: "Enter the face credit to add." });
        await admin.from("restaurant_prepaid").update({
          balance_cents: row.balance_cents + face,
          total_paid_cents: row.total_paid_cents + paid,
          total_face_cents: row.total_face_cents + face,
          active: true,
          topup_alerted_at: null, // reset so a future shortfall re-alerts
          updated_at: new Date().toISOString(),
        }).eq("listing_id", listingId);
        await admin.from("restaurant_balance_events").insert({ listing_id: listingId, delta_cents: face, kind: "topup", note: `Top-up — paid ${Math.round(paid / 100)} for ${Math.round(face / 100)} face` });
      } else if (action === "adjust") {
        const delta = Math.round(Number(b.deltaCents) || 0);
        if (!delta) return res.status(400).json({ error: "Enter a non-zero adjustment." });
        await admin.from("restaurant_prepaid").update({ balance_cents: row.balance_cents + delta, updated_at: new Date().toISOString() }).eq("listing_id", listingId);
        await admin.from("restaurant_balance_events").insert({ listing_id: listingId, delta_cents: delta, kind: "adjust", note: String(b.note || "Manual adjustment").slice(0, 200) });
      } else if (action === "active") {
        await admin.from("restaurant_prepaid").update({ active: !!b.active, updated_at: new Date().toISOString() }).eq("listing_id", listingId);
      } else if (action === "threshold") {
        await admin.from("restaurant_prepaid").update({ low_threshold_cents: Math.max(0, Math.round(Number(b.lowThresholdCents) || 0)), updated_at: new Date().toISOString() }).eq("listing_id", listingId);
      } else {
        return res.status(400).json({ error: "Unknown action." });
      }
      const { data: fresh } = await admin.from("restaurant_prepaid").select("*").eq("listing_id", listingId).maybeSingle();
      res.json({ ok: true, prepaid: fresh });
    } catch (err) {
      console.error("[admin-prepaid]", err);
      res.status(500).json({ error: "Couldn't update the balance." });
    }
  });

  // POST /api/admin-link-venue — admin: link/unlink an account (by email) to a
  // restaurant it manages, granting the /venue dashboard for that venue.
  app.post("/api/admin-link-venue", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const listingId = String(req.body?.listingId || "");
    const action = req.body?.action === "unlink" ? "unlink" : "link";
    if (!email || !listingId) return res.status(400).json({ error: "Email and venue are required." });
    const { data: listing } = await admin.from("listings").select("id, type").eq("id", listingId).maybeSingle();
    if (!listing || (listing as { type: string }).type !== "eat") return res.status(400).json({ error: "Pick a restaurant listing." });
    // Resolve the email to a user id (they must have an account).
    let targetId: string | null = null;
    for (let page = 1; page <= 50 && !targetId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const users = data?.users ?? [];
      const hit = users.find((u) => (u.email || "").toLowerCase() === email);
      if (hit) targetId = hit.id;
      if (users.length < 1000) break;
    }
    if (!targetId) return res.status(404).json({ error: "No account with that email — ask them to sign up first." });
    if (action === "unlink") {
      await admin.from("restaurant_managers").delete().eq("listing_id", listingId).eq("user_id", targetId);
      return res.json({ ok: true, linked: false });
    }
    const { error } = await admin.from("restaurant_managers").upsert({ listing_id: listingId, user_id: targetId }, { onConflict: "listing_id,user_id" });
    if (error) return res.status(500).json({ error: "Couldn't link that account." });
    res.json({ ok: true, linked: true });
  });

  // POST /api/admin-users — admin-only searchable/filterable user directory
  // (auth email/phone + profile role/name + listing/booking activity counts).
  app.post("/api/admin-users", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : undefined);
    try {
      const result = await listAdminUsers(admin, {
        userId: str(b.userId),
        email: str(b.email),
        phone: str(b.phone),
        name: str(b.name),
        bookingId: str(b.bookingId),
        role: (["traveler", "operator", "admin"].includes(String(b.role)) ? b.role : "") as "" | "traveler" | "operator" | "admin",
        flag: (["has_listings", "has_bookings", "no_activity"].includes(String(b.flag)) ? b.flag : "") as "" | "has_listings" | "has_bookings" | "no_activity",
        page: typeof b.page === "number" ? b.page : 1,
        pageSize: typeof b.pageSize === "number" ? b.pageSize : 25,
      });
      res.json(result);
    } catch (err) {
      console.error("[admin-users]", err);
      res.status(500).json({ error: "Couldn't load users." });
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
    // Restaurants search the RESTAURANT catalog; places (museums, galleries,
    // wineries, …) are Tripadvisor "attractions".
    const category = String(req.query.category || "").toUpperCase() === "ATTRACTION" ? "ATTRACTION" : "RESTAURANT";
    try {
      const match = await matchTripadvisor(name, geo, category);
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

  // POST /api/voucher/start-checkout — buy a prepaid dining voucher for a specific
  // restaurant (consignment). Signed-in buyer; creates a pending voucher + a
  // PayLink link. Activated (code assigned, buyer emailed) once payment verifies.
  app.post("/api/voucher/start-checkout", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in to buy a voucher." });
    if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });
    if (rateLimited(voucherPurchaseHits, userId, 8)) return res.status(429).json({ error: "You're going a bit fast — give it a few seconds." });
    const parsed = voucherStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    if (!isAllowedVoucherAmount(parsed.data.faceCents)) return res.status(400).json({ error: "Pick one of the available voucher amounts." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Vouchers aren't available right now." });

    const { data: offer } = await admin
      .from("restaurant_voucher_offers")
      .select("active, customer_discount_percent, commission_percent")
      .eq("listing_id", parsed.data.listingId)
      .maybeSingle();
    if (!offer || !offer.active) return res.status(400).json({ error: "This restaurant isn't selling vouchers right now." });
    const { data: listing } = await admin.from("listings").select("title, status").eq("id", parsed.data.listingId).maybeSingle();
    if (!listing || listing.status !== "published") return res.status(404).json({ error: "Restaurant not found." });

    const priceCents = voucherPriceCents(parsed.data.faceCents, offer.customer_discount_percent as number);
    const currency = process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const { data: buyer } = await admin.auth.admin.getUserById(userId);
    try {
      const pay = await registerPayment({
        amount: currency === "AMD" ? Math.round(priceCents / 100) : priceCents / 100,
        currency,
        returnUrl: `${site}/account?voucher=return`,
        info: `Revamp voucher · ${listing.title}`,
      });
      if (!pay.redirectUrl) return res.status(502).json({ error: "Couldn't start checkout." });
      const { error: insErr } = await admin.from("restaurant_vouchers").insert({
        listing_id: parsed.data.listingId,
        status: "pending_payment",
        face_cents: parsed.data.faceCents,
        price_cents: priceCents,
        commission_percent: offer.commission_percent,
        currency,
        purchaser_id: userId,
        purchaser_email: buyer?.user?.email ?? null,
        paylink_request_id: pay.requestId,
      });
      if (insErr) {
        console.error("[voucher/start] insert", insErr.message);
        return res.status(500).json({ error: "Couldn't record your voucher." });
      }
      res.json({ redirectUrl: pay.redirectUrl, priceCents });
    } catch (err) {
      console.error("[voucher/start]", err);
      res.status(502).json({ error: "Couldn't start checkout." });
    }
  });

  // POST /api/voucher/confirm — server-verified activation on the buyer's return.
  app.post("/api/voucher/confirm", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    try {
      const r = await reconcilePurchaserVouchers(admin, userId);
      res.json({ activated: r.activated });
    } catch (err) {
      console.error("[voucher/confirm]", err);
      res.status(500).json({ error: "Couldn't confirm your purchase." });
    }
  });

  // POST /api/voucher/redeem — customer-initiated, single-use in-venue redemption.
  app.post("/api/voucher/redeem", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = voucherRedeemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const r = await redeemVoucher(admin, parsed.data.voucherId, userId);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true });
  });

  // GET /api/voucher/redeem-info — public: resolve a redeem token to its restaurant
  // so the validator page brands itself (name/city) + shows the admin staff note.
  app.get("/api/voucher/redeem-info", async (req: Request, res: Response) => {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing token." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: offer } = await admin.from("restaurant_voucher_offers").select("listing_id, redeem_active, staff_note").eq("redeem_token", token).maybeSingle();
    if (!offer || !offer.redeem_active) return res.status(404).json({ error: "This redemption link isn't active." });
    const { data: listing } = await admin.from("listings").select("title, city, image").eq("id", offer.listing_id).maybeSingle();
    if (!listing) return res.status(404).json({ error: "Restaurant not found." });
    res.json({ restaurantTitle: listing.title, city: listing.city, image: listing.image, staffNote: offer.staff_note ?? null });
  });

  // POST /api/voucher/redeem-staff — restaurant-side redemption (model B). No
  // login: the secret redeem_token (from the per-restaurant validator link) is the
  // credential. Staff enter the code the guest shows; single-use, scoped to the
  // token's restaurant. Rate-limited by IP.
  app.post("/api/voucher/redeem-staff", async (req: Request, res: Response) => {
    if (rateLimited(voucherPurchaseHits, `redeem:${req.ip || "?"}`, 60)) return res.status(429).json({ error: "Too many attempts — wait a moment." });
    const parsed = voucherRedeemStaffSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const r = await redeemVoucherByCode(admin, parsed.data);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, restaurantTitle: r.restaurantTitle, faceCents: r.faceCents, currency: r.currency });
  });

  // POST /api/promo/validate — check an operator promo code for a listing + dates
  // (checkout preview). Returns the discount terms; the actual amount is applied
  // server-side at start-checkout.
  app.post("/api/promo/validate", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = promoValidateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: listing } = await admin.from("listings").select("operator_id, type, status").eq("id", parsed.data.listingId).maybeSingle();
    if (!listing || listing.status !== "published") return res.status(404).json({ error: "Listing not found." });
    const pr = await resolvePromo(admin, {
      listingId: parsed.data.listingId,
      operatorId: listing.operator_id,
      code: parsed.data.code,
      travelerId: userId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      listingType: listing.type,
    });
    if (!pr.ok) return res.status(400).json({ error: pr.error });
    res.json({ ok: true, discountType: pr.promo.discount_type, discountValue: pr.promo.discount_value });
  });

  // POST /api/admin-email/preview — admin-only: how many recipients an audience
  // resolves to (deduped, minus unsubscribes) + a small sample.
  app.post("/api/admin-email/preview", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    if (String(req.body?.channel) === "telegram") {
      const tg = await resolveTelegramRecipients(admin);
      return res.json({ count: tg.length, sample: [] });
    }
    const parsed = emailAudienceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const recipients = await resolveAudience(admin, parsed.data.audience);
    res.json({ count: recipients.length, sample: recipients.slice(0, 5).map((r) => r.email) });
  });

  // POST /api/admin-email/generate — admin-only: AI-draft an email body (Markdown)
  // from a short brief, for the composer to edit.
  app.post("/api/admin-email/generate", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    if (!emailGenConfigured()) return res.status(503).json({ error: "AI drafting isn't available (set ANTHROPIC_API_KEY)." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Describe the email you want." });
    if (rateLimited(ahaCopyHits, `email:${userId}`, 20)) return res.status(429).json({ error: "Give it a few seconds." });
    const body = await generateEmailBody(prompt.slice(0, 1000));
    if (!body) return res.status(502).json({ error: "Couldn't draft that — try again." });
    res.json({ body });
  });

  // POST /api/admin-email/import-contacts — admin-only: parse a pasted/uploaded
  // CSV of {email,name} into the reusable "Imported contacts" list.
  app.post("/api/admin-email/import-contacts", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const csv = String(req.body?.csv || "");
    if (!csv.trim()) return res.status(400).json({ error: "Paste or upload some CSV data." });
    if (csv.length > 5_000_000) return res.status(413).json({ error: "That file is too large (max ~5 MB)." });
    const source = String(req.body?.source || "csv").slice(0, 120);
    const { recipients, skipped } = parseContactsCsv(csv);
    if (recipients.length === 0) return res.status(400).json({ error: `No valid email addresses found${skipped ? ` (${skipped} rows skipped)` : ""}.` });
    const { imported } = await importContacts(admin, recipients, source, userId);
    const { count } = await admin.from("email_contacts").select("email", { count: "exact", head: true });
    res.json({ imported, skipped, total: count ?? imported });
  });

  // POST /api/admin-email/send — admin-only: send a composed email to an audience.
  app.post("/api/admin-email/send", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (me?.role !== "admin") return res.status(403).json({ error: "Admins only." });
    const parsed = emailSendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    // Telegram broadcast: recipients are everyone who linked the bot (opt-in).
    if (parsed.data.channel === "telegram") {
      if (!telegramBroadcastConfigured()) return res.status(503).json({ error: "Telegram isn't configured (set TELEGRAM_BOT_TOKEN)." });
      const tgSite = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
      const { sent, failed, total } = await sendTelegramCampaign(admin, { subject: parsed.data.subject, markdown: parsed.data.body, siteUrl: tgSite });
      if (total === 0) return res.status(400).json({ error: "No one has linked Telegram yet." });
      await admin.from("email_campaigns").insert({
        subject: parsed.data.subject,
        body: parsed.data.body,
        audience: "telegram",
        channel: "telegram",
        recipient_count: total,
        sent_count: sent,
        created_by: userId,
      });
      return res.json({ total, sent, failed });
    }

    if (!marketingConfigured()) return res.status(503).json({ error: "Email isn't configured (set RESEND_API_KEY + EMAIL_FROM)." });
    const recipients = await resolveAudience(admin, parsed.data.audience);
    if (recipients.length === 0) return res.status(400).json({ error: "No recipients in that audience." });
    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const { sent, failed } = await sendCampaign({ subject: parsed.data.subject, markdown: parsed.data.body, recipients, siteUrl: site });
    await admin.from("email_campaigns").insert({
      subject: parsed.data.subject,
      body: parsed.data.body,
      audience: parsed.data.audience,
      channel: "email",
      recipient_count: recipients.length,
      sent_count: sent,
      created_by: userId,
    });
    res.json({ total: recipients.length, sent, failed });
  });

  // GET /api/email/unsubscribe?e=&t= — public one-click unsubscribe. Adds the
  // email to the suppression list; the token stops arbitrary-address abuse.
  app.get("/api/email/unsubscribe", async (req: Request, res: Response) => {
    const email = String(req.query.e || "").trim().toLowerCase();
    const t = String(req.query.t || "");
    const page = (msg: string) =>
      `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F5F2EC;color:#212121;display:grid;place-items:center;min-height:100vh;margin:0;"><div style="max-width:420px;background:#fff;border:1px solid rgba(33,33,33,.1);border-radius:14px;padding:28px;text-align:center;"><p style="font-size:22px;font-weight:700;margin:0 0 10px;">revamp.</p><p style="font-size:15px;line-height:1.6;color:#4a463f;margin:0;">${msg}</p></div></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (!email || !verifyUnsub(email, t)) return res.status(400).send(page("This unsubscribe link is invalid or expired."));
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).send(page("We couldn't process that right now — please try again later."));
    await admin.from("email_optouts").upsert({ email }, { onConflict: "email" });
    res.send(page("You've been unsubscribed. You won't receive marketing emails from Revamp anymore."));
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
    const { id, name, description, amountCents, monthsQuantity, pricingMode, commissionPercent, isActive, sort } = parsed.data;
    const commission = commissionPercent ?? null;
    try {
      // Upsert the plan row first. On an amount/duration change we drop the old
      // PayLink subscription id so it re-registers with the new terms.
      let planId = id;
      if (id) {
        const { data: prev } = await admin.from("subscription_plans").select("amount_cents, months_quantity, paylink_subscription_id").eq("id", id).maybeSingle();
        const termsChanged = prev && (prev.amount_cents !== amountCents || prev.months_quantity !== monthsQuantity);
        const { error } = await admin
          .from("subscription_plans")
          .update({ name, description, amount_cents: amountCents, months_quantity: monthsQuantity, pricing_mode: pricingMode, commission_percent: commission, is_active: isActive, sort, ...(termsChanged ? { paylink_subscription_id: null, request_url: null, paylink_request_id: null } : {}) })
          .eq("id", id);
        if (error) throw new Error(error.message);
      } else {
        const { data: created, error } = await admin
          .from("subscription_plans")
          .insert({ name, description, amount_cents: amountCents, months_quantity: monthsQuantity, pricing_mode: pricingMode, commission_percent: commission, currency, is_active: isActive, sort })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        planId = created.id;
      }

      // Register the plan with PayLink now, so the subscribe link exists before
      // any operator enrolls. Best-effort. NOTE: per_listing plans are NOT
      // registered globally — each operator gets their own subscription at their
      // computed amount at subscribe time, so there's nothing to sync here.
      let paylinkSynced = pricingMode === "per_listing"; // n/a → treated as synced
      let paylinkError: string | null = null;
      if (pricingMode === "per_listing") {
        // nothing to do — see note above
      } else if (!paylinkConfigured()) {
        paylinkError = "PayLink credentials aren't set on the server.";
      } else if (isActive) {
        const { data: planRow } = await admin.from("subscription_plans").select("id, name, description, amount_cents, months_quantity, currency, paylink_subscription_id, paylink_request_id, request_url, is_active").eq("id", planId!).maybeSingle();
        if (planRow) {
          try {
            await ensurePlanRegistered(admin, planRow as PlanRow);
            paylinkSynced = true;
          } catch (e) {
            paylinkError = e instanceof Error ? e.message : String(e);
            console.error("[admin-subscription-plan] PayLink register failed", paylinkError);
          }
        }
      }
      res.json({ ok: true, id: planId, paylinkSynced, paylinkError });
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

  // POST /api/sessions/save-schedule — an operator sets a tour/experience's
  // recurring time-slot schedule + booking mode, then we generate the rolling
  // window of sessions. Ownership-checked; writes are service-role.
  app.post("/api/sessions/save-schedule", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = saveScheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });

    const { data: listing } = await admin.from("listings").select("operator_id, type").eq("id", parsed.data.listingId).maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (listing.operator_id !== userId && me?.role !== "admin") return res.status(403).json({ error: "That's not your listing." });
    if (listing.type !== "tour" && listing.type !== "experience") return res.status(400).json({ error: "Time slots are only for tours and experiences." });

    try {
      const { error } = await admin
        .from("listings")
        .update({ session_schedule: parsed.data.schedule, booking_mode: parsed.data.bookingMode })
        .eq("id", parsed.data.listingId);
      if (error) throw new Error(error.message);
      const gen = parsed.data.schedule ? await syncListingSessions(admin, parsed.data.listingId) : { created: 0 };
      res.json({ ok: true, created: gen.created });
    } catch (err) {
      console.error("[sessions/save-schedule]", err);
      res.status(500).json({ error: "Couldn't save your schedule." });
    }
  });

  // POST /api/aha-listing-copy — Aha writes/improves one listing field (title,
  // short/long description, highlights), tuned to type + SEO + Revamp standards.
  // Operators (and admins) only; rate-limited. Returns { text } or { items }.
  app.post("/api/aha-listing-copy", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    if (!ahaCopyConfigured()) return res.status(503).json({ error: "Aha isn't available right now." });
    if (rateLimited(ahaCopyHits, userId, 30)) return res.status(429).json({ error: "You're going a bit fast — give Aha a few seconds." });
    const parsed = ahaCopySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });

    const admin = supabaseAdmin();
    if (admin) {
      const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      if (me?.role !== "operator" && me?.role !== "admin") return res.status(403).json({ error: "Operators only." });
    }
    try {
      const result = await generateListingCopy(parsed.data);
      if (!result.text && !result.items) return res.status(502).json({ error: "Aha couldn't draft that — try again in a moment." });
      res.json(result);
    } catch (err) {
      console.error("[aha-listing-copy]", err);
      res.status(500).json({ error: "Aha couldn't draft that. Please try again." });
    }
  });

  // POST /api/booking-approve — the operator (or admin) approves a request-to-book
  // slot: registers a PayLink charge, moves it to awaiting_payment, and emails the
  // guest a secure pay link. Seats were already held at request time.
  app.post("/api/booking-approve", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    if (!paylinkConfigured()) return res.status(503).json({ error: "Payments aren't available yet." });
    const parsed = bookingDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });

    const { data: booking } = await admin
      .from("bookings")
      .select("id, listing_id, traveler_id, status, guests, amount_cents, currency, starts_at, guest_email, guest_phone, session_id")
      .eq("id", parsed.data.bookingId)
      .maybeSingle();
    if (!booking) return res.status(404).json({ error: "Request not found." });
    if (booking.status !== "requested") return res.status(400).json({ error: `This request is already ${String(booking.status).replace(/_/g, " ")}.` });

    const { data: listing } = await admin.from("listings").select("title, city, region, slug, operator_id, type, facts, lat, lng").eq("id", booking.listing_id).maybeSingle();
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.operator_id !== userId && me?.role !== "admin") return res.status(403).json({ error: "That's not your listing." });

    const site = (process.env.URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const currency = booking.currency || process.env.PAYLINK_CURRENCY || DEFAULT_CURRENCY;
    try {
      const pay = await registerPayment({
        amount: currency === "AMD" ? Math.round(booking.amount_cents / 100) : booking.amount_cents / 100,
        currency,
        returnUrl: `${site}/account?checkout=return`,
        info: `Revamp booking · ${listing.title}`,
      });
      if (!pay.redirectUrl) return res.status(502).json({ error: "Couldn't create the payment link." });
      const { data: upd } = await admin
        .from("bookings")
        .update({ status: "awaiting_payment", paylink_request_id: pay.requestId, paylink_order_id: pay.orderId })
        .eq("id", booking.id)
        .eq("status", "requested")
        .select("id");
      if (!upd || upd.length === 0) return res.status(409).json({ error: "This request just changed — refresh and try again." });

      await logBookingEvent(admin, booking.id, "status_approved", "Request approved — awaiting guest payment");
      // Email the guest the pay link (best-effort).
      try {
        const info = slotBookingEmailInfo(listing, booking);
        const { data: trav } = await admin.auth.admin.getUserById(booking.traveler_id);
        const to = trav?.user?.email || booking.guest_email;
        if (to) await sendGuestBookingApproved(to, info, pay.redirectUrl);
      } catch (e) {
        console.error("[booking-approve] email failed", e);
      }
      const approveWhen = `${slotBookingEmailInfo(listing, booking).startDate}${booking.starts_at ? ` at ${formatSlotTime(booking.starts_at)}` : ""}`;
      await notifyBooking(admin, {
        bookingId: booking.id,
        listingId: booking.listing_id,
        operatorId: listing.operator_id,
        travelerId: booking.traveler_id,
        travelerPhone: booking.guest_phone,
        inboxBody: `✅ Request approved — ${listing.title}, ${approveWhen}. Complete payment to lock in your seat: ${pay.redirectUrl}`,
        smsBody: `Revamp: your booking for ${listing.title} (${approveWhen}) is approved. Pay to confirm: ${pay.redirectUrl}`,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("[booking-approve]", err);
      res.status(502).json({ error: "Couldn't approve the request." });
    }
  });

  // POST /api/booking-decline — the operator (or admin) declines a request: frees
  // the held seats and emails the guest. No charge was ever made.
  app.post("/api/booking-decline", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) return res.status(401).json({ error: "Sign in." });
    const parsed = bookingDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: issuesToMessage(parsed.error) });
    const admin = supabaseAdmin();
    if (!admin) return res.status(503).json({ error: "Not available right now." });

    const { data: booking } = await admin
      .from("bookings")
      .select("id, listing_id, traveler_id, status, guests, amount_cents, currency, starts_at, guest_email, guest_phone, session_id")
      .eq("id", parsed.data.bookingId)
      .maybeSingle();
    if (!booking) return res.status(404).json({ error: "Request not found." });
    if (booking.status !== "requested") return res.status(400).json({ error: `This request is already ${String(booking.status).replace(/_/g, " ")}.` });

    const { data: listing } = await admin.from("listings").select("title, city, region, slug, operator_id, type, facts, lat, lng").eq("id", booking.listing_id).maybeSingle();
    const { data: me } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.operator_id !== userId && me?.role !== "admin") return res.status(403).json({ error: "That's not your listing." });

    const { data: upd } = await admin.from("bookings").update({ status: "cancelled" }).eq("id", booking.id).eq("status", "requested").select("id");
    if (!upd || upd.length === 0) return res.status(409).json({ error: "This request just changed — refresh and try again." });
    if (booking.session_id) await releaseSeats(admin, booking.session_id, booking.guests);
    await logBookingEvent(admin, booking.id, "status_cancelled", "Request declined by host");
    try {
      const info = slotBookingEmailInfo(listing, booking);
      const { data: trav } = await admin.auth.admin.getUserById(booking.traveler_id);
      const to = trav?.user?.email || booking.guest_email;
      if (to) await sendGuestBookingDeclined(to, info);
    } catch (e) {
      console.error("[booking-decline] email failed", e);
    }
    await notifyBooking(admin, {
      bookingId: booking.id,
      listingId: booking.listing_id,
      operatorId: listing.operator_id,
      travelerId: booking.traveler_id,
      travelerPhone: booking.guest_phone,
      inboxBody: `❌ Booking request declined — ${listing.title}. No charge was made; the seats have been released.`,
      smsBody: `Revamp: unfortunately your booking request for ${listing.title} was declined. No charge was made.`,
    });
    res.json({ ok: true });
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
