/**
 * Analytics → "Upcoming events & pricing" (0102). For each verified upcoming
 * event that touches one of the operator's listings (same city, or nationwide
 * like a public holiday) it shows, per listing:
 *   - your price on those dates (per-date rate, else base),
 *   - what similar Revamp listings ask on those dates (same type + city, median,
 *     at least 3 of them — otherwise we say there isn't enough to compare),
 *   - a suggestion when you're noticeably below them, with "Apply" that writes
 *     a per-date price for the event dates. Never automatic; honest wording:
 *     it's what similar hosts ASK, not a promise of bookings.
 * Hotels (priced per room type) link to the Calendar instead of applying.
 */
import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { SubHeader } from "@/components/PageHeader";
import { withoutDays } from "@/components/OperatorMultiCalendar";
import { eventAffects, IMPACT_LABEL, useEvents, type MarketEvent } from "@/lib/events";
import { userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const fmtRange = (a: string, b: string) => {
  const f = (iso: string, withMonth = true) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", withMonth ? { day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", timeZone: "UTC" });
  return a === b ? f(a) : a.slice(0, 7) === b.slice(0, 7) ? `${f(a, false)}–${f(b)}` : `${f(a)} – ${f(b)}`;
};
const days = (a: string, b: string) => {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
};
/** Average price (cents) a listing asks over the given days. */
function askOver(l: LiveListing, ds: string[]): number {
  const base = Math.round(l.price * 100);
  if (!ds.length) return base;
  const sum = ds.reduce((acc, d) => {
    const r = (l.seasonalRates ?? []).filter((x) => x.start <= d && d <= x.end).pop();
    return acc + (r ? r.priceCents : base);
  }, 0);
  return Math.round(sum / ds.length);
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const roundAmd = (cents: number) => Math.round(cents / 100_000) * 100_000; // nearest ֏1,000

/** `embedded`: the page supplies the title/description (Dashboard → Analytics → Events & pricing); only the filter shows here. */
export function EventInsights({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { listings, setSeasonalRates } = useListings();
  const { format } = useCurrency();
  const from = todayIso();
  const to = addDays(from, 120);
  const events = useEvents(from, to);
  const [applying, setApplying] = useState<string | null>(null);

  const mine = useMemo(() => listings.filter((l) => l.operatorId === user?.id && l.status === "published" && l.isActive !== false && l.type !== "eat" && l.type !== "place"), [listings, user?.id]);
  const market = useMemo(() => listings.filter((l) => l.status === "published" && l.isActive !== false && l.operatorId !== user?.id && l.price > 0), [listings, user?.id]);

  // Events worth acting on: medium/high impact, touching at least one of my listings.
  const relevant = useMemo(
    () =>
      events
        .filter((e) => e.impact !== "low" && e.end >= from)
        .map((e) => ({ e, listings: mine.filter((l) => eventAffects(e, l.city, l.region)) }))
        .filter((x) => x.listings.length > 0)
        .slice(0, 40),
    [events, mine, from],
  );

  const apply = async (l: LiveListing, e: MarketEvent, cents: number) => {
    const key = `${l.id}:${e.id}`;
    setApplying(key);
    try {
      const start = e.start < from ? from : e.start;
      await setSeasonalRates(l.id, [...withoutDays(l.seasonalRates ?? [], start, e.end), { start, end: e.end, priceCents: cents, label: e.title.slice(0, 60) }]);
      toast.success(`${l.title}: ${format(cents)} set for ${fmtRange(start, e.end)}.`);
    } catch (err) {
      toast(userMessage(err, "Couldn't save the price."));
    } finally {
      setApplying(null);
    }
  };

  // Per event: each affected listing's price vs similar Revamp listings, and a suggestion.
  const rowsFor = (e: MarketEvent, ls: LiveListing[]) =>
    ls.map((l) => {
      const ds = days(e.start < from ? from : e.start, e.end);
      const yours = askOver(l, ds);
      const peers = market.filter((m) => m.type === l.type && m.city.trim().toLowerCase() === l.city.trim().toLowerCase());
      const enough = peers.length >= 3;
      const med = enough ? median(peers.map((p) => askOver(p, ds))) : 0;
      const suggest = enough && !l.multiRoom && yours > 0 && yours < med * 0.95 ? roundAmd(med) : 0;
      return { l, ds, yours, peers: peers.length, enough, med, suggest, unit: l.type === "stay" ? "night" : l.priceUnit || "person" };
    });
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [bigOnly, setBigOnly] = useState(false);
  const list = relevant.filter((x) => !bigOnly || x.e.impact === "high");
  const shown = showAll ? list : list.slice(0, 6);
  const anyComparison = relevant.some(({ e, listings: ls }) => rowsFor(e, ls).some((r) => r.enough));

  if (!mine.length) return null;

  return (
    <section>
      {(() => {
        const filter = relevant.length > 0 ? (
            <div role="group" aria-label="Show" className="inline-flex rounded-full border border-basalt/15 bg-paper p-1">
              {([
                [false, "All"],
                [true, "Big demand"],
              ] as const).map(([v, label]) => (
                <button key={label} type="button" aria-pressed={bigOnly === v} onClick={() => setBigOnly(v)} className={cn("h-8 rounded-full px-3 text-xs font-semibold", bigOnly === v ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt")}>
                  {label}
                </button>
              ))}
            </div>
          ) : undefined;
        return embedded ? (
          filter && <div className="mb-3 flex justify-end">{filter}</div>
        ) : (
          <SubHeader title="Upcoming events & pricing" sub="Holidays, festivals, concerts and matches found automatically from public sources, next four months." actions={filter} />
        );
      })()}
      {list.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-6 text-sm text-basalt/70">No notable events near your listings in the next four months yet. The list refreshes every week.</p>
      ) : (
        <>
          {!anyComparison && (
            <p className="mb-3 text-sm text-basalt/60">Price comparisons appear once at least 3 similar Revamp listings (same type, same city) are live — until then, use these dates to set your own event prices in Calendar.</p>
          )}
          <ul className="divide-y divide-basalt/10 border border-basalt/10 bg-paper">
            {shown.map(({ e, listings: ls }) => {
              const rows = rowsFor(e, ls);
              const sugg = rows.filter((r) => r.suggest > 0);
              const cmp = rows.filter((r) => r.enough);
              const noCmp = rows.filter((r) => !r.enough);
              const isOpen = open === e.id;
              const d = new Date(e.start + "T00:00:00Z");
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : e.id)}
                    aria-expanded={isOpen}
                    className="grid w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-chalk/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-apricot"
                  >
                    <span className="text-center leading-tight">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-basalt/60">{d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
                      <span className="block font-display text-xl tabular-nums">{d.getUTCDate()}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{e.title}</span>
                      <span className="block truncate text-xs text-basalt/60">
                        {fmtRange(e.start, e.end)} · {e.city ?? "Nationwide"}
                        {e.expectedAttendance ? ` · ~${e.expectedAttendance.toLocaleString()} expected` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className={cn("hidden rounded-full px-2.5 py-0.5 text-[11px] font-bold sm:inline", e.impact === "high" ? "bg-apricot/15 text-apricot" : "bg-basalt/10 text-basalt/70")}>{IMPACT_LABEL[e.impact]}</span>
                      <span className={cn("text-xs font-semibold", sugg.length ? "text-basalt" : "text-basalt/55")}>
                        {sugg.length ? `${sugg.length} price suggestion${sugg.length === 1 ? "" : "s"}` : `${ls.length} listing${ls.length === 1 ? "" : "s"}`}
                      </span>
                      <ChevronDown className={cn("h-4 w-4 text-basalt/50 transition-transform", isOpen && "rotate-180")} />
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-basalt/8 bg-chalk/40 px-4 pb-4 pt-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-basalt/70">
                        {e.summary && <span className="max-w-2xl">{e.summary}</span>}
                        {e.venue && <span>· {e.venue}</span>}
                        {e.sourceUrl && (
                          <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot">
                            {e.sourceName ?? "Source"} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      {cmp.length > 0 && (
                        <div className="mt-2 divide-y divide-basalt/8">
                          {cmp.map((r) => (
                            <div key={r.l.id} className="grid grid-cols-2 items-center gap-x-6 gap-y-1.5 py-2.5 text-sm lg:grid-cols-[minmax(0,1fr)_10rem_15rem_10rem]">
                              <span className="col-span-2 min-w-0 truncate font-medium lg:col-span-1">{r.l.title}</span>
                              <span className="tabular-nums text-basalt/70">You: <strong className="text-basalt">{r.yours > 0 ? format(r.yours) : "—"}</strong> / {r.unit}</span>
                              <span className="tabular-nums text-basalt/70">Similar: <strong className="text-basalt">{format(r.med)}</strong> <span className="text-basalt/50">({r.peers})</span></span>
                              {r.suggest ? (
                                <button
                                  type="button"
                                  disabled={applying === `${r.l.id}:${e.id}`}
                                  onClick={() => void apply(r.l, e, r.suggest)}
                                  className="col-span-2 inline-flex h-9 items-center justify-center gap-1.5 justify-self-start rounded-none bg-basalt px-3 text-xs font-semibold text-paper hover:bg-basalt/90 disabled:opacity-50 lg:col-span-1 lg:justify-self-end"
                                  title={`Sets ${format(r.suggest)} per ${r.unit} for ${fmtRange(r.ds[0], e.end)}`}
                                >
                                  <Sparkles className="h-3.5 w-3.5 text-apricot" /> {applying === `${r.l.id}:${e.id}` ? "Applying…" : `Apply ${format(r.suggest)}`}
                                </button>
                              ) : (
                                <span className="col-span-2 text-xs text-basalt/60 lg:col-span-1 lg:text-right">{r.l.multiRoom ? "Set room-type prices in Calendar" : "In line with similar listings"}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {noCmp.length > 0 && (
                        <p className="mt-2 text-sm text-basalt/60">
                          {cmp.length > 0 ? "Also affects " : "Affects "}
                          {noCmp.length === 1 ? noCmp[0].l.title : `${noCmp.length} of your listings`} — not enough similar Revamp listings nearby to compare yet.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {list.length > 6 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-sm font-semibold text-basalt/70 underline-offset-4 hover:text-apricot hover:underline">
              {showAll ? "Show fewer" : `Show all ${list.length} events`}
            </button>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-basalt/55">Suggestions compare what similar Revamp listings ask — they aren't a promise of bookings. Nothing changes until you click Apply.</p>
    </section>
  );
}
