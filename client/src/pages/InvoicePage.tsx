/**
 * The guest's private invoice page — /invoice/:token (migration 0108). Linked
 * from the invoice email; no sign-in, the token is the credential. The server
 * rebuilds the invoice from the live booking (so it shows "Paid" once the
 * guest pays) and this page draws it with the same shared/invoice.ts renderer
 * as the email and the operator's editor. "Download PDF" uses the browser's
 * print dialog (Save as PDF) — the toolbar is hidden in print. Never indexed.
 */
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { getInvoice, userMessage } from "@/lib/api";
import { invoiceHtml, type InvoiceModel } from "@shared/invoice";

export default function InvoicePage({ token }: { token: string }) {
  const [invoice, setInvoice] = useState<InvoiceModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentMeta({ title: invoice?.number ? `Invoice ${invoice.number} | Revamp` : "Invoice | Revamp", description: "Your invoice", canonicalPath: "/invoice", noindex: true });

  useEffect(() => {
    let live = true;
    getInvoice(token)
      .then((r) => live && setInvoice(r.invoice))
      .catch((e) => {
        console.error("[invoice page]", e);
        if (live) setError(userMessage(e, "This invoice isn't available right now. Please try again shortly."));
      });
    return () => {
      live = false;
    };
  }, [token]);

  // Built from escaped values only (shared/invoice.ts escapes every field).
  const html = useMemo(() => (invoice ? invoiceHtml(invoice) : ""), [invoice]);

  return (
    <div className="min-h-screen bg-chalk px-4 py-6 text-basalt sm:py-10 print:bg-paper print:p-0">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <a href="/" className="font-display text-xl font-bold tracking-[-0.03em]">revamp.</a>
          {invoice && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-11 items-center gap-2 rounded-none bg-basalt px-5 text-sm font-semibold text-paper transition-colors hover:bg-basalt/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
            >
              <Download className="h-4 w-4" aria-hidden /> Download PDF
            </button>
          )}
        </div>

        {error ? (
          <div className="rounded-none border border-basalt/10 bg-paper p-8 text-center">
            <p className="text-base font-semibold">{error}</p>
            <p className="mt-2 text-sm text-basalt/55">
              Questions? Write to <a href="mailto:hello@revampvacations.com" className="font-semibold text-apricot hover:underline">hello@revampvacations.com</a>.
            </p>
          </div>
        ) : !invoice ? (
          <div className="flex items-center justify-center gap-2 rounded-none border border-basalt/10 bg-paper p-12 text-sm text-basalt/55">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your invoice…
          </div>
        ) : (
          <article
            aria-label={`Invoice ${invoice.number ?? ""}`}
            className="overflow-x-auto rounded-none border border-basalt/10 bg-paper p-5 sm:p-10 print:overflow-visible print:border-0 print:p-0"
            // Keep the status pill and the light bands when saved as PDF.
            style={{ WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        <p className="mt-6 text-center text-[11px] text-basalt/40 print:hidden">
          This invoice is private to you — please don't share the link. · <a href="/" className="font-semibold text-basalt/55 hover:text-apricot">Revamp Vacations</a>
        </p>
      </div>
    </div>
  );
}
