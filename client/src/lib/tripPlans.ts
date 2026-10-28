/**
 * Aha AI trip plans in the browser and in the account (2026-10-28).
 *
 *  - The plan on screen lives in sessionStorage, so /plan/trip survives a
 *    reload or a trip to a listing and back.
 *  - "Save this trip" while signed out parks the plan in localStorage (it has
 *    to survive the sign-up email opening a new tab); <PendingTripSaver /> saves
 *    it the moment a real account is signed in.
 *  - Saved plans are rows in trip_plans (0122, owner-only RLS). The plan is kept
 *    as the exact JSON the server signed, so a saved plan can still be emailed.
 */
import { supabase } from "@/lib/supabase";
import type { Itinerary } from "@/lib/api";

export interface CurrentPlan {
  /** JSON.stringify of the itinerary exactly as the server returned it. */
  planJson: string;
  token: string | null;
  request?: string;
  /** e.g. "4 days · 2 travellers · balanced" */
  meta?: string;
  /** Set once saved to the account. */
  id?: string;
  /** Changed since it was saved. */
  dirty?: boolean;
}

export interface SavedTripPlan {
  id: string;
  title: string;
  request: string | null;
  days: number | null;
  created_at: string;
  updated_at: string;
}

const CURRENT_KEY = "revamp.tripPlan";
const PENDING_KEY = "revamp.pendingTripPlan";
const PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const parsePlan = (p: CurrentPlan): Itinerary => JSON.parse(p.planJson) as Itinerary;

export function readCurrentPlan(): CurrentPlan | null {
  try {
    const raw = sessionStorage.getItem(CURRENT_KEY);
    return raw ? (JSON.parse(raw) as CurrentPlan) : null;
  } catch {
    return null;
  }
}

export function writeCurrentPlan(p: CurrentPlan): void {
  try {
    sessionStorage.setItem(CURRENT_KEY, JSON.stringify(p));
  } catch {
    /* private mode — the page still works until it's closed */
  }
}

export function setPendingSave(p: CurrentPlan): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function takePendingSave(): CurrentPlan | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_KEY);
    const p = JSON.parse(raw) as CurrentPlan & { at?: number };
    return p.at && Date.now() - p.at < PENDING_TTL_MS ? p : null;
  } catch {
    return null;
  }
}

export function hasPendingSave(): boolean {
  try {
    return !!localStorage.getItem(PENDING_KEY);
  } catch {
    return false;
  }
}

function rowFrom(p: CurrentPlan) {
  const it = parsePlan(p);
  return {
    title: (it.tripTitle || "Your Armenia trip").slice(0, 160),
    request: p.request ? p.request.slice(0, 600) : null,
    plan_json: p.planJson,
    plan_token: p.token,
    days: Math.min(30, Math.max(1, it.days.length)),
  };
}

/** Insert (no id yet) or update the saved copy. Returns the row id. */
export async function saveTripPlan(userId: string, p: CurrentPlan): Promise<string> {
  if (p.id) {
    const { error } = await supabase.from("trip_plans").update({ ...rowFrom(p), updated_at: new Date().toISOString() }).eq("id", p.id);
    if (error) throw error;
    return p.id;
  }
  const { data, error } = await supabase.from("trip_plans").insert({ ...rowFrom(p), user_id: userId }).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function getTripPlan(id: string): Promise<CurrentPlan | null> {
  const { data, error } = await supabase.from("trip_plans").select("id, request, plan_json, plan_token").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { id: string; request: string | null; plan_json: string; plan_token: string | null };
  return { id: row.id, planJson: row.plan_json, token: row.plan_token, request: row.request ?? undefined };
}

export async function listTripPlans(): Promise<SavedTripPlan[]> {
  const { data, error } = await supabase.from("trip_plans").select("id, title, request, days, created_at, updated_at").order("updated_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as SavedTripPlan[];
}

export async function deleteTripPlan(id: string): Promise<void> {
  const { error } = await supabase.from("trip_plans").delete().eq("id", id);
  if (error) throw error;
}
