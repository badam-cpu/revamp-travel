/**
 * Invoice editor (migration 0108), opened from the booking window for every
 * listing type. The operator edits the words — who it's billed to, dates,
 * line descriptions, notes and, when they're the seller, their own details —
 * and sees the invoice update live (shared/invoice.ts, the same renderer the
 * email and the guest's /invoice/:token page use). Amounts come from the
 * booking and can't be changed here or on the server.
 */
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Info, Loader2, Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { getInvoiceDraft, saveInvoice, userMessage, type InvoiceDraft } from "@/lib/api";
import { buildInvoice, invoiceHtml, invoiceMoney, INVOICE_LIMITS, type InvoiceEdits } from "@shared/invoice";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold">
        {label} {hint && <span className="font-normal text-basalt/45">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-basalt/10 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const inputCls = "h-11 rounded-none text-base sm:text-sm";

export function InvoiceDialog({ bookingId, open, onClose, onSaved }: { bookingId: string; open: boolean; onClose: () => void; onSaved?: () => void }) {
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [edits, setEdits] = useState<InvoiceEdits>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [saveDefaults, setSaveDefaults] = useState(true);
  const [saved, setSaved] = useState<InvoiceDraft["saved"]>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setError(null);
    getInvoiceDraft(bookingId)
      .then((d) => {
        setDraft(d);
        setSaved(d.saved);
        const s = d.context.seller;
        setEdits({
          sendTo: d.edits.sendTo ?? d.facts.guestEmail ?? "",
          billTo: { name: d.facts.guestName ?? "", ...d.edits.billTo },
          issuedOn: d.edits.issuedOn,
          dueOn: d.edits.dueOn,
          notes: d.edits.notes ?? "",
          lines: d.edits.lines ?? {},
          seller:
            d.context.issuerKind === "operator"
              ? { name: s.name ?? "", taxId: s.taxId ?? "", address: s.address ?? "", email: s.email ?? "", phone: s.phone ?? "", bankDetails: s.bankDetails ?? "", ...d.edits.seller }
              : undefined,
        });
      })
      .catch((e) => {
        console.error("[invoice draft]", e);
        setError(userMessage(e, "Couldn't open the invoice right now. Please try again."));
      });
  }, [open, bookingId]);

  const model = useMemo(() => (draft ? buildInvoice(draft.facts, { ...draft.context, number: saved?.number ?? draft.context.number }, edits) : null), [draft, edits, saved]);
  const previewHtml = useMemo(() => (model ? invoiceHtml(model) : ""), [model]);

  const setBill = (k: keyof NonNullable<InvoiceEdits["billTo"]>, v: string) => setEdits((e) => ({ ...e, billTo: { ...e.billTo, [k]: v } }));
  const setSeller = (k: keyof NonNullable<InvoiceEdits["seller"]>, v: string) => setEdits((e) => ({ ...e, seller: { ...e.seller, [k]: v } }));
  const setLine = (key: string, v: string) => setEdits((e) => ({ ...e, lines: { ...e.lines, [key]: v } }));

  const submit = async (send: boolean) => {
    if (!draft) return;
    setBusy(send ? "send" : "save");
    try {
      const r = await saveInvoice(bookingId, edits, { send, saveSellerDefaults: saveDefaults && draft.context.issuerKind === "operator" });
      setSaved({ number: r.number, url: r.url, sentTo: r.sentTo, sentAt: r.sent ? new Date().toISOString() : saved?.sentAt ?? null });
      onSaved?.();
      toast.success(r.sent ? `Invoice ${r.number} sent to ${r.sentTo}.` : `Invoice ${r.number} saved.`);
    } catch (e) {
      toast(userMessage(e, send ? "Couldn't send the invoice." : "Couldn't save the invoice."));
      onSaved?.(); // it may have been saved even if the email failed
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!saved?.url) return;
    try {
      await navigator.clipboard.writeText(saved.url);
      toast("Invoice link copied.");
    } catch {
      toast("Couldn't copy — open the invoice and copy the address instead.");
    }
  };

  const operatorSeller = draft?.context.issuerKind === "operator";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[94vh] w-full max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-6xl">
        <div className="shrink-0 border-b border-basalt/10 bg-chalk px-5 py-4 pr-14">
          <DialogTitle className="text-lg font-semibold">{saved?.number ? `Invoice ${saved.number}` : "New invoice"}</DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-basalt/55">
            {saved?.sentAt && saved.sentTo
              ? `Last sent to ${saved.sentTo} on ${new Date(saved.sentAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. Edits update the same invoice.`
              : "Edit the details, check the preview, then send it to the guest."}
          </DialogDescription>
        </div>

        {error ? (
          <div className="p-8 text-sm text-basalt/70">{error}</div>
        ) : !draft || !model ? (
          <div className="flex items-center gap-2 p-8 text-sm text-basalt/55">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the booking…
          </div>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:overflow-hidden">
              {/* Form */}
              <div className="grid content-start gap-5 p-5 lg:overflow-y-auto">
                {!draft.invoiceable && (
                  <p className="flex gap-2 bg-chalk p-3 text-xs leading-5 text-basalt/70">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-apricot" aria-hidden />
                    This booking can't be invoiced in its current status. Invoices are for confirmed bookings and bookings awaiting payment.
                  </p>
                )}

                <Group title="Send to">
                  <Field id="inv-to" label="Guest email">
                    <Input id="inv-to" type="email" value={edits.sendTo ?? ""} onChange={(e) => setEdits((x) => ({ ...x, sendTo: e.target.value }))} maxLength={INVOICE_LIMITS.short} placeholder="guest@example.com" className={inputCls} />
                  </Field>
                </Group>

                <Group title="Bill to">
                  <Field id="inv-bname" label="Name">
                    <Input id="inv-bname" value={edits.billTo?.name ?? ""} onChange={(e) => setBill("name", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="inv-bco" label="Company" hint="(optional)">
                      <Input id="inv-bco" value={edits.billTo?.company ?? ""} onChange={(e) => setBill("company", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                    </Field>
                    <Field id="inv-btax" label="Tax ID" hint="(optional)">
                      <Input id="inv-btax" value={edits.billTo?.taxId ?? ""} onChange={(e) => setBill("taxId", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                    </Field>
                  </div>
                  <Field id="inv-badd" label="Address" hint="(optional)">
                    <Textarea id="inv-badd" rows={2} value={edits.billTo?.address ?? ""} onChange={(e) => setBill("address", e.target.value)} maxLength={INVOICE_LIMITS.address} className="rounded-none text-base sm:text-sm" />
                  </Field>
                </Group>

                <Group title="Dates">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="inv-issued" label="Issue date">
                      <Input id="inv-issued" type="date" value={model.issuedOn} onChange={(e) => setEdits((x) => ({ ...x, issuedOn: e.target.value || undefined }))} className={inputCls} />
                    </Field>
                    {model.status === "due" && (
                      <Field id="inv-due" label="Due date">
                        <Input id="inv-due" type="date" value={model.dueOn ?? ""} min={model.issuedOn} onChange={(e) => setEdits((x) => ({ ...x, dueOn: e.target.value || null }))} className={inputCls} />
                      </Field>
                    )}
                  </div>
                </Group>

                <Group title="Lines">
                  <p className="flex items-start gap-2 text-xs leading-5 text-basalt/55">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    You can reword each line. Amounts come from the booking, so the invoice always matches what the guest was charged.
                  </p>
                  {model.lines.map((l) => (
                    <div key={l.key} className="grid gap-1.5">
                      <Label htmlFor={`inv-line-${l.key}`} className="sr-only">Line description</Label>
                      <div className="flex items-center gap-3">
                        <Input id={`inv-line-${l.key}`} value={edits.lines?.[l.key] ?? l.description} onChange={(e) => setLine(l.key, e.target.value)} maxLength={INVOICE_LIMITS.line} className={inputCls} />
                        <span className="shrink-0 text-sm tabular-nums text-basalt/60">{l.onRequest ? "—" : invoiceMoney(l.amountCents, model.currency)}</span>
                      </div>
                    </div>
                  ))}
                </Group>

                <Group title="Notes">
                  <Field id="inv-notes" label="Shown at the bottom of the invoice" hint="(optional)">
                    <Textarea id="inv-notes" rows={3} value={edits.notes ?? ""} onChange={(e) => setEdits((x) => ({ ...x, notes: e.target.value }))} maxLength={INVOICE_LIMITS.notes} placeholder="e.g. Thank you for staying with us!" className="rounded-none text-base sm:text-sm" />
                  </Field>
                </Group>

                {operatorSeller ? (
                  <Group title="Your details (seller)">
                    <p className="text-xs leading-5 text-basalt/55">The guest paid you directly, so the invoice is issued by your business.</p>
                    <Field id="inv-sname" label="Business or legal name">
                      <Input id="inv-sname" value={edits.seller?.name ?? ""} onChange={(e) => setSeller("name", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id="inv-stax" label="Tax ID" hint="(optional)">
                        <Input id="inv-stax" value={edits.seller?.taxId ?? ""} onChange={(e) => setSeller("taxId", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                      </Field>
                      <Field id="inv-sphone" label="Phone" hint="(optional)">
                        <Input id="inv-sphone" type="tel" value={edits.seller?.phone ?? ""} onChange={(e) => setSeller("phone", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                      </Field>
                    </div>
                    <Field id="inv-semail" label="Email">
                      <Input id="inv-semail" type="email" value={edits.seller?.email ?? ""} onChange={(e) => setSeller("email", e.target.value)} maxLength={INVOICE_LIMITS.short} className={inputCls} />
                    </Field>
                    <Field id="inv-sadd" label="Address" hint="(optional)">
                      <Textarea id="inv-sadd" rows={2} value={edits.seller?.address ?? ""} onChange={(e) => setSeller("address", e.target.value)} maxLength={INVOICE_LIMITS.address} className="rounded-none text-base sm:text-sm" />
                    </Field>
                    <Field id="inv-sbank" label="How to pay" hint="(shown when a balance is due)">
                      <Textarea id="inv-sbank" rows={2} value={edits.seller?.bankDetails ?? ""} onChange={(e) => setSeller("bankDetails", e.target.value)} maxLength={INVOICE_LIMITS.bank} placeholder="e.g. Bank, account name and number" className="rounded-none text-base sm:text-sm" />
                    </Field>
                    <label htmlFor="inv-savedef" className="flex items-center gap-2 text-sm">
                      <Checkbox id="inv-savedef" checked={saveDefaults} onCheckedChange={(v) => setSaveDefaults(v === true)} />
                      Use these details on my future invoices
                    </label>
                  </Group>
                ) : (
                  <Group title="Seller">
                    <p className="flex gap-2 bg-chalk p-3 text-xs leading-5 text-basalt/70">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-apricot" aria-hidden />
                      The guest paid through Revamp, so Revamp Hospitality LLC issues this invoice. Your business is named as the service provider.
                    </p>
                  </Group>
                )}
              </div>

              {/* Live preview */}
              <div className="border-t border-basalt/10 bg-chalk p-4 sm:p-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
                <p className="mb-3 text-xs font-semibold text-basalt/50">Preview — what the guest receives</p>
                <div className="overflow-x-auto rounded-none border border-basalt/10 bg-paper p-5 sm:p-8" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-basalt/10 bg-paper px-5 py-3">
              <Button onClick={() => void submit(true)} disabled={!!busy || !draft.invoiceable} className="h-11 rounded-none bg-apricot px-5 text-white hover:bg-apricot/90">
                {busy === "send" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
                {saved?.sentAt ? "Send again" : "Send invoice"}
              </Button>
              <Button variant="outline" onClick={() => void submit(false)} disabled={!!busy || !draft.invoiceable} className="h-11 rounded-none border-basalt/20">
                {busy === "save" ? "Saving…" : "Save without sending"}
              </Button>
              {saved?.url && (
                <div className="flex items-center gap-1 sm:ml-auto">
                  <a href={saved.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-semibold text-basalt/70 hover:text-apricot">
                    <ExternalLink className="h-4 w-4" aria-hidden /> Open
                  </a>
                  <button type="button" onClick={() => void copyLink()} className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-semibold text-basalt/70 hover:text-apricot">
                    <Copy className="h-4 w-4" aria-hidden /> Copy link
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
