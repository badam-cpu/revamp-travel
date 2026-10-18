/**
 * Google business status for curated restaurants / places (0112): a badge in
 * Admin → Eat guide / Visit guide when Google reports a venue temporarily or
 * permanently closed. Read in its own query, so the admin lists keep working
 * before the migration has run.
 */
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export interface VenueStatus {
  status: string | null;
  checkedAt: string | null;
}

export function useVenueStatuses(ids: string[]): Map<string, VenueStatus> {
  const [map, setMap] = useState<Map<string, VenueStatus>>(new Map());
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return setMap(new Map());
    let live = true;
    supabase
      .from("listings")
      .select("id, business_status, business_status_checked_at")
      .in("id", key.split(","))
      .then(({ data, error }) => {
        if (!live || error) return;
        setMap(new Map(((data ?? []) as { id: string; business_status: string | null; business_status_checked_at: string | null }[]).map((r) => [r.id, { status: r.business_status, checkedAt: r.business_status_checked_at }])));
      });
    return () => {
      live = false;
    };
  }, [key]);
  return map;
}

export function VenueStatusBadge({ status }: { status?: VenueStatus }) {
  if (!status?.status || status.status === "OPERATIONAL") return null;
  const permanent = status.status === "CLOSED_PERMANENTLY";
  const checked = status.checkedAt ? new Date(status.checkedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
  return (
    <span
      title={`Google business status${checked ? ` · checked ${checked}` : ""}`}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", permanent ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-800")}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden /> {permanent ? "Permanently closed" : "Temporarily closed"} (Google)
    </span>
  );
}

/** "N venues are reported closed" above the list, when any are. */
export function ClosedVenuesNote({ statuses }: { statuses: Map<string, VenueStatus> }) {
  const closed = Array.from(statuses.values()).filter((s) => s.status === "CLOSED_TEMPORARILY" || s.status === "CLOSED_PERMANENTLY").length;
  if (!closed) return null;
  return (
    <p className="mt-3 flex items-start gap-2 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {closed} {closed === 1 ? "venue is" : "venues are"} reported closed on Google. Check whether to unpublish or edit {closed === 1 ? "it" : "them"} — nothing changes on the site automatically.
    </p>
  );
}
