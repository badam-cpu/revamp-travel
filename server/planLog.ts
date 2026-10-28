/**
 * Aha AI trip planner log for admins (2026-10-28, 0124 trip_plan_events).
 *
 * Every planner request (new plan, "Change anything", emailed plan) is logged
 * best-effort — a logging failure never affects the guest. Admin → Aha AI →
 * Trip planner reads the report. Rows older than 90 days are purged here.
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Itinerary } from "./planner.js";

const KEEP_DAYS = 90;

/** Short, stable id for a plan, from the server's signature of it. */
export function planRef(token: string | null | undefined): string | null {
  return token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 16) : null;
}

/** The language the guest wrote in (by script) — "hy", "ru", "en" or "other". */
export function languageOf(text: string | undefined | null): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (/[԰-֏]/.test(t)) return "hy";
  if (/[Ѐ-ӿ]/.test(t)) return "ru";
  if (/[a-z]/i.test(t)) return "en";
  return "other";
}

export interface PlanEvent {
  kind: "plan" | "change" | "email";
  source?: "web" | "mcp";
  token?: string | null;
  parentToken?: string | null;
  request?: string | null;
  change?: string | null;
  itinerary?: Itinerary | null;
  model?: string | null;
  durationMs?: number | null;
  retried?: boolean;
  ok: boolean;
  error?: string | null;
  userId?: string | null;
  email?: string | null;
}

export async function logPlanEvent(admin: SupabaseClient | null, e: PlanEvent): Promise<void> {
  if (!admin) return;
  try {
    const it = e.itinerary;
    const { error } = await admin.from("trip_plan_events").insert({
      kind: e.kind,
      source: e.source ?? "web",
      plan_ref: planRef(e.token),
      parent_ref: planRef(e.parentToken),
      request: e.request ? e.request.slice(0, 600) : null,
      change: e.change ? e.change.slice(0, 300) : null,
      language: languageOf(e.change || e.request) ?? (e.kind === "plan" ? "form" : null),
      title: it?.tripTitle?.slice(0, 160) ?? null,
      days: it ? Math.min(30, it.days.length) : null,
      route: it?.route?.length ? it.route.slice(0, 12) : null,
      listings: it?.places ? Object.keys(it.places).slice(0, 40) : null,
      model: e.model ?? null,
      duration_ms: e.durationMs != null ? Math.round(e.durationMs) : null,
      retried: !!e.retried,
      ok: e.ok,
      error: e.error ? e.error.slice(0, 300) : null,
      user_id: e.userId ?? null,
      email: e.email ? e.email.slice(0, 200) : null,
    });
    if (error) console.error("[plan-log]", error.message);
    // Keep 90 days — an occasional sweep is plenty at this volume.
    if (Math.random() < 0.05) {
      await admin.from("trip_plan_events").delete().lt("created_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());
    }
  } catch (err) {
    console.error("[plan-log]", err);
  }
}

interface EventRow {
  id: number;
  created_at: string;
  kind: "plan" | "change" | "email";
  source: string;
  plan_ref: string | null;
  parent_ref: string | null;
  request: string | null;
  change: string | null;
  language: string | null;
  title: string | null;
  days: number | null;
  route: string[] | null;
  listings: string[] | null;
  model: string | null;
  duration_ms: number | null;
  retried: boolean;
  ok: boolean;
  error: string | null;
  user_id: string | null;
  email: string | null;
}

export interface PlannerReportPlan {
  id: number;
  at: string;
  source: string;
  request: string | null;
  language: string | null;
  title: string | null;
  days: number | null;
  route: string[];
  listings: { slug: string; title: string; type: string }[];
  model: string | null;
  durationMs: number | null;
  retried: boolean;
  ok: boolean;
  error: string | null;
  guest: string | null;
  changes: { at: string; change: string | null; ok: boolean }[];
  emails: { at: string; email: string | null; ok: boolean }[];
  saved: boolean;
}

export interface PlannerReport {
  since: string;
  totals: { plans: number; ok: number; failed: number; retried: number; changes: number; emails: number; saves: number; medianMs: number | null };
  byDay: { day: string; plans: number; failed: number }[];
  languages: { language: string; plans: number }[];
  topPlaces: { slug: string; title: string; type: string; plans: number }[];
  topAreas: { name: string; plans: number }[];
  plans: PlannerReportPlan[];
}

/** Admin report for the last `days` days (max 90). */
export async function plannerReport(admin: SupabaseClient, days: number): Promise<PlannerReport> {
  const sinceMs = Date.now() - Math.min(KEEP_DAYS, Math.max(1, days)) * 86_400_000;
  const since = new Date(sinceMs).toISOString();
  await admin.from("trip_plan_events").delete().lt("created_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());

  const { data, error } = await admin.from("trip_plan_events").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
  if (error) throw error;
  const rows = (data ?? []) as EventRow[];
  const plans = rows.filter((r) => r.kind === "plan");
  const changes = rows.filter((r) => r.kind === "change");
  const emails = rows.filter((r) => r.kind === "email");

  // Every plan (and changed version) → its root plan, so changes/emails attach to the original request.
  const rootOf = new Map<string, string>();
  for (const p of plans) if (p.plan_ref) rootOf.set(p.plan_ref, p.plan_ref);
  for (const c of [...changes].reverse()) if (c.plan_ref && c.parent_ref) rootOf.set(c.plan_ref, rootOf.get(c.parent_ref) ?? c.parent_ref);
  const root = (ref: string | null) => (ref ? rootOf.get(ref) ?? ref : null);

  // Saved plans (0122) — matched by the signature only, nothing else is read.
  const refs = new Set<string>();
  const { data: savedRows } = await admin.from("trip_plans").select("plan_token").gte("created_at", since).limit(2000);
  for (const s of (savedRows ?? []) as { plan_token: string | null }[]) {
    const r = root(planRef(s.plan_token));
    if (r) refs.add(r);
  }

  // Listing titles + guest names.
  const slugs = Array.from(new Set(rows.flatMap((r) => r.listings ?? [])));
  const titles = new Map<string, { title: string; type: string }>();
  for (let i = 0; i < slugs.length; i += 200) {
    const { data: ls } = await admin.from("listings").select("slug, title, type").in("slug", slugs.slice(i, i + 200));
    for (const l of (ls ?? []) as { slug: string; title: string; type: string }[]) titles.set(l.slug, { title: l.title, type: l.type });
  }
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x)));
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data: ps } = await admin.from("profiles").select("id, display_name").in("id", userIds);
    for (const p of (ps ?? []) as { id: string; display_name: string | null }[]) names.set(p.id, p.display_name || "Signed-in guest");
  }

  const okPlans = plans.filter((p) => p.ok);
  const durations = okPlans.map((p) => p.duration_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const count = <K extends string>(list: K[]) => {
    const m = new Map<K, number>();
    for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };
  const dayKey = (iso: string) => iso.slice(0, 10);
  const byDayMap = new Map<string, { plans: number; failed: number }>();
  for (const p of plans) {
    const d = byDayMap.get(dayKey(p.created_at)) ?? { plans: 0, failed: 0 };
    d.plans++;
    if (!p.ok) d.failed++;
    byDayMap.set(dayKey(p.created_at), d);
  }

  return {
    since,
    totals: {
      plans: plans.length,
      ok: okPlans.length,
      failed: plans.length - okPlans.length,
      retried: plans.filter((p) => p.retried).length,
      changes: changes.length,
      emails: emails.filter((e) => e.ok).length,
      saves: refs.size,
      medianMs: durations.length ? durations[Math.floor(durations.length / 2)] : null,
    },
    byDay: Array.from(byDayMap.entries()).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    languages: count(plans.map((p) => p.language ?? "form")).map(([language, n]) => ({ language, plans: n })),
    topPlaces: count(okPlans.flatMap((p) => p.listings ?? []))
      .slice(0, 12)
      .map(([slug, n]) => ({ slug, title: titles.get(slug)?.title ?? slug, type: titles.get(slug)?.type ?? "", plans: n })),
    topAreas: count(okPlans.flatMap((p) => Array.from(new Set(p.route ?? [])))).slice(0, 10).map(([name, n]) => ({ name, plans: n })),
    plans: plans.slice(0, 300).map((p) => {
      const mine = (r: EventRow) => p.plan_ref && root(r.plan_ref) === p.plan_ref;
      return {
        id: p.id,
        at: p.created_at,
        source: p.source,
        request: p.request,
        language: p.language,
        title: p.title,
        days: p.days,
        route: p.route ?? [],
        listings: (p.listings ?? []).map((slug) => ({ slug, title: titles.get(slug)?.title ?? slug, type: titles.get(slug)?.type ?? "" })),
        model: p.model,
        durationMs: p.duration_ms,
        retried: p.retried,
        ok: p.ok,
        error: p.error,
        guest: p.user_id ? names.get(p.user_id) ?? "Signed-in guest" : null,
        changes: changes.filter((c) => mine(c) || (p.plan_ref && root(c.parent_ref) === p.plan_ref)).map((c) => ({ at: c.created_at, change: c.change, ok: c.ok })).reverse(),
        emails: emails.filter(mine).map((e) => ({ at: e.created_at, email: e.email, ok: e.ok })).reverse(),
        saved: !!p.plan_ref && refs.has(p.plan_ref),
      };
    }),
  };
}
