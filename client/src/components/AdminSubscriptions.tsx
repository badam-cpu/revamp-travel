/**
 * Admin subscriptions (/admin → Subscriptions). Create/edit the recurring plans
 * Revamp offers operators (each is mirrored as a PayLink Subscription on save),
 * and see who's subscribed. All writes go through /api/admin-subscription-plan
 * (service role, admin-gated); reads are admin-scoped Supabase selects.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  listAllPlans,
  listAllSubscriptions,
  saveSubscriptionPlan,
  cancelSubscription,
  type SubscriptionPlan,
  type AdminSubscriptionRow,
  type PricingMode,
} from "@/lib/subscriptions";

interface Draft {
  id?: string;
  name: string;
  description: string;
  amountAmd: string; // whole AMD in the input; converted to cents on save
  monthsQuantity: string;
  pricingMode: PricingMode;
  isActive: boolean;
  sort: string;
}
const BLANK: Draft = { name: "", description: "", amountAmd: "", monthsQuantity: "12", pricingMode: "flat", isActive: true, sort: "0" };

export function AdminSubscriptions() {
  const { format } = useCurrency();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s] = await Promise.all([listAllPlans(), listAllSubscriptions()]);
      setPlans(p);
      setSubs(s);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (p: SubscriptionPlan) =>
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description,
      amountAmd: String(Math.round(p.amountCents / 100)),
      monthsQuantity: String(p.monthsQuantity),
      pricingMode: p.pricingMode,
      isActive: p.isActive,
      sort: String(p.sort),
    });

  const save = async () => {
    if (!draft) return;
    const amd = Math.round(Number(draft.amountAmd));
    if (!draft.name.trim() || !Number.isFinite(amd) || amd <= 0) {
      toast("Give the plan a name and a monthly price.");
      return;
    }
    setSaving(true);
    try {
      const r = await saveSubscriptionPlan({
        id: draft.id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        amountCents: amd * 100,
        monthsQuantity: Math.max(1, Math.min(120, Number(draft.monthsQuantity) || 12)),
        pricingMode: draft.pricingMode,
        isActive: draft.isActive,
        sort: Number(draft.sort) || 0,
      });
      if (r.paylinkSynced) {
        toast.success("Plan saved and synced to PayLink.");
      } else {
        // Surface the real reason so a mis-configured plan / API issue is visible.
        toast.error(`Plan saved, but PayLink sync failed: ${r.paylinkError || "unknown error"}`, { duration: 12000 });
      }
      setDraft(null);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save that plan.");
    } finally {
      setSaving(false);
    }
  };

  const cancelSub = async (row: AdminSubscriptionRow) => {
    if (!confirm(`Cancel ${row.operatorName}'s subscription?`)) return;
    try {
      await cancelSubscription(row.id);
      toast.success("Subscription cancelled.");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel.");
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.03em] sm:text-5xl">Subscriptions</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-basalt/60">Recurring plans operators pay for, billed monthly through PayLink.</p>
        </div>
        {!draft && (
          <Button onClick={() => setDraft({ ...BLANK })}>
            <Plus className="mr-1.5 h-4 w-4" /> New plan
          </Button>
        )}
      </div>

      {/* Plan editor */}
      {draft && (
        <div className="mb-10 border border-basalt/15 bg-paper p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-2xl">{draft.id ? "Edit plan" : "New plan"}</h2>
            <button type="button" onClick={() => setDraft(null)} className="text-basalt/40 hover:text-basalt" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="plan-name" className="text-sm font-semibold">Name</Label>
              <Input id="plan-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Channel Manager" className="mt-1.5" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="plan-desc" className="text-sm font-semibold">Description</Label>
              <Textarea id="plan-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What the operator gets for this monthly fee." rows={3} className="mt-1.5" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-sm font-semibold">Pricing</Label>
              <div className="mt-1.5 flex border border-basalt/15">
                {([
                  { key: "flat", label: "Flat monthly", blurb: "One fixed price per operator." },
                  { key: "per_listing", label: "Per listing", blurb: "Unit price × their live listings." },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setDraft({ ...draft, pricingMode: m.key })}
                    className={`flex-1 px-4 py-2.5 text-left text-xs transition-colors ${draft.pricingMode === m.key ? "bg-basalt text-paper" : "text-basalt/60 hover:bg-chalk"}`}
                  >
                    <span className="block font-bold uppercase tracking-[0.08em]">{m.label}</span>
                    <span className={`mt-0.5 block ${draft.pricingMode === m.key ? "text-paper/70" : "text-basalt/45"}`}>{m.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="plan-amount" className="text-sm font-semibold">
                {draft.pricingMode === "per_listing" ? "Price per listing / month (AMD)" : "Monthly price (AMD)"}
              </Label>
              <Input id="plan-amount" type="number" min={1} value={draft.amountAmd} onChange={(e) => setDraft({ ...draft, amountAmd: e.target.value })} placeholder="e.g. 1500" className="mt-1.5" />
              {draft.pricingMode === "per_listing" && (
                <p className="mt-1 text-xs text-basalt/45">Charged for each of the operator's published stay/tour/experience listings. Updates next cycle when their count changes.</p>
              )}
            </div>
            <div>
              <Label htmlFor="plan-months" className="text-sm font-semibold">Billing cycles (months)</Label>
              <Input id="plan-months" type="number" min={1} max={120} value={draft.monthsQuantity} onChange={(e) => setDraft({ ...draft, monthsQuantity: e.target.value })} className="mt-1.5" />
              <p className="mt-1 text-xs text-basalt/45">How many monthly charges the subscription runs for.</p>
            </div>
            <div>
              <Label htmlFor="plan-sort" className="text-sm font-semibold">Sort order</Label>
              <Input id="plan-sort" type="number" min={0} value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })} className="mt-1.5" />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch id="plan-active" checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
              <Label htmlFor="plan-active" className="text-sm font-semibold">Active (operators can subscribe)</Label>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…</> : <><Check className="mr-1.5 h-4 w-4" /> Save plan</>}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
          {!draft.id && (
            <p className="mt-3 text-xs text-basalt/45">Saving registers this plan with PayLink so operators get a hosted subscribe page. Changing the price or cycles later re-registers it.</p>
          )}
        </div>
      )}

      {/* Plans list */}
      <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Plans</h2>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-basalt/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : plans.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-8 text-center text-sm text-basalt/55">No plans yet. Create one to start billing operators.</p>
      ) : (
        <div className="grid gap-3">
          {plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 border border-basalt/12 bg-paper px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  {!p.isActive && <span className="rounded-full bg-basalt/10 px-2 py-0.5 text-xs text-basalt/55">Archived</span>}
                  {p.pricingMode === "per_listing" && <span className="rounded-full bg-basalt/8 px-2 py-0.5 text-xs text-basalt/60">Per listing</span>}
                  {/* Per-listing plans register per operator, so a null plan-level id is expected. */}
                  {p.pricingMode === "flat" && p.paylinkSubscriptionId == null && <span className="rounded-full bg-apricot/10 px-2 py-0.5 text-xs text-apricot">Not synced</span>}
                </div>
                <p className="text-sm text-basalt/60">
                  {format(p.amountCents)} / {p.pricingMode === "per_listing" ? "listing / month" : "month"} · {p.monthsQuantity} cycles
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => startEdit(p)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Subscribers */}
      <h2 className="mb-3 mt-10 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Subscribers ({subs.length})</h2>
      {subs.length === 0 ? (
        <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-8 text-center text-sm text-basalt/55">No operators have subscribed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-basalt/15 text-left text-xs font-bold uppercase tracking-[0.08em] text-basalt/45">
                <th className="py-2 pr-4">Operator</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Since</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map((row) => (
                <tr key={row.id} className="border-b border-basalt/8">
                  <td className="py-3 pr-4 font-medium">{row.operatorName}</td>
                  <td className="py-3 pr-4 text-basalt/70">{row.planName}</td>
                  <td className="py-3 pr-4">
                    <span className="rounded-full bg-basalt/8 px-2 py-0.5 text-xs capitalize text-basalt/70">{row.status.replace("_", " ")}</span>
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-basalt/60">{row.startedAt ? new Date(row.startedAt).toLocaleDateString() : "—"}</td>
                  <td className="py-3 text-right">
                    {(row.status === "active" || row.status === "pending" || row.status === "past_due") && (
                      <button type="button" onClick={() => cancelSub(row)} className="text-xs font-semibold text-[#b4472e] hover:underline">
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
