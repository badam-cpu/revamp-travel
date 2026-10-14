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
  source?: string;
  basis?: string;
}
export interface RateChange {
  start: string;
  end: string; // inclusive
  from: number | null;
  to: number | null;
  /** The new rate's label, e.g. the event it was set for. */
  label?: string;
  /** Where the new price came from (manual / event_market / event_markup / pricelabs), if tagged. */
  source?: string;
  /** What a suggestion was based on. */
  basis?: string;
  /** Where the OLD price came from — e.g. an event price that was removed. */
  fromSource?: string;
  fromLabel?: string;
}

const DAY = 86_400_000;
const next = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") + DAY).toISOString().slice(0, 10);

type Day = { cents: number; label?: string; source?: string; basis?: string };
function perDay(rates: unknown): Map<string, Day> {
  const out = new Map<string, Day>();
  if (!Array.isArray(rates)) return out;
  for (const r of rates as RateLike[]) {
    if (!r || typeof r.start !== "string" || typeof r.end !== "string" || typeof r.priceCents !== "number") continue;
    let n = 0;
    // Later entries win (same rule the price lookups use); cap a runaway range at ~2 years.
    for (let d = r.start; d <= r.end && n < 800; d = next(d), n++) out.set(d, { cents: r.priceCents, label: r.label, source: r.source, basis: r.basis });
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
    const nb = b.get(d);
    const na = a.get(d);
    const item: RateChange = { start: d, end: d, from, to, label: nb?.label, source: nb?.source, basis: nb?.basis, fromSource: na?.source, fromLabel: na?.label };
    const last = out[out.length - 1];
    const same = (x: RateChange) => x.from === from && x.to === to && x.label === item.label && x.source === item.source && x.basis === item.basis && x.fromSource === item.fromSource && x.fromLabel === item.fromLabel;
    if (last && next(last.end) === d && same(last)) last.end = d;
    else out.push(item);
  }
  return out;
}

export type ChangeKind = "manual" | "suggestion" | "automatic" | "removed";
/**
 * One label for a date-price change line: a suggestion that was applied
 * (market or markup), an event price being removed, an automatic sync, or a
 * manual edit. Untagged (older) lines fall back on the event name and on
 * whether a person made the change.
 */
export function rateChangeKind(c: RateChange, byPerson: boolean): { kind: ChangeKind; text: string } {
  if (c.to != null && (c.source === "event_market" || c.source === "event_markup"))
    return { kind: "suggestion", text: c.source === "event_market" ? "Event suggestion · market" : "Event suggestion · markup" };
  if (c.to == null && (c.fromSource === "event_market" || c.fromSource === "event_markup" || c.fromLabel)) return { kind: "removed", text: "Event price removed" };
  if (c.source === "pricelabs" || !byPerson) return { kind: "automatic", text: "Automatic" };
  if (c.source === "manual") return { kind: "manual", text: "Manual" };
  if (c.to != null && c.label) return { kind: "suggestion", text: "Event suggestion" }; // applied before tagging existed
  return { kind: "manual", text: "Manual" };
}
