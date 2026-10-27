/**
 * Dashboard → Listings ⋯ → Guest FAQ (0118). The host's questions and answers
 * for one listing: Aha drafts them from the listing's own saved data (never
 * invents), the host edits, reorders, removes and saves. Saved through
 * /api/listing-faq/save, which cleans them and refuses contact details.
 * Nothing Aha drafts is shown to guests until the host saves it.
 */
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, MessageCircleQuestion, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useListings } from "@/contexts/ListingsContext";
import { ahaListingFaq, saveListingFaq, userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cleanFaq, FAQ_A_MAX, FAQ_MAX_ITEMS, FAQ_Q_MAX, type FaqItem } from "@shared/listingFaq";

type Row = FaqItem & { key: string; suggested?: boolean };
let nextKey = 0;
const toRows = (items: FaqItem[], suggested = false): Row[] => items.map((it) => ({ ...it, key: `faq-${nextKey++}`, suggested }));

export function ListingFaqEditor({ listing, open, onClose }: { listing: { id: string; title: string; faq?: FaqItem[]; faqHostSavedAt?: string | null }; open: boolean; onClose: () => void }) {
  const { refresh } = useListings();
  const [rows, setRows] = useState<Row[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = JSON.stringify(cleanFaq(listing.faq ?? []));
  const dirty = JSON.stringify(cleanFaq(rows)) !== saved || rows.some((r) => r.suggested);

  // Load when the editor opens — not on every catalog refresh, which would wipe edits.
  useEffect(() => {
    if (open) setRows(toRows(listing.faq ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (key: string, p: Partial<FaqItem>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p, suggested: false } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const out = [...rs];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  const draft = async () => {
    setDrafting(true);
    try {
      const { items } = await ahaListingFaq(listing.id);
      const have = new Set(rows.map((r) => r.q.trim().toLowerCase()));
      const fresh = items.filter((it) => !have.has(it.q.trim().toLowerCase())).slice(0, Math.max(0, FAQ_MAX_ITEMS - rows.length));
      if (!fresh.length) toast("Aha AI didn't find new questions it could answer from your listing. Add more details to the listing, or write your own.");
      else {
        setRows((rs) => [...rs, ...toRows(fresh, true)]);
        toast.success(`Aha AI drafted ${fresh.length} question${fresh.length === 1 ? "" : "s"} — check each one before saving.`);
      }
    } catch (e) {
      toast(userMessage(e, "Aha AI couldn't draft questions right now. Please try again."));
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { items } = await saveListingFaq(listing.id, cleanFaq(rows));
      setRows(toRows(items));
      await refresh();
      toast.success(items.length ? "Guest FAQ saved — it's on your listing page." : "Guest FAQ cleared.");
      onClose();
    } catch (e) {
      toast(userMessage(e, "Couldn't save your FAQ. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    onClose();
  };

  const full = rows.length >= FAQ_MAX_ITEMS;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[100dvh] w-full max-w-2xl flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-h-[90dvh]">
        <div className="shrink-0 border-b border-basalt/10 px-5 pb-4 pt-5 pr-14">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-basalt/45">{listing.title}</p>
          <DialogTitle className="mt-1 font-display text-xl tracking-tight">Guest FAQ</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-6 text-basalt/60">
            Questions guests ask before booking. Shown on your listing page and used to answer guests. Public information only — no door codes, phone numbers or links.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!listing.faqHostSavedAt && (
            <p className="mb-4 flex gap-2.5 border border-apricot/30 bg-apricot/[0.04] p-3 text-sm leading-6 text-basalt/75">
              <Sparkles className="mt-1 h-4 w-4 shrink-0 text-apricot" aria-hidden />
              <span>
                {(listing.faq?.length ?? 0) > 0
                  ? "Aha AI wrote these from your listing details and they're live on your page. It updates them when you change your listing. Edit or remove anything — once you save, they're yours and Aha AI won't change them."
                  : "Aha AI writes this FAQ automatically from your listing details, usually within an hour of publishing or changing them. You can also write your own now."}
              </span>
            </p>
          )}
          {rows.length === 0 ? (
            <div className="grid place-items-center gap-3 py-10 text-center">
              <MessageCircleQuestion className="h-8 w-8 text-apricot" aria-hidden />
              <p className="max-w-sm text-sm leading-6 text-basalt/65">
                Let Aha AI draft the usual questions from what your listing already says — parking, check-in, who it suits, what's included. You check and edit each one.
              </p>
              <Button onClick={draft} disabled={drafting} className="h-12 rounded-full bg-apricot px-6 text-base text-white hover:bg-apricot/90 sm:h-10 sm:text-sm">
                {drafting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Draft with Aha AI
              </Button>
              <button type="button" onClick={() => setRows((rs) => [...rs, ...toRows([{ q: "", a: "" }])])} className="h-10 text-sm font-semibold text-basalt/70 underline-offset-4 hover:underline">
                or write your own
              </button>
            </div>
          ) : (
            <ol className="grid gap-3">
              {rows.map((r, i) => (
                <li key={r.key} className={cn("grid gap-2 border p-3", r.suggested ? "border-apricot/40 bg-apricot/[0.03]" : "border-basalt/12")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-basalt/50">
                      Question {i + 1}
                      {r.suggested && <span className="ml-2 rounded-full bg-apricot/10 px-2 py-0.5 text-[11px] text-apricot">Drafted by Aha AI — check it</span>}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="grid h-10 w-10 place-items-center rounded-full text-basalt/55 hover:bg-chalk disabled:opacity-30 sm:h-8 sm:w-8">
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="grid h-10 w-10 place-items-center rounded-full text-basalt/55 hover:bg-chalk disabled:opacity-30 sm:h-8 sm:w-8">
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove this question" className="grid h-10 w-10 place-items-center rounded-full text-basalt/55 hover:bg-chalk hover:text-destructive sm:h-8 sm:w-8">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                  <Input
                    value={r.q}
                    maxLength={FAQ_Q_MAX}
                    onChange={(e) => patch(r.key, { q: e.target.value })}
                    placeholder="e.g. Is there parking nearby?"
                    aria-label={`Question ${i + 1}`}
                    className="h-12 rounded-none text-base font-semibold sm:h-10 sm:text-sm"
                  />
                  <Textarea
                    value={r.a}
                    maxLength={FAQ_A_MAX}
                    onChange={(e) => patch(r.key, { a: e.target.value })}
                    placeholder="Your answer"
                    aria-label={`Answer ${i + 1}`}
                    rows={3}
                    className="min-h-[5.5rem] rounded-none text-base sm:text-sm"
                  />
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-basalt/10 px-5 py-3 sm:flex-row sm:items-center">
          {rows.length > 0 && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={draft} disabled={drafting || full} className="h-11 flex-1 rounded-full sm:h-9 sm:flex-none">
                {drafting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4 text-apricot" />} More with Aha AI
              </Button>
              <Button variant="outline" onClick={() => setRows((rs) => [...rs, ...toRows([{ q: "", a: "" }])])} disabled={full} className="h-11 flex-1 rounded-full sm:h-9 sm:flex-none">
                <Plus className="mr-1.5 h-4 w-4" /> Add question
              </Button>
            </div>
          )}
          <div className="flex items-center gap-3 sm:ml-auto">
            <span className="text-xs text-basalt/45">
              {rows.length} of {FAQ_MAX_ITEMS}
            </span>
            <Button onClick={save} disabled={saving || !dirty} className="ml-auto h-12 rounded-full bg-apricot px-8 text-base text-white hover:bg-apricot/90 sm:h-9 sm:px-6 sm:text-sm">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save FAQ
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
