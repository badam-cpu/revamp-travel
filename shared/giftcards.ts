/**
 * Gift-card constants shared by client + server so the buy page, the purchase
 * route, and the redemption logic agree. All amounts are AMD hundredths
 * (*_cents), matching every other money value in the app (see the AMD-primary
 * note in CLAUDE.md). AMD has no minor unit, so these are whole drams ×100.
 */

/** The three fixed denominations offered on /gift-cards (֏25,000 / 50,000 / 100,000). */
export const GIFT_CARD_AMOUNTS_CENTS = [2_500_000, 5_000_000, 10_000_000] as const;

/** Gift cards are valid for this many months from activation. */
export const GIFT_CARD_VALID_MONTHS = 12;

export function isAllowedGiftAmount(cents: number): boolean {
  return (GIFT_CARD_AMOUNTS_CENTS as readonly number[]).includes(cents);
}
