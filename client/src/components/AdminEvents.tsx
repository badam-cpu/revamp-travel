/**
 * Admin → Events (0102). The upcoming-events list is filled automatically every
 * week (server/events.ts: Google's Armenian holidays + AI web search, each
 * AI-found event checked against its cited source page). Nothing here needs
 * curating — this view is for transparency: what was found, from where, whether
 * its source checked out, plus "Refresh now" and a Hide switch for the rare
 * wrong one. Unverified events are listed (admins only) but never shown to
 * operators.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { fetchEvents, IMPACT_LABEL, type MarketEvent } from "@/lib/events";
import { refreshEventsNow, userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const todayIso = () => new Date().toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const fmt = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Tab = "events" | "holidays" | "cancelled" | "unverified";
const inTab = (e: MarketEvent, t: Tab) =>
  t === "holidays" ? e.kind === "holiday" : t === "cancelled" ? e.kind === "event" && e.status === "cancelled" : t === "unverified" ? e.kind === "event" && !e.verified && e.status !== "cancelled" : e.kind === "event" && e.verified && e.status !== "cancelled";

export function AdminEvents() {
  const [events, setEvents] = useState<MarketEvent[] | null>(null);
  const [filter, setFilter] = useState<Tab>("events");
  const [lastRun, setLastRun] = useState<{ at: string | null; ok: boolean | null; detail: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchEvents(todayIso(), plus(400)).then(setEvents);
    supabase
      .from("cron_runs")
      .select("last_run_at, ok, detail")
      .eq("job", "events-sync")
      .maybeSingle()
      .then(({ data }) => setLastRun(data ? { at: data.last_run_at as string | null, ok: data.ok as boolean | null, detail: data.detail as string | null } : null));
  }, []);
  useEffect(load, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      await refreshEventsNow();
      toast.success("Started — the search takes a few minutes. Reload this page afterwards.");
    } catch (e) {
      toast(userMessage(e, "Couldn't start the refresh."));
    } finally {
      setBusy(false);
    }
  };
  const setHidden = async (ev: MarketEvent, hidden: boolean) => {
    const { error } = await supabase.from("events").update({ hidden }).eq("id", ev.id);
    if (error) return toast(userMessage(error, "Couldn't update that event."));
    setEvents((all) => (all ?? []).map((x) => (x.id === ev.id ? { ...x, hidden } : x)));
  };

  const shown = (events ?? []).filter((e) => inTab(e, filter));
  const restore = async (ev: MarketEvent) => {
    // Same text as RESTORED_BY_ADMIN in server/events.ts — the weekly re-check then leaves it alone.
    const { error } = await supabase.from("events").update({ status: "active", status_reason: "Restored by an admin", hidden: false }).eq("id", ev.id);
    if (error) return toast(userMessage(error, "Couldn't restore that event."));
    setEvents((all) => (all ?? []).map((x) => (x.id === ev.id ? { ...x, status: "active", statusReason: "Restored by an admin", hidden: false } : x)));
  };

  return (
    <div>
      <PageHeader
        title="Events"
        sub="Holidays and public events across Armenia for the next 12 months, found and re-checked automatically every week. Operators see verified ones next to their pricing."
        actions={
          <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-none border border-basalt/20 px-4 text-sm font-semibold hover:border-basalt/40 disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} /> Refresh now
          </button>
        }
      />
      <p className="mb-4 text-sm text-basalt/60">
        {lastRun?.at ? (
          <>
            Last run {new Date(lastRun.at).toLocaleString("en-GB")} — {lastRun.ok ? "OK" : "had problems"}
            {lastRun.detail ? ` (${lastRun.detail})` : ""}
          </>
        ) : (
          "Not run yet — click Refresh now, or it runs automatically this week."
        )}
      </p>
      <div role="group" aria-label="Show" className="mb-4 inline-flex rounded-full border border-basalt/15 bg-paper p-1">
        {([
          ["events", "Events"],
          ["holidays", "Holidays"],
          ["cancelled", "Cancelled"],
          ["unverified", "Couldn't verify"],
        ] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn("h-9 rounded-full px-4 text-sm font-semibold", filter === k ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt")}>
            {label} <span className="tabular-nums opacity-60">{(events ?? []).filter((e) => inTab(e, k)).length}</span>
          </button>
        ))}
      </div>
      {events === null ? (
        <p className="text-sm text-basalt/60">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-8 text-center text-sm text-basalt/70">Nothing here yet.</p>
      ) : (
        <ul className="divide-y divide-basalt/10 border border-basalt/10 bg-paper">
          {shown.map((e) => (
            <li key={e.id} className={cn("flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3", e.hidden && "opacity-50")}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.title}</p>
                <p className="text-sm text-basalt/60">
                  {fmt(e.start)}{e.end !== e.start ? ` – ${fmt(e.end)}` : ""} · {e.city ?? "Nationwide"} · {e.category} · {IMPACT_LABEL[e.impact]}
                </p>
                {e.summary && <p className="mt-0.5 text-sm text-basalt/70">{e.summary}</p>}
                {e.statusReason && <p className={cn("mt-0.5 text-xs font-semibold", e.status === "cancelled" || e.hidden ? "text-apricot" : "text-basalt/60")}>{e.statusReason}</p>}
              </div>
              {e.sourceUrl && (
                <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/60 hover:text-apricot">
                  {e.sourceName ?? "Source"} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {e.status === "cancelled" ? (
                <button type="button" onClick={() => void restore(e)} className="text-xs font-semibold text-basalt/60 hover:text-basalt">Restore</button>
              ) : (
                <button type="button" onClick={() => void setHidden(e, !e.hidden)} className="text-xs font-semibold text-basalt/60 hover:text-basalt">
                  {e.hidden ? "Show" : "Hide"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
