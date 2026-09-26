/**
 * Aha AI writing assist — a small "✨ Aha AI" control that sits next to a listing field
 * (title / short description / long description / highlights). It reads the draft
 * context from the caller, asks the server to generate or improve the field
 * (type-, SEO-, and standards-aware), previews the suggestion, and applies it only
 * when the operator clicks "Use". Never overwrites without consent.
 */
import { useState } from "react";
import { Sparkles, Loader2, Check, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ahaListingCopy, ApiError, type AhaCopyContext, type AhaCopyParams } from "@/lib/api";

type Field = AhaCopyParams["field"];
type ListingType = AhaCopyParams["listingType"];

export function AhaAssist({
  field,
  listingType,
  getContext,
  getCurrent,
  onApplyText,
  onApplyItems,
}: {
  field: Field;
  listingType: ListingType;
  getContext: () => AhaCopyContext;
  getCurrent: () => string;
  onApplyText?: (text: string) => void;
  onApplyItems?: (items: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ text?: string; items?: string[] } | null>(null);

  const run = async (mode: "generate" | "improve") => {
    setBusy(true);
    setResult(null);
    try {
      const ctx = { ...getContext(), notes: notes.trim() || undefined };
      const r = await ahaListingCopy({ field, mode, listingType, current: getCurrent(), context: ctx });
      if (!r.text && !r.items?.length) throw new ApiError("Aha AI didn't return anything — try again.");
      setResult(r);
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Aha AI couldn't draft that.");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (result?.items && onApplyItems) onApplyItems(result.items);
    else if (result?.text && onApplyText) onApplyText(result.text);
    setResult(null);
    setOpen(false);
    setNotes("");
    toast.success("Applied Aha AI's draft — edit it however you like.");
  };

  const hasText = () => !!getCurrent().trim();

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-apricot/30 bg-apricot/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-apricot transition-colors hover:bg-apricot/10"
      >
        <Sparkles className="h-3 w-3" /> Aha AI
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(92vw,360px)] rounded-none border border-basalt/15 bg-paper p-3 shadow-[0_20px_55px_rgba(35,35,33,0.18)]">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/50">Write with Aha AI</p>
            <button type="button" onClick={() => { setOpen(false); setResult(null); }} className="text-basalt/40 hover:text-basalt" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional: a hint for Aha AI (e.g. 'family-friendly, near the metro')"
            className="mt-2 h-9 w-full rounded-none border border-basalt/15 bg-paper px-2.5 text-xs outline-none focus:border-apricot"
          />

          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => run("generate")} className="flex-1 rounded-none bg-apricot px-3 py-1.5 text-xs font-bold text-white hover:bg-apricot/90 disabled:opacity-50">
              {busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : "Generate"}
            </button>
            <button type="button" disabled={busy || !hasText()} title={hasText() ? "" : "Type something first to improve it"} onClick={() => run("improve")} className="flex-1 rounded-none border border-basalt/20 px-3 py-1.5 text-xs font-bold text-basalt hover:border-apricot disabled:opacity-40">
              Improve mine
            </button>
          </div>

          {result && (
            <div className="mt-3 border-t border-basalt/10 pt-3">
              {result.items ? (
                <ul className="grid gap-1.5 text-sm text-basalt/80">
                  {result.items.map((it, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-apricot" />{it}</li>)}
                </ul>
              ) : (
                <p className="whitespace-pre-line text-sm leading-6 text-basalt/80">{result.text}</p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={apply} className="inline-flex items-center gap-1 rounded-none bg-apricot px-3 py-1.5 text-xs font-bold text-white hover:bg-apricot/90"><Check className="h-3.5 w-3.5" /> Use this</button>
                <button type="button" disabled={busy} onClick={() => run(hasText() ? "improve" : "generate")} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/55 hover:text-apricot disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Regenerate</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
