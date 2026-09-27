/**
 * Restaurant-side voucher validator (model B). A standalone, no-login page a
 * staff member opens from the restaurant's private redeem link (the token in the
 * URL is the credential). They type the code the guest shows; the server redeems
 * it single-use, scoped to this restaurant. No app to install — just a web page.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrency } from "@/contexts/CurrencyContext";
import { staffRedeemVoucher, voucherRedeemInfo, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function RedeemStation({ token }: { token: string }) {
  const { format } = useCurrency();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [info, setInfo] = useState<{ restaurantTitle: string; city: string; image: string | null; staffNote: string | null } | null>(null);
  const [infoError, setInfoError] = useState(false);

  useEffect(() => {
    let live = true;
    voucherRedeemInfo(token)
      .then((i) => { if (live) setInfo(i); })
      .catch(() => { if (live) setInfoError(true); });
    return () => { live = false; };
  }, [token]);

  const redeem = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await staffRedeemVoucher(token, c);
      setResult({ ok: true, msg: `Redeemed ${format(r.faceCents)} · ${r.restaurantTitle}` });
      setCode("");
    } catch (e) {
      setResult({ ok: false, msg: e instanceof ApiError || e instanceof Error ? e.message : "Couldn't redeem." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-chalk p-6">
      <div className="brand-notch w-full max-w-md border border-basalt/12 bg-paper p-7 shadow-[0_20px_55px_rgba(35,35,33,0.1)]">
        {info ? (
          <div className="flex items-center gap-3 border-b border-basalt/10 pb-4">
            {info.image && info.image.startsWith("http") && <img src={info.image} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />}
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-tight text-basalt">{info.restaurantTitle}</p>
              <p className="truncate text-xs uppercase tracking-[0.1em] text-basalt/45">{info.city} · Voucher redemption</p>
            </div>
          </div>
        ) : (
          <p className="font-display text-2xl leading-none">revamp<span className="text-apricot">.</span></p>
        )}
        <h1 className="mt-4 font-display text-xl">Redeem a voucher</h1>
        <p className="mt-1 text-sm text-basalt/55">Enter the code the guest shows you.</p>
        {info?.staffNote && <p className="mt-3 border border-apricot/25 bg-apricot/5 p-3 text-sm text-basalt/75">{info.staffNote}</p>}
        {infoError && <p className="mt-3 text-sm text-destructive">This redemption link isn't active. Check with your Revamp contact.</p>}
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && redeem()}
          placeholder="RV-XXXX-XXXX"
          autoFocus
          className="mt-4 h-14 rounded-none text-center text-lg font-bold uppercase tracking-[0.2em]"
        />
        <Button onClick={redeem} disabled={busy || !code.trim()} className="mt-3 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Redeem"}
        </Button>
        {result && (
          <div className={cn("mt-4 flex items-center gap-2 border p-3 text-sm font-semibold", result.ok ? "border-sevan/40 bg-sevan/10 text-sevan" : "border-destructive/40 bg-destructive/10 text-destructive")}>
            {result.ok ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
            <span>{result.msg}</span>
          </div>
        )}
        <p className="mt-5 text-[11px] leading-4 text-basalt/40">Each code works once. Keep this page bookmarked — the link is private to your restaurant; don't share it.</p>
      </div>
    </div>
  );
}
