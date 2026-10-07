/**
 * /admin → Referrals. Oversight for the operator-refers-operator program:
 * toggle it on/off, set the referrer reward, see every referral, and mark a
 * qualified (earned) reward paid once it's been disbursed with the operator's
 * normal payout. Reads/writes /api/referral/admin*.
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminListReferrals, adminPayReferral, adminSaveReferralSettings, type AdminReferralData, type AdminReferralRow } from "@/lib/referrals";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Invited", cls: "bg-basalt/5 text-basalt/55 border-basalt/15" },
  qualified: { label: "Earned — owed", cls: "bg-green-600/10 text-green-700 border-green-600/30" },
  paid: { label: "Paid", cls: "bg-basalt/90 text-paper border-basalt" },
  void: { label: "Void", cls: "bg-red-600/10 text-red-700 border-red-600/30" },
};

function name(p: AdminReferralRow["referrer"]): string {
  return (p?.business_name || p?.display_name || "—").trim();
}

export function AdminReferrals() {
  const { format } = useCurrency();
  const [data, setData] = useState<AdminReferralData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [rewardAmd, setRewardAmd] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  const load = () =>
    adminListReferrals()
      .then((d) => {
        setData(d);
        setEnabled(d.config.enabled);
        setRewardAmd(String(Math.round(d.config.rewardCents / 100)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load referrals."));

  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const rewardCents = Math.max(0, Math.round(Number(rewardAmd) || 0)) * 100;
      await adminSaveReferralSettings({ enabled, rewardCents });
      toast("Referral settings saved.");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const pay = async (id: string) => {
    setPayingId(id);
    try {
      const r = await adminPayReferral(id);
      if (r.ok) {
        toast("Marked paid.");
        await load();
      } else {
        toast("Could not mark paid (already paid?).");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't mark paid.");
    } finally {
      setPayingId(null);
    }
  };

  if (error) return <p className="rounded-none border border-red-600/30 bg-red-600/5 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-basalt/50">Loading…</p>;

  return (
    <div>
      <h2 className="font-display text-4xl font-normal tracking-tight">Referrals.</h2>
      <p className="mt-1 max-w-2xl text-sm text-basalt/55">Operators refer other hosts. When a referred host gets their first confirmed booking, the referrer earns credit — paid out by the team alongside normal payouts.</p>

      {/* Settings */}
      <div className="mt-6 rounded-none border border-basalt/12 bg-chalk/40 p-5">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Program settings</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-apricot" />
            Program active
          </label>
          <div>
            <label className="mb-1 block text-xs font-semibold text-basalt/55">Referrer reward (AMD)</label>
            <Input type="number" min={0} step={1000} value={rewardAmd} onChange={(e) => setRewardAmd(e.target.value)} className="h-9 w-40 rounded-none" />
          </div>
          <Button type="button" size="sm" className="h-9 rounded-none bg-basalt text-paper hover:bg-basalt/90" disabled={savingSettings} onClick={saveSettings}>
            {savingSettings ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-none border border-green-600/30 bg-green-600/10 px-3 py-1 text-sm font-semibold text-green-700">Owed: {format(data.totals.owedCents)}</span>
        <span className="inline-flex items-center rounded-none border border-basalt/15 bg-basalt/5 px-3 py-1 text-sm font-semibold text-basalt/60">Paid: {format(data.totals.paidCents)}</span>
        <span className="inline-flex items-center rounded-none border border-basalt/15 bg-basalt/5 px-3 py-1 text-sm font-semibold text-basalt/60">{data.referrals.length} total</span>
      </div>

      {/* Table */}
      <h3 className="mb-2 mt-8 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">All referrals</h3>
      {data.referrals.length === 0 ? (
        <p className="rounded-none border border-dashed border-basalt/15 bg-chalk/30 px-4 py-6 text-center text-sm text-basalt/45">No referrals yet.</p>
      ) : (
        <div className="divide-y divide-basalt/10 rounded-none border border-basalt/12">
          {data.referrals.map((r) => {
            const s = STATUS[r.status] ?? STATUS.pending;
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{name(r.referrer)} <span className="font-normal text-basalt/40">referred</span> {name(r.referred)}</p>
                  <p className="text-[11px] text-basalt/45">Joined {new Date(r.created_at).toLocaleDateString()}{r.qualified_at ? ` · earned ${new Date(r.qualified_at).toLocaleDateString()}` : ""}{r.paid_at ? ` · paid ${new Date(r.paid_at).toLocaleDateString()}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  {r.reward_cents > 0 && <span className="font-semibold tabular-nums">{format(r.reward_cents)}</span>}
                  <span className={cn("inline-flex items-center rounded-none border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]", s.cls)}>{s.label}</span>
                  {r.status === "qualified" && (
                    <Button type="button" size="sm" variant="outline" className="h-8 rounded-none border-basalt/15 text-xs" disabled={payingId === r.id} onClick={() => pay(r.id)}>
                      {payingId === r.id ? "…" : <><Check className="mr-1 h-3.5 w-3.5" /> Mark paid</>}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
