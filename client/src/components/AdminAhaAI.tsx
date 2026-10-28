/**
 * Admin → Aha AI (2026-10-28): keep a finger on the pulse of what guests ask
 * Aha AI and how it goes.
 *
 *  - Trip planner: every /plan request (0124 trip_plan_events) — the guest's
 *    words, language, days, route, suggested listings, model, wait, whether it
 *    worked — and what happened next (changed / emailed, with the address for
 *    follow-up / saved). Kept 90 days.
 *  - Voice calls: "Talk to Aha AI" history read live from ElevenLabs (summary,
 *    outcome, transcript with tool calls) — nothing copied into our database.
 *  - Chats are already in Admin → Support.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bookmark, ChevronDown, Loader2, Mail, MessageSquare, Mic, Pencil, RefreshCw, Route as RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ApiError, fetchTripPlannerReport, fetchVoiceCall, fetchVoiceCalls, type TripPlannerReport, type VoiceCallDetail, type VoiceCallSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

const LANG: Record<string, string> = { en: "English", ru: "Russian", hy: "Armenian", other: "Other", form: "Form only" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const secs = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

function Tile({ n, label, hint }: { n: string | number; label: string; hint?: string }) {
  return (
    <div className="border border-basalt/10 bg-paper p-4">
      <p className="font-display text-3xl tabular-nums">{n}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-basalt/45">{hint}</p>}
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "good" && "bg-emerald-50 text-emerald-700",
        tone === "bad" && "bg-red-50 text-red-700",
        tone === "warn" && "bg-amber-50 text-amber-800",
        tone === "neutral" && "bg-chalk text-basalt/65",
      )}
    >
      {children}
    </span>
  );
}

export function AdminAhaAI({ onOpenSupport }: { onOpenSupport?: () => void }) {
  const [tab, setTab] = useState<"planner" | "voice">("planner");
  return (
    <div>
      <PageHeader title="Aha AI" sub="What guests ask Aha AI, what they get, and how it goes." />
      <div className="mb-6 flex flex-wrap gap-2">
        {([
          { k: "planner", label: "Trip planner", icon: RouteIcon },
          { k: "voice", label: "Voice calls", icon: Mic },
        ] as const).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold", tab === t.k ? "border-basalt bg-basalt text-paper" : "border-basalt/15 text-basalt/70 hover:border-basalt/35")}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
        {onOpenSupport && (
          <button type="button" onClick={onOpenSupport} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-basalt/15 px-4 text-sm font-semibold text-basalt/70 hover:border-basalt/35">
            <MessageSquare className="h-4 w-4" /> Chats <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {tab === "planner" ? <PlannerTab /> : <VoiceTab />}
    </div>
  );
}

function PlannerTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TripPlannerReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "failed" | "followup">("all");

  const load = () => {
    setError(null);
    setData(null);
    fetchTripPlannerReport(days)
      .then(setData)
      .catch((e) => {
        if (!(e instanceof ApiError)) console.error("[admin-aha] planner", e);
        setError(e instanceof ApiError ? e.message : "Couldn't load the trip planner log.");
      });
  };
  useEffect(load, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === "failed") return data.plans.filter((p) => !p.ok || p.retried);
    if (filter === "followup") return data.plans.filter((p) => p.emails.length || p.saved);
    return data.plans;
  }, [data, filter]);

  if (error) return <p className="border border-basalt/12 bg-chalk p-4 text-sm text-basalt/70">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;

  const t = data.totals;
  const maxDay = Math.max(1, ...data.byDay.map((d) => d.plans));
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={cn("min-h-10 rounded-full border px-3.5 text-sm font-semibold", days === d ? "border-apricot bg-apricot text-white" : "border-basalt/15 text-basalt/70")}>
            {d} days
          </button>
        ))}
        <button type="button" onClick={load} className="ml-auto inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-basalt/60 hover:text-basalt"><RefreshCw className="h-4 w-4" /> Refresh</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile n={t.plans} label="Plans" />
        <Tile n={t.plans ? `${Math.round((t.ok / t.plans) * 100)}%` : "—"} label="Worked" hint={t.failed ? `${t.failed} failed · ${t.retried} retried` : t.retried ? `${t.retried} needed a retry` : undefined} />
        <Tile n={secs(t.medianMs)} label="Typical wait" />
        <Tile n={t.changes} label="Changes" />
        <Tile n={t.emails} label="Emailed" />
        <Tile n={t.saves} label="Saved" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="border border-basalt/10 bg-paper p-4">
          <p className="text-sm font-semibold">Plans per day</p>
          {data.byDay.length ? (
            <div className="mt-3 flex h-28 items-end gap-1">
              {data.byDay.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.plans} plans${d.failed ? `, ${d.failed} failed` : ""}`}>
                  <div className="bg-apricot/80" style={{ height: `${((d.plans - d.failed) / maxDay) * 100}%` }} />
                  {d.failed > 0 && <div className="bg-red-400" style={{ height: `${(d.failed / maxDay) * 100}%` }} />}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-basalt/50">No plans yet in this period.</p>
          )}
          <p className="mt-3 text-xs text-basalt/50">
            Languages: {data.languages.map((l) => `${LANG[l.language] ?? l.language} ${l.plans}`).join(" · ") || "—"}
          </p>
        </div>
        <div className="border border-basalt/10 bg-paper p-4">
          <p className="text-sm font-semibold">Most suggested places</p>
          <ol className="mt-2 grid gap-1 text-sm">
            {data.topPlaces.slice(0, 8).map((p) => (
              <li key={p.slug} className="flex justify-between gap-3"><a href={`/listing/${p.slug}`} target="_blank" rel="noreferrer" className="truncate hover:text-apricot">{p.title}</a><span className="tabular-nums text-basalt/50">{p.plans}</span></li>
            ))}
            {!data.topPlaces.length && <li className="text-basalt/50">—</li>}
          </ol>
        </div>
        <div className="border border-basalt/10 bg-paper p-4">
          <p className="text-sm font-semibold">Most planned areas</p>
          <ol className="mt-2 grid gap-1 text-sm">
            {data.topAreas.slice(0, 8).map((a) => (
              <li key={a.name} className="flex justify-between gap-3"><span className="truncate">{a.name}</span><span className="tabular-nums text-basalt/50">{a.plans}</span></li>
            ))}
            {!data.topAreas.length && <li className="text-basalt/50">—</li>}
          </ol>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="mr-2 text-sm font-semibold">Requests</p>
          {([
            { k: "all", label: "All" },
            { k: "followup", label: "Emailed or saved" },
            { k: "failed", label: "Failed or retried" },
          ] as const).map((f) => (
            <button key={f.k} type="button" onClick={() => setFilter(f.k)} className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", filter === f.k ? "border-basalt bg-basalt text-paper" : "border-basalt/15 text-basalt/65")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="divide-y divide-basalt/10 border border-basalt/10 bg-paper">
          {rows.map((p) => (
            <div key={p.id}>
              <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="grid w-full gap-1.5 p-3 text-left hover:bg-chalk/60 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="text-xs tabular-nums text-basalt/50">{when(p.at)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{p.request || <span className="text-basalt/50">Form: {p.title ?? "—"}</span>}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-basalt/50">
                    {p.language && <Chip>{LANG[p.language] ?? p.language}</Chip>}
                    {p.source === "mcp" && <Chip>ChatGPT / Claude</Chip>}
                    {p.days != null && <span>{p.days} days</span>}
                    {p.route.length > 0 && <span className="truncate">· {p.route.join(" → ")}</span>}
                    {p.guest && <span>· {p.guest}</span>}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {p.ok ? <Chip tone={p.retried ? "warn" : "good"}>{p.retried ? "Worked on retry" : "Worked"}</Chip> : <Chip tone="bad">Failed</Chip>}
                  {p.changes.length > 0 && <Chip><Pencil className="mr-1 h-3 w-3" /> {p.changes.length}</Chip>}
                  {p.emails.length > 0 && <Chip><Mail className="mr-1 h-3 w-3" /> {p.emails.length}</Chip>}
                  {p.saved && <Chip><Bookmark className="mr-1 h-3 w-3" /> Saved</Chip>}
                  <ChevronDown className={cn("h-4 w-4 text-basalt/35 transition-transform", open === p.id && "rotate-180")} />
                </span>
              </button>
              {open === p.id && (
                <div className="grid gap-3 bg-chalk/50 px-3 pb-4 pt-1 text-sm sm:pl-[142px]">
                  {p.request && <p className="whitespace-pre-wrap leading-6">“{p.request}”</p>}
                  {p.title && <p><span className="text-basalt/50">Plan:</span> {p.title}</p>}
                  {!p.ok && p.error && <p className="text-red-700">{p.error}</p>}
                  {p.listings.length > 0 && (
                    <p className="leading-6"><span className="text-basalt/50">Suggested:</span> {p.listings.map((l, i) => <span key={l.slug}>{i > 0 && " · "}<a href={`/listing/${l.slug}`} target="_blank" rel="noreferrer" className="hover:text-apricot">{l.title}</a></span>)}</p>
                  )}
                  {p.changes.map((c, i) => <p key={i}><span className="text-basalt/50">Changed {when(c.at)}:</span> “{c.change}”{!c.ok && <span className="text-red-700"> — failed</span>}</p>)}
                  {p.emails.map((e, i) => (
                    <p key={i} className="flex flex-wrap items-center gap-2">
                      <span className="text-basalt/50">Emailed {when(e.at)} to</span>
                      {e.email ? <a href={`mailto:${e.email}`} className="font-semibold text-apricot hover:underline">{e.email}</a> : "—"}
                      {!e.ok && <span className="text-red-700">— didn't send</span>}
                    </p>
                  ))}
                  <p className="text-xs text-basalt/45">{p.model ?? "—"} · {secs(p.durationMs)}{p.retried ? " · needed a second try" : ""}</p>
                </div>
              )}
            </div>
          ))}
          {!rows.length && <p className="p-4 text-sm text-basalt/50">Nothing here for this period.</p>}
        </div>
        <p className="mt-2 text-xs text-basalt/45">Kept for 90 days. Email addresses are shown so you can follow up — use them only for that.</p>
      </div>
    </div>
  );
}

function VoiceTab() {
  const [calls, setCalls] = useState<VoiceCallSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, VoiceCallDetail | "loading" | "error">>({});

  const load = (next?: string | null) => {
    setError(null);
    if (next) setMore(true);
    fetchVoiceCalls(next)
      .then((r) => {
        setCalls((prev) => (next && prev ? [...prev, ...r.calls] : r.calls));
        setCursor(r.nextCursor);
      })
      .catch((e) => {
        if (!(e instanceof ApiError)) console.error("[admin-aha] voice", e);
        setError(e instanceof ApiError ? e.message : "Couldn't load the call history.");
      })
      .finally(() => setMore(false));
  };
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    setOpen(open === id ? null : id);
    if (detail[id] && detail[id] !== "error") return;
    setDetail((d) => ({ ...d, [id]: "loading" }));
    fetchVoiceCall(id)
      .then((c) => setDetail((d) => ({ ...d, [id]: c })))
      .catch((e) => {
        console.error("[admin-aha] call", e);
        setDetail((d) => ({ ...d, [id]: "error" }));
      });
  };

  if (error) return <p className="border border-basalt/12 bg-chalk p-4 text-sm text-basalt/70">{error}</p>;
  if (!calls) return <p className="flex items-center gap-2 text-sm text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Loading calls from ElevenLabs…</p>;

  const total = calls.reduce((n, c) => n + (c.durationSecs ?? 0), 0);
  const ok = calls.filter((c) => c.outcome === "success").length;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile n={calls.length} label="Calls shown" />
        <Tile n={calls.length ? mmss(total / calls.length) : "—"} label="Average length" />
        <Tile n={calls.length ? `${Math.round((ok / calls.length) * 100)}%` : "—"} label="Went well" hint="ElevenLabs' own judgement" />
        <Tile n={mmss(total)} label="Total talk time" />
      </div>
      <div className="divide-y divide-basalt/10 border border-basalt/10 bg-paper">
        {calls.map((c) => {
          const d = detail[c.id];
          return (
            <div key={c.id}>
              <button type="button" onClick={() => toggle(c.id)} aria-expanded={open === c.id} className="grid w-full gap-1.5 p-3 text-left hover:bg-chalk/60 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="text-xs tabular-nums text-basalt/50">{c.startedAt ? when(c.startedAt) : "—"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{c.title || "Call"}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-basalt/50">
                    <span>{mmss(c.durationSecs)}</span>
                    {c.messages != null && <span>· {c.messages} messages</span>}
                    {c.language && <span>· {c.language.toUpperCase()}</span>}
                    {c.tools.map((t) => <Chip key={t}>{t}</Chip>)}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {c.outcome === "success" ? <Chip tone="good">Went well</Chip> : c.outcome === "failure" ? <Chip tone="bad">Didn't go well</Chip> : <Chip>{c.status === "done" ? "Unclear" : c.status ?? "—"}</Chip>}
                  <ChevronDown className={cn("h-4 w-4 text-basalt/35 transition-transform", open === c.id && "rotate-180")} />
                </span>
              </button>
              {open === c.id && (
                <div className="bg-chalk/50 px-3 pb-4 pt-1 text-sm sm:pl-[142px]">
                  {d === "loading" || !d ? (
                    <p className="flex items-center gap-2 text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Loading the transcript…</p>
                  ) : d === "error" ? (
                    <p className="text-basalt/60">Couldn't load this call — try again.</p>
                  ) : (
                    <div className="grid gap-3">
                      {d.summary && <p className="leading-6"><span className="text-basalt/50">Summary:</span> {d.summary}</p>}
                      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
                        {d.turns.filter((t) => t.text || t.tools.length).map((t, i) => (
                          <div key={i} className={cn("max-w-[85%] rounded-[12px] px-3 py-2", t.role === "agent" ? "bg-paper" : "ml-auto bg-basalt text-paper")}>
                            {t.text && <p className="leading-6">{t.text}</p>}
                            {t.tools.map((tool, j) => <p key={j} className={cn("mt-1 text-xs", t.role === "agent" ? "text-apricot" : "text-paper/70")}>⚙ {tool.name}{tool.params ? ` ${tool.params}` : ""}</p>)}
                            {t.at != null && <p className={cn("mt-0.5 text-[10px]", t.role === "agent" ? "text-basalt/40" : "text-paper/50")}>{mmss(t.at)}</p>}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-basalt/45">{mmss(d.durationSecs)}{d.credits != null ? ` · ${d.credits.toLocaleString()} credits` : ""}{d.endedBecause ? ` · ended: ${d.endedBecause}` : ""}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!calls.length && <p className="p-4 text-sm text-basalt/50">No calls yet.</p>}
      </div>
      {cursor && (
        <button type="button" onClick={() => load(cursor)} disabled={more} className="inline-flex min-h-10 items-center justify-center gap-1.5 justify-self-start rounded-full border border-basalt/20 px-4 text-sm font-semibold">
          {more ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load older calls
        </button>
      )}
      <p className="text-xs text-basalt/45">Read live from ElevenLabs — nothing is copied into Revamp. Their call-history retention settings apply.</p>
    </div>
  );
}
