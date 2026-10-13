/**
 * Hotels: several rooms of ONE type in a single checkout (migration 0097).
 *
 * Each room becomes its own booking row — its own room (101, 102…), guests,
 * price, cancellation and refund — so per-room calendars, the timeline, room
 * moves and per-room cancellation all work unchanged. The rows share one PayLink
 * payment and a `booking_group_id` (= the first room's id; that row also carries
 * add-ons, the gift card and the promo code). Rooms are the cheapest distinct
 * free rooms of the type (shared/rooms.ts `cheapestAvailableUnits`) and are
 * priced by the same shared code the guest's preview uses; a promo code is split
 * across the rooms (`splitGroupCharges`). Confirmation still goes room by room
 * through `confirm_room_booking()` (capacity-safe); the guest and host get one
 * group confirmation (server/bookings.ts).
 *
 * Single-room checkouts never come here — they keep the original path in
 * server/routes.ts untouched.
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomType, RoomUnit } from "../shared/listings.js";
import { addonUnitCost, maxNightlyOccupancy, nightsBetween, type Addon } from "../shared/bookings.js";
import { MAX_ROOMS_PER_BOOKING, cheapestAvailableUnits, freeUnitCount, quoteRoom, splitGroupCharges, type RoomQuote } from "../shared/rooms.js";
import { promoDiscountCents } from "../shared/promo.js";
import { lookupRedeemableGift, reserveGift, releaseGift, logGiftEvent } from "./giftcards.js";
import { resolvePaymentAccount } from "./paymentAccounts.js";
import { finalizeConfirmedBooking } from "./bookings.js";

type Range = { start: string; end: string };

export interface RoomGroupInput {
  admin: SupabaseClient;
  /** The traveler's RLS-scoped client (inserts their own pending holds). */
  supa: SupabaseClient;
  userId: string;
  site: string;
  currency: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listing: any;
  roomType: { id: string; max_guests: number; price_cents: number; price_unit: string | null; quantity: number; seasonal_rates?: { start: string; end: string; priceCents: number }[] | null };
  startDate: string;
  endDate: string;
  /** Guests in each room, one entry per room. */
  roomsGuests: number[];
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  messagingConsent: boolean;
  addons?: { id: string; qty: number }[];
  giftCode?: string;
  promo: { id: string; discount_type: "percent" | "amount"; discount_value: number } | null;
  expectedTotalCents?: number;
}

export type RoomGroupResult = { status: number; body: Record<string, unknown> };

const fail = (status: number, error: string): RoomGroupResult => ({ status, body: { error } });

export async function startRoomGroupCheckout(i: RoomGroupInput): Promise<RoomGroupResult> {
  const { admin, listing, roomType: rt, startDate, endDate, roomsGuests } = i;
  const n = roomsGuests.length;
  if (n < 2 || n > MAX_ROOMS_PER_BOOKING) return fail(400, `You can book up to ${MAX_ROOMS_PER_BOOKING} rooms at once.`);
  if (roomsGuests.some((g) => !(g >= 1) || g > rt.max_guests)) {
    return fail(400, `Each room fits up to ${rt.max_guests} ${rt.max_guests === 1 ? "guest" : "guests"}.`);
  }
  // The operator's minimum stay applies to every room.
  const facts = Array.isArray(listing.facts) ? (listing.facts as { label?: string; value?: string }[]) : [];
  const minStay = parseInt(facts.find((f) => f.label?.toLowerCase() === "minimum stay")?.value ?? "", 10);
  if (Number.isFinite(minStay) && minStay > 1 && nightsBetween(startDate, endDate) < minStay) return fail(400, `This stay has a ${minStay}-night minimum.`);

  const quoteListing = {
    cancellationPolicy: listing.cancellation_policy ?? "flexible",
    nonrefundableDiscountPercent: listing.nonrefundable_discount_percent ?? 0,
    cleaningFeeCents: listing.cleaning_fee_cents ?? 0,
    discountType: listing.discount_type,
    discountValue: listing.discount_value,
    discountStart: listing.discount_start,
    discountEnd: listing.discount_end,
  };

  // ── Rooms: the cheapest distinct free rooms of the type ────────────────────
  const { data: unitRows, error: unitErr } = await admin.from("room_units").select("*").eq("room_type_id", rt.id);
  if (unitErr) {
    console.error("[room-group] units read failed", unitErr.message);
    return fail(503, "Booking isn't available right now.");
  }
  const units: RoomUnit[] = (unitRows ?? []).map((u) => ({
    id: u.id,
    roomTypeId: u.room_type_id,
    name: u.name,
    priceCents: u.price_cents ?? undefined,
    seasonalRates: Array.isArray(u.seasonal_rates) ? u.seasonal_rates : [],
    manualBlockedRanges: Array.isArray(u.manual_blocked_ranges) ? u.manual_blocked_ranges : [],
    blockedRanges: Array.isArray(u.blocked_ranges) ? u.blocked_ranges : [],
    active: u.active !== false,
    sortOrder: u.sort_order ?? 0,
  }));

  const holdCutoff = Date.now() - 15 * 60_000;
  let picks: { unit: RoomUnit | null; quote: RoomQuote; guests: number }[];
  if (units.length) {
    const { data: unitBookings, error: ubErr } = await admin
      .from("bookings")
      .select("room_unit_id, status, created_at, start_date, end_date")
      .in("room_unit_id", units.map((u) => u.id))
      .in("status", ["confirmed", "pending_payment"])
      .lt("start_date", endDate)
      .gt("end_date", startDate);
    if (ubErr) {
      console.error("[room-group] availability read failed", ubErr.message);
      return fail(503, "Booking isn't available right now.");
    }
    const bookedByUnit = new Map<string, Range[]>();
    for (const b of unitBookings ?? []) {
      if (b.status !== "confirmed" && Date.parse(b.created_at) <= holdCutoff) continue; // stale hold
      const arr = bookedByUnit.get(b.room_unit_id) ?? [];
      arr.push({ start: b.start_date, end: b.end_date });
      bookedByUnit.set(b.room_unit_id, arr);
    }
    const type = { priceCents: rt.price_cents, seasonalRates: Array.isArray(rt.seasonal_rates) ? rt.seasonal_rates : [], units } as Pick<RoomType, "priceCents" | "units" | "seasonalRates">;
    const got = cheapestAvailableUnits(quoteListing, type, bookedByUnit, startDate, endDate, roomsGuests);
    if (!got) {
      const free = freeUnitCount(type, bookedByUnit, startDate, endDate);
      return fail(409, free > 0 ? `Only ${free} room${free === 1 ? "" : "s"} of this type ${free === 1 ? "is" : "are"} free for those nights.` : "No room of this type is free for all of those nights. Try other dates or another room.");
    }
    picks = got;
  } else {
    // A type with no individual rooms yet: its legacy count, all priced alike.
    const { data: clashes, error } = await admin
      .from("bookings")
      .select("status, created_at, start_date, end_date")
      .eq("room_type_id", rt.id)
      .in("status", ["confirmed", "pending_payment"])
      .lt("start_date", endDate)
      .gt("end_date", startDate);
    if (error) return fail(503, "Booking isn't available right now.");
    const live = (clashes ?? []).filter((c) => c.status === "confirmed" || Date.parse(c.created_at) > holdCutoff).map((c) => ({ start: c.start_date as string, end: c.end_date as string }));
    const free = (rt.quantity ?? 1) - maxNightlyOccupancy(live, startDate, endDate);
    if (free < n) return fail(409, free > 0 ? `Only ${free} room${free === 1 ? "" : "s"} of this type ${free === 1 ? "is" : "are"} free for those nights.` : "That room just sold out for those dates. Try other dates or another room.");
    picks = roomsGuests.map((g) => ({ unit: null, guests: g, quote: quoteRoom(quoteListing, { priceCents: rt.price_cents, priceUnit: rt.price_unit || "night", seasonalRates: Array.isArray(rt.seasonal_rates) ? rt.seasonal_rates : [] }, startDate, endDate, g) }));
  }
  if (picks.some((p) => p.quote.accommodationCents <= 0)) return fail(400, "This listing is rate-on-request — contact the operator to book.");

  // ── Money: each room on its own; one promo split across them ───────────────
  const bases = picks.map((p) => p.quote.charge.baseCents);
  const promoTotal = i.promo ? promoDiscountCents(bases.reduce((a, b) => a + b, 0), i.promo.discount_type, i.promo.discount_value) : 0;
  const charges = splitGroupCharges(bases, promoTotal);

  let addonsCents = 0;
  const addonSnapshot: { id: string; name: string; unit: string; qty: number; amountCents: number; onRequest: boolean }[] = [];
  if (i.addons?.length) {
    const { data: ss } = await i.supa.from("site_settings").select("addons").eq("id", 1).maybeSingle();
    const catalog: Addon[] = Array.isArray(ss?.addons) ? (ss!.addons as Addon[]) : [];
    const nights = nightsBetween(startDate, endDate);
    const guests = roomsGuests.reduce((a, b) => a + b, 0);
    for (const sel of i.addons) {
      const a = catalog.find((c) => c.id === sel.id && c.enabled && c.name && (c.priceCents > 0 || c.onRequest));
      if (!a) continue;
      const amt = addonUnitCost(a, { nights, guests }) * sel.qty;
      addonsCents += amt;
      addonSnapshot.push({ id: a.id, name: a.name, unit: a.unit, qty: sel.qty, amountCents: amt, onRequest: !!a.onRequest });
    }
  }
  const rowTotals = charges.map((c, idx) => c.totalCents + (idx === 0 ? addonsCents : 0));
  const groupTotal = rowTotals.reduce((a, b) => a + b, 0);
  if (i.expectedTotalCents != null && groupTotal > i.expectedTotalCents) {
    return fail(409, "The price for these dates just changed. Go back to review it, then try again.");
  }

  // ── Gift card (applied to the whole group; held on the first room) ─────────
  let giftId: string | null = null;
  let giftApplied = 0;
  let giftBalanceAfter = 0;
  if (i.giftCode) {
    const look = await lookupRedeemableGift(admin, i.giftCode, i.currency);
    if ("error" in look) return fail(400, look.error);
    giftApplied = Math.min(look.balanceCents, groupTotal);
    if (!(await reserveGift(admin, look.id, giftApplied))) return fail(409, "That gift card balance just changed — please try again.");
    giftId = look.id;
    giftBalanceAfter = look.balanceCents - giftApplied;
  }
  const remaining = groupTotal - giftApplied;

  // ── Rows ───────────────────────────────────────────────────────────────────
  const ids = picks.map(() => crypto.randomUUID());
  const groupId = ids[0];
  const rows = picks.map((p, idx) => {
    const c = charges[idx];
    const row: Record<string, unknown> = {
      id: ids[idx],
      booking_group_id: groupId,
      listing_id: listing.id,
      traveler_id: i.userId,
      start_date: startDate,
      end_date: endDate,
      guests: p.guests,
      amount_cents: rowTotals[idx],
      base_cents: c.baseCents,
      tax_cents: c.taxCents,
      addons: idx === 0 ? addonSnapshot : [],
      addons_cents: idx === 0 ? addonsCents : 0,
      currency: i.currency,
      cancellation_policy: listing.cancellation_policy ?? "flexible",
      free_cancel_days: listing.free_cancel_days ?? 7,
      gift_card_id: idx === 0 ? giftId : null,
      gift_applied_cents: idx === 0 ? giftApplied : 0,
      promo_code_id: idx === 0 ? i.promo?.id ?? null : null,
      promo_discount_cents: bases[idx] - c.baseCents,
      messaging_consent: i.messagingConsent,
      room_type_id: rt.id,
      ...(p.unit ? { room_unit_id: p.unit.id } : {}),
    };
    if (i.guestName || i.guestEmail || i.guestPhone) {
      row.guest_name = i.guestName || null;
      row.guest_email = i.guestEmail || null;
      row.guest_phone = i.guestPhone || null;
    }
    return row;
  });
  const cancelAll = async () => {
    await admin.from("bookings").update({ status: "cancelled" }).in("id", ids);
  };

  // Fully covered by the gift card → hold every room, then confirm each through
  // the capacity-safe confirm; if any room can't be confirmed, undo the lot.
  if (remaining <= 0 && giftId) {
    const { error: holdErr } = await admin.from("bookings").insert(rows.map((r) => ({ ...r, status: "pending_payment", provider: "gift" })));
    if (holdErr) {
      await releaseGift(admin, giftId, giftApplied);
      console.error("[room-group] gift-covered hold failed", holdErr.message);
      return fail(500, "Couldn't record your booking.");
    }
    for (const id of ids) {
      const { data: outcome, error: rpcErr } = await admin.rpc("confirm_room_booking", { p_booking_id: id });
      if (rpcErr || outcome !== "confirmed") {
        await cancelAll();
        await releaseGift(admin, giftId, giftApplied);
        if (outcome === "capacity") return fail(409, "One of those rooms just sold out. Try fewer rooms or other dates.");
        console.error("[room-group] gift-covered confirm failed", rpcErr?.message ?? outcome);
        return fail(500, "Couldn't record your booking.");
      }
    }
    await logGiftEvent(admin, giftId, "redeemed", { amountCents: giftApplied, balanceAfter: giftBalanceAfter, bookingId: groupId, detail: `Fully covered ${n} rooms · ${listing.title}` });
    for (const id of ids) {
      try {
        await finalizeConfirmedBooking(admin, id);
      } catch (e) {
        console.error("[room-group] finalize failed", id, e);
      }
    }
    return { status: 200, body: { confirmed: true, fullyCovered: true, bookingId: groupId, rooms: n } };
  }

  // Otherwise one PayLink charge for the whole group (the operator's own account
  // if connected, else Revamp's), shared by every room row.
  try {
    const account = await resolvePaymentAccount(admin, listing.operator_id);
    const pay = await account.client.registerPayment({
      amount: i.currency === "AMD" ? Math.round(remaining / 100) : remaining / 100,
      currency: i.currency,
      returnUrl: `${i.site}/account?checkout=return`,
      info: `Revamp booking · ${listing.title} · ${n} rooms`,
    });
    if (!pay.redirectUrl) {
      if (giftId) await releaseGift(admin, giftId, giftApplied);
      return fail(502, "Couldn't start checkout.");
    }
    const writer = account.owner ? admin : i.supa;
    const { error: insErr } = await writer.from("bookings").insert(
      rows.map((r) => ({
        ...r,
        status: "pending_payment",
        provider: "paylink",
        paylink_request_id: pay.requestId,
        paylink_order_id: pay.orderId,
        ...(account.owner ? { paylink_account_owner: account.owner } : {}),
      })),
    );
    if (insErr) {
      if (giftId) await releaseGift(admin, giftId, giftApplied);
      console.error("[room-group] insert failed", insErr.message);
      return fail(500, "Couldn't record your booking.");
    }
    if (giftId) await logGiftEvent(admin, giftId, "redeemed", { amountCents: giftApplied, balanceAfter: giftBalanceAfter, bookingId: groupId, detail: `Applied to ${n} rooms · ${listing.title}` });
    return { status: 200, body: { redirectUrl: pay.redirectUrl } };
  } catch (err) {
    if (giftId) await releaseGift(admin, giftId, giftApplied);
    console.error("[room-group] checkout failed", err);
    return fail(502, "Couldn't start checkout. Please try again.");
  }
}
