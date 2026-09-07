/**
 * Thin fetch wrapper around the one remaining server route — the AI trip
 * planner (server/routes.ts). Listings CRUD used to live here too; it's
 * gone now that listings read/write straight from Supabase under
 * Row-Level Security (see client/src/contexts/ListingsContext.tsx).
 */
export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status}).`);
  }
  return body as T;
}

export interface PlanTripParams {
  days: number;
  startCity: string;
  travelers: number;
  pace: "relaxed" | "balanced" | "packed";
  budget: "budget" | "mid-range" | "comfort";
  interests: string[];
}

export interface ItineraryDay {
  day: number;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  tip?: string;
}

export interface Itinerary {
  tripTitle: string;
  summary: string;
  days: ItineraryDay[];
  estimatedBudget: string;
  packingTip: string;
}

export function planTrip(params: PlanTripParams): Promise<Itinerary> {
  return request<{ itinerary: Itinerary }>("/api/plan-trip", {
    method: "POST",
    body: JSON.stringify(params),
  }).then((d) => d.itinerary);
}
