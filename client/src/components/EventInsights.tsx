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
import { ExternalLink, Sparkles } from "lucide-react";
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

export function EventInsights() {
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
        .slice(0, 12),
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

  if (!mine.length) return null;

  return (
    <section>
      <SubHeader
        title="Upcoming events & pricing"
        sub="Holidays, festivals, concerts and matches found automatically from public sources over the next four months — and how your prices compare with similar Revamp listings on those dates."
      />
      {relevant.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-6 text-sm text-basalt/70">No notable events near your listings in the next four months yet. The list refreshes every week.</p>
      ) : (
        <ul className="grid gap-3">
          {relevant.map(({ e, listings: ls }) => (
            <li key={e.id} className="border border-basalt/10 bg-paper p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{e.title}</p>
                  <p className="mt-0.5 text-sm text-basalt/60">
                    {fmtRange(e.start, e.end)} · {e.city ?? "Nationwide"}
                    {e.venue ? ` · ${e.venue}` : ""}
                    {e.expectedAttendance ? ` · ~${e.expectedAttendance.toLocaleString()} expected` : ""}
                  </p>
                  {e.summary && <p className="mt-1 max-w-2xl text-sm text-basalt/70">{e.summary}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold", e.impact === "high" ? "bg-apricot/15 text-apricot" : "bg-basalt/10 text-basalt/70")}>{IMPACT_LABEL[e.impact]}</span>
                  {e.sourceUrl && (
                    <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot">
                      {e.sourceName ?? "Source"} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <div className="mt-3 divide-y divide-basalt/8 border-t border-basalt/8">
                {ls.map((l) => {
                  const ds = days(e.start < from ? from : e.start, e.end);
                  const yours = askOver(l, ds);
                  const peers = market.filter((m) => m.type === l.type && m.city.trim().toLowerCase() === l.city.trim().toLowerCase());
                  const enough = peers.length >= 3;
                  const med = enough ? median(peers.map((p) => askOver(p, ds))) : 0;
                  const suggest = enough && yours > 0 && yours < med * 0.95 ? roundAmd(med) : 0;
                  const unit = l.type === "stay" ? "night" : l.priceUnit || "person";
                  return (
                    <div key={l.id} className="grid items-center gap-x-6 gap-y-1.5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_10rem_17rem_10rem]">
                      <span className="min-w-0 truncate font-medium">{l.title}</span>
                      <span className="tabular-nums text-basalt/70">
                        You: <strong className="text-basalt">{yours > 0 ? format(yours) : "—"}</strong> / {unit}
                      </span>
                      <span className="tabular-nums text-basalt/70">
                        {enough ? (
                          <>
                            Similar in {l.city}: <strong className="text-basalt">{format(med)}</strong> <span className="text-basalt/50">({peers.length})</span>
                          </>
                        ) : (
                          <span className="text-basalt/55">Not enough similar listings in {l.city} to compare</span>
                        )}
                      </span>
                      {l.multiRoom ? (
                        <span className="text-xs text-basalt/60 md:text-right">Set room-type prices in Calendar</span>
                      ) : suggest ? (
                        <button
                          type="button"
                          disabled={applying === `${l.id}:${e.id}`}
                          onClick={() => void apply(l, e, suggest)}
                          className="inline-flex h-9 items-center justify-center gap-1.5 justify-self-start rounded-none bg-basalt px-3 text-xs font-semibold text-paper hover:bg-basalt/90 disabled:opacity-50 md:justify-self-end"
                          title={`Sets ${format(suggest)} per ${unit} for ${fmtRange(ds[0], e.end)}`}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-apricot" /> {applying === `${l.id}:${e.id}` ? "Applying…" : `Apply ${format(suggest)}`}
                        </button>
                      ) : enough ? (
                        <span className="text-xs text-basalt/60 md:text-right">In line with similar listings</span>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-basalt/55">Suggestions compare what similar Revamp listings ask — they aren't a promise of bookings. Nothing changes until you click Apply.</p>
    </section>
  );
}
