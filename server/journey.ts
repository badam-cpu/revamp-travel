/**
 * Customer Journey (migration 0097) — the server half: send a step to a guest,
 * show a booking's schedule, serve the guest's private trip page + survey, and
 * run the automation from the 10-minute reconcile cron.
 *
 * Content rules live in shared/journey.ts (templates, placeholders, timing). A
 * step goes out by email (full message, Resend), a short text with the trip link
 * (SMS/WhatsApp/Viber to opted-in guests + linked Telegram, via notifyBooking),
 * and the booking's inbox thread. Every send is logged in `journey_sends`
 * (automatic sends are claimed first, so two cron runs can't double-send) and in
 * the booking's history.
 *
 * The trip page (/trip/:token) shows only steps that were actually sent, so a
 * door code isn't revealed before the check-in message goes out. Survey answers
 * are private; every respondent sees the operator's Google/Tripadvisor links
 * (no review gating), and 1–3 scores alert the operator at once.
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JOURNEY_STEPS,
  buildJourneyVars,
  googleReviewUrl,
  missingPlaceholders,
  renderTemplate,
  resolveTemplate,
  rowToTemplate,
  stepWindow,
  stepsFor,
  type JourneyChannels,
  type JourneyListingType,
  type JourneyStep,
  type JourneyTemplate,
  type JourneyTemplateRow,
} from "../shared/journey.js";
import { roomUnitLabel } from "../shared/rooms.js";
import { logBookingEvent } from "./bookings.js";
import { notifyBooking } from "./notify.js";
import { sendJourneyEmail, sendSurveyAlert } from "./email.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");
const DAY_MS = 86_400_000;
/** The trip page stays open this long after the stay/experience ends. */
const TRIP_PAGE_DAYS = 30;

export const JOURNEY_BOOKING_COLS =
  "id, listing_id, status, start_date, end_date, starts_at, guests, guest_name, guest_email, guest_phone, traveler_id, room_type_id, room_unit_id, trip_token, booking_group_id";

export interface JourneyBooking {
  id: string;
  listing_id: string;
  status: string;
  start_date: string;
  end_date: string;
  starts_at: string | null;
  guests: number;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  traveler_id: string | null;
  room_type_id: string | null;
  room_unit_id: string | null;
  trip_token: string | null;
  /** Several rooms booked together (0097): the group's first room id. */
  booking_group_id: string | null;
}
export interface JourneyListing {
  id: string;
  title: string;
  type: JourneyListingType;
  slug: string;
  image: string | null;
  city: string | null;
  facts: { label?: string; value?: string }[] | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  operator_id: string;
}
interface Details {
  wifi_name: string;
  wifi_password: string;
  door_code: string;
  parking: string;
  host_phone: string;
  notes: string;
}
interface Settings {
  tripadvisor_url: string;
  google_review_url: string;
  reply_to_email: string;
}

export interface JourneyContext {
  booking: JourneyBooking;
  listing: JourneyListing;
  templates: JourneyTemplate[];
  details: Details | null;
  settings: Settings | null;
  googlePlaceId: string | null;
  hostName: string;
  travelerName: string;
  room: string;
}

const isJourneyType = (t: string): t is JourneyListingType => t === "stay" || t === "tour" || t === "experience";

/** Everything needed to render a booking's journey. Null if it isn't a journey booking. */
export async function loadJourneyContext(admin: SupabaseClient, bookingId: string): Promise<JourneyContext | null> {
  const { data: b, error } = await admin.from("bookings").select(JOURNEY_BOOKING_COLS).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`journey booking read failed: ${error.message}`);
  if (!b) return null;
  const booking = b as unknown as JourneyBooking;
  const { data: l } = await admin
    .from("listings")
    .select("id, title, type, slug, image, city, facts, address, lat, lng, operator_id")
    .eq("id", booking.listing_id)
    .maybeSingle();
  if (!l || !isJourneyType((l as { type: string }).type)) return null;
  const listing = l as unknown as JourneyListing;

  const [tpl, det, set, prof, trav, room] = await Promise.all([
    admin.from("journey_templates").select("*").eq("operator_id", listing.operator_id).or(`listing_id.is.null,listing_id.eq.${listing.id}`),
    admin.from("journey_listing_details").select("*").eq("listing_id", listing.id).maybeSingle(),
    admin.from("journey_settings").select("*").eq("operator_id", listing.operator_id).maybeSingle(),
    admin.from("profiles").select("display_name, business_name, google_place_id").eq("id", listing.operator_id).maybeSingle(),
    booking.traveler_id ? admin.from("profiles").select("display_name").eq("id", booking.traveler_id).maybeSingle() : Promise.resolve({ data: null }),
    booking.room_unit_id ? admin.from("room_units").select("name, room_types(name)").eq("id", booking.room_unit_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (tpl.error) throw new Error(`journey templates read failed: ${tpl.error.message}`);
  const p = prof.data as { display_name?: string; business_name?: string; google_place_id?: string } | null;
  const r = room.data as { name?: string; room_types?: { name?: string } | null } | null;
  let roomLabel = r?.name ? `${r.room_types?.name ? `${r.room_types.name} · ` : ""}${roomUnitLabel(r.name)}` : "";
  // A room group: {room} lists every room still booked ("Deluxe · Room 101, Room 102").
  if (booking.booking_group_id) {
    const { data: members } = await admin
      .from("bookings")
      .select("room_units(name), room_types(name)")
      .eq("booking_group_id", booking.booking_group_id)
      .in("status", ["confirmed", "completed"]);
    const ms = (members ?? []) as unknown as { room_units: { name?: string } | null; room_types: { name?: string } | null }[];
    const names = ms.map((m) => (m.room_units?.name ? roomUnitLabel(m.room_units.name) : "")).filter(Boolean);
    if (names.length > 1) roomLabel = `${ms[0]?.room_types?.name ? `${ms[0].room_types.name} · ` : ""}${names.join(", ")}`;
  }
  return {
    booking,
    listing,
    templates: ((tpl.data ?? []) as JourneyTemplateRow[]).map(rowToTemplate),
    details: (det.data as Details | null) ?? null,
    settings: (set.data as Settings | null) ?? null,
    googlePlaceId: p?.google_place_id ?? null,
    hostName: p?.business_name || p?.display_name || "",
    travelerName: (trav.data as { display_name?: string } | null)?.display_name ?? "",
    room: roomLabel,
  };
}

export function tripLinkFor(token: string | null): string {
  return token ? `${SITE()}/trip/${token}` : "";
}

/** The guest's trip-page token, created on first use. */
export async function ensureTripToken(admin: SupabaseClient, booking: JourneyBooking): Promise<string> {
  if (booking.trip_token) return booking.trip_token;
  const token = crypto.randomBytes(18).toString("base64url");
  await admin.from("bookings").update({ trip_token: token }).eq("id", booking.id).is("trip_token", null);
  const { data } = await admin.from("bookings").select("trip_token").eq("id", booking.id).maybeSingle();
  const saved = (data as { trip_token?: string } | null)?.trip_token ?? token;
  booking.trip_token = saved;
  return saved;
}

export interface RenderedStep {
  template: JourneyTemplate;
  subject: string;
  body: string;
  text: string;
  /** Placeholders the template uses that this booking can't fill (their lines are dropped). */
  missing: string[];
}

export function renderStep(ctx: JourneyContext, step: JourneyStep, template?: JourneyTemplate): RenderedStep {
  const t = template ?? resolveTemplate(ctx.templates, { id: ctx.listing.id, type: ctx.listing.type }, step);
  const vars = buildJourneyVars(
    { ...ctx.booking, traveler_name: ctx.travelerName },
    ctx.listing,
    ctx.details,
    { room: ctx.room, tripLink: tripLinkFor(ctx.booking.trip_token) },
  );
  return {
    template: t,
    subject: renderTemplate(t.subject, vars),
    body: renderTemplate(t.body, vars, { dropEmptyLines: true }),
    text: renderTemplate(t.textBody, vars),
    missing: missingPlaceholders(`${t.subject}\n${t.body}\n${t.textBody}`, vars).filter((k) => k !== "trip_link"),
  };
}

async function guestEmail(admin: SupabaseClient, b: JourneyBooking): Promise<string> {
  if (b.traveler_id) {
    const { data } = await admin.auth.admin.getUserById(b.traveler_id);
    if (data?.user?.email) return data.user.email;
  }
  return b.guest_email ?? "";
}

export type SendResult = { ok: true; channels: string[] } | { ok: false; status: number; error: string };

const SENDABLE = new Set(["confirmed", "completed"]);

/** Send one step to the guest. Automatic sends are claimed first (once per booking + step). */
export async function sendJourneyStep(
  admin: SupabaseClient,
  bookingId: string,
  step: JourneyStep,
  opts: { manual: boolean; channels?: Partial<JourneyChannels>; ctx?: JourneyContext },
): Promise<SendResult> {
  const ctx = opts.ctx ?? (await loadJourneyContext(admin, bookingId));
  if (!ctx) return { ok: false, status: 404, error: "Booking not found." };
  if (!SENDABLE.has(ctx.booking.status)) return { ok: false, status: 400, error: "Only confirmed bookings get journey messages." };
  if (!stepsFor(ctx.listing.type).includes(step)) return { ok: false, status: 400, error: "That message doesn't apply to this listing." };

  // Claim an automatic send before anything goes out (the partial unique index
  // makes a second cron run fail here instead of messaging the guest twice).
  let claimId: string | null = null;
  if (!opts.manual) {
    const { data: claim, error } = await admin.from("journey_sends").insert({ booking_id: bookingId, step, manual: false, status: "sent", channels: [] }).select("id").single();
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, status: 409, error: "Already sent." };
      throw new Error(`journey claim failed: ${error.message}`);
    }
    claimId = (claim as { id: string }).id;
  }

  await ensureTripToken(admin, ctx.booking);
  const r = renderStep(ctx, step);
  const ch: JourneyChannels = { ...r.template.channels, ...(opts.channels ?? {}) };
  const sent: string[] = [];
  const errors: string[] = [];

  if (ch.email) {
    const to = await guestEmail(admin, ctx.booking);
    if (!to) errors.push("no guest email");
    else {
      const res = await sendJourneyEmail(to, {
        subject: r.subject,
        body: r.body,
        ctaLabel: JOURNEY_STEPS[step].cta,
        tripLink: tripLinkFor(ctx.booking.trip_token),
        hostName: ctx.hostName,
        replyTo: ctx.settings?.reply_to_email || undefined,
      });
      if (res.sent) sent.push("email");
      else errors.push(`email ${res.reason ?? "failed"}`);
    }
  }
  if (ch.inbox || ch.text) {
    const extra = await notifyBooking(admin, {
      bookingId,
      listingId: ctx.listing.id,
      operatorId: ctx.listing.operator_id,
      travelerId: ctx.booking.traveler_id,
      travelerPhone: ch.text ? ctx.booking.guest_phone : null,
      inboxBody: ch.inbox ? `${r.subject}\n\n${r.body}` : "",
      smsBody: ch.text && r.text ? r.text : undefined,
      whatsapp: process.env.INFOBIP_WHATSAPP_JOURNEY_TEMPLATE
        ? { templateName: process.env.INFOBIP_WHATSAPP_JOURNEY_TEMPLATE, placeholders: [buildFirstName(ctx), ctx.listing.title, tripLinkFor(ctx.booking.trip_token)] }
        : undefined,
    });
    sent.push(...extra);
  }

  const status = sent.length ? "sent" : "failed";
  const error = errors.length ? errors.join("; ") : sent.length ? null : "No channel could reach the guest.";
  if (claimId) await admin.from("journey_sends").update({ status, channels: sent, error }).eq("id", claimId);
  else await admin.from("journey_sends").insert({ booking_id: bookingId, step, manual: true, status, channels: sent, error });
  const label = JOURNEY_STEPS[step].label;
  await logBookingEvent(admin, bookingId, status === "sent" ? "journey_sent" : "journey_failed", `${label}${opts.manual ? "" : " (automatic)"} — ${sent.length ? sent.join(", ") : error}`);
  return sent.length ? { ok: true, channels: sent } : { ok: false, status: 502, error: error ?? "Couldn't reach the guest." };
}

function buildFirstName(ctx: JourneyContext): string {
  return ((ctx.booking.guest_name || ctx.travelerName || "").trim().split(/\s+/)[0] || "there");
}

// ── Schedule (booking window) ────────────────────────────────────────────────

export interface ScheduleItem {
  step: JourneyStep;
  label: string;
  enabled: boolean;
  applicable: boolean;
  reason?: string;
  dueAt: string;
  latestAt: string;
  sends: { at: string; status: string; manual: boolean; channels: string[] }[];
}

export async function journeySchedule(admin: SupabaseClient, ctx: JourneyContext): Promise<ScheduleItem[]> {
  const { data } = await admin.from("journey_sends").select("step, status, manual, channels, sent_at").eq("booking_id", ctx.booking.id).order("sent_at");
  const sends = (data ?? []) as { step: string; status: string; manual: boolean; channels: string[]; sent_at: string }[];
  return stepsFor(ctx.listing.type).map((step) => {
    const t = resolveTemplate(ctx.templates, { id: ctx.listing.id, type: ctx.listing.type }, step);
    const w = stepWindow(t, ctx.listing.type, ctx.booking);
    return {
      step,
      label: JOURNEY_STEPS[step].label,
      enabled: t.enabled,
      applicable: w.applicable,
      ...(w.reason ? { reason: w.reason } : {}),
      dueAt: new Date(w.dueMs).toISOString(),
      latestAt: new Date(w.latestMs).toISOString(),
      sends: sends.filter((s) => s.step === step).map((s) => ({ at: s.sent_at, status: s.status, manual: s.manual, channels: Array.isArray(s.channels) ? s.channels : [] })),
    };
  });
}

// ── Guest trip page ──────────────────────────────────────────────────────────

export interface TripPage {
  listing: { title: string; type: string; slug: string; image: string | null; city: string | null };
  booking: { startDate: string; endDate: string; startTime: string; guests: number; room: string; status: string };
  guestFirstName: string;
  hostName: string;
  hostPhone: string;
  address: string;
  mapUrl: string;
  messages: { step: JourneyStep; label: string; subject: string; body: string; sentAt: string }[];
  surveys: { step: JourneyStep; label: string; rating: number | null }[];
  reviewLinks: { google: string; tripadvisor: string; revamp: string };
}

/** Find a booking by its trip token; null when unknown or expired. */
export async function bookingIdForToken(admin: SupabaseClient, token: string): Promise<{ id: string; expired: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { data } = await admin.from("bookings").select("id, end_date").eq("trip_token", token).maybeSingle();
  if (!data) return null;
  const d = data as { id: string; end_date: string };
  return { id: d.id, expired: Date.now() > Date.parse(`${d.end_date}T00:00:00Z`) + TRIP_PAGE_DAYS * DAY_MS };
}

async function revampReviewLink(admin: SupabaseClient, b: JourneyBooking): Promise<string> {
  if (!b.traveler_id) return "";
  const { data } = await admin.auth.admin.getUserById(b.traveler_id);
  // Revamp reviews need the guest's own signed-in account (anonymous guest sessions can't).
  if (!data?.user || (data.user as { is_anonymous?: boolean }).is_anonymous || !data.user.email) return "";
  return `${SITE()}/account?tab=trips&review=${encodeURIComponent(b.id)}`;
}

export async function tripPageData(admin: SupabaseClient, ctx: JourneyContext): Promise<TripPage> {
  const [{ data: sendRows }, { data: answers }, revamp] = await Promise.all([
    admin.from("journey_sends").select("step, sent_at").eq("booking_id", ctx.booking.id).eq("status", "sent").order("sent_at"),
    admin.from("journey_survey_responses").select("step, rating").eq("booking_id", ctx.booking.id),
    revampReviewLink(admin, ctx.booking),
  ]);
  const firstSent = new Map<JourneyStep, string>();
  for (const s of (sendRows ?? []) as { step: JourneyStep; sent_at: string }[]) if (!firstSent.has(s.step)) firstSent.set(s.step, s.sent_at);
  const rated = new Map(((answers ?? []) as { step: JourneyStep; rating: number }[]).map((a) => [a.step, a.rating]));

  const steps = stepsFor(ctx.listing.type).filter((s) => firstSent.has(s));
  const messages = steps.map((step) => {
    const r = renderStep(ctx, step);
    return { step, label: JOURNEY_STEPS[step].label, subject: r.subject, body: r.body, sentAt: firstSent.get(step)! };
  });
  const surveys = steps
    .filter((step) => resolveTemplate(ctx.templates, { id: ctx.listing.id, type: ctx.listing.type }, step).survey)
    .map((step) => ({ step, label: JOURNEY_STEPS[step].label, rating: rated.get(step) ?? null }));

  const where = ctx.listing.lat && ctx.listing.lng ? `${ctx.listing.lat},${ctx.listing.lng}` : ctx.listing.address || "";
  return {
    listing: { title: ctx.listing.title, type: ctx.listing.type, slug: ctx.listing.slug, image: ctx.listing.image, city: ctx.listing.city },
    booking: {
      startDate: ctx.booking.start_date,
      endDate: ctx.booking.end_date,
      startTime: buildJourneyVars(ctx.booking, ctx.listing, null).start_time,
      guests: ctx.booking.guests,
      room: ctx.room,
      status: ctx.booking.status,
    },
    guestFirstName: buildFirstName(ctx),
    hostName: ctx.hostName,
    // Contact + address are only shown once a message has gone out.
    hostPhone: messages.length ? ctx.details?.host_phone ?? "" : "",
    address: messages.length ? ctx.listing.address ?? "" : "",
    mapUrl: messages.length && where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` : "",
    messages,
    surveys,
    reviewLinks: {
      google: ctx.settings?.google_review_url || googleReviewUrl(ctx.googlePlaceId),
      tripadvisor: ctx.settings?.tripadvisor_url ?? "",
      revamp,
    },
  };
}

export type SurveyResult = { ok: true; rating: number; low: boolean } | { ok: false; status: number; error: string };

/** Save a guest's survey answer; 1–3 alerts the operator at once. */
export async function submitSurvey(admin: SupabaseClient, ctx: JourneyContext, step: JourneyStep, rating: number, comment: string): Promise<SurveyResult> {
  if (step !== "midstay" && step !== "after") return { ok: false, status: 400, error: "That isn't a survey." };
  const r = Math.round(rating);
  if (!(r >= 1 && r <= 5)) return { ok: false, status: 400, error: "Pick 1 to 5 stars." };
  const t = resolveTemplate(ctx.templates, { id: ctx.listing.id, type: ctx.listing.type }, step);
  const { data: sentRow } = await admin.from("journey_sends").select("id").eq("booking_id", ctx.booking.id).eq("step", step).eq("status", "sent").limit(1);
  if (!t.survey || !sentRow?.length) return { ok: false, status: 400, error: "This survey isn't open." };

  const text = comment.trim().slice(0, 2000);
  const { error } = await admin.from("journey_survey_responses").insert({ booking_id: ctx.booking.id, step, rating: r, comment: text });
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, status: 409, error: "Thanks — we already have your answer." };
    throw new Error(`survey insert failed: ${error.message}`);
  }
  const low = r <= 3;
  await logBookingEvent(admin, ctx.booking.id, low ? "survey_low" : "survey_answered", `${JOURNEY_STEPS[step].label}: ${r}/5${text ? ` — “${text.slice(0, 140)}”` : ""}`);
  if (low) {
    const { data } = await admin.auth.admin.getUserById(ctx.listing.operator_id);
    const to = data?.user?.email;
    if (to) {
      await sendSurveyAlert(to, {
        listingTitle: ctx.listing.title,
        guestName: ctx.booking.guest_name || ctx.travelerName || "A guest",
        rating: r,
        comment: text,
        stepLabel: JOURNEY_STEPS[step].label,
        startDate: ctx.booking.start_date,
        endDate: ctx.booking.end_date,
      }).catch((e) => console.error("[journey] survey alert failed", e));
    }
  }
  return { ok: true, rating: r, low };
}

// ── Automation (10-minute cron) ──────────────────────────────────────────────

/**
 * Send every enabled step that's due. Only operators with at least one enabled
 * template are scanned; bookings from 31 days ahead (the longest offset) to 5
 * days past their end. Tolerates a pre-0097 database.
 */
export async function runJourneyAutomations(admin: SupabaseClient, now = Date.now(), maxSends = 60): Promise<{ sent: number; failed: number; checked: number }> {
  const { data: enabled, error } = await admin.from("journey_templates").select("operator_id").eq("enabled", true);
  if (error || !enabled?.length) return { sent: 0, failed: 0, checked: 0 };
  const operators = Array.from(new Set((enabled as { operator_id: string }[]).map((r) => r.operator_id)));

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const { data: rows, error: bErr } = await admin
    .from("bookings")
    .select(`${JOURNEY_BOOKING_COLS}, listings!inner(operator_id, type)`)
    .in("status", ["confirmed", "completed"])
    .in("listings.operator_id", operators)
    .lte("start_date", iso(now + 31 * DAY_MS))
    .gte("end_date", iso(now - 5 * DAY_MS))
    .limit(1000);
  if (bErr) {
    console.error("[journey] bookings read failed", bErr.message);
    return { sent: 0, failed: 0, checked: 0 };
  }
  const all = (rows ?? []) as unknown as (JourneyBooking & { listings: { operator_id: string; type: string } })[];
  // Rooms booked together get the journey once: on the group's lead room (the
  // first room, or — if that one was cancelled — the next one still booked).
  const lead = new Map<string, string>();
  for (const b of [...all].sort((x, y) => (x.id === x.booking_group_id ? -1 : y.id === y.booking_group_id ? 1 : x.id.localeCompare(y.id)))) {
    if (b.booking_group_id && !lead.has(b.booking_group_id)) lead.set(b.booking_group_id, b.id);
  }
  const bookings = all.filter((b) => !b.booking_group_id || lead.get(b.booking_group_id) === b.id);
  if (!bookings.length) return { sent: 0, failed: 0, checked: 0 };

  const { data: sentRows } = await admin.from("journey_sends").select("booking_id, step").eq("manual", false).in("booking_id", bookings.map((b) => b.id));
  const done = new Set(((sentRows ?? []) as { booking_id: string; step: string }[]).map((s) => `${s.booking_id}:${s.step}`));
  const { data: tplRows } = await admin.from("journey_templates").select("*").in("operator_id", operators);
  const byOperator = new Map<string, JourneyTemplate[]>();
  for (const r of (tplRows ?? []) as (JourneyTemplateRow & { operator_id: string })[]) {
    const arr = byOperator.get(r.operator_id) ?? [];
    arr.push(rowToTemplate(r));
    byOperator.set(r.operator_id, arr);
  }

  let sent = 0;
  let failed = 0;
  for (const b of bookings) {
    if (sent + failed >= maxSends) break;
    const type = b.listings.type;
    if (!isJourneyType(type)) continue;
    const templates = byOperator.get(b.listings.operator_id) ?? [];
    for (const step of stepsFor(type)) {
      if (done.has(`${b.id}:${step}`)) continue;
      const t = resolveTemplate(templates, { id: b.listing_id, type }, step);
      if (!t.enabled) continue;
      const w = stepWindow(t, type, b);
      if (!w.applicable || now < w.dueMs || now > w.latestMs) continue;
      if (step === "after" && b.status !== "confirmed" && b.status !== "completed") continue;
      try {
        const r = await sendJourneyStep(admin, b.id, step, { manual: false });
        if (r.ok) sent++;
        else if (r.status !== 409) failed++;
      } catch (err) {
        failed++;
        console.error("[journey] automatic send failed", b.id, step, err);
      }
    }
  }
  return { sent, failed, checked: bookings.length };
}

/** Operators whose "Thank you" step is on for a listing — the Revamp review email then folds into it. */
export async function afterStepEnabledFor(admin: SupabaseClient, listings: { id: string; operator_id: string; type: string }[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ops = Array.from(new Set(listings.map((l) => l.operator_id)));
  if (!ops.length) return out;
  const { data, error } = await admin.from("journey_templates").select("*").in("operator_id", ops).eq("step", "after");
  if (error || !data?.length) return out;
  const rows = (data as (JourneyTemplateRow & { operator_id: string })[]).map((r) => ({ ...rowToTemplate(r), operatorId: r.operator_id }));
  for (const l of listings) {
    if (!isJourneyType(l.type)) continue;
    const t = resolveTemplate(rows.filter((r) => r.operatorId === l.operator_id), { id: l.id, type: l.type }, "after");
    if (t.enabled) out.add(l.id);
  }
  return out;
}
