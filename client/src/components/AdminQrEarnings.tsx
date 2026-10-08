/**
 * /admin → Payouts (below booking payouts): settle QR payment earnings. Tips &
 * service payments are collected through Revamp's PayLink (Revamp is merchant of
 * record); Revamp keeps 12.5% and owes the operator their net. This lists what's
 * owed per operator and marks it paid out. Reads /api/qr-earnings*.
 */
import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import { adminListQrEarnings, adminSettleQrEarnings, type QrEarningsData } from "@/lib/qr";
import { useCurrency } from "@/contexts/CurrencyContext";
import { toast } from "sonner";

export function AdminQrEarnings() {
  const { format } = useCurrency();
  const [data, setData] = useState<QrEarningsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    adminListQrEarnings()
      .then(setData)
      .catch(() => setFailed(true));

  useEffect(() => {
    load();
  }, []);

  const settle = async (operatorId: string) => {
    setBusy(operatorId);
    try {
      const r = await adminSettleQrEarnings(operatorId);
      toast(`Marked ${format(r.amountCents)} paid (${r.count} payment${r.count === 1 ? "" : "s"}).`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't settle these earnings.");
    } finally {
      setBusy(null);
    }
  };

  // Quiet until the ledger is reachable (e.g. before migration 0090 is run).
  if (failed || !data) return null;
  const owing = data.operators.filter((o) => o.owedCents > 0);

  return (
    <section className="mt-14 border-t border-basalt/10 pt-10">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-apricot" />
        <h2 className="font-display text-3xl tracking-[-0.03em]">QR payment earnings</h2>
      </div>
      <p className="mt-2 max-w-xl text-sm text-basalt/55">
        Tips &amp; service payments collected via QR, net of the 12.5% commission. <strong className="text-basalt">{format(data.totals.owedCents)}</strong> is owed to operators. Mark paid once you've sent it.
      </p>

      {owing.length === 0 ? (
        <p className="mt-5 border border-dashed border-basalt/20 bg-chalk px-6 py-8 text-center text-sm text-basalt/55">Nothing owed right now.</p>
      ) : (
        <div className="mt-5 grid gap-2">
          {owing.map((o) => (
            <div key={o.operatorId} className="grid gap-2 border border-basalt/10 bg-paper p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <h3 className="font-semibold">{o.name}</h3>
                <p className="mt-0.5 text-sm text-basalt/55">
                  {o.owedCount} payment{o.owedCount === 1 ? "" : "s"} owed{o.paidCents > 0 ? ` · ${format(o.paidCents)} paid to date` : ""}
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <p className="font-display text-xl font-normal">{format(o.owedCents)}</p>
                <button
                  type="button"
                  disabled={busy === o.operatorId}
                  onClick={() => settle(o.operatorId)}
                  className="rounded-none bg-sevan px-3 py-1.5 text-xs font-semibold text-white hover:bg-sevan/90 disabled:opacity-50"
                >
                  {busy === o.operatorId ? "…" : "Mark paid"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
