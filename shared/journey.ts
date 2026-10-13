/**
 * Customer Journey (migration 0097) — the pure, shared half: the step catalogue,
 * Revamp's ready-made templates, placeholders, rendering and timing. No I/O, so
 * the dashboard editor (preview), the server (sending + the automation cron) and
 * tests all use the same rules.
 *
 * Steps:
 *   stays              checkin · midstay · checkout · after
 *   tours/experiences  meeting · after
 * Each step is anchored to the booking's start (check-in / experience day) or
 * end (checkout; for tours the experience day itself), then offset by whole days
 * to a local Armenia wall-clock time (UTC+4, no DST — shared/sessions.ts).
 */
import { ARMENIA_UTC_OFFSET_HOURS } from "./sessions.js";

export type JourneyStep = "checkin" | "midstay" | "checkout" | "meeting" | "after";
export type JourneyListingType = "stay" | "tour" | "experience";

export interface JourneyTiming {
  /** Whole days from the step's anchor date (negative = before). */
  offsetDays: number;
  /** Local Armenia time, "HH:MM". */
  at: string;
}
export interface JourneyChannels {
  email: boolean;
  /** Short text with the trip link: SMS / WhatsApp / Viber (opted-in guests) + Telegram. */
  text: boolean;
  /** The booking's message thread in the Revamp inbox. */
  inbox: boolean;
}

export interface JourneyTemplate {
  id?: string;
  listingType: JourneyListingType;
  /** null = the operator's default for this listing type. */
  listingId: string | null;
  step: JourneyStep;
  enabled: boolean;
  subject: string;
  body: string;
  textBody: string;
  timing: JourneyTiming;
  channels: JourneyChannels;
  survey: boolean;
  /** Mid-stay only: skip stays shorter than this many nights. */
  minNights: number;
  /** True when this came from Revamp's built-in defaults (nothing saved yet). */
  isDefault?: boolean;
}

interface StepMeta {
  label: string;
  hint: string;
  anchor: "start" | "end";
  types: JourneyListingType[];
  surveyAllowed: boolean;
  /** Email button label (the trip page). */
  cta: string;
}

export const JOURNEY_STEPS: Record<JourneyStep, StepMeta> = {
  checkin: { label: "Check-in instructions", hint: "Address, check-in time, Wi-Fi and how to get in.", anchor: "start", types: ["stay"], surveyAllowed: false, cta: "Open your check-in details" },
  midstay: { label: "Mid-stay check-in", hint: "A quick “is everything OK?” — fix problems while the guest is still there.", anchor: "start", types: ["stay"], surveyAllowed: true, cta: "Tell us how it's going" },
  checkout: { label: "Checkout instructions", hint: "Checkout time and what to do before leaving.", anchor: "end", types: ["stay"], surveyAllowed: false, cta: "Open your checkout details" },
  meeting: { label: "Meeting-point instructions", hint: "Where and when to meet, what to bring.", anchor: "start", types: ["tour", "experience"], surveyAllowed: false, cta: "Open your meeting details" },
  after: { label: "Thank you", hint: "Thank the guest and ask how it went.", anchor: "end", types: ["stay", "tour", "experience"], surveyAllowed: true, cta: "Rate your experience" },
};

export function stepsFor(type: JourneyListingType): JourneyStep[] {
  return type === "stay" ? ["checkin", "midstay", "checkout", "after"] : ["meeting", "after"];
}

export const DEFAULT_TIMING: Record<JourneyStep, JourneyTiming> = {
  checkin: { offsetDays: -2, at: "10:00" },
  midstay: { offsetDays: 1, at: "11:00" },
  checkout: { offsetDays: -1, at: "18:00" },
  meeting: { offsetDays: -1, at: "10:00" },
  after: { offsetDays: 1, at: "11:00" },
};

const ALL_ON: JourneyChannels = { email: true, text: true, inbox: true };

const COPY: Record<"stay" | "activity", Partial<Record<JourneyStep, { subject: string; body: string; textBody: string }>>> = {
  stay: {
    checkin: {
      subject: "Your check-in details for {listing}",
      body: [
        "Hi {guest_first_name},",
        "",
        "We're looking forward to welcoming you on **{check_in_date}**.",
        "",
        "**Check-in:** from {check_in_time}",
        "**Address:** {address}",
        "**Room:** {room}",
        "**Wi-Fi network:** {wifi_name}",
        "**Wi-Fi password:** {wifi_password}",
        "**Door code:** {door_code}",
        "**Parking:** {parking}",
        "",
        "If anything comes up on the way, call or message us at {host_phone}.",
        "",
        "See you soon!",
      ].join("\n"),
      textBody: "Hi {guest_first_name}, your check-in details for {listing}: {trip_link}",
    },
    midstay: {
      subject: "How's your stay at {listing}?",
      body: [
        "Hi {guest_first_name},",
        "",
        "We hope you're settling in well. Is everything as it should be?",
        "",
        "Let us know in one tap — if anything isn't right, we'd like to fix it while you're still here.",
        "",
        "You can also reach us any time at {host_phone}.",
      ].join("\n"),
      textBody: "Hi {guest_first_name}, how's your stay at {listing}? Tell us in one tap: {trip_link}",
    },
    checkout: {
      subject: "Checkout tomorrow — {listing}",
      body: [
        "Hi {guest_first_name},",
        "",
        "A quick reminder that checkout is tomorrow, **{check_out_date}**, by **{checkout_time}**.",
        "",
        "Before you go:",
        "• Leave the keys where you found them",
        "• Close the windows and switch off the lights and air conditioning",
        "• Check you have all your belongings",
        "",
        "Need a later checkout or a taxi? Message us at {host_phone}.",
        "",
        "Thank you for staying with us!",
      ].join("\n"),
      textBody: "Hi {guest_first_name}, a reminder that checkout from {listing} is tomorrow. Details: {trip_link}",
    },
    after: {
      subject: "Thank you for staying at {listing}",
      body: [
        "Hi {guest_first_name},",
        "",
        "Thank you for staying with us — we hope you had a wonderful time in Armenia.",
        "",
        "We'd love to hear how it went. It takes a few seconds and helps us keep getting better.",
        "",
        "Safe travels, and we hope to welcome you back!",
      ].join("\n"),
      textBody: "Thank you for staying at {listing}, {guest_first_name}! How was it? {trip_link}",
    },
  },
  activity: {
    meeting: {
      subject: "Meeting details for {listing} on {start_date}",
      body: [
        "Hi {guest_first_name},",
        "",
        "We're excited to see you on **{start_date}** at **{start_time}**.",
        "",
        "**Meeting point:** {meeting_point}",
        "**Address:** {address}",
        "",
        "Please arrive 10 minutes early, with comfortable shoes and water.",
        "",
        "Running late or can't find us? Call {host_phone}.",
        "",
        "See you there!",
      ].join("\n"),
      textBody: "Hi {guest_first_name}, meeting details for {listing} on {start_date}: {trip_link}",
    },
    after: {
      subject: "Thank you for joining {listing}",
      body: [
        "Hi {guest_first_name},",
        "",
        "Thank you for joining us — we hope you enjoyed it as much as we did.",
        "",
        "We'd love to hear how it went. It takes a few seconds and helps us keep getting better.",
        "",
        "Hope to see you again!",
      ].join("\n"),
      textBody: "Thank you for joining {listing}, {guest_first_name}! How was it? {trip_link}",
    },
  },
};

/** Revamp's ready-made template for a step — always disabled until the operator switches it on. */
export function defaultTemplate(listingType: JourneyListingType, step: JourneyStep, listingId: string | null = null): JourneyTemplate {
  const copy = COPY[listingType === "stay" ? "stay" : "activity"][step] ?? { subject: "", body: "", textBody: "" };
  return {
    listingType,
    listingId,
    step,
    enabled: false,
    ...copy,
    timing: { ...DEFAULT_TIMING[step] },
    channels: { ...ALL_ON },
    survey: JOURNEY_STEPS[step].surveyAllowed,
    minNights: step === "midstay" ? 3 : 0,
    isDefault: true,
  };
}

// ── Placeholders ─────────────────────────────────────────────────────────────

export interface Placeholder {
  key: string;
  label: string;
  types: JourneyListingType[];
}
const BOTH: JourneyListingType[] = ["stay", "tour", "experience"];
const STAY: JourneyListingType[] = ["stay"];
const ACT: JourneyListingType[] = ["tour", "experience"];

export const PLACEHOLDERS: Placeholder[] = [
  { key: "guest_first_name", label: "Guest first name", types: BOTH },
  { key: "listing", label: "Listing name", types: BOTH },
  { key: "check_in_date", label: "Check-in date", types: STAY },
  { key: "check_out_date", label: "Checkout date", types: STAY },
  { key: "check_in_time", label: "Check-in time", types: STAY },
  { key: "checkout_time", label: "Checkout time", types: STAY },
  { key: "room", label: "Room", types: STAY },
  { key: "start_date", label: "Date", types: ACT },
  { key: "start_time", label: "Start time", types: ACT },
  { key: "meeting_point", label: "Meeting point", types: ACT },
  { key: "address", label: "Address", types: BOTH },
  { key: "wifi_name", label: "Wi-Fi network", types: STAY },
  { key: "wifi_password", label: "Wi-Fi password", types: STAY },
  { key: "door_code", label: "Door code", types: STAY },
  { key: "parking", label: "Parking", types: BOTH },
  { key: "host_phone", label: "Your phone", types: BOTH },
  { key: "trip_link", label: "Trip page link", types: BOTH },
];

export type JourneyVars = Record<string, string>;

const TOKEN = /\{([a-z_]+)\}/g;

/**
 * Fill placeholders. In multi-line bodies (`dropEmptyLines`), a line whose
 * placeholder has no value is removed entirely — so "**Door code:** {door_code}"
 * simply disappears for a listing without one — and runs of blank lines collapse.
 * Single-line texts just drop the empty value.
 */
export function renderTemplate(text: string, vars: JourneyVars, { dropEmptyLines = false }: { dropEmptyLines?: boolean } = {}): string {
  const fill = (line: string) => line.replace(TOKEN, (_, k: string) => (vars[k] ?? "").trim());
  if (!dropEmptyLines) return fill(text).replace(/[ \t]{2,}/g, " ").trim();
  const lines = text.split("\n").filter((line) => {
    const keys = Array.from(line.matchAll(TOKEN), (m) => m[1]);
    return keys.every((k) => (vars[k] ?? "").trim() !== "");
  });
  return lines
    .map(fill)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Placeholders a template uses that this booking can't fill (shown as a hint in previews). */
export function missingPlaceholders(text: string, vars: JourneyVars): string[] {
  return Array.from(new Set(Array.from(text.matchAll(TOKEN), (m) => m[1]).filter((k) => !(vars[k] ?? "").trim())));
}

// ── Values for one booking ───────────────────────────────────────────────────

export interface JourneyBookingInput {
  start_date: string;
  end_date: string;
  starts_at?: string | null;
  guest_name?: string | null;
  traveler_name?: string | null;
}
export interface JourneyListingInput {
  title: string;
  type: string;
  facts?: { label?: string; value?: string }[] | null;
  address?: string | null;
}
export interface JourneyDetailsInput {
  wifi_name?: string;
  wifi_password?: string;
  door_code?: string;
  parking?: string;
  host_phone?: string;
}

const prettyDate = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";

function localTime(iso: string): string {
  const d = new Date(Date.parse(iso) + ARMENIA_UTC_OFFSET_HOURS * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function buildJourneyVars(b: JourneyBookingInput, l: JourneyListingInput, d: JourneyDetailsInput | null, extra: { room?: string; tripLink?: string } = {}): JourneyVars {
  const facts = Array.isArray(l.facts) ? l.facts : [];
  const fact = (...labels: string[]) => facts.find((f) => labels.includes((f.label ?? "").toLowerCase().trim()))?.value?.trim() ?? "";
  const name = (b.guest_name || b.traveler_name || "").trim();
  return {
    guest_first_name: name.split(/\s+/)[0] || "there",
    listing: l.title,
    check_in_date: prettyDate(b.start_date),
    check_out_date: prettyDate(b.end_date),
    check_in_time: fact("check-in", "checkin", "check in"),
    checkout_time: fact("checkout", "check-out", "check out"),
    room: extra.room ?? "",
    start_date: prettyDate(b.start_date),
    start_time: b.starts_at ? localTime(b.starts_at) : "",
    meeting_point: fact("meeting point", "starting point", "start"),
    address: (l.address ?? "").trim(),
    wifi_name: d?.wifi_name?.trim() ?? "",
    wifi_password: d?.wifi_password?.trim() ?? "",
    door_code: d?.door_code?.trim() ?? "",
    parking: d?.parking?.trim() ?? "",
    host_phone: d?.host_phone?.trim() ?? "",
    trip_link: extra.tripLink ?? "",
  };
}

/** Sample values for previews in the editor. */
export function sampleVars(type: JourneyListingType, listingTitle = "Your listing"): JourneyVars {
  return {
    guest_first_name: "Anna",
    listing: listingTitle,
    check_in_date: "Fri, 14 Nov",
    check_out_date: "Mon, 17 Nov",
    check_in_time: "15:00",
    checkout_time: "11:00",
    room: type === "stay" ? "Deluxe king · Room 101" : "",
    start_date: "Fri, 14 Nov",
    start_time: "10:00",
    meeting_point: "Republic Square, by the fountains",
    address: "12 Abovyan St, Yerevan",
    wifi_name: "Revamp-Guest",
    wifi_password: "welcome2026",
    door_code: "4821#",
    parking: "Free street parking out front",
    host_phone: "+374 99 000000",
    trip_link: "revampvacations.com/trip/…",
  };
}

/**
 * Preview values for a real listing: its own details (left EMPTY where it has
 * none, so those lines drop exactly as they will for guests) + sample values
 * for the booking-specific parts (guest name, dates, trip link).
 */
export function listingPreviewVars(type: JourneyListingType, listing: JourneyListingInput & { multiRoom?: boolean }, details: JourneyDetailsInput | null): JourneyVars {
  const sample = sampleVars(type, listing.title);
  const real = buildJourneyVars({ start_date: "2026-11-14", end_date: "2026-11-17", guest_name: "Anna" }, listing, details);
  return {
    ...sample,
    listing: real.listing,
    check_in_time: real.check_in_time,
    checkout_time: real.checkout_time,
    meeting_point: real.meeting_point,
    address: real.address,
    wifi_name: real.wifi_name,
    wifi_password: real.wifi_password,
    door_code: real.door_code,
    parking: real.parking,
    host_phone: real.host_phone,
    room: listing.multiRoom ? sample.room : "",
  };
}

// ── Templates: resolution + DB mapping ───────────────────────────────────────

/** The template a booking uses: the listing's own, else the operator default, else Revamp's (off). */
export function resolveTemplate(rows: JourneyTemplate[], listing: { id: string; type: JourneyListingType }, step: JourneyStep): JourneyTemplate {
  return (
    rows.find((r) => r.step === step && r.listingId === listing.id) ??
    rows.find((r) => r.step === step && r.listingId === null && r.listingType === listing.type) ??
    defaultTemplate(listing.type, step)
  );
}

export interface JourneyTemplateRow {
  id: string;
  listing_type: JourneyListingType;
  listing_id: string | null;
  step: JourneyStep;
  enabled: boolean;
  subject: string;
  body: string;
  text_body: string;
  timing: Partial<JourneyTiming> | null;
  channels: Partial<JourneyChannels> | null;
  survey: boolean;
  min_nights: number;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function rowToTemplate(r: JourneyTemplateRow): JourneyTemplate {
  const t = r.timing ?? {};
  const c = r.channels ?? {};
  return {
    id: r.id,
    listingType: r.listing_type,
    listingId: r.listing_id,
    step: r.step,
    enabled: r.enabled,
    subject: r.subject,
    body: r.body,
    textBody: r.text_body,
    timing: {
      offsetDays: Number.isFinite(t.offsetDays) ? Math.round(t.offsetDays as number) : DEFAULT_TIMING[r.step].offsetDays,
      at: typeof t.at === "string" && HHMM.test(t.at) ? t.at : DEFAULT_TIMING[r.step].at,
    },
    channels: { email: c.email !== false, text: c.text !== false, inbox: c.inbox !== false },
    survey: JOURNEY_STEPS[r.step].surveyAllowed && r.survey,
    minNights: r.min_nights ?? 0,
  };
}

export function templateToRow(t: JourneyTemplate, operatorId: string): Omit<JourneyTemplateRow, "id"> & { operator_id: string } {
  return {
    operator_id: operatorId,
    listing_type: t.listingType,
    listing_id: t.listingId,
    step: t.step,
    enabled: t.enabled,
    subject: t.subject.slice(0, 200),
    body: t.body.slice(0, 6000),
    text_body: t.textBody.slice(0, 480),
    timing: { offsetDays: Math.max(-30, Math.min(30, Math.round(t.timing.offsetDays))), at: HHMM.test(t.timing.at) ? t.timing.at : DEFAULT_TIMING[t.step].at },
    channels: t.channels,
    survey: JOURNEY_STEPS[t.step].surveyAllowed && t.survey,
    min_nights: Math.max(0, Math.round(t.minNights)),
  };
}

// ── Timing ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** UTC instant of a local Armenia date + "HH:MM". */
export function armeniaInstant(dateIso: string, hhmm: string): number {
  return Date.parse(`${dateIso}T${hhmm}:00Z`) - ARMENIA_UTC_OFFSET_HOURS * 3_600_000;
}

/** The date a step counts from: check-in/checkout for stays, the experience day for tours. */
export function anchorDate(step: JourneyStep, listingType: string, b: { start_date: string; end_date: string }): string {
  if (listingType !== "stay") return b.start_date;
  return JOURNEY_STEPS[step].anchor === "end" ? b.end_date : b.start_date;
}

export interface StepWindow {
  /** False when the step doesn't apply to this booking (e.g. a short stay for mid-stay). */
  applicable: boolean;
  reason?: string;
  dueMs: number;
  /** After this, an automatic send is skipped — the message would arrive too late. */
  latestMs: number;
}

/**
 * When an automatic step is due, and until when it still makes sense. A booking
 * made after the due time (e.g. a same-day booking) still gets the step at once,
 * as long as it's before `latestMs`.
 */
export function stepWindow(t: Pick<JourneyTemplate, "step" | "timing" | "minNights">, listingType: string, b: { start_date: string; end_date: string }): StepWindow {
  const dueMs = armeniaInstant(addDays(anchorDate(t.step, listingType, b), t.timing.offsetDays), t.timing.at);
  const nights = Math.round((Date.parse(`${b.end_date}T00:00:00Z`) - Date.parse(`${b.start_date}T00:00:00Z`)) / DAY_MS);
  switch (t.step) {
    case "checkin":
    case "meeting":
      // Useful until the end of the arrival / experience day.
      return { applicable: true, dueMs, latestMs: armeniaInstant(b.start_date, "23:59") };
    case "midstay": {
      const min = Math.max(2, t.minNights || 0);
      if (nights < min) return { applicable: false, reason: `Stays under ${min} nights`, dueMs, latestMs: dueMs };
      const latestMs = armeniaInstant(b.end_date, "09:00"); // not on/after the checkout morning
      if (dueMs >= latestMs) return { applicable: false, reason: "Falls after checkout", dueMs, latestMs };
      return { applicable: true, dueMs, latestMs };
    }
    case "checkout":
      return { applicable: true, dueMs, latestMs: armeniaInstant(b.end_date, "12:00") };
    case "after":
      return { applicable: true, dueMs, latestMs: dueMs + 3 * DAY_MS };
  }
}

/** Google "write a review" link for a Place ID. */
export function googleReviewUrl(placeId: string | null | undefined): string {
  const id = (placeId ?? "").trim();
  return id ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}` : "";
}

// ── Review sites (where guests are invited to review, after the survey) ──────
//
// Only sites where ANY guest may review. Airbnb / Booking.com / GetYourGuide /
// Viator reviews require a booking made through them, and Yelp forbids asking
// for reviews, so they're not offered. Every survey respondent sees these
// buttons regardless of score (no review gating).

export type ReviewPlatform = "google" | "tripadvisor" | "trustpilot" | "facebook" | "other";
export interface ReviewLink {
  platform: ReviewPlatform;
  url: string;
  /** Button name for "other" (e.g. "Yell.am"). */
  label?: string;
}

export const REVIEW_PLATFORMS: Record<ReviewPlatform, { name: string; hosts: RegExp | null; hint: string }> = {
  google: { name: "Google", hosts: /(^|\.)(google\.[a-z.]+|g\.page|goo\.gl|maps\.app\.goo\.gl)$/i, hint: "Your Google Business “Ask for reviews” link (g.page/r/…/review)" },
  tripadvisor: { name: "Tripadvisor", hosts: /(^|\.)tripadvisor\.[a-z.]+$/i, hint: "Your Tripadvisor “Write a review” link" },
  trustpilot: { name: "Trustpilot", hosts: /(^|\.)trustpilot\.com$/i, hint: "trustpilot.com/evaluate/your-domain" },
  facebook: { name: "Facebook", hosts: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i, hint: "Your Facebook page's Reviews tab" },
  other: { name: "Other site", hosts: null, hint: "Any review page where all guests may post" },
};
export const MAX_REVIEW_LINKS = 5;

/** Why a review link can't be saved, or null when it's fine. */
export function reviewLinkProblem(l: ReviewLink): string | null {
  const meta = REVIEW_PLATFORMS[l.platform];
  if (!meta) return "Pick a review site.";
  let u: URL;
  try {
    u = new URL(l.url.trim());
  } catch {
    return `${meta.name}: enter the full link, starting with https://`;
  }
  if (u.protocol !== "https:") return `${meta.name}: the link must start with https://`;
  if (meta.hosts && !meta.hosts.test(u.hostname)) return `That doesn't look like a ${meta.name} link.`;
  if (l.platform === "other" && !(l.label ?? "").trim()) return "Name the site for the “Other” link.";
  return null;
}

/** The buttons a guest sees: the operator's list (in their order), else the legacy fields, plus Google from the Place ID if not listed. */
export function resolveReviewButtons(
  s: { review_links?: unknown; google_review_url?: string; tripadvisor_url?: string } | null,
  googlePlaceId: string | null,
): { label: string; url: string }[] {
  const list = (Array.isArray(s?.review_links) ? (s!.review_links as ReviewLink[]) : []).filter((l) => l && !reviewLinkProblem(l));
  const out = list.map((l) => ({ label: l.platform === "other" ? (l.label ?? "").trim() : REVIEW_PLATFORMS[l.platform].name, url: l.url.trim() }));
  if (!list.length) {
    if (s?.google_review_url) out.push({ label: "Google", url: s.google_review_url });
    if (s?.tripadvisor_url) out.push({ label: "Tripadvisor", url: s.tripadvisor_url });
  }
  const auto = googleReviewUrl(googlePlaceId);
  if (auto && !out.some((b) => b.label === "Google")) out.unshift({ label: "Google", url: auto });
  return out.slice(0, MAX_REVIEW_LINKS + 1);
}
