/**
 * Admin response-time oversight (migration 0081). Reads ALL inquiry/booking
 * conversations (admin RLS) and shows: overall responsiveness, a per-operator
 * breakdown (slowest first), and the inquiries still waiting for a first reply
 * (longest wait first) so an admin can nudge. Response time = operator's first
 * reply minus the guest's first message.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchResponseConversations, summarize, responseSeconds, waitingSeconds, median, formatDuration, type ResponseConversation } from "@/lib/responseTime";

export function AdminResponseTimes() {
  const [convos, setConvos] = useState<ResponseConversation[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    fetchResponseConversations().then(async (c) => {
      if (!active) return;
      setConvos(c);
      const ids = Array.from(new Set(c.map((x) => x.operatorId).filter(Boolean))) as string[];
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, display_name, business_name").in("id", ids);
        if (active) setNames(new Map((data ?? []).map((p) => [p.id as string, (p.business_name as string) || (p.display_name as string) || "Operator"])));
      }
    }).catch(() => setConvos([]));
    return () => { active = false; };
  }, []);

  const overall = useMemo(() => (convos ? summarize(convos) : null), [convos]);

  const perOperator = useMemo(() => {
    if (!convos) return [];
    const map = new Map<string, ResponseConversation[]>();
    for (const c of convos) {
      if (!c.operatorId) continue;
      const list = map.get(c.operatorId) ?? [];
      list.push(c);
      map.set(c.operatorId, list);
    }
    return Array.from(map.entries())
      .map(([id, list]) => {
        const secs = list.map(responseSeconds).filter((s): s is number => s != null);
        const awaiting = list.filter((c) => responseSeconds(c) == null && c.status !== "closed").length;
        return { id, name: names.get(id) ?? "Operator", count: list.length, medianSeconds: median(secs), awaiting };
      })
      .sort((a, b) => (b.medianSeconds ?? -1) - (a.medianSeconds ?? -1));
  }, [convos, names]);

  const waiting = useMemo(() => {
    if (!convos) return [];
    const now = Date.now();
    return convos
      .map((c) => ({ c, w: waitingSeconds(c, now) }))
      .filter((x) => x.w != null && x.c.status !== "closed")
      .sort((a, b) => (b.w ?? 0) - (a.w ?? 0))
      .slice(0, 25);
  }, [convos]);

  if (!convos) return <p className="text-sm text-basalt/45">Loading…</p>;

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="font-display text-3xl font-normal text-basalt">Response times</h2>
        <p className="mt-1 max-w-2xl text-sm text-basalt/55">How fast guest inquiries get a first operator reply — fast replies win bookings. Across {overall?.total ?? 0} inquiries.</p>
      </div>

      {overall && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile value={formatDuration(overall.medianSeconds)} label="Median reply" />
          <Tile value={`${Math.round(overall.responseRate * 100)}%`} label="Response rate" />
          <Tile value={overall.within1hRate != null ? `${Math.round(overall.within1hRate * 100)}%` : "—"} label="Within 1 hour" />
          <Tile value={`${overall.awaiting}`} label="Awaiting reply" highlight={overall.awaiting > 0} />
        </div>
      )}

      {/* Per-operator */}
      <div className="overflow-x-auto border border-basalt/12">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-basalt/12 bg-chalk/40 text-left text-[11px] uppercase tracking-[0.08em] text-basalt/50">
              <th className="px-3 py-2.5 font-semibold">Operator</th>
              <th className="px-3 py-2.5 text-right font-semibold">Inquiries</th>
              <th className="px-3 py-2.5 text-right font-semibold">Median reply</th>
              <th className="px-3 py-2.5 text-right font-semibold">Awaiting</th>
            </tr>
          </thead>
          <tbody>
            {perOperator.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-basalt/45">No inquiries yet.</td></tr>
            ) : perOperator.map((o) => (
              <tr key={o.id} className="border-b border-basalt/8 last:border-0">
                <td className="px-3 py-3 font-semibold text-basalt">{o.name}</td>
                <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{o.count}</td>
                <td className="px-3 py-3 text-right tabular-nums text-basalt/70">{formatDuration(o.medianSeconds)}</td>
                <td className={`px-3 py-3 text-right tabular-nums ${o.awaiting > 0 ? "font-semibold text-red-500" : "text-basalt/40"}`}>{o.awaiting || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Still waiting */}
      {waiting.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Still awaiting a reply</h3>
          {waiting.map(({ c, w }) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border border-basalt/10 bg-paper p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-basalt">{c.listingTitle || "Listing"}</p>
                <p className="text-xs text-basalt/45">{names.get(c.operatorId ?? "") ?? "Operator"} · {c.kind === "booking" ? "Booking" : "Inquiry"}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-red-500">waiting {formatDuration(w)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className={`border bg-paper p-4 ${highlight ? "border-red-300 bg-red-50/40" : "border-basalt/10"}`}>
      <p className="font-display text-2xl font-normal tabular-nums text-basalt">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
    </div>
  );
}
