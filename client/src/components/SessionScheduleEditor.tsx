/**
 * Dashboard → Listings → ⋯ → "Schedule & spots" for a tour/experience: the same
 * ScheduleFields as the creation steps (book a day / a class time, weekly times
 * per day, spots, length, notice, instant vs approve) plus the upcoming classes,
 * where the host cancels one class (a holiday, a sick day) or reopens it.
 * Saving regenerates the next 60 days of classes server-side.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { saveSessionSchedule, setSessionOpen, ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { formatSlotTime, slotLocalDate } from "@shared/sessions";
import { ScheduleFields, scheduleFromValue, scheduleProblem, scheduleValueFrom, type ScheduleValue } from "./ScheduleFields";

interface UpcomingClass {
  id: string;
  starts_at: string;
  status: "open" | "closed";
  seats_taken: number;
  capacity: number;
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function ScheduleDialog({ listing, open, onClose }: { listing: LiveListing; open: boolean; onClose: () => void }) {
  const { refresh } = useListings();
  const [value, setValue] = useState<ScheduleValue>(() => scheduleValueFrom(listing.sessionSchedule, listing.bookingMode));
  const [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState<UpcomingClass[] | null>(null);
  const [changing, setChanging] = useState<string | null>(null);

  // Fresh values each time it opens (the listing may have changed since).
  useEffect(() => {
    if (open) setValue(scheduleValueFrom(listing.sessionSchedule, listing.bookingMode));
  }, [open, listing.sessionSchedule, listing.bookingMode]);

  const loadClasses = async () => {
    const { data, error } = await supabase
      .from("listing_sessions")
      .select("id, starts_at, status, seats_taken, capacity")
      .eq("listing_id", listing.id)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(40);
    if (error) console.error("[schedule] classes", error);
    setClasses((data ?? []) as UpcomingClass[]);
  };
  useEffect(() => {
    if (open && listing.sessionSchedule) void loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listing.id, listing.sessionSchedule]);

  const save = async () => {
    const problem = scheduleProblem(value);
    if (problem) {
      toast(problem);
      return;
    }
    setBusy(true);
    try {
      const schedule = scheduleFromValue(value);
      const res = await saveSessionSchedule(listing.id, schedule, value.mode);
      toast.success(schedule ? `Schedule saved — ${res.created} new class${res.created === 1 ? "" : "es"} opened.` : "Saved — guests now pick a day.");
      await refresh();
      if (schedule) await loadClasses();
    } catch (e) {
      if (!(e instanceof ApiError)) console.error("[schedule] save", e);
      toast(e instanceof ApiError ? e.message : "Your schedule didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggleClass = async (c: UpcomingClass) => {
    setChanging(c.id);
    try {
      await setSessionOpen(c.id, c.status !== "open");
      setClasses((list) => list?.map((x) => (x.id === c.id ? { ...x, status: x.status === "open" ? "closed" : "open" } : x)) ?? null);
      toast.success(c.status === "open" ? "Class cancelled — guests can't book it." : "Class reopened.");
    } catch (e) {
      if (!(e instanceof ApiError)) console.error("[schedule] class", e);
      toast(e instanceof ApiError ? e.message : "That class didn't update. Please try again.");
    } finally {
      setChanging(null);
    }
  };

  // Group the next classes by day.
  const byDay = new Map<string, UpcomingClass[]>();
  for (const c of classes ?? []) {
    const d = slotLocalDate(c.starts_at);
    byDay.set(d, [...(byDay.get(d) ?? []), c]);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Schedule &amp; spots</DialogTitle>
          <DialogDescription>How guests book {listing.title}.</DialogDescription>
        </DialogHeader>

        <ScheduleFields value={value} onChange={setValue} idPrefix={`sched-${listing.id}`} />

        <div className="flex justify-end gap-2 border-t border-basalt/10 pt-4">
          <Button type="button" variant="ghost" className="h-11 rounded-none" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="button" className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save schedule"}
          </Button>
        </div>

        {listing.sessionSchedule && value.kind === "slots" && (
          <div className="grid gap-3 border-t border-basalt/10 pt-4">
            <div>
              <p className="text-sm font-semibold">Upcoming classes</p>
              <p className="text-xs leading-5 text-basalt/55">Cancel one class for a holiday or a day off — the rest of the schedule stays. A class with guests booked can't be cancelled here.</p>
            </div>
            {classes === null ? (
              <p className="text-sm text-basalt/50">Loading…</p>
            ) : classes.length === 0 ? (
              <p className="text-sm text-basalt/55">No upcoming classes yet. Save the schedule to open them.</p>
            ) : (
              <div className="grid gap-3">
                {Array.from(byDay.entries()).map(([day, list]) => (
                  <div key={day} className="grid gap-1.5">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-basalt/50">{dayLabel(day)}</p>
                    {list.map((c) => (
                      <div key={c.id} className={cn("flex flex-wrap items-center justify-between gap-2 border px-3 py-2", c.status === "open" ? "border-basalt/12" : "border-dashed border-basalt/20 bg-chalk/60")}>
                        <span className="text-sm">
                          <span className={cn("font-semibold tabular-nums", c.status !== "open" && "text-basalt/45 line-through")}>{formatSlotTime(c.starts_at)}</span>
                          <span className="ml-2 text-basalt/55">{c.status === "open" ? `${c.seats_taken} of ${c.capacity} booked` : "Cancelled"}</span>
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-10 rounded-none sm:h-8"
                          disabled={changing === c.id || (c.status === "open" && c.seats_taken > 0)}
                          title={c.status === "open" && c.seats_taken > 0 ? "Guests are booked into this class" : undefined}
                          onClick={() => void toggleClass(c)}
                        >
                          {changing === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.status === "open" ? "Cancel class" : "Reopen"}
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
