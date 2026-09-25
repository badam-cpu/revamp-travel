/**
 * Recurring time-slot editor for a tour/experience (Dashboard). The operator sets
 * which weekdays + times they run, capacity per session, duration, and how a
 * booking is confirmed (pay now vs. approve first). Saving generates the rolling
 * window of sessions server-side. Day-level (no schedule) stays the default —
 * this is opt-in per listing.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CalendarClock, Check, Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListings, type LiveListing } from "@/contexts/ListingsContext";
import { saveSessionSchedule, ApiError } from "@/lib/api";
import { generateSessionStarts, describeSchedule, type SessionSchedule } from "@shared/sessions";

const WEEKDAYS = [
  { i: 1, l: "Mon" }, { i: 2, l: "Tue" }, { i: 3, l: "Wed" }, { i: 4, l: "Thu" },
  { i: 5, l: "Fri" }, { i: 6, l: "Sat" }, { i: 0, l: "Sun" },
];

export function SessionScheduleEditor({ listing }: { listing: LiveListing }) {
  const { refresh } = useListings();
  const existing = listing.sessionSchedule;
  const rule0 = existing?.rules?.[0];

  const [enabled, setEnabled] = useState(!!existing);
  const [days, setDays] = useState<number[]>(rule0?.days ?? [1, 2, 3, 4, 5, 6]);
  const [times, setTimes] = useState<string[]>(rule0?.times?.length ? rule0.times : ["10:00"]);
  const [capacity, setCapacity] = useState(String(existing?.capacity ?? 8));
  const [durationMin, setDurationMin] = useState(String(existing?.durationMin ?? 120));
  const [leadTimeHours, setLeadTimeHours] = useState(String(existing?.leadTimeHours ?? 12));
  const [mode, setMode] = useState<"instant" | "request">(listing.bookingMode ?? "instant");
  const [busy, setBusy] = useState(false);

  const draft = useMemo<SessionSchedule | null>(() => {
    if (!enabled) return null;
    const cleanTimes = Array.from(new Set(times.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))).sort();
    if (days.length === 0 || cleanTimes.length === 0) return null;
    return {
      durationMin: Math.max(15, Math.min(1440, Number(durationMin) || 120)),
      capacity: Math.max(1, Math.min(1000, Number(capacity) || 1)),
      rules: [{ days: [...days].sort(), times: cleanTimes }],
      leadTimeHours: Math.max(0, Math.min(720, Number(leadTimeHours) || 0)),
      horizonDays: 60,
    };
  }, [enabled, days, times, capacity, durationMin, leadTimeHours]);

  const previewCount = useMemo(() => (draft ? generateSessionStarts(draft).length : 0), [draft]);

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const setTime = (idx: number, v: string) => setTimes((prev) => prev.map((t, i) => (i === idx ? v : t)));
  const addTime = () => setTimes((prev) => [...prev, "15:00"]);
  const removeTime = (idx: number) => setTimes((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (enabled && !draft) {
      toast("Pick at least one day and one time.");
      return;
    }
    setBusy(true);
    try {
      const res = await saveSessionSchedule(listing.id, draft, mode);
      toast.success(draft ? `Schedule saved — ${res.created} new session${res.created === 1 ? "" : "s"} opened.` : "Switched back to day-level availability.");
      await refresh();
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't save your schedule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-basalt/10 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">
          <CalendarClock className="h-3.5 w-3.5" /> Time slots
        </p>
        <label className="flex items-center gap-2 text-xs text-basalt/60">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          Offer fixed time slots
        </label>
      </div>

      {!enabled ? (
        <p className="mt-2 text-xs text-basalt/45">Off — guests book this by the day. Turn on to run hourly/fixed sessions (like GetYourGuide or Fresha), each with its own capacity.</p>
      ) : (
        <div className="mt-3 grid gap-4">
          {/* Days */}
          <div>
            <Label className="text-xs font-semibold">Days you run</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.i}
                  type="button"
                  onClick={() => toggleDay(d.i)}
                  className={cn("rounded-none border px-3 py-1.5 text-xs font-semibold", days.includes(d.i) ? "border-apricot bg-apricot text-white" : "border-basalt/15 text-basalt/60 hover:border-basalt/30")}
                >
                  {d.l}
                </button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div>
            <Label className="text-xs font-semibold">Start times (Armenia time)</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {times.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 border border-basalt/15">
                  <Input type="time" value={t} onChange={(e) => setTime(i, e.target.value)} className="h-8 w-28 rounded-none border-0 text-xs" />
                  {times.length > 1 && (
                    <button type="button" onClick={() => removeTime(i)} className="px-1.5 text-basalt/40 hover:text-destructive" aria-label="Remove time"><X className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-8 rounded-none" onClick={addTime}><Plus className="mr-1 h-3.5 w-3.5" /> Add time</Button>
            </div>
          </div>

          {/* Capacity / duration / lead */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`cap-${listing.id}`} className="text-xs font-semibold">Seats / session</Label>
              <Input id={`cap-${listing.id}`} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="mt-1 h-9 rounded-none text-xs" />
            </div>
            <div>
              <Label htmlFor={`dur-${listing.id}`} className="text-xs font-semibold">Duration (min)</Label>
              <Input id={`dur-${listing.id}`} type="number" min={15} step={15} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} className="mt-1 h-9 rounded-none text-xs" />
            </div>
            <div>
              <Label htmlFor={`lead-${listing.id}`} className="text-xs font-semibold">Min notice (hrs)</Label>
              <Input id={`lead-${listing.id}`} type="number" min={0} value={leadTimeHours} onChange={(e) => setLeadTimeHours(e.target.value)} className="mt-1 h-9 rounded-none text-xs" />
            </div>
          </div>

          {/* Booking mode */}
          <div>
            <Label className="text-xs font-semibold">When a guest books</Label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              {([
                { key: "instant", title: "Instant book", blurb: "Guest pays right away." },
                { key: "request", title: "Request to book", blurb: "You approve, then they pay. Safer if you also take bookings elsewhere." },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={cn("flex-1 rounded-none border p-3 text-left", mode === m.key ? "border-apricot bg-apricot/[0.05]" : "border-basalt/15 hover:border-basalt/30")}
                >
                  <span className="block text-xs font-bold">{m.title}</span>
                  <span className="mt-0.5 block text-[11px] text-basalt/55">{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-basalt/55">
            <span className="font-semibold text-basalt">{describeSchedule(draft)}</span>
            {previewCount > 0 && ` · ${previewCount} sessions over the next 60 days`}
          </p>
        </div>
      )}

      <div className="mt-3">
        <Button type="button" size="sm" className="rounded-none" disabled={busy} onClick={save}>
          {busy ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Save schedule</>}
        </Button>
      </div>
    </div>
  );
}
