/**
 * Channel Manager — the connectivity provider seam. Everything Revamp builds
 * (data model, availability engine, operator UI, reservation ingestion) talks to
 * this interface, NOT to a specific vendor. The first implementation is ETG
 * (Ostrovok) direct connectivity; an aggregator (e.g. Channex) or any other OTA
 * can be added later by writing another adapter — no rewrite, no lock-in.
 */
import type { AvailabilityDay } from "./availability.js";

/** How a Revamp listing is represented on the provider side. */
export interface ChannelMapping {
  listingId: string;
  operatorId: string;
  externalPropertyId?: string | null;
  externalRoomTypeId?: string | null;
  externalRatePlanId?: string | null;
  channels: string[];
}

/** A reservation that arrived from an OTA via the provider. */
export interface InboundReservation {
  provider: string;
  externalId: string;
  channel?: string; // ostrovok, booking, …
  listingId?: string;
  startDate?: string;
  endDate?: string;
  guests?: number;
  guestName?: string;
  amountCents?: number;
  currency?: string;
  status: "new" | "confirmed" | "modified" | "cancelled";
  raw: unknown;
}

export interface ListingContent {
  title: string;
  description: string;
  city: string;
  region: string;
  address?: string;
  images: string[];
  maxGuests?: number;
  amenities: string[];
}

export interface ConnectivityProvider {
  /** Provider key stored on channel_property_map.provider (e.g. "etg"). */
  readonly name: string;
  /** True when credentials are present and the provider is usable. */
  configured(): boolean;
  /** Create/update the property + room + rate on the provider; returns the ids. */
  ensureProperty(
    mapping: ChannelMapping,
    content: ListingContent,
  ): Promise<{ externalPropertyId: string; externalRoomTypeId: string; externalRatePlanId: string }>;
  /** Push availability + prices (ARI) for the mapped listing. */
  pushAvailability(mapping: ChannelMapping, days: AvailabilityDay[]): Promise<void>;
  /** Parse a provider webhook payload into a normalized reservation. */
  parseReservationWebhook(payload: unknown): InboundReservation | null;
}
