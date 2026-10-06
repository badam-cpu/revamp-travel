/**
 * /admin → Health. A single operational dashboard for the site's life-important
 * signals: scheduled jobs (crons), calendar (iCal) sync freshness, stuck
 * payments, and which server integrations are configured. Data comes from the
 * admin-gated GET /api/admin-health (server/health.ts) — read-only, no secrets.
 *
 * Built after a Netlify scheduler outage left calendars stale and payments
 * unconfirmed for weeks with nothing surfacing it; this is the in-app eyeball
 * that complements the email alerts.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Activity, AlertTriangle, Calendar, CheckCircle2, Clock, CreditCard, Plug, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAdminHealth, type AdminHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function everyLabel(maxAgeMinutes: number): string {
  // The watchdog threshold is generous (≈ one extra cycle); describe the cadence loosely.
  if (maxAgeMinutes <= 60) return "runs every few minutes";
  if (maxAgeMinutes <= 30 * 60) return "runs a few times a day";
  return "runs daily";
}

type Tone = "ok" | "warn" | "bad" | "idle";
const toneClasses: Record<Tone, string> = {
  ok: "bg-green-600/10 text-green-700 border-green-600/30",
  warn: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  bad: "bg-red-600/10 text-red-700 border-red-600/30",
  idle: "bg-basalt/5 text-basalt/50 border-basalt/15",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]", toneClasses[tone])}>{children}</span>;
}

/** Friendly names + grouping for the integration booleans. */
const INTEGRATION_LABELS: Record<string, string> = {
  payments_paylink: "Payments (PayLink)",
  email_resend: "Email (Resend)",
  supabase_service_role: "Supabase service role",
  anthropic_ai: "AI (Anthropic)",
  google_maps: "Google Maps",
  google_places: "Google Places",
  google_translate: "Google Translate",
  sms_infobip: "SMS (Infobip)",
  whatsapp_infobip: "WhatsApp (Infobip)",
  viber_infobip: "Viber (Infobip)",
  telegram: "Telegram",
  tripadvisor: "Tripadvisor",
  alert_recipient_admin_email: "Alert recipient (ADMIN_EMAIL)",
  heartbeat_ping_refresh_ical: "Dead-man ping · refresh-ical",
  heartbeat_ping_reconcile_bookings: "Dead-man ping · reconcile-bookings",
};
const CORE_KEYS = ["payments_paylink", "email_resend", "supabase_service_role", "anthropic_ai", "alert_recipient_admin_email"];

function cronTone(c: AdminHealth["crons"][number]): { tone: Tone; label: string } {
  // Never recorded a run, but not yet overdue (e.g. a 6-hourly job right after
  // monitoring was enabled) — neutral, not an alarm.
  if (c.neverRecorded && !c.stale) return { tone: "idle", label: "Awaiting first run" };
  if (c.neverRecorded) return { tone: "bad", label: "Never run" };
  if (c.stale) return { tone: "bad", label: "Stale" };
  if (c.ok === false || c.consecutiveFailures > 0) return { tone: "warn", label: "Failing" };
  return { tone: "ok", label: "Healthy" };
}

export function AdminHealth() {
  const [data, setData] = useState<AdminHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminHealth());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the health snapshot.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Overall banner: count the things that need a human.
  const issues = data
    ? [
        !data.db.ok && "database",
        data.crons.some((c) => c.stale) && "a scheduled job",
        data.calendars.errored > 0 && "calendar errors",
        (data.bookings.pendingPayment > 0 || data.bookings.awaitingPayment > 0) && "unconfirmed payments",
      ].filter(Boolean)
    : [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-4xl font-normal tracking-tight">System health.</h2>
          <p className="mt-1 max-w-2xl text-sm text-basalt/55">
            Live status of the site's moving parts — scheduled jobs, calendar syncs, payments, and integrations. {data && <span className="text-basalt/40">Snapshot {relTime(data.time)}.</span>}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-none border-basalt/15" disabled={loading} onClick={load}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error && <p className="mt-6 rounded-none border border-red-600/30 bg-red-600/5 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!data && loading && <p className="mt-6 text-sm text-basalt/50">Loading health…</p>}

      {data && (
        <div className="mt-6 grid gap-6">
          {/* Overall banner */}
          <div className={cn("flex items-center gap-3 rounded-none border px-4 py-3", issues.length ? toneClasses.bad : toneClasses.ok)}>
            {issues.length ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
            <p className="text-sm font-semibold">
              {issues.length ? `${issues.length} area${issues.length === 1 ? " needs" : "s need"} attention: ${issues.join(", ")}.` : "All systems operational."}
            </p>
          </div>

          {/* Scheduled jobs */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45"><Activity className="h-3.5 w-3.5" /> Scheduled jobs (crons)</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.crons.map((c) => {
                const { tone, label } = cronTone(c);
                return (
                  <div key={c.job} className="rounded-none border border-basalt/12 bg-paper p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{c.label}</p>
                      <Pill tone={tone}>{label}</Pill>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-basalt/40">{c.job} · {everyLabel(c.maxAgeMinutes)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-basalt/60">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last run: {relTime(c.lastRunAt)}</span>
                      <span>Last success: {relTime(c.lastSuccessAt)}</span>
                    </div>
                    {c.detail && <p className="mt-1.5 truncate text-[11px] text-basalt/45" title={c.detail}>{c.detail}</p>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Calendar syncs */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45"><Calendar className="h-3.5 w-3.5" /> Calendar syncs (iCal)</h3>
            <div className="mb-2 flex flex-wrap gap-2">
              <Pill tone="idle">{data.calendars.total} connected</Pill>
              <Pill tone={data.calendars.stale ? "warn" : "ok"}>{data.calendars.stale} stale</Pill>
              <Pill tone={data.calendars.errored ? "bad" : "ok"}>{data.calendars.errored} errored</Pill>
            </div>
            {data.calendars.items.length === 0 ? (
              <p className="text-sm text-basalt/45">No listings have an external calendar connected.</p>
            ) : (
              <div className="divide-y divide-basalt/10 rounded-none border border-basalt/12">
                {data.calendars.items.map((cal) => (
                  <div key={cal.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/listing/${cal.id}`} className="truncate font-semibold hover:text-apricot">{cal.title}</Link>
                      <p className="text-[11px] text-basalt/45">{cal.type} · {cal.blockedRanges} blocked range{cal.blockedRanges === 1 ? "" : "s"} · synced {relTime(cal.lastSyncedAt)}</p>
                      {cal.error && <p className="mt-0.5 text-[11px] text-red-700">⚠ {cal.error}</p>}
                    </div>
                    {cal.error ? <Pill tone="bad">Error</Pill> : cal.stale ? <Pill tone="warn">Stale</Pill> : <Pill tone="ok">Fresh</Pill>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Payments */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45"><CreditCard className="h-3.5 w-3.5" /> Payments</h3>
            <div className="flex flex-wrap gap-2">
              <Pill tone={data.bookings.pendingPayment ? "warn" : "ok"}>{data.bookings.pendingPayment} pending payment</Pill>
              <Pill tone={data.bookings.awaitingPayment ? "warn" : "ok"}>{data.bookings.awaitingPayment} awaiting payment</Pill>
            </div>
            {(data.bookings.pendingPayment > 0 || data.bookings.awaitingPayment > 0) && (
              <p className="mt-1.5 text-xs text-basalt/50">Held bookings are confirmed by the reconcile cron. A healthy cron clears genuinely-paid ones within ~10 minutes; persistently stuck rows may need a manual check.</p>
            )}
          </section>

          {/* Integrations */}
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45"><Plug className="h-3.5 w-3.5" /> Integrations configured</h3>
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {Object.entries(data.integrations)
                .sort(([a], [b]) => Number(CORE_KEYS.includes(b)) - Number(CORE_KEYS.includes(a)))
                .map(([key, on]) => (
                  <div key={key} className="flex items-center justify-between gap-2 border-b border-basalt/8 py-1 text-sm">
                    <span className={cn("flex items-center gap-1.5", CORE_KEYS.includes(key) && "font-semibold")}>{INTEGRATION_LABELS[key] ?? key}</span>
                    {on ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> On</span>
                    ) : (
                      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", CORE_KEYS.includes(key) ? "text-red-700" : "text-basalt/35")}><XCircle className="h-3.5 w-3.5" /> Off</span>
                    )}
                  </div>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-basalt/40">Shows only whether each integration's keys are set on the server — never the values.</p>
          </section>
        </div>
      )}
    </div>
  );
}
