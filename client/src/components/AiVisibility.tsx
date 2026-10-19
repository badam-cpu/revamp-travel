/**
 * Admin → Analytics → AI assistants (migration 0114). How AI assistants show
 * Revamp to people, from `ai_visibility_daily` (admin-read RLS; written only by
 * the server — see shared/aiAgents.ts / server/aiVisibility.ts):
 *  - Answers: an assistant opened a page live because someone asked it
 *  - Visitors from AI: people who clicked through from an assistant
 *  - AI tool uses: calls to the public /mcp catalog
 *  - Crawls: background indexing / training (context, not people)
 * Bot visits are checked against each company's published addresses; impostors
 * ("failed") are never counted, only reported in the footnote.
 */
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { SubHeader } from "@/components/PageHeader";
import { AI_ASSISTANT_LABEL, type AiAssistant, type AiVerification, type AiVisitKind } from "@shared/aiAgents";
import { ARMENIA_UTC_OFFSET_HOURS } from "@shared/sessions";

interface Row {
  day: string;
  kind: AiVisitKind;
  assistant: AiAssistant;
  path: string;
  verification: AiVerification;
  hits: number;
}

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 28, label: "28 days" },
  { days: 90, label: "90 days" },
];

const armeniaDay = (offsetDays = 0) => new Date(Date.now() + ARMENIA_UTC_OFFSET_HOURS * 3_600_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("en-US");
const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const COLORS = { answer: "#F15822", referral: "#212121", mcp: "#9A948B" };

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition-colors", active ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt/60 hover:text-basalt")}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: number; sub: string; accent?: boolean }) {
  return (
    <div className="border border-basalt/10 bg-paper p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/45">{label}</p>
      <p className={cn("mt-2 font-display text-3xl tabular-nums leading-none", accent ? "text-apricot" : "text-basalt")}>{fmt(value)}</p>
      <p className="mt-2 text-xs leading-5 text-basalt/55">{sub}</p>
    </div>
  );
}

export function AiVisibility() {
  const [days, setDays] = useState(28);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    (async () => {
      const from = armeniaDay(days - 1);
      const all: Row[] = [];
      for (let page = 0; page < 10; page++) {
        const { data, error } = await supabase
          .from("ai_visibility_daily")
          .select("day, kind, assistant, path, verification, hits")
          .gte("day", from)
          .order("day", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        if (error) {
          console.error("[ai-visibility]", error);
          if (live) setMissing(true);
          return;
        }
        all.push(...((data ?? []) as Row[]));
        if (!data || data.length < 1000) break;
      }
      if (live) {
        setMissing(false);
        setRows(all);
      }
    })();
    return () => {
      live = false;
    };
  }, [days]);

  const view = useMemo(() => {
    if (!rows) return null;
    const real = rows.filter((r) => r.verification !== "failed");
    const sum = (pred: (r: Row) => boolean) => real.filter(pred).reduce((n, r) => n + r.hits, 0);
    const answers = sum((r) => r.kind === "answer");
    const answersVerified = real.filter((r) => r.kind === "answer" && r.verification === "verified").reduce((n, r) => n + r.hits, 0);
    const referrals = sum((r) => r.kind === "referral");
    const toolUses = sum((r) => r.kind === "mcp" && r.path !== "(connect)");
    const connects = sum((r) => r.kind === "mcp" && r.path === "(connect)");
    const search = sum((r) => r.kind === "search");
    const training = sum((r) => r.kind === "training");
    const impostors = rows.filter((r) => r.verification === "failed").reduce((n, r) => n + r.hits, 0);

    // Daily chart: every day in the range, even quiet ones.
    const byDay = new Map<string, { day: string; answer: number; referral: number; mcp: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = armeniaDay(i);
      byDay.set(d, { day: d, answer: 0, referral: 0, mcp: 0 });
    }
    for (const r of real) {
      const b = byDay.get(r.day);
      if (!b) continue;
      if (r.kind === "answer") b.answer += r.hits;
      else if (r.kind === "referral") b.referral += r.hits;
      else if (r.kind === "mcp" && r.path !== "(connect)") b.mcp += r.hits;
    }

    // By assistant.
    const asst = new Map<AiAssistant, Record<AiVisitKind, number>>();
    for (const r of real) {
      if (r.kind === "mcp" && r.path === "(connect)") continue;
      const a = asst.get(r.assistant) ?? { answer: 0, referral: 0, mcp: 0, search: 0, training: 0 };
      a[r.kind] += r.hits;
      asst.set(r.assistant, a);
    }
    const assistants = Array.from(asst.entries())
      .map(([assistant, k]) => ({ assistant, ...k, people: k.answer + k.referral + k.mcp }))
      .sort((a, b) => b.people - a.people || b.search + b.training - (a.search + a.training));

    // Top pages people reached through AI (answers + click-throughs).
    const pages = new Map<string, { path: string; answer: number; referral: number; via: Set<AiAssistant> }>();
    for (const r of real) {
      if (r.kind !== "answer" && r.kind !== "referral") continue;
      const p = pages.get(r.path) ?? { path: r.path, answer: 0, referral: 0, via: new Set<AiAssistant>() };
      if (r.kind === "answer") p.answer += r.hits;
      else p.referral += r.hits;
      p.via.add(r.assistant);
      pages.set(r.path, p);
    }
    const topPages = Array.from(pages.values())
      .sort((a, b) => b.answer + b.referral - (a.answer + a.referral))
      .slice(0, 15);

    return { answers, answersVerified, referrals, toolUses, connects, search, training, impostors, chart: Array.from(byDay.values()), assistants, topPages };
  }, [rows, days]);

  return (
    <div className="grid min-w-0 gap-5">
      <div className="flex flex-wrap items-center gap-1.5 border border-basalt/10 bg-paper p-4">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/35">Range</span>
        {WINDOWS.map((w) => (
          <Chip key={w.days} active={days === w.days} onClick={() => setDays(w.days)}>{w.label}</Chip>
        ))}
      </div>

      {missing ? (
        <div className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/60">
          AI assistant counts aren't set up yet. Run migration <code className="font-mono text-xs">0114_ai_visibility.sql</code>, and counting starts with the next visit.
        </div>
      ) : !view ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              accent
              label="Answers"
              value={view.answers}
              sub={view.answers ? `Times an AI opened a Revamp page to answer someone. ${fmt(view.answersVerified)} confirmed from the AI company's own servers.` : "Times an AI opened a Revamp page to answer someone's question."}
            />
            <Tile label="Visitors from AI" value={view.referrals} sub="People who clicked through to Revamp from an AI assistant." />
            <Tile label="AI tool uses" value={view.toolUses} sub={`Searches and lookups in our catalog by AI tools${view.connects ? `, from ${fmt(view.connects)} connections` : ""}.`} />
            <Tile label="Crawls" value={view.search + view.training} sub={`Background reading by AI companies: ${fmt(view.search)} for AI search, ${fmt(view.training)} for training.`} />
          </div>

          <section aria-label="Day by day" className="min-w-0 border border-basalt/10 bg-paper p-4">
            <SubHeader title="Day by day" sub="Answers, visitors and tool uses per day (Armenia time)." className="mb-3" />
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={view.chart} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} stroke="rgba(33,33,33,0.08)" />
                  <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: "rgba(33,33,33,0.55)" }} tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgba(33,33,33,0.55)" }} tickLine={false} axisLine={false} />
                  <Tooltip labelFormatter={(d) => shortDay(String(d))} cursor={{ fill: "rgba(33,33,33,0.04)" }} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid rgba(33,33,33,0.12)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="answer" name="Answers" stackId="a" fill={COLORS.answer} />
                  <Bar dataKey="referral" name="Visitors from AI" stackId="a" fill={COLORS.referral} />
                  <Bar dataKey="mcp" name="AI tool uses" stackId="a" fill={COLORS.mcp} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <section aria-label="By assistant" className="min-w-0">
              <SubHeader title="By assistant" />
              {view.assistants.length ? (
                <div className="overflow-x-auto border border-basalt/10 bg-paper">
                  <table className="w-full text-sm">
                    <thead className="border-b border-basalt/10 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/45">
                      <tr>
                        <th scope="col" className="px-3 py-2.5">Assistant</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Answers</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Visitors</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Tool uses</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Crawls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.assistants.map((a) => (
                        <tr key={a.assistant} className="border-b border-basalt/5 last:border-0">
                          <td className="px-3 py-2.5 font-semibold">{AI_ASSISTANT_LABEL[a.assistant]}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.answer ? fmt(a.answer) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.referral ? fmt(a.referral) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.mcp ? fmt(a.mcp) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-basalt/55">{a.search + a.training ? fmt(a.search + a.training) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-8 text-center text-sm text-basalt/55">Nothing yet in this period. Counting started when this was switched on.</p>
              )}
            </section>

            <section aria-label="Pages people reached through AI" className="min-w-0">
              <SubHeader title="Pages people reached through AI" />
              {view.topPages.length ? (
                <div className="overflow-x-auto border border-basalt/10 bg-paper">
                  <table className="w-full text-sm">
                    <thead className="border-b border-basalt/10 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-basalt/45">
                      <tr>
                        <th scope="col" className="px-3 py-2.5">Page</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Answers</th>
                        <th scope="col" className="px-3 py-2.5 text-right">Visitors</th>
                        <th scope="col" className="px-3 py-2.5">Via</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.topPages.map((p) => (
                        <tr key={p.path} className="border-b border-basalt/5 last:border-0">
                          <td className="max-w-[16rem] truncate px-3 py-2.5">
                            {p.path.startsWith("/") ? (
                              <a href={p.path} target="_blank" rel="noreferrer" className="hover:text-apricot">{p.path}</a>
                            ) : (
                              <span className="text-basalt/55">{p.path === "(not found)" ? "Pages that don't exist" : "Other addresses"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{p.answer ? fmt(p.answer) : "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{p.referral ? fmt(p.referral) : "—"}</td>
                          <td className="px-3 py-2.5 text-xs text-basalt/55">{Array.from(p.via).map((a) => AI_ASSISTANT_LABEL[a]).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="border border-dashed border-basalt/20 bg-chalk px-5 py-8 text-center text-sm text-basalt/55">No pages reached through AI in this period yet.</p>
              )}
            </section>
          </div>

          <div className="grid gap-1.5 text-xs leading-5 text-basalt/50">
            <p>
              <strong className="font-semibold text-basalt/65">How this is counted.</strong> ChatGPT, Claude and Perplexity visits are checked against the addresses each company publishes for its bots.
              {view.impostors > 0 && ` ${fmt(view.impostors)} visit${view.impostors === 1 ? "" : "s"} claiming to be an AI came from other addresses and ${view.impostors === 1 ? "isn't" : "aren't"} counted.`}
            </p>
            <p>Gemini and Google's AI answers read pages as Google Search does, so they appear only as visitors. Answers an AI gives from memory, without opening a page, can't be seen by any site.</p>
          </div>
        </>
      )}
    </div>
  );
}
