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
 *   - with fewer than 3 comparables (early marketplace), a rule-of-thumb
 *     suggestion instead: your usual price + an event markup the operator picks
 *     (+10/20/30% on big-demand dates, half on others), labelled as such.
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
/**
 * Does this event matter for this listing type? Stays: every event. Tours and
 * experiences: events that bring visitors with free time (conferences,
 * festivals, sports, exhibitions, crowd-drawing feasts) and big holidays —
 * not one-evening concerts, which barely move daytime tours.
 */
function mattersFor(l: LiveListing, e: MarketEvent): boolean {
  if (l.type === "stay") return true;
  if (e.kind === "holiday") return e.impact === "high";
  return ["conference", "festival", "sports", "exhibition", "religious"].includes(e.category);
}
const MARKUPS = [10, 20, 30];
const MARKUP_KEY = "revamp.eventMarkup";
const roundAmd = (cents: number) => Math.round(cents / 100_000) * 100_000; // nearest ֏1,000

/** `embedded`: the page supplies the title/description (Dashboard → Analytics → Events & pricing); only the filter shows here. */
export function EventInsights({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { listings, setSeasonalRates } = useListings();
  const { format } = useCurrency();
  const from = todayIso();
  const to = addDays(from, 365);
  const events = useEvents(from, to);
  const [applying, setApplying] = useState<string | null>(null);

  const mine = useMemo(() => listings.filter((l) => l.operatorId === user?.id && l.status === "published" && l.isActive !== false && l.type !== "eat" && l.type !== "place"), [listings, user?.id]);
  const market = useMemo(() => listings.filter((l) => l.status === "published" && l.isActive !== false && l.operatorId !== user?.id && l.price > 0), [listings, user?.id]);

  // Events worth acting on: medium/high impact, touching at least one of my listings.
  const relevant = useMemo(
    () =>
      events
        .filter((e) => e.status !== "cancelled" && e.impact !== "low" && e.end >= from)
        .map((e) => ({ e, listings: mine.filter((l) => eventAffects(e, l.city, l.region) && mattersFor(l, e)) }))
        .filter((x) => x.listings.length > 0)
        .slice(0, 80),
    [events, mine, from],
  );

  /** Set a per-date price for [start, end] (the event dates; tours: the days around it too). */
  const apply = async (l: LiveListing, e: MarketEvent, cents: number, start: string, end: string, source: "event_market" | "event_markup", basis: string) => {
    const key = `${l.id}:${e.id}`;
    setApplying(key);
    try {
      await setSeasonalRates(l.id, [...withoutDays(l.seasonalRates ?? [], start, end), { start, end, priceCents: cents, label: e.title.slice(0, 60), source, basis }]);
      toast.success(`${l.title}: ${format(cents)} set for ${fmtRange(start, end)}.`);
    } catch (err) {
      toast(userMessage(err, "Couldn't save the price."));
    } finally {
      setApplying(null);
    }
  };

  // Per event: each affected listing's price vs similar Revamp listings, and a suggestion.
  // Event markup (rule of thumb) for when there aren't 3 comparable listings yet:
  // the chosen % on big-demand dates, half of it (rounded to 5) on smaller ones.
  const [markup, setMarkup] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(MARKUP_KEY));
      return MARKUPS.includes(v) ? v : 20;
    } catch {
      return 20;
    }
  });
  const chooseMarkup = (v: number) => {
    setMarkup(v);
    try {
      localStorage.setItem(MARKUP_KEY, String(v));
    } catch {
      /* private mode — not remembered */
    }
  };
  const pctFor = (e: MarketEvent) => (e.impact === "high" ? markup : Math.max(5, Math.round(markup / 2 / 5) * 5));

  // Per event and listing: market comparison when ≥3 similar listings exist, else your usual price + the markup.
  const rowsFor = (e: MarketEvent, ls: LiveListing[]) =>
    ls.map((l) => {
      const activity = l.type !== "stay";
      // Tours/experiences: visitors book on the days AROUND an event (free day before/after), not during it.
      const winStart = activity ? addDays(e.start, -1) : e.start;
      const winEnd = activity ? addDays(e.end, 1) : e.end;
      const ds = days(winStart < from ? from : winStart, winEnd);
      const yours = askOver(l, ds);
      const usual = Math.round(l.price * 100);
      const peers = market.filter((m) => m.type === l.type && m.city.trim().toLowerCase() === l.city.trim().toLowerCase());
      const enough = peers.length >= 3;
      const med = enough ? median(peers.map((p) => askOver(p, ds))) : 0;
      // A sharp jump loses tour bookings faster than hotel nights: half the stay markup.
      const pct = activity ? Math.max(5, Math.round(pctFor(e) / 2 / 5) * 5) : pctFor(e);
      const target = enough ? roundAmd(med) : roundAmd(usual * (1 + pct / 100));
      const priced = yours > 0 && yours >= (enough ? med * 0.95 : target);
      const suggest = !l.multiRoom && usual > 0 && !priced ? target : 0;
      const hints: string[] = [];
      if (activity && e.end > e.start && (e.category === "conference" || e.category === "festival" || e.category === "sports" || e.category === "exhibition")) hints.push("Visitors in town for several days — consider opening extra sessions or dates.");
      if (activity && e.category === "sports" && e.city) hints.push(`Road closures are likely in ${e.city} on the event day — check your route.`);
      return { l, ds, yours, usual, pct, peers: peers.length, enough, med, suggest, priced, hints, activity, unit: l.type === "stay" ? "night" : l.priceUnit || "person" };
    });
  // Cancelled events where the operator had applied an event price (rates labelled with the event's name).
  const cancelledPrices = useMemo(
    () =>
      events
        .filter((e) => e.status === "cancelled" && e.end >= addDays(from, -1))
        .flatMap((e) =>
          mine
            .map((l) => ({ e, l, rates: (l.seasonalRates ?? []).filter((r) => r.label === e.title.slice(0, 60) && r.end >= addDays(e.start, -1) && r.start <= addDays(e.end, 1)) }))
            .filter((x) => x.rates.length > 0),
        ),
    [events, mine, from],
  );
  const removeEventPrice = async (l: LiveListing, e: MarketEvent) => {
    const key = `rm:${l.id}:${e.id}`;
    setApplying(key);
    try {
      const label = e.title.slice(0, 60);
      await setSeasonalRates(l.id, (l.seasonalRates ?? []).filter((r) => !(r.label === label && r.end >= addDays(e.start, -1) && r.start <= addDays(e.end, 1))));
      toast.success(`${l.title}: back to your usual price on those dates.`);
    } catch (err) {
      toast(userMessage(err, "Couldn't remove the event price."));
    } finally {
      setApplying(null);
    }
  };
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [bigOnly, setBigOnly] = useState(false);
  const list = relevant.filter((x) => !bigOnly || x.e.impact === "high");
  const shown = showAll ? list : list.slice(0, 6);
  const anyMarkup = relevant.some(({ e, listings: ls }) => rowsFor(e, ls).some((r) => !r.enough));

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
        const markupPicker = anyMarkup ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-basalt/70">Event markup</span>
            <div role="group" aria-label="Event markup on big-demand dates" className="inline-flex rounded-full border border-basalt/15 bg-paper p-1">
              {MARKUPS.map((v) => (
                <button key={v} type="button" aria-pressed={markup === v} onClick={() => chooseMarkup(v)} className={cn("h-8 rounded-full px-3 text-xs font-semibold tabular-nums", markup === v ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt")}>
                  +{v}%
                </button>
              ))}
            </div>
          </div>
        ) : null;
        return embedded ? (
          (filter || markupPicker) && <div className="mb-3 flex flex-wrap items-center justify-between gap-3">{markupPicker ?? <span />}{filter}</div>
        ) : (
          <SubHeader title="Upcoming events & pricing" sub="Holidays, festivals, concerts and matches found automatically from public sources, next 12 months." actions={filter} />
        );
      })()}
      {cancelledPrices.length > 0 && (
        <ul className="mb-4 grid gap-2" aria-label="Cancelled events with your event prices">
          {cancelledPrices.map(({ e, l, rates }) => (
            <li key={`${e.id}:${l.id}`} className="flex flex-wrap items-center justify-between gap-3 border border-apricot/40 bg-apricot/[0.06] px-4 py-3 text-sm">
              <span className="min-w-0">
                <strong>{e.title}</strong> was cancelled{e.statusReason ? ` (${e.statusReason.charAt(0).toLowerCase()}${e.statusReason.slice(1)})` : ""}. Your event price for <strong>{l.title}</strong> is still set on {rates.map((r) => fmtRange(r.start, r.end)).join(", ")}.
              </span>
              <button type="button" disabled={applying === `rm:${l.id}:${e.id}`} onClick={() => void removeEventPrice(l, e)} className="h-9 shrink-0 rounded-none bg-basalt px-3 text-xs font-semibold text-paper hover:bg-basalt/90 disabled:opacity-50">
                {applying === `rm:${l.id}:${e.id}` ? "Removing…" : "Remove event price"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-6 text-sm text-basalt/70">No notable events near your listings in the next 12 months yet. New events are added twice a month.</p>
      ) : (
        <>
          {anyMarkup && (
            <p className="mb-3 text-sm text-basalt/60">
              Where there aren't yet 3 similar Revamp listings to compare with, suggestions add the markup to your usual price: +{markup}% on big-demand dates, +{Math.max(5, Math.round(markup / 2 / 5) * 5)}% on others. It's a starting point, not market data.
            </p>
          )}
          <ul className="divide-y divide-basalt/10 border border-basalt/10 bg-paper">
            {shown.map(({ e, listings: ls }) => {
              const rows = rowsFor(e, ls);
              const sugg = rows.filter((r) => r.suggest > 0);
              const cmp = rows;
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
                              <span className="col-span-2 min-w-0 truncate font-medium lg:col-span-1">
                                {r.l.title}
                                {r.activity && <span className="block text-xs font-normal text-basalt/60">{fmtRange(r.ds[0], r.ds[r.ds.length - 1])} (around the event)</span>}
                              </span>
                              <span className="tabular-nums text-basalt/70">You: <strong className="text-basalt">{r.yours > 0 ? format(r.yours) : "—"}</strong> / {r.unit}</span>
                              {r.enough ? (
                                <span className="tabular-nums text-basalt/70">Similar: <strong className="text-basalt">{format(r.med)}</strong> <span className="text-basalt/50">({r.peers})</span></span>
                              ) : (
                                <span className="tabular-nums text-basalt/70">Usual {r.usual > 0 ? format(r.usual) : "—"} <span className="text-basalt/50">+{r.pct}%</span></span>
                              )}
                              {r.suggest ? (
                                <button
                                  type="button"
                                  disabled={applying === `${r.l.id}:${e.id}`}
                                  onClick={() => void apply(r.l, e, r.suggest, r.ds[0], r.ds[r.ds.length - 1], r.enough ? "event_market" : "event_markup", r.enough ? `median of ${r.peers} similar listings (${format(r.med)})` : `+${r.pct}% on usual ${format(r.usual)}`)}
                                  className="col-span-2 inline-flex h-9 items-center justify-center gap-1.5 justify-self-start rounded-none bg-basalt px-3 text-xs font-semibold text-paper hover:bg-basalt/90 disabled:opacity-50 lg:col-span-1 lg:justify-self-end"
                                  title={`Sets ${format(r.suggest)} per ${r.unit} for ${fmtRange(r.ds[0], r.ds[r.ds.length - 1])}`}
                                >
                                  <Sparkles className="h-3.5 w-3.5 text-apricot" /> {applying === `${r.l.id}:${e.id}` ? "Applying…" : `Apply ${format(r.suggest)}`}
                                </button>
                              ) : (
                                <span className="col-span-2 text-xs text-basalt/60 lg:col-span-1 lg:text-right">
                                  {r.l.multiRoom ? "Set room-type prices in Calendar" : r.usual <= 0 ? "No price set" : r.enough ? "In line with similar listings" : "Already priced for the event"}
                                </span>
                              )}
                              {r.hints.length > 0 && <p className="col-span-2 text-xs text-basalt/60 lg:col-span-4">{r.hints.join(" ")}</p>}
                            </div>
                          ))}
                        </div>
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
      <p className="mt-3 text-xs text-basalt/55">Suggestions are a starting point — they aren't a promise of bookings. Nothing changes until you click Apply.</p>
    </section>
  );
}
