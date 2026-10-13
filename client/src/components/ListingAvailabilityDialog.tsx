/**
 * Operator listing availability (0101), from Dashboard → Listings ⋯ menu:
 *   - Suspend bookings: pick the first day (and optionally the last) guests
 *     can't book; existing bookings in that period stand and must be honoured.
 *   - Switch off (inactive): replaces Delete — the listing leaves the site and
 *     can't be booked until switched back on; existing bookings stand.
 * Both show how many upcoming bookings the operator still has to honour, take
 * an optional note for Revamp, and email the admins (server/listingStatus.ts).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { previewBookingsToHonour, setListingAvailability, userMessage } from "@/lib/api";
import { suspensionLabel } from "@shared/listings";

export type AvailabilityMode = "suspend" | "deactivate";
const todayIso = () => new Date().toISOString().slice(0, 10);

export function ListingAvailabilityDialog({ listing, mode, onClose }: { listing: LiveListing; mode: AvailabilityMode | null; onClose: () => void }) {
  const { refresh } = useListings();
  const [from, setFrom] = useState(listing.suspendedFrom && listing.suspendedFrom >= todayIso() ? listing.suspendedFrom : todayIso());
  const [until, setUntil] = useState(listing.suspendedUntil ?? "");
  const [open, setOpen] = useState(!listing.suspendedUntil && !!listing.suspendedFrom); // "until I resume"
  const [note, setNote] = useState("");
  const [count, setCount] = useState<number | null | "error">(null);
  const [saving, setSaving] = useState(false);

  const suspend = mode === "suspend";
  const datesOk = !suspend || (!!from && from >= todayIso() && (open || (!!until && until >= from)));

  // How many upcoming bookings stand (in the period, or all of them when switching off).
  useEffect(() => {
    if (!mode || !datesOk) return setCount(null);
    let live = true;
    const t = setTimeout(() => {
      previewBookingsToHonour(listing.id, suspend ? from : undefined, suspend ? (open ? null : until) : undefined)
        .then((n) => live && setCount(n))
        .catch((e) => {
          console.error("[availability] preview", e);
          if (live) setCount("error");
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mode, listing.id, from, until, open, suspend, datesOk]);

  const save = async () => {
    if (!mode || !datesOk) return;
    setSaving(true);
    try {
      const r = suspend
        ? await setListingAvailability(listing.id, "suspend", { from, until: open ? null : until, note })
        : await setListingAvailability(listing.id, "deactivate", { note });
      await refresh();
      const honour = r.bookingsToHonour ? ` You still have ${r.bookingsToHonour} booking${r.bookingsToHonour === 1 ? "" : "s"} to honour.` : "";
      toast.success((suspend ? `Bookings suspended ${suspensionLabel(r)}.` : `${listing.title} is now inactive.`) + honour);
      onClose();
    } catch (e) {
      toast(userMessage(e, "Couldn't save that change."));
    } finally {
      setSaving(false);
    }
  };

  const field = "h-12 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 text-base outline-none focus:border-basalt";
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-[14px] p-6">
        <DialogTitle className="font-display text-2xl tracking-[-0.02em]">{suspend ? "Suspend bookings" : "Make inactive"}</DialogTitle>
        <DialogDescription className="text-sm leading-6 text-basalt/70">
          {suspend
            ? `Guests won't be able to book ${listing.title} for these dates, and it's out of search while the suspension is on.`
            : `${listing.title} will be hidden from the site and can't be booked. You can switch it back on any time — nothing is deleted.`}
        </DialogDescription>

        {suspend && (
          <div className="mt-2 grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-sm font-semibold">
                First day
                <input type="date" value={from} min={todayIso()} onChange={(e) => setFrom(e.target.value)} className={field} />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Last day
                <input type="date" value={open ? "" : until} min={from || todayIso()} disabled={open} onChange={(e) => setUntil(e.target.value)} className={`${field} disabled:opacity-40`} />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="h-4 w-4 accent-[var(--color-basalt)]" />
              Until I resume bookings
            </label>
          </div>
        )}

        <div className="mt-3 rounded-[0.875rem] border border-basalt/12 bg-chalk px-4 py-3 text-sm leading-6">
          {count === null ? (
            <span className="text-basalt/60">Checking your bookings…</span>
          ) : count === "error" ? (
            <span>We couldn't check your bookings just now. Any you have stay booked — <strong>you still need to honour them</strong>.</span>
          ) : count === 0 ? (
            <span>No upcoming bookings {suspend ? "in this period" : "on this listing"}.</span>
          ) : (
            <span>
              <strong>{count} upcoming booking{count === 1 ? "" : "s"}</strong> {suspend ? "fall in this period" : "on this listing"}. They stay booked — <strong>you still need to honour {count === 1 ? "it" : "them"}</strong>. To cancel one, open it from Bookings.
            </span>
          )}
        </div>

        <label className="mt-3 grid gap-1.5 text-sm font-semibold">
          <span>Note for Revamp <span className="font-normal text-basalt/60">(optional)</span></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder={suspend ? "E.g. renovation, owner's use…" : "Why it's going offline"} className="rounded-[0.875rem] border border-basalt/15 bg-paper px-3 py-2.5 text-base font-normal outline-none focus:border-basalt" />
        </label>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="h-11 px-3 text-sm font-semibold text-basalt/70 hover:text-basalt">Cancel</button>
          <button type="button" disabled={saving || !datesOk} onClick={() => void save()} className="h-11 rounded-none bg-basalt px-5 text-sm font-semibold text-paper hover:bg-basalt/90 disabled:opacity-40">
            {saving ? "Saving…" : suspend ? "Suspend bookings" : "Make inactive"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Switch back on / resume — no dialog needed (nothing to honour). */
export async function quickAvailability(listing: LiveListing, action: "activate" | "resume", refresh: () => Promise<void>) {
  try {
    await setListingAvailability(listing.id, action);
    await refresh();
    toast.success(action === "activate" ? `${listing.title} is active again.` : `Bookings resumed for ${listing.title}.`);
  } catch (e) {
    toast(userMessage(e, "Couldn't save that change."));
  }
}
