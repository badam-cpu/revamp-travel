/**
 * Engagement analytics dashboard, shared by admins and operators (migration 0068
 * for the data, 0077 for the operator read policy). Reads the daily per-listing
 * counters (impressions / views / clicks / directions / saves / shares / eat
 * intents) RLS-scoped: an admin sees every listing; an operator sees ONLY their
 * own listings (which never includes restaurants, since operators can't own
 * 'eat'). Shows KPI tiles, a daily trend graph for a selectable metric, and a
 * per-listing breakdown, with standard filters (date range / type / listing).
 * Real measured events only — no fabricated numbers.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { InfoTip } from "@/components/InfoTip";
import { METRIC_INFO } from "@/lib/metricInfo";
import { cn } from "@/lib/utils";

type Row = { listing_id: string; day: string; kind: string; count: number };
const help = (kind: string) => METRIC_INFO[kind]?.help ?? "";

const TYPE_ORDER = ["stay", "tour", "experience", "eat"] as const;
const TYPE_LABEL: Record<string, string> = { stay: "Stays", tour: "Tours", experience: "Experiences", eat: "Restaurants" };

// Metrics shown as KPI tiles / graph options. The first six apply to every
// listing type; the eat intents (website/call/menu) only render when present.
const BASE_METRICS = [
  { kind: "impression", label: "Impressions" },
  { kind: "view", label: "Views" },
  { kind: "card_click", label: "Clicks" },
  { kind: "directions", label: "Directions" },
  { kind: "save", label: "Saves" },
  { kind: "share", label: "Shares" },
] as const;
const EAT_METRICS = [
  { kind: "website", label: "Website" },
  { kind: "call", label: "Calls" },
  { kind: "menu", label: "Menu" },
] as const;

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function dayList(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return days;
}
const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt/60 hover:text-basalt",
      )}
    >
      {children}
    </button>
  );
}

export function AnalyticsDashboard({ scope }: { scope: "admin" | "operator" }) {
  const { user } = useAuth();
  const { listings } = useListings();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [type, setType] = useState<string>("all");
  const [listingId, setListingId] = useState<string>("all");
  const [metric, setMetric] = useState<string>("view");

  // Listings this viewer's analytics can cover.
  const scopeListings = useMemo(
    () => (scope === "operator" ? listings.filter((l) => (l as { operatorId?: string }).operatorId === user?.id) : listings),
    [listings, scope, user?.id],
  );
  const listingMeta = useMemo(() => new Map(scopeListings.map((l) => [l.id, l])), [scopeListings]);

  const availableTypes = useMemo(() => {
    const present = new Set(scopeListings.map((l) => l.type));
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [scopeListings]);

  useEffect(() => {
    let active = true;
    setRows(null);
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
    supabase
      .from("listing_analytics_daily")
      .select("listing_id, day, kind, count")
      .gte("day", since)
      .limit(20000)
      .then(({ data }) => {
        if (active) setRows((data as Row[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [windowDays]);

  // Which listing ids pass the current type/listing filter.
  const filteredIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of scopeListings) {
      if (type !== "all" && l.type !== type) continue;
      if (listingId !== "all" && l.id !== listingId) continue;
      ids.add(l.id);
    }
    return ids;
  }, [scopeListings, type, listingId]);

  const filteredRows = useMemo(() => (rows ?? []).filter((r) => filteredIds.has(r.listing_id)), [rows, filteredIds]);

  // KPI totals by kind + which metrics to show (base + any eat intents present).
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of filteredRows) t[r.kind] = (t[r.kind] ?? 0) + r.count;
    return t;
  }, [filteredRows]);
  const metrics = useMemo(() => {
    const extra = EAT_METRICS.filter((m) => (totals[m.kind] ?? 0) > 0);
    return [...BASE_METRICS, ...extra];
  }, [totals]);

  // Daily series for the selected graph metric.
  const days = useMemo(() => dayList(windowDays), [windowDays]);
  const series = useMemo(() => {
    const map: Record<string, number> = {};
    days.forEach((d) => (map[d] = 0));
    for (const r of filteredRows) if (r.kind === metric && r.day in map) map[r.day] += r.count;
    return days.map((d) => ({ day: d, value: map[d] }));
  }, [filteredRows, days, metric]);
  const seriesMax = Math.max(1, ...series.map((s) => s.value));
  const seriesTotal = series.reduce((s, b) => s + b.value, 0);
  const metricLabel = metrics.find((m) => m.kind === metric)?.label ?? "Views";

  // Per-listing breakdown, most-viewed first.
  const breakdown = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const r of filteredRows) {
      let e = map.get(r.listing_id);
      if (!e) { e = {}; map.set(r.listing_id, e); }
      e[r.kind] = (e[r.kind] ?? 0) + r.count;
    }
    return Array.from(map.entries())
      .map(([id, byKind]) => ({ listing: listingMeta.get(id), byKind }))
      .filter((x) => x.listing)
      .sort((a, b) => (b.byKind.view ?? 0) - (a.byKind.view ?? 0) || (b.byKind.impression ?? 0) - (a.byKind.impression ?? 0));
  }, [filteredRows, listingMeta]);

  // x-axis ticks: ~6 evenly spaced labels.
  const tickEvery = Math.max(1, Math.ceil(days.length / 6));

  const listingOptions = useMemo(
    () => scopeListings.filter((l) => type === "all" || l.type === type).sort((a, b) => a.title.localeCompare(b.title)),
    [scopeListings, type],
  );

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-display text-3xl font-normal text-basalt">Analytics</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">
          {scope === "operator"
            ? "How travelers engage with your listings — real measured events. Impressions are how often a card was seen; views are detail-page opens."
            : "Per-listing engagement across the marketplace — real measured events. Filter by type or a single listing; the restaurant numbers are the pitch for featured placements."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-basalt/10 bg-paper p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Range</span>
          {WINDOWS.map((w) => (
            <Chip key={w.days} active={windowDays === w.days} onClick={() => setWindowDays(w.days)}>{w.label}</Chip>
          ))}
        </div>
        {availableTypes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Type</span>
            <Chip active={type === "all"} onClick={() => { setType("all"); setListingId("all"); }}>All</Chip>
            {availableTypes.map((t) => (
              <Chip key={t} active={type === t} onClick={() => { setType(t); setListingId("all"); }}>{TYPE_LABEL[t]}</Chip>
            ))}
          </div>
        )}
        {listingOptions.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Listing</span>
            <select
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              className="h-8 max-w-[220px] rounded-none border border-basalt/15 bg-paper px-2 text-xs text-basalt"
            >
              <option value="all">All listings</option>
              {listingOptions.map((l) => (
                <option key={l.id} value={l.id}>{l.title}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {rows === null ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : scopeListings.length === 0 ? (
        <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
          Add a listing to start seeing analytics.
        </div>
      ) : (
        <>
          {/* KPI tiles — click to graph that metric */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {metrics.map((m) => (
              <button
                key={m.kind}
                type="button"
                onClick={() => setMetric(m.kind)}
                title={help(m.kind)}
                className={cn(
                  "border bg-paper p-4 text-left transition-colors",
                  metric === m.kind ? "border-apricot bg-apricot/5" : "border-basalt/10 hover:border-apricot/50",
                )}
              >
                <p className="font-display text-2xl font-normal tabular-nums text-basalt">{(totals[m.kind] ?? 0).toLocaleString("en-US")}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{m.label}</p>
              </button>
            ))}
          </div>

          {/* Trend graph */}
          <div className="border border-basalt/10 bg-paper p-5">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">{metricLabel} · last {windowDays} days</p>
              <p className="font-display text-2xl font-normal tabular-nums text-basalt">{seriesTotal.toLocaleString("en-US")}</p>
            </div>
            {seriesTotal === 0 ? (
              <p className="mt-8 text-sm text-basalt/45">No {metricLabel.toLowerCase()} in this range yet.</p>
            ) : (
              <>
                <div className="mt-5 flex h-40 items-end gap-px" role="img" aria-label={`${metricLabel} by day`}>
                  {series.map((b) => (
                    <div key={b.day} className="group relative flex flex-1 items-end" style={{ height: "100%" }}>
                      <div
                        className="w-full rounded-t-[2px] bg-apricot/80 transition-all group-hover:bg-apricot"
                        style={{ height: `${b.value === 0 ? 0 : Math.max(3, (b.value / seriesMax) * 100)}%` }}
                        title={`${shortDay(b.day)}: ${b.value.toLocaleString("en-US")}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-px">
                  {series.map((b, i) => (
                    <div key={b.day} className="flex-1 text-center text-[9px] text-basalt/35">
                      {i % tickEvery === 0 ? shortDay(b.day) : ""}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Per-listing breakdown */}
          {breakdown.length === 0 ? (
            <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
              No activity recorded in this range yet. Events accumulate as visitors browse.
            </div>
          ) : (
            <div className="overflow-x-auto border border-basalt/10">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-basalt/12 bg-chalk/40 text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
                    <th className="px-3 py-2.5 font-semibold">Listing</th>
                    {metrics.map((m) => (
                      <th key={m.kind} className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1">{m.label}<InfoTip text={help(m.kind)} label={m.label} /></span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map(({ listing, byKind }) => (
                    <tr key={listing!.id} className="border-b border-basalt/8 last:border-0">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-basalt">{listing!.title}</p>
                        <p className="text-[11px] uppercase tracking-[0.1em] text-basalt/45">{TYPE_LABEL[listing!.type] ?? listing!.type} · {listing!.city}</p>
                      </td>
                      {metrics.map((m) => (
                        <td key={m.kind} className="px-3 py-3 text-right tabular-nums text-basalt/70">{(byKind[m.kind] ?? 0) || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
