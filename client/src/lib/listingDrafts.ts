/**
 * "Save and continue later" for new listings (migration 0115). Unfinished
 * Add-a-stay/tour forms and experience wizards are kept in `listing_drafts`
 * (operator-private RLS) as JSON + the step reached — never as a listing row,
 * which must be complete. Saved automatically while the operator works and on
 * "Save & exit"; deleted once the real listing is created.
 *
 * Every function throws on failure; callers keep the message calm (the details
 * go to the console). Before 0115 the table is missing: listing returns [].
 */
import { supabase } from "@/lib/supabase";
import type { ListingType } from "@shared/listings";

export type DraftListingType = Extract<ListingType, "stay" | "tour" | "experience">;

export interface ListingDraftRow<T = unknown> {
  id: string;
  type: DraftListingType;
  title: string;
  step: number;
  data: T;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapRow = (r: any): ListingDraftRow => ({ id: r.id, type: r.type, title: r.title ?? "", step: r.step ?? 0, data: r.data ?? {}, updatedAt: r.updated_at });
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The signed-in operator's unfinished listings of one type, newest first. */
export async function listListingDrafts(operatorId: string, type: DraftListingType): Promise<ListingDraftRow[]> {
  const { data, error } = await supabase
    .from("listing_drafts")
    .select("id, type, title, step, data, updated_at")
    .eq("operator_id", operatorId)
    .eq("type", type)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) {
    console.warn("[listing drafts] list", error.message);
    return [];
  }
  return (data ?? []).map(mapRow);
}

export async function getListingDraft(id: string): Promise<ListingDraftRow | null> {
  const { data, error } = await supabase.from("listing_drafts").select("id, type, title, step, data, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

/** Create (no id) or update a draft; returns its id. */
export async function saveListingDraft(draft: { id?: string | null; type: DraftListingType; title: string; step: number; data: unknown }): Promise<string> {
  const row = { type: draft.type, title: draft.title.trim().slice(0, 200), step: Math.max(0, Math.min(50, Math.round(draft.step))), data: draft.data };
  if (draft.id) {
    const { data, error } = await supabase.from("listing_drafts").update(row).eq("id", draft.id).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return draft.id;
    // Deleted elsewhere (e.g. discarded on another device) — start a new one.
  }
  const { data, error } = await supabase.from("listing_drafts").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function deleteListingDraft(id: string): Promise<void> {
  const { error } = await supabase.from("listing_drafts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** "just now" / "5 min ago" / "3 h ago" / "12 Oct". */
export function savedAgo(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
