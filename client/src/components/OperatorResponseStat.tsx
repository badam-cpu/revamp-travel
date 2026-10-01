/**
 * Operator-facing response-time summary (migration 0081). Shows how fast this
 * operator answers guest inquiries — median first reply, response rate, and how
 * many are still waiting — above their inbox. Fast replies win bookings, so this
 * nudges toward near-instant responses. Reads the operator's own conversations
 * (RLS-scoped).
 */
import { useEffect, useState } from "react";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchResponseConversations, summarize, formatDuration, type ResponseSummary } from "@/lib/responseTime";

export function OperatorResponseStat() {
  const [sum, setSum] = useState<ResponseSummary | null>(null);
  useEffect(() => {
    let active = true;
    fetchResponseConversations().then((c) => { if (active) setSum(summarize(c)); }).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!sum || sum.total === 0) return null;

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile icon={<Clock className="h-4 w-4 text-apricot" />} value={formatDuration(sum.medianSeconds)} label="Median reply" />
      <Tile icon={<CheckCircle2 className="h-4 w-4 text-apricot" />} value={`${Math.round(sum.responseRate * 100)}%`} label="Response rate" />
      <Tile icon={<Clock className="h-4 w-4 text-apricot" />} value={sum.within1hRate != null ? `${Math.round(sum.within1hRate * 100)}%` : "—"} label="Within 1 hour" />
      <Tile icon={<AlertCircle className={`h-4 w-4 ${sum.awaiting > 0 ? "text-red-500" : "text-basalt/40"}`} />} value={`${sum.awaiting}`} label="Awaiting reply" highlight={sum.awaiting > 0} />
    </div>
  );
}

function Tile({ icon, value, label, highlight }: { icon: React.ReactNode; value: string; label: string; highlight?: boolean }) {
  return (
    <div className={`border bg-paper p-3 ${highlight ? "border-red-300 bg-red-50/40" : "border-basalt/10"}`}>
      <div className="flex items-center gap-1.5">{icon}<span className="font-display text-xl font-normal tabular-nums text-basalt">{value}</span></div>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
    </div>
  );
}
