/**
 * Dashboard → Refer & earn. An operator shares their referral link; when a host
 * they referred gets their first confirmed booking, the operator earns credit.
 * Referrer-only reward. Reads GET /api/referral/me.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Gift, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchMyReferral, type ReferralSummary } from "@/lib/referrals";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function StatTile({ n, label, tone }: { n: string; label: string; tone?: "earn" }) {
  return (
    <div className="rounded-none border border-basalt/12 bg-paper p-4">
      <p className={cn("font-display text-3xl tabular-nums", tone === "earn" && "text-apricot")}>{n}</p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
    </div>
  );
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Invited", cls: "bg-basalt/5 text-basalt/55 border-basalt/15" },
  qualified: { label: "Earned", cls: "bg-green-600/10 text-green-700 border-green-600/30" },
  paid: { label: "Paid", cls: "bg-basalt/90 text-paper border-basalt" },
  void: { label: "Void", cls: "bg-red-600/10 text-red-700 border-red-600/30" },
};

export function OperatorReferrals() {
  const { format } = useCurrency();
  const [data, setData] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMyReferral().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your referrals."));
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      toast("Referral link copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const share = async (link: string) => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: "Host with Revamp", text: "List your place on Revamp — here's my invite:", url: link });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    void copy(link);
  };

  if (error) return <p className="rounded-none border border-red-600/30 bg-red-600/5 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-basalt/50">Loading…</p>;

  return (
    <div>
      <h2 className="font-display text-4xl font-normal tracking-tight">Refer a host, earn credit.</h2>
      <p className="mt-1 max-w-2xl text-sm text-basalt/55">
        Invite other hosts to list on Revamp. When a host you refer gets their <strong>first confirmed booking</strong>, you earn <strong className="text-apricot">{format(data.rewardCents)}</strong> in referral credit.
      </p>

      {!data.enabled && (
        <p className="mt-4 rounded-none border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700">The referral program is currently paused. Your existing referrals are safe and will still qualify when it resumes.</p>
      )}

      {/* Share link */}
      <div className="mt-6 rounded-none border border-basalt/12 bg-chalk/40 p-5">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45"><Share2 className="h-3.5 w-3.5" /> Your invite link</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={data.link} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-none bg-paper text-sm" />
          <Button type="button" variant="outline" size="sm" className="h-10 shrink-0 rounded-none border-basalt/15" onClick={() => copy(data.link)}>
            {copied ? <><Check className="mr-1.5 h-4 w-4" /> Copied</> : <><Copy className="mr-1.5 h-4 w-4" /> Copy</>}
          </Button>
          <Button type="button" size="sm" className="h-10 shrink-0 rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={() => share(data.link)}>
            <Share2 className="mr-1.5 h-4 w-4" /> Share
          </Button>
        </div>
        <p className="mt-2 text-xs text-basalt/45">Your code: <span className="font-mono font-semibold text-basalt/70">{data.code}</span> — a new host can also enter it when they sign up.</p>
      </div>

      {/* How it works */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Share2, t: "Share your link", d: "Send your invite to a host who'd be a great fit for Revamp." },
          { icon: Users, t: "They sign up & list", d: "They create an operator account through your link and publish a listing." },
          { icon: Gift, t: "You earn credit", d: `When their first booking is confirmed, you earn ${format(data.rewardCents)}.` },
        ].map((s, i) => (
          <div key={i} className="rounded-none border border-basalt/12 bg-paper p-4">
            <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-none bg-apricot/12 text-apricot"><s.icon className="h-4 w-4" /></span><span className="text-xs font-bold text-basalt/40">0{i + 1}</span></div>
            <p className="mt-2 font-semibold">{s.t}</p>
            <p className="mt-0.5 text-sm text-basalt/55">{s.d}</p>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile n={String(data.stats.invited)} label="Invited" />
        <StatTile n={String(data.stats.qualified)} label="Earned" />
        <StatTile n={format(data.stats.owedCents)} label="Credit owed" tone="earn" />
        <StatTile n={format(data.stats.paidCents)} label="Paid out" />
      </div>

      {/* List */}
      <h3 className="mb-2 mt-8 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Your referrals</h3>
      {data.referrals.length === 0 ? (
        <p className="rounded-none border border-dashed border-basalt/15 bg-chalk/30 px-4 py-6 text-center text-sm text-basalt/45">No referrals yet — share your link to get started.</p>
      ) : (
        <div className="divide-y divide-basalt/10 rounded-none border border-basalt/12">
          {data.referrals.map((r) => {
            const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.pending;
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold">Referred host</p>
                  <p className="text-[11px] text-basalt/45">Joined {new Date(r.createdAt).toLocaleDateString()}{r.qualifiedAt ? ` · earned ${new Date(r.qualifiedAt).toLocaleDateString()}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  {r.rewardCents > 0 && <span className="font-semibold tabular-nums">{format(r.rewardCents)}</span>}
                  <span className={cn("inline-flex items-center rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]", s.cls)}>{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-basalt/40">Credit owed is paid out by the Revamp team alongside your regular payouts. See the <a href="/terms" className="font-semibold text-basalt/60 underline hover:text-apricot">referral program terms</a>.</p>
    </div>
  );
}
