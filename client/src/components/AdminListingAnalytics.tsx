/**
 * Admin per-listing engagement analytics (migration 0068). Reads the daily
 * counters (admin-only RLS) and shows, per listing, last-30-day totals —
 * impressions, detail views, directions, saves — plus a views sparkline.
 * Restaurants are the default focus (the "convincing numbers" for eat
 * monetization), with a toggle to see all types. Real measured events only.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useListings } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

type Row = { listing_id: string; day: string; kind: string; count: number };
const WINDOW_DAYS = 30;

function dayList(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return days;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 28;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-apricot" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <div className="min-w-[64px]">
      <p className="font-display text-xl font-normal tabular-nums text-basalt">{n.toLocaleString("en-US")}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
    </div>
  );
}

export function AdminListingAnalytics() {
  const { listings } = useListings();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"eat" | "all">("eat");

  useEffect(() => {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    supabase
      .from("listing_analytics_daily")
      .select("listing_id, day, kind, count")
      .gte("day", since)
      .then(({ data }) => {
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
  }, []);

  const days = useMemo(() => dayList(WINDOW_DAYS), []);
  const dayIndex = useMemo(() => new Map(days.map((d, i) => [d, i])), [days]);

  const perListing = useMemo(() => {
    const map = new Map<string, { byKind: Record<string, number>; views: number[] }>();
    for (const r of rows) {
      let e = map.get(r.listing_id);
      if (!e) {
        e = { byKind: {}, views: new Array(days.length).fill(0) };
        map.set(r.listing_id, e);
      }
      e.byKind[r.kind] = (e.byKind[r.kind] ?? 0) + r.count;
      if (r.kind === "view") {
        const i = dayIndex.get(r.day);
        if (i != null) e.views[i] += r.count;
      }
    }
    return map;
  }, [rows, days.length, dayIndex]);

  const shown = useMemo(() => {
    return listings
      .filter((l) => (scope === "eat" ? l.type === "eat" : true))
      .map((l) => ({ listing: l, stats: perListing.get(l.id) }))
      .sort((a, b) => (b.stats?.byKind.view ?? 0) - (a.stats?.byKind.view ?? 0) || (b.stats?.byKind.impression ?? 0) - (a.stats?.byKind.impression ?? 0));
  }, [listings, perListing, scope]);

  const totalEvents = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-display text-3xl font-normal text-basalt">Analytics</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">Per-listing engagement over the last {WINDOW_DAYS} days — real measured events. These are the numbers to show a restaurant when pitching a featured placement or premium listing.</p>
      </div>

      <div className="flex items-center gap-2">
        {(["eat", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn("rounded-none border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors", scope === s ? "border-apricot bg-apricot/10 text-basalt" : "border-basalt/15 text-basalt/55 hover:border-apricot/60")}
          >
            {s === "eat" ? "Restaurants" : "All listings"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : totalEvents === 0 ? (
        <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">
          No activity recorded yet. Events start accumulating once this build is live and visitors browse the listings.
        </div>
      ) : (
        <div className="grid gap-3">
          {shown.map(({ listing, stats }) => (
            <div key={listing.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 border border-basalt/10 bg-paper p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-basalt">{listing.title}</p>
                <p className="truncate text-xs uppercase tracking-[0.1em] text-basalt/45">{listing.type} · {listing.city}</p>
              </div>
              <div className="flex items-center gap-5">
                <Tile n={stats?.byKind.impression ?? 0} label="Seen" />
                <Tile n={stats?.byKind.view ?? 0} label="Views" />
                <Tile n={stats?.byKind.directions ?? 0} label="Directions" />
                <Tile n={stats?.byKind.save ?? 0} label="Saves" />
              </div>
              <div className="text-basalt/50">{stats ? <Sparkline values={stats.views} /> : <span className="text-xs">—</span>}</div>
            </div>
          ))}
          {shown.length === 0 && <p className="text-sm text-basalt/45">No listings in this view.</p>}
        </div>
      )}
    </div>
  );
}
