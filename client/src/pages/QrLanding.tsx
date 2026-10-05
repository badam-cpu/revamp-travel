/**
 * Public QR landing — /q/:code. Resolves the code (and counts the scan) via
 * /api/qr-resolve, then acts by type:
 *   listing      → redirect to the Revamp listing (UTM-tagged)
 *   custom       → redirect to the operator's URL
 *   instructions → render an info page + a "powered by Revamp" marketing CTA
 *   tip/service  → a payment page (PayLink); the guest pays with no account
 * Returning from PayLink with ?pay=<paymentId> shows the confirmation.
 * Guest-facing, minimal chrome (scanned on a phone).
 */
import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Loader2, ArrowRight, Check } from "lucide-react";
import { resolveQr, startQrPayment, confirmQrPayment, type QrType, type QrConfig } from "@/lib/qr";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { toast } from "sonner";

const fmt = (cents: number) => "֏" + Math.round(cents / 100).toLocaleString("en-US");

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-chalk text-basalt">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
        <header className="mb-6"><span className="font-display text-xl font-bold tracking-[-0.02em]">revamp.</span></header>
        <main className="flex-1">{children}</main>
        <footer className="mt-8 text-center text-[11px] text-basalt/40">powered by <span className="font-bold text-basalt/60">revamp.</span></footer>
      </div>
    </div>
  );
}

export default function QrLanding({ code }: { code: string }) {
  const searchStr = useSearch();
  const payId = new URLSearchParams(searchStr).get("pay");

  useDocumentMeta({ title: "Revamp", description: "Revamp Vacations", canonicalPath: `/q/${code}`, noindex: true });

  // --- return from PayLink: confirm the payment --------------------------------
  const [payState, setPayState] = useState<"confirming" | "paid" | "pending" | null>(payId ? "confirming" : null);
  useEffect(() => {
    if (!payId) return;
    let active = true;
    confirmQrPayment(payId)
      .then((r) => active && setPayState(r.status === "paid" ? "paid" : "pending"))
      .catch(() => active && setPayState("pending"));
    return () => { active = false; };
  }, [payId]);

  // --- resolve the code --------------------------------------------------------
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; type: QrType; name: string; config: QrConfig }
  >({ status: "loading" });
  useEffect(() => {
    if (payId) return; // showing the confirmation, skip resolve/redirect
    let active = true;
    resolveQr(code)
      .then((r) => {
        if (!active) return;
        if (r.type === "listing" && r.listingSlug) {
          window.location.replace(`/listing/${r.listingSlug}?utm_source=qr&utm_medium=onsite&utm_campaign=qr-listing`);
          return;
        }
        if (r.type === "custom" && r.config?.url) { window.location.replace(r.config.url); return; }
        setState({ status: "ready", type: r.type, name: r.name, config: r.config });
      })
      .catch((e) => active && setState({ status: "error", message: e instanceof Error ? e.message : "This code isn't active." }));
    return () => { active = false; };
  }, [code, payId]);

  // --- payment form state ------------------------------------------------------
  const [chosenCents, setChosenCents] = useState<number | null>(null);
  const [customDram, setCustomDram] = useState("");
  const [paying, setPaying] = useState(false);

  if (payState) {
    return (
      <Shell>
        {payState === "confirming" && <div className="grid place-items-center py-24 text-basalt/50"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {payState === "paid" && (
          <div className="brand-notch border border-basalt/12 bg-paper p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-apricot text-white"><Check className="h-7 w-7" /></div>
            <h1 className="mt-5 font-display text-3xl tracking-[-0.02em]">Thank you!</h1>
            <p className="mt-2 text-sm text-basalt/60">Your payment went through. Enjoy your stay.</p>
            <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-apricot">Explore Revamp <ArrowRight className="h-4 w-4" /></Link>
          </div>
        )}
        {payState === "pending" && (
          <div className="brand-notch border border-basalt/12 bg-paper p-8 text-center">
            <h1 className="font-display text-2xl tracking-[-0.02em]">Payment processing</h1>
            <p className="mt-2 text-sm text-basalt/60">If you completed payment, it'll be confirmed shortly — no need to pay again.</p>
          </div>
        )}
      </Shell>
    );
  }

  if (state.status === "loading") return <Shell><div className="grid place-items-center py-24 text-basalt/50"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>;

  if (state.status === "error") {
    return (
      <Shell>
        <div className="brand-notch border border-basalt/12 bg-paper p-6 text-center">
          <p className="font-display text-2xl">This code isn't available.</p>
          <p className="mt-2 text-sm text-basalt/55">{state.message}</p>
          <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-apricot">Go to Revamp <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </Shell>
    );
  }

  if (state.type === "instructions") {
    return (
      <Shell>
        <div className="brand-notch border border-basalt/12 bg-paper p-6">
          <h1 className="font-display text-3xl leading-[1.05] tracking-[-0.03em]">{state.name}</h1>
          {state.config.content && <div className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-basalt/80">{state.config.content}</div>}
          <div className="mt-6 rounded-[0.875rem] bg-basalt p-5 text-center text-paper">
            <p className="font-display text-lg">Coming back to Armenia?</p>
            <p className="mt-1 text-xs text-paper/65">Book your next stay, tour or table on Revamp.</p>
            <Link href="/" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-apricot px-4 py-2 text-xs font-bold text-white">Explore Revamp →</Link>
          </div>
        </div>
      </Shell>
    );
  }

  // tip / service — payment page
  const isService = state.type === "service";
  const suggestions = state.config.suggestionsCents ?? [];
  const fixedCents = state.config.amountCents ?? 0;
  const customCents = Math.round(Number(customDram) * 100);
  const amountCents = isService ? fixedCents : (chosenCents ?? (Number.isFinite(customCents) && customCents > 0 ? customCents : 0));

  const pay = async () => {
    if (!isService && (!amountCents || amountCents <= 0)) { toast("Choose an amount."); return; }
    setPaying(true);
    try {
      const { redirectUrl } = await startQrPayment(code, isService ? fixedCents : amountCents);
      window.location.href = redirectUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the payment.");
      setPaying(false);
    }
  };

  return (
    <Shell>
      <div className="brand-notch border border-basalt/12 bg-paper p-6">
        <h1 className="font-display text-2xl leading-[1.1] tracking-[-0.02em]">{state.name}</h1>
        {state.config.description && <p className="mt-2 text-sm text-basalt/55">{state.config.description}</p>}

        {isService ? (
          <div className="mt-5 rounded-[0.875rem] bg-chalk p-5 text-center">
            <div className="font-display text-4xl font-medium">{fmt(fixedCents)}</div>
          </div>
        ) : (
          <div className="mt-5">
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((c) => (
                <button key={c} type="button" onClick={() => { setChosenCents(c); setCustomDram(""); }}
                  className={`rounded-full border px-4 py-2 text-sm font-bold ${chosenCents === c ? "border-apricot bg-apricot text-white" : "border-basalt/20 bg-paper text-basalt"}`}>
                  {fmt(c)}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <input
                value={customDram}
                onChange={(e) => { setCustomDram(e.target.value.replace(/[^0-9]/g, "")); setChosenCents(null); }}
                inputMode="numeric"
                placeholder="Other amount (֏)"
                className="h-11 w-full rounded-[0.875rem] border border-basalt/20 bg-paper px-3 text-center text-base outline-none focus:border-apricot"
              />
            </div>
          </div>
        )}

        <button type="button" onClick={pay} disabled={paying || (!isService && amountCents <= 0)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-[0.875rem] bg-apricot py-3.5 font-bold text-white disabled:opacity-50">
          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {paying ? "Taking you to payment…" : amountCents > 0 ? `Pay ${fmt(amountCents)} securely` : "Choose an amount"}
        </button>
        <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">Paid securely via PayLink · powered by <span className="font-semibold text-basalt/60">revamp.</span></p>
      </div>
    </Shell>
  );
}
