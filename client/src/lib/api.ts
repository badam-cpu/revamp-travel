/** Thin fetch wrappers around the Express API in `server/routes.ts`. */
import type { Listing, ListingInput } from "@shared/listings";

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

export function getListings(): Promise<Listing[]> {
  return request<{ listings: Listing[] }>("/api/listings").then((d) => d.listings);
}

export function createListing(input: ListingInput): Promise<Listing> {
  return request<{ listing: Listing }>("/api/listings", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((d) => d.listing);
}

export function updateListing(id: string, input: ListingInput): Promise<Listing> {
  return request<{ listing: Listing }>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  }).then((d) => d.listing);
}

export function deleteListing(id: string): Promise<void> {
  return request<void>(`/api/listings/${encodeURIComponent(id)}`, { method: "DELETE" });
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
