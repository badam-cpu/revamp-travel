/**
 * Revamp credit (migration 0105) — the guest loyalty rules, shared by the
 * server (earning cron, checkout) and the client (checkout preview, account).
 *
 *  - Earn CREDIT_PERCENT of the pre-tax price the guest paid IN MONEY: the
 *    booking's base (stay/tour price + cleaning/extra fee, after discounts),
 *    scaled by the share of the total not covered by a gift card or credit.
 *    Tax and add-ons never earn.
 *  - Credited after the trip (the day after a stay's checkout; the day after a
 *    tour/experience), only for trips ending on/after CREDIT_PROGRAM_START, and
 *    never for bookings an operator entered by hand.
 *  - Each earning expires CREDIT_VALID_MONTHS later.
 *  - Usable on any instant booking; Revamp funds it (operator payout unchanged).
 */

export const CREDIT_PERCENT = 2;
export const CREDIT_VALID_MONTHS = 12;
/** Trips ending on or after this day earn credit ("from launch on"). */
export const CREDIT_PROGRAM_START = "2026-10-16";

/** Credit is whole drams (AMD has no minor unit): round DOWN to 100 "cents". */
const wholeDram = (cents: number) => Math.max(0, Math.floor(cents / 100) * 100);

/**
 * Credit a booking earns. `baseCents` = pre-tax price; `amountCents` = the
 * total charged (base + tax + add-ons); gift/credit = parts not paid in money.
 */
export function creditEarnedCents(b: { baseCents: number | null | undefined; amountCents: number; giftAppliedCents?: number | null; creditAppliedCents?: number | null }): number {
  const amount = b.amountCents;
  if (!(amount > 0)) return 0;
  const base = b.baseCents ?? amount;
  const paidInMoney = Math.max(0, amount - (b.giftAppliedCents ?? 0) - (b.creditAppliedCents ?? 0));
  const earnBase = (base * paidInMoney) / amount;
  return wholeDram((earnBase * CREDIT_PERCENT) / 100);
}

/** How much credit to apply at checkout: never more than what's left to pay. */
export function creditToApply(balanceCents: number, dueCents: number): number {
  return wholeDram(Math.min(Math.max(0, balanceCents), Math.max(0, dueCents)));
}

/** The day a finished trip earns: a stay the day after checkout; a tour/experience the day after it. */
export function creditEarnDay(type: string | null | undefined, startDate: string, endDate: string): string {
  // Stays: end_date is the checkout day → the next day. Tours/experiences:
  // end_date is already start + 1 (exclusive) → that day.
  if (type === "stay") return addDays(endDate, 1);
  return endDate > startDate ? endDate : addDays(startDate, 1);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

export function creditExpiry(from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + CREDIT_VALID_MONTHS);
  return d.toISOString();
}

/** Balance of live lots (unexpired, something left). */
export function creditBalance(lots: { remaining_cents: number; expires_at: string }[], now = Date.now()): number {
  return lots.reduce((s, l) => s + (Date.parse(l.expires_at) > now ? Math.max(0, l.remaining_cents) : 0), 0);
}

export const CREDIT_TERMS = [
  `You earn ${CREDIT_PERCENT}% of the price you paid (before tax, not counting add-ons or anything paid with a gift card or credit) once your trip is over.`,
  `Credit is added the day after your stay or tour, and each amount is valid for ${CREDIT_VALID_MONTHS} months.`,
  "Use it on any stay, tour or experience you book and pay for on Revamp — it's applied at checkout.",
  "If you cancel a booking that used credit, the credit comes back to your account. Credit can't be exchanged for cash or transferred.",
];
