/**
 * Price change log (migration 0103) — turning a logged change into readable
 * lines. A date-price change stores the whole old and new rate lists; this
 * finds the days whose price actually changed and groups consecutive days with
 * the same before → after into ranges, e.g. "3–5 Nov: usual → ֏59,000".
 * `null` means "no per-date price" (the usual/base price applies).
 */
export interface RateLike {
  start: string;
  end: string; // inclusive
  priceCents: number;
  label?: string;
}
export interface RateChange {
  start: string;
  end: string; // inclusive
  from: number | null;
  to: number | null;
  /** The new rate's label, e.g. the event it was set for. */
  label?: string;
}

const DAY = 86_400_000;
const next = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") + DAY).toISOString().slice(0, 10);

function perDay(rates: unknown): Map<string, { cents: number; label?: string }> {
  const out = new Map<string, { cents: number; label?: string }>();
  if (!Array.isArray(rates)) return out;
  for (const r of rates as RateLike[]) {
    if (!r || typeof r.start !== "string" || typeof r.end !== "string" || typeof r.priceCents !== "number") continue;
    let n = 0;
    // Later entries win (same rule the price lookups use); cap a runaway range at ~2 years.
    for (let d = r.start; d <= r.end && n < 800; d = next(d), n++) out.set(d, { cents: r.priceCents, label: r.label });
  }
  return out;
}

export function describeRateChange(oldRates: unknown, newRates: unknown): RateChange[] {
  const a = perDay(oldRates);
  const b = perDay(newRates);
  const days = Array.from(new Set(Array.from(a.keys()).concat(Array.from(b.keys())))).sort();
  const out: RateChange[] = [];
  for (const d of days) {
    const from = a.get(d)?.cents ?? null;
    const to = b.get(d)?.cents ?? null;
    if (from === to) continue;
    const label = b.get(d)?.label;
    const last = out[out.length - 1];
    if (last && next(last.end) === d && last.from === from && last.to === to && last.label === label) last.end = d;
    else out.push({ start: d, end: d, from, to, label });
  }
  return out;
}
