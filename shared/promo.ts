/**
 * Operator promo-code math + badge text, shared by client (checkout preview,
 * listing badge, dashboard) and server (authoritative apply). Amounts are AMD
 * hundredths (*_cents) like every other money value.
 */
export type PromoType = "percent" | "amount";

/** Discount in cents for a base amount. Percent is clamped 1–90; amount is capped at the base. */
export function promoDiscountCents(baseCents: number, type: PromoType, value: number): number {
  if (baseCents <= 0) return 0;
  if (type === "percent") {
    const pct = Math.min(90, Math.max(1, Math.round(value)));
    return Math.min(baseCents, Math.floor((baseCents * pct) / 100));
  }
  return Math.min(baseCents, Math.max(0, Math.round(value)));
}

/** Public badge text for a promo surfaced on a listing. */
export function promoBadgeText(
  p: { discount_type: PromoType; discount_value: number; tag_label?: string | null },
  format?: (cents: number) => string,
): string {
  if (p.tag_label && p.tag_label.trim()) return p.tag_label.trim();
  if (p.discount_type === "percent") return `${Math.round(p.discount_value)}% OFF`;
  return format ? `${format(p.discount_value)} OFF` : "Deal";
}
