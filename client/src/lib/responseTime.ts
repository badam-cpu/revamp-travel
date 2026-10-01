/**
 * Message response-time tracking (migration 0081). Reads conversations RLS-scoped
 * — an operator gets their own, an admin gets all — and derives how fast guest
 * inquiries get a first operator reply. Used by the operator dashboard (own
 * stats) and the admin oversight panel (overall + per-operator + still-waiting).
 *
 * "Response time" = first_operator_at − first_guest_at for a booking/inquiry
 * conversation the guest opened. Auto/support messages never set first_operator_at
 * (only a real 'operator' reply does), so the number reflects human responsiveness.
 */
import { supabase } from "@/lib/supabase";

export interface ResponseConversation {
  id: string;
  kind: string;
  status: string;
  firstGuestAt: string | null;
  firstOperatorAt: string | null;
  operatorId: string | null;
  listingTitle: string | null;
}

interface Row {
  id: string;
  kind: string;
  status: string;
  first_guest_at: string | null;
  first_operator_at: string | null;
  listings: { title: string | null; operator_id: string | null } | { title: string | null; operator_id: string | null }[] | null;
}

/** Conversations visible to the caller (operator: own; admin: all), inquiry/booking only. */
export async function fetchResponseConversations(): Promise<ResponseConversation[]> {
  const { data } = await supabase
    .from("conversations")
    .select("id, kind, status, first_guest_at, first_operator_at, listings(title, operator_id)")
    .in("kind", ["booking", "listing_inquiry"])
    .not("first_guest_at", "is", null)
    .order("first_guest_at", { ascending: false })
    .limit(2000);
  return ((data ?? []) as Row[]).map((r) => {
    const l = Array.isArray(r.listings) ? r.listings[0] : r.listings;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      firstGuestAt: r.first_guest_at,
      firstOperatorAt: r.first_operator_at,
      operatorId: l?.operator_id ?? null,
      listingTitle: l?.title ?? null,
    };
  });
}

/** Seconds to first operator reply, or null if not yet answered. */
export function responseSeconds(c: ResponseConversation): number | null {
  if (!c.firstGuestAt || !c.firstOperatorAt) return null;
  const s = Math.round((Date.parse(c.firstOperatorAt) - Date.parse(c.firstGuestAt)) / 1000);
  return s >= 0 ? s : null;
}

/** Seconds a still-unanswered inquiry has been waiting (from the guest's message). */
export function waitingSeconds(c: ResponseConversation, now = Date.now()): number | null {
  if (!c.firstGuestAt || c.firstOperatorAt) return null;
  return Math.max(0, Math.round((now - Date.parse(c.firstGuestAt)) / 1000));
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface ResponseSummary {
  total: number;        // inquiries the guest opened
  answered: number;     // got an operator reply
  awaiting: number;     // open + still no reply
  responseRate: number; // answered / total (0..1)
  medianSeconds: number | null;
  within1hRate: number | null; // share of answered replied to within 1h
}

export function summarize(convos: ResponseConversation[]): ResponseSummary {
  const answeredSecs: number[] = [];
  let awaiting = 0;
  for (const c of convos) {
    const r = responseSeconds(c);
    if (r != null) answeredSecs.push(r);
    else if (c.status !== "closed") awaiting++;
  }
  const total = convos.length;
  const answered = answeredSecs.length;
  return {
    total,
    answered,
    awaiting,
    responseRate: total ? answered / total : 0,
    medianSeconds: median(answeredSecs),
    within1hRate: answered ? answeredSecs.filter((s) => s <= 3600).length / answered : null,
  };
}

/** "2h 10m", "45m", "3d 4h", "28s" — compact human duration. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}
