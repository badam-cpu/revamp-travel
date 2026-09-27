/**
 * Restaurant-voucher constants + math, shared by client + server so the buy card,
 * the purchase route, and settlement all agree. Amounts are AMD hundredths
 * (*_cents), like every other money value in the app.
 */

/** Fixed dining-credit denominations offered (֏5,000 / ֏10,000 / ֏25,000). */
export const VOUCHER_AMOUNTS_CENTS = [500_000, 1_000_000, 2_500_000] as const;

/** Vouchers are valid for this many months from purchase. */
export const VOUCHER_VALID_MONTHS = 6;

export function isAllowedVoucherAmount(cents: number): boolean {
  return (VOUCHER_AMOUNTS_CENTS as readonly number[]).includes(cents);
}

/** Customer price for a face value after the restaurant-set customer discount. */
export function voucherPriceCents(faceCents: number, discountPercent: number): number {
  const pct = Math.min(90, Math.max(0, Math.round(discountPercent)));
  return Math.round((faceCents * (100 - pct)) / 100);
}

/** What the restaurant is owed on a redeemed voucher (face minus Revamp commission). */
export function voucherPayoutCents(faceCents: number, commissionPercent: number): number {
  const pct = Math.min(90, Math.max(0, Math.round(commissionPercent)));
  return Math.round((faceCents * (100 - pct)) / 100);
}
