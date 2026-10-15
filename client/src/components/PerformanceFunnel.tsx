/**
 * "Listing performance" — a GetYourGuide-style performance funnel at the
 * top of Analytics → Engagement (operators and admins). Impressions →
 * click-through rate → page visits → conversion rate → bookings, for whatever
 * the dashboard's filters select (range / type / listing), plus a trend line
 * for the chosen step (daily for a week, weekly otherwise).
 *
 * Real measured numbers only: impressions / card clicks / page visits come from
 * listing_analytics_daily (0068; operators' and admins' own browsing is never
 * tracked), bookings from the bookings table (RLS-scoped). Bookings count
 * confirmed/completed bookings made on Revamp (a room group = one booking;
 * bookings an operator entered by hand are not counted). Restaurants and
 * places aren't booked on Revamp — when the filter selects only them, the last
 * step is "Actions" (directions / website / call / menu).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import {
  type Bucket,
  type FunnelCounts,
  type StageKey,
  bucketDays,
  bucketLabel,
  formatRate,
  isRateStage,
  monotoneSegments,
  niceTicks,
  stageValue,
} from "@/lib/funnel";

type Row = { listing_id: string; day: string; kind: string; count: number };
export type FunnelBooking = { id: string; listing_id: string; created_at: string; status: string; provider: string | null; booking_group_id?: string | null };

export const BOOKABLE = new Set(["stay", "tour", "experience"]);
export const ACTION_KINDS = new Set(["directions", "website", "call", "menu"]);

/** Confirmed/completed bookings created since `since` (RLS: an operator gets their own listings', an admin all). null while loading. */
export function useFunnelBookings(since: string): FunnelBooking[] | null {
  const [bookings, setBookings] = useState<FunnelBooking[] | null>(null);
  useEffect(() => {
    let live = true;
    setBookings(null);
    const load = async () => {
      const base = "id, listing_id, created_at, status, provider";
      const query = (cols: string) =>
        supabase.from("bookings").select(cols).gte("created_at", `${since}T00:00:00Z`).in("status", ["confirmed", "completed"]).limit(10000);
      // booking_group_id is 0097; without it every booking counts on its own.
      let res = await query(`${base}, booking_group_id`);
      if (res.error) res = await query(base);
      if (res.error) console.error("[funnel] bookings load failed", res.error.message);
      if (live) setBookings((res.data ?? []) as unknown as FunnelBooking[]);
    };
    void load();
    return () => {
      live = false;
    };
  }, [since]);
  return bookings;
}

/** Bookings that count: made on Revamp (not entered by hand), a room group once. */
export function countedBookings(bookings: FunnelBooking[]): FunnelBooking[] {
  const seen = new Set<string>();
  return bookings.filter((b) => {
    if (b.provider === "direct") return false;
    const key = b.booking_group_id || b.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const STAGES: StageKey[] = ["impressions", "ctr", "visits", "conversion", "outcome"];

/** Phone-width step names (five columns of ~60px) — plain words, no abbreviations. */
function shortLabel(stage: StageKey, actions: boolean): string {
  return { impressions: "Seen", ctr: "Click rate", visits: "Visits", conversion: actions ? "Action rate" : "Book rate", outcome: actions ? "Actions" : "Bookings" }[stage];
}

/** One-line explanation shown in the step-name tooltip (tap on phones, hover on desktop). */
function tipText(stage: StageKey, actions: boolean): string {
  switch (stage) {
    case "impressions":
      return "How many times the listing card was shown in search, lists or on the map.";
    case "ctr":
      return "Out of everyone who saw the card, the share who clicked it. Often shortened to CTR.";
    case "visits":
      return "How many times the listing page was opened.";
    case "conversion":
      return actions ? "Out of all page visits, the share that led to an action." : "Out of all page visits, the share that became a booking.";
    case "outcome":
      return actions ? "Taps on directions, website, call or menu." : "Confirmed bookings made on Revamp.";
  }
}

function stageCopy(stage: StageKey, actions: boolean): { label: string; help: string } {
  switch (stage) {
    case "impressions":
      return { label: "Impressions", help: "Times a listing card was shown to a traveller on Revamp — in search results, lists or on the map." };
    case "ctr":
      return { label: "Click-through rate", help: "Card clicks ÷ impressions: how often someone who saw the card opened the listing." };
    case "visits":
      return { label: "Page visits", help: "Opens of the listing page — from a card, Google, or a shared link." };
    case "conversion":
      return actions
        ? { label: "Action rate", help: "Actions ÷ page visits." }
        : { label: "Conversion rate", help: "Bookings ÷ page visits." };
    case "outcome":
      return actions
        ? { label: "Actions", help: "Taps on directions, website, call or menu." }
        : { label: "Bookings", help: "Confirmed bookings made on Revamp in this period (several rooms in one checkout count once; bookings entered by hand aren't counted)." };
  }
}

const fmtCount = (n: number) => n.toLocaleString("en-US");
const fmtStage = (stage: StageKey, v: number | null) => (isRateStage(stage) ? formatRate(v) : fmtCount(v ?? 0));

export function PerformanceFunnel({
  rows,
  listingMeta,
  ids,
  days,
  bookings,
  focus,
}: {
  /** Engagement rows for the period (any listings — filtered here by `ids`). */
  rows: Row[];
  listingMeta: Map<string, { type: string }>;
  /** Listings the dashboard's filters select. */
  ids: Set<string>;
  /** The period, oldest first (ISO days). */
  days: string[];
  /** From useFunnelBookings (null while loading). */
  bookings: FunnelBooking[] | null;
  /** When the graph is narrowed to one listing from the table below. */
  focus?: { title: string; onClear: () => void };
}) {
  const [stage, setStage] = useState<StageKey>("impressions");
  // Bookable listings get the bookings funnel; only when the filter selects
  // nothing bookable (restaurants / places) does it switch to actions.
  const { scopeIds, actions, leftOut } = useMemo(() => {
    const bookable = new Set<string>();
    let venues = 0;
    ids.forEach((id) => {
      const t = listingMeta.get(id)?.type;
      if (t && BOOKABLE.has(t)) bookable.add(id);
      else venues++;
    });
    if (bookable.size === 0) return { scopeIds: ids, actions: true, leftOut: 0 };
    return { scopeIds: bookable, actions: false, leftOut: venues };
  }, [ids, listingMeta]);

  // Per-day counts → any bucket's counts are a sum.
  const perDay = useMemo(() => {
    const m = new Map<string, FunnelCounts>();
    const at = (day: string) => {
      let c = m.get(day);
      if (!c) {
        c = { impressions: 0, clicks: 0, visits: 0, outcome: 0 };
        m.set(day, c);
      }
      return c;
    };
    for (const r of rows) {
      if (!scopeIds.has(r.listing_id)) continue;
      if (r.kind === "impression") at(r.day).impressions += r.count;
      else if (r.kind === "card_click") at(r.day).clicks += r.count;
      else if (r.kind === "view") at(r.day).visits += r.count;
      else if (actions && ACTION_KINDS.has(r.kind)) at(r.day).outcome += r.count;
    }
    if (!actions && bookings) {
      for (const b of countedBookings(bookings)) if (scopeIds.has(b.listing_id)) at(b.created_at.slice(0, 10)).outcome += 1;
    }
    return m;
  }, [rows, scopeIds, actions, bookings]);

  const sum = (ds: string[]): FunnelCounts => {
    const c: FunnelCounts = { impressions: 0, clicks: 0, visits: 0, outcome: 0 };
    for (const d of ds) {
      const x = perDay.get(d);
      if (!x) continue;
      c.impressions += x.impressions;
      c.clicks += x.clicks;
      c.visits += x.visits;
      c.outcome += x.outcome;
    }
    return c;
  };
  const totals = useMemo(() => sum(days), [perDay, days]);
  // The trend uses whole weeks only: a 2-day leftover would draw a fake dip.
  const buckets = useMemo(() => {
    const all = bucketDays(days);
    const full = all.filter((b) => !b.partial);
    return full.length >= 2 ? full : all;
  }, [days]);
  const series = useMemo(() => buckets.map((b) => ({ bucket: b, value: stageValue(sum(b.days), stage) })), [buckets, perDay, stage]);

  const loading = !actions && bookings === null;
  const empty = totals.impressions + totals.visits + totals.outcome === 0;
  const period = `${bucketLabel(days[0], days[days.length - 1])} ${days[days.length - 1].slice(0, 4)}`;
  const current = stageCopy(stage, actions);

  return (
    <section className="border border-basalt/10 bg-paper" aria-label="Listing performance">
      <div className="p-5 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold text-basalt">Listing performance</h2>
          <p className="text-xs tabular-nums text-basalt/50">{period}</p>
        </div>
        {focus && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-apricot/10 px-2.5 py-0.5 font-semibold text-basalt">{focus.title}</span>
            <button type="button" onClick={focus.onClear} className="text-xs font-semibold text-apricot hover:underline">
              Show all listings
            </button>
          </p>
        )}
        <p className="mt-1 text-sm text-basalt/60">
          {actions
            ? "From seeing the card in search to an action — directions, website, call or menu."
            : "From seeing the card in search to booking."}
          {leftOut > 0 && <span className="text-basalt/45"> Restaurants and places aren't booked on Revamp, so they're left out here.</span>}
        </p>

        <Funnel totals={totals} stage={stage} onSelect={setStage} actions={actions} loading={loading} />
      </div>

      <div className="border-t border-basalt/10 p-5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-basalt">{current.label}</p>
          <InfoTip text={current.help} label={current.label} />
        </div>
        <p className="mt-1 font-display text-3xl font-normal tabular-nums text-basalt">{loading ? "…" : fmtStage(stage, stageValue(totals, stage))}</p>
        <p className="mt-1 max-w-[65ch] text-sm text-basalt/55">{current.help}</p>
        {empty && !loading ? (
          <p className="mt-6 text-sm text-basalt/45">No activity in this period yet. Numbers build up as travellers browse.</p>
        ) : (
          <TrendChart series={series} stage={stage} loading={loading} />
        )}
      </div>
    </section>
  );
}

/* ── Funnel ─────────────────────────────────────────────────────────────── */

function Funnel({
  totals,
  stage,
  onSelect,
  actions,
  loading,
}: {
  totals: FunnelCounts;
  stage: StageKey;
  onSelect: (s: StageKey) => void;
  actions: boolean;
  loading: boolean;
}) {
  // Step-name tooltip: opens on tap (phones) or click, closes after a few seconds or on any other tap.
  const [tip, setTip] = useState<StageKey | null>(null);
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const t = setTimeout(close, 5000);
    document.addEventListener("pointerdown", close);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", close);
    };
  }, [tip]);
  const ticks = niceTicks(Math.max(totals.impressions, totals.visits, totals.outcome, 1), true);
  const top = ticks[ticks.length - 1];
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(1.2, (v / top) * 100));
  const h = { impressions: pct(totals.impressions), visits: pct(totals.visits), outcome: pct(loading ? 0 : totals.outcome) };
  const bar = (key: "impressions" | "visits" | "outcome") => ({ key, height: h[key], value: key === "impressions" ? totals.impressions : key === "visits" ? totals.visits : totals.outcome });
  const cols: ({ kind: "bar"; key: StageKey; height: number; value: number } | { kind: "rate"; key: StageKey; from: number; to: number; value: number | null })[] = [
    { kind: "bar", ...bar("impressions") },
    { kind: "rate", key: "ctr", from: h.impressions, to: h.visits, value: stageValue(totals, "ctr") },
    { kind: "bar", ...bar("visits") },
    { kind: "rate", key: "conversion", from: h.visits, to: h.outcome, value: loading ? null : stageValue(totals, "conversion") },
    { kind: "bar", ...bar("outcome") },
  ];

  return (
    <div className="mt-5">
      <div className="flex">
        {/* y axis */}
        <div className="relative w-9 shrink-0 text-[10px] tabular-nums text-basalt/40" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-2" style={{ bottom: `calc(${(t / top) * 100}% - 0.5em)` }}>
              {t >= 1000 ? `${Number((t / 1000).toFixed(1))}K` : t}
            </span>
          ))}
        </div>
        <div className="relative h-40 flex-1 sm:h-48">
          {ticks.map((t) => (
            <div key={t} aria-hidden className="absolute inset-x-0 border-t border-basalt/[0.07]" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 grid grid-cols-5">
            {cols.map((c) =>
              c.kind === "bar" ? (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onSelect(c.key)}
                  aria-label={`${stageCopy(c.key, actions).label}: ${fmtCount(c.value)}`}
                  className="group relative h-full focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "absolute inset-x-1 bottom-0 rounded-t-md transition-colors sm:inset-x-2",
                      stage === c.key ? "bg-apricot" : "bg-apricot/35 group-hover:bg-apricot/55",
                      "group-focus-visible:ring-2 group-focus-visible:ring-basalt/40",
                    )}
                    style={{ height: `${c.height}%` }}
                  />
                  <span
                    className={cn("absolute inset-x-0 text-center text-[11px] font-semibold tabular-nums sm:text-xs", stage === c.key ? "text-basalt" : "text-basalt/55")}
                    style={{ bottom: `calc(${c.height}% + 4px)` }}
                  >
                    {loading && c.key === "outcome" ? "…" : fmtCount(c.value)}
                  </span>
                </button>
              ) : (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onSelect(c.key)}
                  aria-label={`${stageCopy(c.key, actions).label}: ${formatRate(c.value)}`}
                  className="group relative h-full focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={cn("absolute inset-0 transition-colors", stage === c.key ? "bg-apricot/20" : "bg-apricot/[0.08] group-hover:bg-apricot/15")}
                    style={{ clipPath: `polygon(0 ${100 - c.from}%, 100% ${100 - c.to}%, 100% 100%, 0 100%)` }}
                  />
                  <span
                    className={cn(
                      "absolute inset-x-0 top-[42%] text-center text-xs font-semibold tabular-nums sm:text-sm",
                      stage === c.key ? "text-apricot" : "text-basalt/50",
                      "group-focus-visible:underline",
                    )}
                  >
                    {formatRate(c.value)}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      </div>
      {/* step names */}
      <div className="ml-9 mt-2 grid grid-cols-5 border-t border-basalt/15 pt-2" role="tablist" aria-label="Funnel step">
        {STAGES.map((s, i) => (
          <div key={s} className="group relative flex justify-center">
            <button
              type="button"
              role="tab"
              aria-selected={stage === s}
              aria-describedby={`funnel-tip-${s}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onSelect(s);
                setTip((t) => (t === s ? null : s));
              }}
              className={cn(
                "px-0.5 text-center text-[11px] leading-tight underline-offset-4 transition-colors sm:text-sm",
                stage === s ? "font-semibold text-basalt underline decoration-apricot decoration-2" : "text-basalt/55 hover:text-basalt",
              )}
            >
              <span className="hidden sm:inline">{stageCopy(s, actions).label}</span>
              <span className="sm:hidden" aria-hidden>{shortLabel(s, actions)}</span>
              <span className="sr-only sm:hidden">{stageCopy(s, actions).label}</span>
            </button>
            <span
              id={`funnel-tip-${s}`}
              role="tooltip"
              style={{ width: "13rem", maxWidth: "calc(100vw - 3rem)" }}
              className={cn(
                "pointer-events-none absolute top-full z-20 mt-2 rounded-md bg-basalt px-3 py-2 text-left text-[11px] leading-snug text-paper shadow-lg",
                i === 0 ? "left-0" : i === STAGES.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
                tip === s ? "block" : "hidden sm:group-hover:block",
              )}
            >
              <span className="block font-semibold">{stageCopy(s, actions).label}</span>
              {tipText(s, actions)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Trend line ─────────────────────────────────────────────────────────── */

function TrendChart({ series, stage, loading }: { series: { bucket: Bucket; value: number | null }[]; stage: StageKey; loading: boolean }) {
  const values = series.map((s) => s.value ?? 0);
  const ticks = niceTicks(Math.max(...values, 1), !isRateStage(stage));
  const top = ticks[ticks.length - 1];
  const n = series.length;
  const xPct = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const yPct = (v: number) => 100 - (v / top) * 100;
  // SVG space: 1000 × 100, stretched to the box (strokes don't scale).
  const pts = values.map((v, i) => ({ x: xPct(i) * 10, y: yPct(v) }));
  const segs = monotoneSegments(pts);
  const linePath = pts.length ? [`M${pts[0].x},${pts[0].y}`, ...segs].join(" ") : "";
  const areaPath = pts.length > 1 ? `M${pts[0].x},100 L${pts[0].x},${pts[0].y} ${segs.join(" ")} L${pts[n - 1].x},100 Z` : "";
  const label = (v: number) => (isRateStage(stage) ? `${Number(v.toFixed(2))}%` : v >= 1000 ? `${Number((v / 1000).toFixed(1))}K` : `${v}`);
  // Fewer x labels on phones.
  const every = Math.max(1, Math.ceil(n / 6));
  const everyPhone = Math.max(1, Math.ceil(n / 3));

  return (
    <div className={cn("mt-6", loading && "opacity-50")}>
      <div className="flex">
        <div className="relative w-10 shrink-0 text-[10px] tabular-nums text-basalt/40" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-2" style={{ bottom: `calc(${(t / top) * 100}% - 0.5em)` }}>
              {label(t)}
            </span>
          ))}
        </div>
        <div className="relative h-44 flex-1 sm:h-56" role="img" aria-label={`${stage} trend: ${series.map((s) => `${s.bucket.label} ${fmtStage(stage, s.value)}`).join(", ")}`}>
          {ticks.map((t) => (
            <div key={t} aria-hidden className={cn("absolute inset-x-0 border-t", t === 0 ? "border-basalt/20" : "border-basalt/[0.07]")} style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {areaPath && <path d={areaPath} fill="var(--color-apricot, #F15822)" fillOpacity={0.07} stroke="none" />}
            <path d={linePath} fill="none" stroke="var(--color-basalt, #212121)" strokeWidth={2.25} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          </svg>
          {series.map((s, i) => (
            <div key={s.bucket.label} className="group absolute -translate-x-1/2 translate-y-1/2" style={{ left: `${xPct(i)}%`, bottom: `${100 - yPct(values[i])}%` }}>
              <span
                tabIndex={0}
                className={cn(
                  "block h-2.5 w-2.5 rounded-full border-2 border-paper outline-none ring-basalt/30 focus-visible:ring-2",
                  i === n - 1 ? "bg-apricot" : "bg-basalt",
                )}
              />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-basalt px-2 py-1 text-[11px] font-semibold tabular-nums text-paper group-hover:block group-focus-within:block">
                {s.bucket.label}
                {s.bucket.partial ? ` (${s.bucket.days.length} days)` : ""} · {fmtStage(stage, s.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative ml-10 mt-2 h-4 text-[10px] text-basalt/45 sm:text-[11px]" aria-hidden>
        {series.map((s, i) => {
          const showPhone = i % everyPhone === 0;
          const showWide = i % every === 0;
          if (!showPhone && !showWide) return null;
          const edge = i === 0 ? "translate-x-0" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2";
          // Phones get every `everyPhone`-th label, wider screens every `every`-th — never both sets at once.
          const vis = showPhone && showWide ? "" : showPhone ? "sm:hidden" : "hidden sm:inline";
          return (
            <span key={s.bucket.label} className={cn("absolute top-0 whitespace-nowrap", edge, vis)} style={{ left: `${xPct(i)}%` }}>
              {s.bucket.label}
            </span>
          );
        })}
      </div>
      {n > 1 && series[0].bucket.days.length === 7 && (
        <p className="ml-10 mt-2 text-[11px] text-basalt/45">By week, ending today · last {n} full weeks.</p>
      )}
    </div>
  );
}
