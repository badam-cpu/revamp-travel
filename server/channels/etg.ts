/**
 * ETG (Ostrovok / Emerging Travel Group) DIRECT connectivity adapter.
 *
 * NOTE: pushing supply INTO Ostrovok uses ETG's connectivity/supplier program
 * (become a certified ETG connectivity partner → receive the inbound ARI spec +
 * credentials). That is separate from the ETG *demand* API (docs.emergingtravel.com,
 * which pulls inventory to resell). Until we're onboarded and have that spec, the
 * push/property calls below are stubs that throw a clear error; the seam, config
 * detection, and webhook parsing are in place so the rest of the channel manager
 * can be built and tested now.
 *
 * Credentials (server-side only, never VITE_): ETG_CONNECTIVITY_KEY_ID +
 * ETG_CONNECTIVITY_KEY_UUID (Basic Auth), issued during connectivity onboarding.
 */
import type { AvailabilityDay } from "./availability.js";
import type { ChannelMapping, ConnectivityProvider, InboundReservation, ListingContent } from "./provider.js";

const PENDING = "ETG connectivity isn't set up yet — complete ETG connectivity-partner onboarding and add ETG_CONNECTIVITY_KEY_ID / ETG_CONNECTIVITY_KEY_UUID, then this adapter will be wired to the inbound ARI spec.";

export const etgProvider: ConnectivityProvider = {
  name: "etg",

  configured(): boolean {
    return !!(process.env.ETG_CONNECTIVITY_KEY_ID && process.env.ETG_CONNECTIVITY_KEY_UUID);
  },

  async ensureProperty(_mapping: ChannelMapping, _content: ListingContent) {
    // TODO(etg-onboarding): create/update property + room type + rate plan via the
    // ETG connectivity endpoints, return the provider ids.
    throw new Error(PENDING);
  },

  async pushAvailability(_mapping: ChannelMapping, _days: AvailabilityDay[]): Promise<void> {
    // TODO(etg-onboarding): map AvailabilityDay[] to ETG's ARI update payload
    // (availability + rate + restrictions per date) and POST it.
    throw new Error(PENDING);
  },

  parseReservationWebhook(payload: unknown): InboundReservation | null {
    // Shape is finalized against ETG's connectivity webhook once onboarded; kept
    // defensive so an unexpected payload never throws.
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const externalId = typeof p.id === "string" ? p.id : typeof p.reservation_id === "string" ? p.reservation_id : "";
    if (!externalId) return null;
    return {
      provider: "etg",
      externalId,
      channel: typeof p.channel === "string" ? p.channel : "ostrovok",
      status: "new",
      raw: payload,
    };
  },
};
