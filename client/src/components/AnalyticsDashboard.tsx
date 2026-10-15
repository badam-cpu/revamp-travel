/**
 * Engagement analytics dashboard, shared by admins and operators (migration 0068
 * for the data, 0077 for the operator read policy). Reads the daily per-listing
 * counters (impressions / views / clicks / directions / saves / shares / eat
 * intents) RLS-scoped: an admin sees every listing; an operator sees ONLY their
 * own listings (which never includes restaurants, since operators can't own
 * 'eat'). Two parts, with standard filters (date range / type / listing):
 *  - "Listing performance" (PerformanceFunnel): impressions → click-through →
 *    page visits → conversion → bookings, with a trend line;
 *  - a sortable per-listing table with the same steps (+ saves / shares /
 *    restaurant actions only when there are any). Clicking a row narrows the
 *    graph to that listing.
 * Real measured events only — no fabricated numbers.
 */
import { PageHeader } from "@/components/PageHeader";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { InfoTip } from "@/components/InfoTip";
import { METRIC_INFO } from "@/lib/metricInfo";
import { cn } from "@/lib/utils";
import { ACTION_KINDS, BOOKABLE, PerformanceFunnel, countedBookings, useFunnelBookings } from "@/components/PerformanceFunnel";
import { formatRate, rate } from "@/lib/funnel";

type Row = { listing_id: string; day: string; kind: string; count: number };
const help = (kind: string) => METRIC_INFO[kind]?.help ?? "";

const TYPE_ORDER = ["stay", "tour", "experience", "eat", "place"] as const;
const TYPE_LABEL: Record<string, string> = { stay: "Stays", tour: "Tours", experience: "Experiences", eat: "Restaurants", place: "Places" };

// Secondary engagement — a column only when some listing in the table has any.
const EXTRA_METRICS = [
  { kind: "directions", label: "Directions" },
  { kind: "website", label: "Website" },
  { kind: "call", label: "Calls" },
  { kind: "menu", label: "Menu" },
  { kind: "save", label: "Saves" },
  { kind: "share", label: "Shares" },
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

type SortKey = "title" | "impressions" | "ctr" | "visits" | "conv" | "outcome" | (typeof EXTRA_METRICS)[number]["kind"];
interface TableRow {
  id: string;
  title: string;
  type: string;
  city: string;
  bookable: boolean;
  impressions: number;
  clicks: number;
  visits: number;
  outcome: number | null; // bookings (bookable) or actions (restaurants/places)
  ctr: number | null;
  conv: number | null;
  extra: Record<string, number>;
}

/** `embedded`: the page around it supplies the header (Dashboard → Analytics tabs). */
export function AnalyticsDashboard({ scope, embedded = false }: { scope: "admin" | "operator"; embedded?: boolean }) {
  const { user } = useAuth();
  const { listings } = useListings();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [type, setType] = useState<string>("all");
  const [listingId, setListingId] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "impressions", desc: true });
  const graphRef = useRef<HTMLDivElement>(null);

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

  const days = useMemo(() => dayList(windowDays), [windowDays]);
  const bookings = useFunnelBookings(days[0]);

  useEffect(() => {
    let active = true;
    setRows(null);
    supabase
      .from("listing_analytics_daily")
      .select("listing_id, day, kind, count")
      .gte("day", days[0])
      .limit(20000)
      .then(({ data }) => {
        if (active) setRows((data as Row[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [days]);

  // The graph follows type + listing; the table follows type only (so a row
  // click narrows the graph without hiding the other rows).
  const typeListings = useMemo(() => scopeListings.filter((l) => type === "all" || l.type === type), [scopeListings, type]);
  const graphIds = useMemo(
    () => new Set(typeListings.filter((l) => listingId === "all" || l.id === listingId).map((l) => l.id)),
    [typeListings, listingId],
  );

  // One row per listing that is (or was in this period) live.
  const table = useMemo(() => {
    const byId = new Map<string, Record<string, number>>();
    for (const r of rows ?? []) {
      let e = byId.get(r.listing_id);
      if (!e) byId.set(r.listing_id, (e = {}));
      e[r.kind] = (e[r.kind] ?? 0) + r.count;
    }
    const booked = new Map<string, number>();
    for (const b of countedBookings(bookings ?? [])) booked.set(b.listing_id, (booked.get(b.listing_id) ?? 0) + 1);
    return typeListings
      .filter((l) => (l as { status?: string }).status === "published" || byId.has(l.id))
      .map<TableRow>((l) => {
        const k = byId.get(l.id) ?? {};
        const bookable = BOOKABLE.has(l.type);
        const actions = Array.from(ACTION_KINDS).reduce((sum, kind) => sum + (k[kind] ?? 0), 0);
        const outcome = bookable ? (bookings ? booked.get(l.id) ?? 0 : null) : actions;
        const impressions = k.impression ?? 0;
        const clicks = k.card_click ?? 0;
        const visits = k.view ?? 0;
        return {
          id: l.id,
          title: l.title,
          type: l.type,
          city: l.city,
          bookable,
          impressions,
          clicks,
          visits,
          outcome,
          ctr: rate(clicks, impressions),
          conv: outcome === null ? null : rate(outcome, visits),
          extra: k,
        };
      });
  }, [rows, bookings, typeListings]);

  const anyBookable = table.some((r) => r.bookable);
  const anyVenue = table.some((r) => !r.bookable);
  const outcomeLabel = anyBookable && anyVenue ? "Bookings / actions" : anyBookable ? "Bookings" : "Actions";
  const convLabel = anyBookable && anyVenue ? "Book / action rate" : anyBookable ? "Book rate" : "Action rate";
  const extras = EXTRA_METRICS.filter((m) => table.some((r) => (r.extra[m.kind] ?? 0) > 0));

  const sorted = useMemo(() => {
    const val = (r: TableRow): number | string | null => {
      switch (sort.key) {
        case "title":
          return r.title.toLowerCase();
        case "impressions":
        case "visits":
        case "ctr":
        case "conv":
        case "outcome":
          return r[sort.key];
        default:
          return r.extra[sort.key] ?? 0;
      }
    };
    return [...table].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      // Rates with nothing to divide by ("—") always go last.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const c = x < y ? -1 : x > y ? 1 : 0;
      return (sort.desc ? -c : c) || b.impressions - a.impressions;
    });
  }, [table, sort]);

  const listingOptions = useMemo(() => [...typeListings].sort((a, b) => a.title.localeCompare(b.title)), [typeListings]);
  const focused = listingId === "all" ? undefined : listingMeta.get(listingId);

  const pick = (id: string) => {
    setListingId((cur) => (cur === id ? "all" : id));
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    graphRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  const SortHead = ({ k, label, tip, align = "right" }: { k: SortKey; label: string; tip?: string; align?: "left" | "right" }) => (
    <th
      scope="col"
      aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("whitespace-nowrap px-3 py-2.5 font-semibold", align === "right" ? "text-right" : "text-left", k === "title" && "sticky left-0 z-[1] min-w-[150px] bg-chalk sm:min-w-[260px]")}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "justify-end")}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "title" }))}
          className={cn("inline-flex items-center gap-0.5 uppercase tracking-[0.08em] hover:text-basalt", sort.key === k && "text-basalt")}
        >
          {label}
          <span aria-hidden className={cn("text-[9px]", sort.key === k ? "opacity-100" : "opacity-0")}>{sort.desc ? "▼" : "▲"}</span>
        </button>
        {tip && <InfoTip text={tip} label={label} />}
      </span>
    </th>
  );

  return (
    <div className="grid min-w-0 gap-5">
      {!embedded && <PageHeader
        className="mb-0"
        title="Analytics"
        sub={
          scope === "operator"
            ? "How travellers find and book your listings."
            : "How travellers find and book listings across the marketplace."
        }
      />}

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
            <label htmlFor="analytics-listing" className="text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Listing</label>
            <select
              id="analytics-listing"
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
          <div ref={graphRef} className="min-w-0 scroll-mt-4">
            <PerformanceFunnel
              rows={rows}
              listingMeta={listingMeta}
              ids={graphIds}
              days={days}
              bookings={bookings}
              focus={focused ? { title: focused.title, onClear: () => setListingId("all") } : undefined}
            />
          </div>

          {/* Per-listing: the same steps, side by side */}
          {sorted.length > 0 && (
            <section aria-label="By listing" className="min-w-0">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-base font-semibold text-basalt">By listing</h2>
                <p className="text-xs text-basalt/50">Click a listing to see its own graph. Click a column to sort.</p>
              </div>
              <div className="overflow-x-auto border border-basalt/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-basalt/12 bg-chalk text-[11px] text-basalt/50">
                      <SortHead k="title" label="Listing" align="left" />
                      <SortHead k="impressions" label="Seen" tip={help("impression")} />
                      <SortHead k="ctr" label="Click rate" tip="Click-through rate: out of everyone who saw the card, the share who clicked it. Low? Try a stronger cover photo, title or price." />
                      <SortHead k="visits" label="Page visits" tip={help("view")} />
                      <SortHead k="conv" label={convLabel} tip="Out of all page visits, the share that became a booking (restaurants and places: an action). Low? Check photos, description, price and open dates." />
                      <SortHead k="outcome" label={outcomeLabel} tip="Confirmed bookings made on Revamp in this period (bookings entered by hand aren't counted). Restaurants and places: taps on directions, website, call or menu." />
                      {extras.map((m) => (
                        <SortHead key={m.kind} k={m.kind} label={m.label} tip={help(m.kind)} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => {
                      const active = listingId === r.id;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => pick(r.id)}
                          className={cn("cursor-pointer border-b border-basalt/8 last:border-0 transition-colors", active ? "bg-apricot/[0.07]" : "hover:bg-chalk/60")}
                        >
                          <td className={cn("sticky left-0 z-[1] px-3 py-3", active ? "bg-[color-mix(in_oklch,var(--color-apricot)_7%,var(--color-paper))]" : "bg-paper")}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                pick(r.id);
                              }}
                              aria-pressed={active}
                              className="text-left font-semibold text-basalt hover:underline focus-visible:underline focus-visible:outline-none"
                            >
                              {r.title}
                            </button>
                            <p className="text-[11px] uppercase tracking-[0.1em] text-basalt/45">{TYPE_LABEL[r.type] ?? r.type} · {r.city}</p>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{r.impressions ? r.impressions.toLocaleString("en-US") : "—"}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{formatRate(r.ctr)}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{r.visits ? r.visits.toLocaleString("en-US") : "—"}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{formatRate(r.conv)}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-basalt">{r.outcome === null ? "…" : r.outcome ? r.outcome.toLocaleString("en-US") : "—"}</td>
                          {extras.map((m) => (
                            <td key={m.kind} className="px-3 py-3 text-right tabular-nums text-basalt/70">{r.extra[m.kind] || "—"}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
