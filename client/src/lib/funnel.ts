/**
 * Pure helpers for the performance funnel (Analytics → Engagement): the
 * Impressions → Click-through → Page visits → Conversion → Bookings journey,
 * its time buckets, and the trend chart's scale. No React, no Supabase — so it
 * can be unit-tested on its own.
 */

export type StageKey = "impressions" | "ctr" | "visits" | "conversion" | "outcome";

/** Raw counts for one listing set over one period. */
export interface FunnelCounts {
  impressions: number;
  clicks: number; // card clicks — the true click-through from a card
  visits: number; // listing page opens (from cards, Google, shared links…)
  outcome: number; // bookings (bookable types) or actions (restaurants/places)
}

/** A percentage, or null when the denominator is zero (shown as "—"). */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

export function stageValue(c: FunnelCounts, stage: StageKey): number | null {
  switch (stage) {
    case "impressions":
      return c.impressions;
    case "ctr":
      return rate(c.clicks, c.impressions);
    case "visits":
      return c.visits;
    case "conversion":
      return rate(c.outcome, c.visits);
    case "outcome":
      return c.outcome;
  }
}

export const isRateStage = (s: StageKey) => s === "ctr" || s === "conversion";

/** "6.53%", "0%", "0.4%", "—". */
export function formatRate(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "0%";
  const digits = v >= 10 ? 1 : 2;
  return `${Number(v.toFixed(digits))}%`;
}

export interface Bucket {
  days: string[]; // ISO days, oldest first
  label: string; // "Sep 14 – 20", "Sep 28 – Oct 4", "Oct 12"
  partial: boolean; // shorter than the others (the period still running)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return { m: MONTHS[m - 1], d };
};

export function bucketLabel(first: string, last: string): string {
  const a = md(first);
  if (first === last) return `${a.m} ${a.d}`;
  const b = md(last);
  return a.m === b.m ? `${a.m} ${a.d} – ${b.d}` : `${a.m} ${a.d} – ${b.m} ${b.d}`;
}

/**
 * Splits the period into points for the trend line: one per day for a week,
 * otherwise 7-day weeks counted BACK from the last day — so the latest point is
 * always a full week (no fake end-of-chart drop). Only the oldest bucket can be
 * short; it's flagged so the chart draws it as a part week.
 */
export function bucketDays(days: string[]): Bucket[] {
  const size = days.length <= 14 ? 1 : 7;
  const out: Bucket[] = [];
  for (let end = days.length; end > 0; end -= size) {
    const chunk = days.slice(Math.max(0, end - size), end);
    out.unshift({ days: chunk, label: bucketLabel(chunk[0], chunk[chunk.length - 1]), partial: chunk.length < size });
  }
  return out;
}

/**
 * Evenly spaced, round y-axis ticks from 0 that cover `max` — whichever of 4
 * or 5 steps ends closest above it (4,563 → 0…5,000, not 0…6,000).
 * `integer`: counts never get fractional ticks.
 */
export function niceTicks(max: number, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const build = (target: number) => {
    const raw = max / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    if (integer) step = Math.max(1, Math.ceil(step));
    const ticks: number[] = [];
    for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toFixed(6)));
    return ticks;
  };
  const a = build(4);
  const b = build(5);
  return b[b.length - 1] < a[a.length - 1] ? b : a;
}

/**
 * Smooth curve through points (monotone cubic, Fritsch–Carlson): it never
 * overshoots between points, so it can't dip below zero or invent a peak.
 * Returns one SVG "C…" command per gap, so a caller can draw the last gap
 * differently (dashed for a period still running).
 */
export function monotoneSegments(pts: { x: number; y: number }[]): string[] {
  const n = pts.length;
  if (n < 2) return [];
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  t.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }
  const segs: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    segs.push(`C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`);
  }
  return segs;
}

export function monotonePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  return [`M${pts[0].x},${pts[0].y}`, ...monotoneSegments(pts)].join(" ");
}
