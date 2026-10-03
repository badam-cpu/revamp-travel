/**
 * Restaurant owner dashboard (/venue). A venue manager (linked by an admin —
 * migration 0078) sees their own restaurant's numbers: engagement analytics
 * (impressions / views / directions / website / call / menu / saves) with a
 * trend graph, and voucher performance (sold / redeemed / outstanding + the
 * payout Revamp owes on redeemed-but-unsettled vouchers). Read-only — restaurants
 * stay house-owned; this is insight, not editing. Sign-in-gated, noindex.
 *
 * All data comes from POST /api/restaurant/summary, which verifies the caller
 * manages the venue and aggregates server-side (service role).
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { BarChart3, Ticket, Copy, Loader2, Store, Wallet, AlertTriangle } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { restaurantSummary, ApiError, type VenueSummaryResponse } from "@/lib/api";
import { InfoTip } from "@/components/InfoTip";
import { METRIC_INFO } from "@/lib/metricInfo";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];
const METRIC_TILES = [
  { kind: "impression", label: "Impressions" },
  { kind: "view", label: "Views" },
  { kind: "directions", label: "Directions" },
  { kind: "website", label: "Website" },
  { kind: "call", label: "Calls" },
  { kind: "menu", label: "Menu" },
  { kind: "save", label: "Saves" },
];
const shortDay = (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${m}/${d}`; };

export default function VenueDashboard() {
  const { user, loading } = useAuth();
  const { format } = useCurrency();
  const [, navigate] = useLocation();
  const [data, setData] = useState<VenueSummaryResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [venueId, setVenueId] = useState<string | undefined>(undefined);
  const [windowDays, setWindowDays] = useState(30);
  const [graphMetric, setGraphMetric] = useState<"view" | "impression">("view");

  useDocumentMeta({ title: "Your venue | Revamp Vacations", description: "Your restaurant's performance on Revamp.", canonicalPath: "/venue", noindex: true });

  useEffect(() => { if (!loading && !user) navigate("/login"); }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setBusy(true);
    restaurantSummary(venueId, windowDays)
      .then((r) => { if (active) { setData(r); if (!venueId && r.selectedId) setVenueId(r.selectedId); } })
      .catch((e) => { if (active) toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't load your venue."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [user, venueId, windowDays]);

  const s = data?.summary;
  const seriesValues = graphMetric === "view" ? s?.analytics.views ?? [] : s?.analytics.impressions ?? [];
  const seriesDays = s?.analytics.days ?? [];
  const seriesMax = Math.max(1, ...seriesValues);
  const seriesTotal = seriesValues.reduce((a, b) => a + b, 0);
  const tickEvery = Math.max(1, Math.ceil(seriesDays.length / 6));
  const redeemUrl = useMemo(() => (s?.redeemToken ? `${window.location.origin}/redeem/${s.redeemToken}` : null), [s?.redeemToken]);

  const venues = data?.venues ?? [];
  const currentVenue = venues.find((v) => v.id === (venueId ?? data?.selectedId)) ?? venues[0];

  if (loading || (!data && busy)) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <div className="grid place-items-center py-32 text-basalt/50"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {venues.length === 0 ? (
          <div className="mx-auto max-w-lg border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center">
            <Store className="mx-auto h-8 w-8 text-basalt/40" />
            <h1 className="mt-4 font-display text-2xl">No venue linked yet.</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-basalt/55">This dashboard shows your restaurant's performance on Revamp. Ask the Revamp team to link your account to your venue, then refresh.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="eyebrow flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> Venue dashboard</p>
                <h1 className="mt-2 font-display text-4xl tracking-[-0.03em]">{currentVenue?.title}.</h1>
                <p className="mt-1 text-sm text-basalt/55">{currentVenue?.city} · how diners engage with your Revamp listing.</p>
              </div>
              {venues.length > 1 && (
                <select value={venueId ?? currentVenue?.id} onChange={(e) => setVenueId(e.target.value)} className="h-10 rounded-none border border-basalt/15 bg-paper px-3 text-sm">
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              )}
            </div>

            {/* Range filter */}
            <div className="mt-6 flex items-center gap-1.5">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Range</span>
              {WINDOWS.map((w) => (
                <button key={w.days} type="button" onClick={() => setWindowDays(w.days)}
                  className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", windowDays === w.days ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt/60 hover:text-basalt")}>
                  {w.label}
                </button>
              ))}
              {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin text-basalt/40" />}
            </div>

            {/* Engagement */}
            <h2 className="mt-8 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50"><BarChart3 className="h-4 w-4" /> Engagement</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {METRIC_TILES.map((m) => (
                <div key={m.kind} className="border border-basalt/10 bg-paper p-4">
                  <p className="font-display text-2xl font-normal tabular-nums text-basalt">{(s?.analytics.totals[m.kind] ?? 0).toLocaleString("en-US")}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">
                    {m.label}
                    {METRIC_INFO[m.kind]?.help && <InfoTip text={METRIC_INFO[m.kind].help} label={m.label} />}
                  </p>
                </div>
              ))}
            </div>

            {/* Trend graph */}
            <div className="mt-4 border border-basalt/10 bg-paper p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {(["view", "impression"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setGraphMetric(k)}
                      className={cn("rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors", graphMetric === k ? "bg-apricot text-white" : "text-basalt/55 hover:text-basalt")}>
                      {k === "view" ? "Views" : "Impressions"}
                    </button>
                  ))}
                  <span className="ml-1 text-xs text-basalt/45">· last {windowDays} days</span>
                </div>
                <span className="font-display text-2xl font-normal tabular-nums">{seriesTotal.toLocaleString("en-US")}</span>
              </div>
              {seriesTotal === 0 ? (
                <p className="mt-8 text-sm text-basalt/45">No activity in this range yet — numbers accrue as diners find your listing.</p>
              ) : (
                <>
                  <div className="mt-5 flex h-40 items-end gap-px" role="img" aria-label={`${graphMetric} by day`}>
                    {seriesValues.map((v, i) => (
                      <div key={seriesDays[i] ?? i} className="group flex flex-1 items-end" style={{ height: "100%" }}>
                        <div className="w-full rounded-t-[2px] bg-apricot/80 transition-all group-hover:bg-apricot"
                          style={{ height: `${v === 0 ? 0 : Math.max(3, (v / seriesMax) * 100)}%` }}
                          title={`${shortDay(seriesDays[i] ?? "")}: ${v.toLocaleString("en-US")}`} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-px">
                    {seriesDays.map((d, i) => <div key={d} className="flex-1 text-center text-[9px] text-basalt/35">{i % tickEvery === 0 ? shortDay(d) : ""}</div>)}
                  </div>
                </>
              )}
            </div>

            {/* Prepaid Revamp balance — decreases live as diners redeem */}
            {s?.prepaid && (() => {
              const p = s.prepaid;
              const empty = p.balanceCents <= 0;
              const low = !empty && p.lowThresholdCents > 0 && p.balanceCents <= p.lowThresholdCents;
              const tone = empty || !p.active ? "border-red-300 bg-red-50/50" : low ? "border-amber-300 bg-amber-50/50" : "border-apricot/40 bg-apricot/5";
              return (
                <>
                  <h2 className="mt-10 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50"><Wallet className="h-4 w-4" /> Revamp balance</h2>
                  <div className={`mt-3 border p-5 ${tone}`}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">Remaining dining credit</p>
                    <p className="mt-1 font-display text-5xl font-normal tabular-nums text-basalt">{format(p.balanceCents)}</p>
                    <p className="mt-2 text-sm text-basalt/60">Revamp pre-paid you for {format(p.totalFaceCents)} of dining credit in total. It drops automatically as guests redeem their vouchers here.</p>
                    {!p.active ? (
                      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-red-600"><AlertTriangle className="h-4 w-4" /> Paused by Revamp.</p>
                    ) : empty ? (
                      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-red-600"><AlertTriangle className="h-4 w-4" /> Used up — redemptions are paused until Revamp tops it up.</p>
                    ) : low ? (
                      <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-amber-700"><AlertTriangle className="h-4 w-4" /> Running low — Revamp will top it up soon.</p>
                    ) : null}
                  </div>
                  {p.events.length > 0 && (
                    <div className="mt-3 overflow-hidden border border-basalt/10">
                      <p className="border-b border-basalt/10 bg-chalk/40 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-basalt/50">Balance history</p>
                      <div className="max-h-64 overflow-y-auto">
                        {p.events.map((e, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 border-b border-basalt/8 px-4 py-2.5 text-sm last:border-0">
                            <div className="min-w-0">
                              <p className="font-medium text-basalt">{e.kind === "topup" ? "Top-up" : e.kind === "redeem" ? "Voucher redeemed" : "Adjustment"}</p>
                              {e.note && <p className="truncate text-xs text-basalt/45">{e.note}</p>}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className={`font-semibold tabular-nums ${e.deltaCents >= 0 ? "text-emerald-600" : "text-basalt/70"}`}>{e.deltaCents >= 0 ? "+" : "−"}{format(Math.abs(e.deltaCents))}</span>
                              <p className="text-[11px] text-basalt/40">{new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Vouchers */}
            <h2 className="mt-10 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50"><Ticket className="h-4 w-4" /> Dining vouchers</h2>
            {s && (s.vouchers.soldCount > 0 || redeemUrl) ? (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <VoucherTile n={s.vouchers.soldCount} label="Sold" sub={format(s.vouchers.soldFaceCents)} subLabel="face value" />
                  <VoucherTile n={s.vouchers.redeemedCount} label="Redeemed" sub={format(s.vouchers.redeemedFaceCents)} subLabel="face value" />
                  <VoucherTile n={s.vouchers.outstandingCount} label="Outstanding" sub={format(s.vouchers.outstandingFaceCents)} subLabel="still to redeem" />
                  {s.prepaid?.active ? (
                    <div className="border border-basalt/10 bg-paper p-4">
                      <p className="font-display text-2xl font-normal text-basalt">Prepaid</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">Settlement</p>
                      <p className="mt-1 text-[11px] text-basalt/50">Paid upfront — redemptions draw your Revamp balance above.</p>
                    </div>
                  ) : (
                    <div className="border border-apricot/40 bg-apricot/5 p-4">
                      <p className="font-display text-2xl font-normal tabular-nums text-basalt">{format(s.vouchers.payoutOwedCents)}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-apricot">Payout owed to you</p>
                      <p className="mt-1 text-[11px] text-basalt/50">{format(s.vouchers.payoutSettledCents)} already settled</p>
                    </div>
                  )}
                </div>
                {redeemUrl && (
                  <div className="mt-4 border border-basalt/10 bg-chalk/50 p-4">
                    <p className="text-sm font-semibold text-basalt">Staff redemption link</p>
                    <p className="mt-1 text-xs text-basalt/55">Open this on a staff device to redeem a customer's voucher code. Keep it private to your team.</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-none border border-basalt/15 bg-paper px-3 py-2 text-xs text-basalt/70">{redeemUrl}</code>
                      <button type="button" onClick={() => { navigator.clipboard?.writeText(redeemUrl); toast.success("Link copied."); }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-none bg-basalt px-3 py-2 text-xs font-semibold text-paper hover:bg-basalt/90">
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-basalt/55">Vouchers aren't switched on for your venue yet. Ask the Revamp team to enable prepaid dining vouchers — a way to bring in revenue up front.</p>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function VoucherTile({ n, label, sub, subLabel }: { n: number; label: string; sub: string; subLabel: string }) {
  return (
    <div className="border border-basalt/10 bg-paper p-4">
      <p className="font-display text-2xl font-normal tabular-nums text-basalt">{n.toLocaleString("en-US")}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
      <p className="mt-1 text-[11px] text-basalt/50">{sub} {subLabel}</p>
    </div>
  );
}
