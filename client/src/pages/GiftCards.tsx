/**
 * /gift-cards — buy a Revamp gift card. Three fixed denominations, a recipient
 * name/email + message, and a required "I accept the terms" checkbox (recorded
 * server-side with time + IP for chargebacks). Payment is the same PayLink loop
 * as bookings; the recipient is emailed a code once the payment is verified.
 * Redemption happens at booking checkout (enter the code on /checkout/:slug).
 */
import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, Gift, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { buildBreadcrumbJsonLd } from "@shared/seo";
import { GIFT_CARD_AMOUNTS_CENTS, GIFT_CARD_VALID_MONTHS } from "@shared/giftcards";
import { buyGiftCard, confirmGiftPurchase, ApiError } from "@/lib/api";

export default function GiftCards() {
  const { user } = useAuth();
  const { format, rate, currency } = useCurrency();
  const search = useSearch();
  // Whole-dollar USD reference under the AMD value (shown when a rate is set and
  // AMD is the active display). Math.round gives $101.45→$101, $101.50→$102.
  const usdRef = (amdCents: number) => (rate > 0 && currency === "AMD" ? `$${Math.round(amdCents / 100 / rate).toLocaleString()}` : null);
  const [amount, setAmount] = useState<number>(GIFT_CARD_AMOUNTS_CENTS[1]);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [buying, setBuying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  useDocumentMeta({
    title: "Gift cards | Revamp Vacations",
    description: "Give the gift of travel in Armenia — a Revamp Vacations gift card for stays, tours, and experiences. Choose an amount, send it to anyone, and they redeem it at checkout.",
    canonicalPath: "/gift-cards",
    jsonLd: buildBreadcrumbJsonLd(origin, [
      { name: "Home", path: "/" },
      { name: "Gift cards", path: "/gift-cards" },
    ]),
  });

  // Buyer returns from PayLink → activate + confirm.
  useEffect(() => {
    if (new URLSearchParams(search).get("purchase") !== "return" || !user) return;
    confirmGiftPurchase()
      .then((r) => {
        if (r.activated > 0) setConfirmed(true);
      })
      .catch(() => {});
  }, [search, user]);

  const buy = async () => {
    if (!accepted) {
      toast("Please accept the gift-card terms to continue.");
      return;
    }
    if (!recipientName.trim() || !recipientEmail.trim()) {
      toast("Add the recipient's name and email.");
      return;
    }
    setBuying(true);
    try {
      const { redirectUrl } = await buyGiftCard({
        amountCents: amount,
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        message: message.trim() || undefined,
        acceptTerms: true,
      });
      window.location.href = redirectUrl;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't start checkout.");
      setBuying(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main>
        <section className="border-b border-basalt/10 bg-chalk">
          <div className="container py-14 lg:py-20">
            <p className="eyebrow inline-flex items-center gap-2"><Gift className="h-4 w-4" /> Give the gift of travel</p>
            <h1 className="mt-3 max-w-3xl font-display text-5xl leading-[1.02] tracking-[-0.04em] lg:text-6xl">Revamp gift cards.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-basalt/60">
              One card, all of Armenia — stays, tours, and experiences. Choose an amount, send it to anyone by email, and they redeem it at checkout.
            </p>
          </div>
        </section>

        {confirmed && (
          <div className="container pt-8">
            <div className="flex items-center gap-3 border border-apricot/30 bg-apricot/5 px-5 py-4 text-sm">
              <Check className="h-5 w-5 shrink-0 text-apricot" />
              <p>Payment received — the gift card is on its way to {recipientEmail || "your recipient"}. Thank you!</p>
            </div>
          </div>
        )}

        <section className="container grid gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:py-16">
          {/* Choose + personalize */}
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">1 · Choose an amount</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {GIFT_CARD_AMOUNTS_CENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(a)}
                  className={`flex flex-col items-center justify-center border px-4 py-6 text-center transition-colors ${amount === a ? "border-apricot bg-apricot/5" : "border-basalt/15 hover:border-basalt/30"}`}
                >
                  <span className="font-display text-2xl tracking-[-0.02em]">{format(a)}</span>
                  {usdRef(a) && <span className="mt-1 text-xs text-basalt/45">≈ {usdRef(a)}</span>}
                </button>
              ))}
            </div>

            <p className="mt-8 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">2 · Who's it for?</p>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="rname" className="text-sm font-semibold">Recipient name</Label>
                <Input id="rname" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Their name" className="h-11 rounded-none" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="remail" className="text-sm font-semibold">Recipient email</Label>
                <Input id="remail" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="their@email.com" className="h-11 rounded-none" />
                <p className="text-xs text-basalt/45">We'll email them the gift card with your message.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rmsg" className="text-sm font-semibold">Message <span className="font-normal text-basalt/45">(optional)</span></Label>
                <Textarea id="rmsg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Happy travels! …" className="rounded-none text-base" maxLength={500} />
              </div>
            </div>
          </div>

          {/* Summary + buy */}
          <aside className="h-fit border border-basalt/12 bg-paper p-6 lg:sticky lg:top-24">
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Summary</p>
            <div className="mt-4 flex items-baseline justify-between border-b border-basalt/10 pb-4">
              <span className="text-sm text-basalt/60">Gift card value</span>
              <span className="text-right">
                <span className="block font-display text-3xl tracking-[-0.02em]">{format(amount)}</span>
                {usdRef(amount) && <span className="block text-xs text-basalt/45">≈ {usdRef(amount)}</span>}
              </span>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-basalt/60">
              <li>• Emailed to your recipient with a unique code.</li>
              <li>• Redeemable across stays, tours & experiences.</li>
              <li>• Valid for {GIFT_CARD_VALID_MONTHS} months from purchase.</li>
              <li>• Usable over multiple bookings until spent.</li>
            </ul>

            <label className="mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-basalt/70">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-apricot" />
              <span>
                I accept the gift-card terms: gift cards are <strong>non-refundable</strong> and not exchangeable for cash, expire {GIFT_CARD_VALID_MONTHS} months after purchase, and are subject to Revamp's{" "}
                <Link href="/terms" className="text-apricot underline-offset-2 hover:underline">Terms of Service</Link>.
              </span>
            </label>

            {user ? (
              <Button onClick={buy} disabled={buying || !accepted} className="mt-5 h-12 w-full rounded-none bg-apricot text-base text-white hover:bg-apricot/90">
                {buying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting checkout…</> : `Pay ${format(amount)}`}
              </Button>
            ) : (
              <Button asChild className="mt-5 h-12 w-full rounded-none bg-apricot text-base text-white hover:bg-apricot/90">
                <Link href="/login?redirect=/gift-cards">Sign in to buy</Link>
              </Button>
            )}
            <p className="mt-3 text-center text-xs text-basalt/40">Secure payment via PayLink.</p>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
