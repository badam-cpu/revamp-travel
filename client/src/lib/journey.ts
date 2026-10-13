/**
 * Customer Journey (migration 0097) — the operator's templates, private listing
 * details, review links and survey answers, read/written directly under RLS
 * (operator-own rows). Sending, previews and the guest trip page go through the
 * server (client/src/lib/api.ts → server/journey.ts).
 */
import { supabase } from "@/lib/supabase";
import { rowToTemplate, templateToRow, type JourneyStep, type JourneyTemplate, type JourneyTemplateRow } from "@shared/journey";

/** The operator's saved templates; null when the feature isn't set up yet (pre-0097). */
export async function fetchJourneyTemplates(operatorId: string): Promise<JourneyTemplate[] | null> {
  const { data, error } = await supabase.from("journey_templates").select("*").eq("operator_id", operatorId);
  if (error) {
    console.error("[journey] templates read failed", error.message);
    return null;
  }
  return ((data ?? []) as JourneyTemplateRow[]).map(rowToTemplate);
}

/** Save (create or update) one template; returns it with its id. */
export async function saveJourneyTemplate(operatorId: string, t: JourneyTemplate): Promise<JourneyTemplate> {
  const row = templateToRow(t, operatorId);
  const write = t.id
    ? supabase.from("journey_templates").update(row).eq("id", t.id).select("*").single()
    : supabase.from("journey_templates").insert(row).select("*").single();
  let { data, error } = await write;
  if (error && (error as { code?: string }).code === "23505") {
    // Saved meanwhile (another tab) — update that row instead.
    let q = supabase.from("journey_templates").update(row).eq("operator_id", operatorId).eq("listing_type", t.listingType).eq("step", t.step);
    q = t.listingId ? q.eq("listing_id", t.listingId) : q.is("listing_id", null);
    ({ data, error } = await q.select("*").single());
  }
  if (error || !data) {
    console.error("[journey] template save failed", error?.message);
    throw new Error("Couldn't save this message. Please try again.");
  }
  return rowToTemplate(data as JourneyTemplateRow);
}

/** Remove a per-listing version (the listing goes back to the operator default). */
export async function deleteJourneyTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("journey_templates").delete().eq("id", id);
  if (error) {
    console.error("[journey] template delete failed", error.message);
    throw new Error("Couldn't remove that version. Please try again.");
  }
}

export interface ListingDetails {
  wifi_name: string;
  wifi_password: string;
  door_code: string;
  parking: string;
  host_phone: string;
  notes: string;
}
export const EMPTY_DETAILS: ListingDetails = { wifi_name: "", wifi_password: "", door_code: "", parking: "", host_phone: "", notes: "" };

export async function fetchListingDetails(listingIds: string[]): Promise<Map<string, ListingDetails>> {
  const out = new Map<string, ListingDetails>();
  if (!listingIds.length) return out;
  const { data, error } = await supabase.from("journey_listing_details").select("*").in("listing_id", listingIds);
  if (error) {
    console.error("[journey] details read failed", error.message);
    return out;
  }
  for (const r of (data ?? []) as (ListingDetails & { listing_id: string })[]) {
    out.set(r.listing_id, { wifi_name: r.wifi_name, wifi_password: r.wifi_password, door_code: r.door_code, parking: r.parking, host_phone: r.host_phone, notes: r.notes });
  }
  return out;
}

export async function saveListingDetails(listingId: string, d: ListingDetails): Promise<void> {
  const { error } = await supabase.from("journey_listing_details").upsert({ listing_id: listingId, ...d }, { onConflict: "listing_id" });
  if (error) {
    console.error("[journey] details save failed", error.message);
    throw new Error("Couldn't save these details. Please try again.");
  }
}

export interface JourneySettings {
  tripadvisor_url: string;
  google_review_url: string;
  reply_to_email: string;
}
export async function fetchJourneySettings(operatorId: string): Promise<{ settings: JourneySettings; googlePlaceId: string }> {
  const [{ data: s }, { data: p }] = await Promise.all([
    supabase.from("journey_settings").select("tripadvisor_url, google_review_url, reply_to_email").eq("operator_id", operatorId).maybeSingle(),
    supabase.from("profiles").select("google_place_id").eq("id", operatorId).maybeSingle(),
  ]);
  return {
    settings: (s as JourneySettings | null) ?? { tripadvisor_url: "", google_review_url: "", reply_to_email: "" },
    googlePlaceId: (p as { google_place_id?: string } | null)?.google_place_id ?? "",
  };
}
export async function saveJourneySettings(operatorId: string, s: JourneySettings): Promise<void> {
  const { error } = await supabase.from("journey_settings").upsert({ operator_id: operatorId, ...s }, { onConflict: "operator_id" });
  if (error) {
    console.error("[journey] settings save failed", error.message);
    throw new Error("Couldn't save these settings. Please try again.");
  }
}

export interface SurveyAnswer {
  id: string;
  step: JourneyStep;
  rating: number;
  comment: string;
  createdAt: string;
  bookingId: string;
  guestName: string;
  listingTitle: string;
  startDate: string;
  endDate: string;
}
export async function fetchSurveyAnswers(): Promise<SurveyAnswer[]> {
  const { data, error } = await supabase
    .from("journey_survey_responses")
    .select("id, step, rating, comment, created_at, booking_id, bookings(guest_name, start_date, end_date, listings(title), profiles!traveler_id(display_name))")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[journey] survey read failed", error.message);
    return [];
  }
  type Row = {
    id: string;
    step: JourneyStep;
    rating: number;
    comment: string;
    created_at: string;
    booking_id: string;
    bookings: { guest_name: string | null; start_date: string; end_date: string; listings: { title?: string } | null; profiles: { display_name?: string } | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    step: r.step,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
    bookingId: r.booking_id,
    guestName: r.bookings?.guest_name || r.bookings?.profiles?.display_name || "Guest",
    listingTitle: r.bookings?.listings?.title ?? "",
    startDate: r.bookings?.start_date ?? "",
    endDate: r.bookings?.end_date ?? "",
  }));
}
