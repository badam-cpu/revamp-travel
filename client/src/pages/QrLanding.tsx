/**
 * Public QR landing — /q/:code. Resolves the code (and counts the scan) via
 * /api/qr-resolve, then acts by type:
 *   listing      → redirect to the Revamp listing (UTM-tagged)
 *   custom       → redirect to the operator's URL
 *   instructions → render an info page + a "powered by Revamp" marketing CTA
 *   tip/service  → payment page (coming in the payments increment)
 * Guest-facing, minimal chrome (scanned on a phone).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, ArrowRight } from "lucide-react";
import { resolveQr, type QrType, type QrConfig } from "@/lib/qr";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";

export default function QrLanding({ code }: { code: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; type: QrType; name: string; config: QrConfig }
  >({ status: "loading" });

  useDocumentMeta({ title: "Revamp", description: "Revamp Vacations", canonicalPath: `/q/${code}`, noindex: true });

  useEffect(() => {
    let active = true;
    resolveQr(code)
      .then((r) => {
        if (!active) return;
        // Redirect types: leave immediately.
        if (r.type === "listing" && r.listingSlug) {
          window.location.replace(`/listing/${r.listingSlug}?utm_source=qr&utm_medium=onsite&utm_campaign=qr-listing`);
          return;
        }
        if (r.type === "custom" && r.config?.url) {
          window.location.replace(r.config.url);
          return;
        }
        setState({ status: "ready", type: r.type, name: r.name, config: r.config });
      })
      .catch((e) => active && setState({ status: "error", message: e instanceof Error ? e.message : "This code isn't active." }));
    return () => { active = false; };
  }, [code]);

  return (
    <div className="min-h-screen bg-chalk text-basalt">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
        <header className="mb-6">
          <span className="font-display text-xl font-bold tracking-[-0.02em]">revamp<span className="text-apricot">.</span></span>
        </header>

        <main className="flex-1">
          {state.status === "loading" && (
            <div className="grid place-items-center py-24 text-basalt/50"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}

          {state.status === "error" && (
            <div className="brand-notch border border-basalt/12 bg-paper p-6 text-center">
              <p className="font-display text-2xl">This code isn't available.</p>
              <p className="mt-2 text-sm text-basalt/55">{state.message}</p>
              <Link href="/" className="mt-5 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-apricot">Go to Revamp <ArrowRight className="h-4 w-4" /></Link>
            </div>
          )}

          {state.status === "ready" && state.type === "instructions" && (
            <div className="brand-notch border border-basalt/12 bg-paper p-6">
              <h1 className="font-display text-3xl leading-[1.05] tracking-[-0.03em]">{state.name}</h1>
              {state.config.content && (
                <div className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-basalt/80">{state.config.content}</div>
              )}
              <div className="mt-6 rounded-[0.875rem] bg-basalt p-5 text-center text-paper">
                <p className="font-display text-lg">Coming back to Armenia?</p>
                <p className="mt-1 text-xs text-paper/65">Book your next stay, tour or table on Revamp.</p>
                <Link href="/" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-apricot px-4 py-2 text-xs font-bold text-white">Explore Revamp →</Link>
              </div>
            </div>
          )}

          {state.status === "ready" && (state.type === "tip" || state.type === "service") && (
            <div className="brand-notch border border-basalt/12 bg-paper p-6 text-center">
              <h1 className="font-display text-2xl leading-[1.1] tracking-[-0.02em]">{state.name}</h1>
              <p className="mt-3 text-sm text-basalt/55">Online payment for this code is coming soon. Please check back shortly.</p>
            </div>
          )}
        </main>

        <footer className="mt-8 text-center text-[11px] text-basalt/40">powered by <span className="font-bold text-basalt/60">revamp.</span></footer>
      </div>
    </div>
  );
}
