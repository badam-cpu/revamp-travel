/**
 * "Schedule & spots" — how guests book a tour or experience, shared by the
 * Add-an-experience wizard, the tour form and the listing's ⋯ → Schedule & spots
 * dialog (user, 2026-10-28: class times belong in the creation steps, not
 * hidden behind "Calendar sync").
 *
 *  - "A day": guests pick a date (the original day-level booking).
 *  - "A start time": weekly start times (a class, a group run, a tasting…) — different times on different days
 *    (one rule per row: e.g. Mon/Wed 08:00 + 19:00, Sat 10:00), spots per
 *    session, length, minimum notice, and instant book vs approve first.
 *
 * Controlled: the caller keeps the `ScheduleValue` and saves it with
 * `saveSessionSchedule(listingId, scheduleFromValue(v), v.mode)` once the
 * listing exists (the server opens the classes for the next 60 days).
 */
import { CalendarDays, Clock, Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { describeSchedule, generateSessionStarts, scheduleHasSlots, type SessionSchedule } from "@shared/sessions";

export interface ScheduleValue {
  kind: "day" | "slots";
  rules: { days: number[]; times: string[] }[];
  capacity: string;
  durationMin: string;
  leadTimeHours: string;
  mode: "instant" | "request";
}

const WEEKDAYS = [
  { i: 1, l: "Mon" }, { i: 2, l: "Tue" }, { i: 3, l: "Wed" }, { i: 4, l: "Thu" },
  { i: 5, l: "Fri" }, { i: 6, l: "Sat" }, { i: 0, l: "Sun" },
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A listing's saved schedule (or none) → the editor's value. */
export function scheduleValueFrom(schedule: SessionSchedule | null | undefined, bookingMode?: "instant" | "request" | null, hints?: { capacity?: number; durationMin?: number }): ScheduleValue {
  const has = scheduleHasSlots(schedule);
  return {
    kind: has ? "slots" : "day",
    rules: has ? schedule!.rules.map((r) => ({ days: [...r.days], times: [...r.times] })) : [{ days: [1, 3, 5], times: ["10:00"] }],
    capacity: String(schedule?.capacity ?? hints?.capacity ?? 8),
    durationMin: String(schedule?.durationMin ?? hints?.durationMin ?? 60),
    leadTimeHours: String(schedule?.leadTimeHours ?? 2),
    mode: bookingMode ?? "instant",
  };
}

/** The editor's value → what the server stores (null = book by the day). */
export function scheduleFromValue(v: ScheduleValue): SessionSchedule | null {
  if (v.kind !== "slots") return null;
  const rules = v.rules
    .map((r) => ({ days: Array.from(new Set(r.days)).sort((a, b) => a - b), times: Array.from(new Set(r.times.filter((t) => TIME_RE.test(t)))).sort() }))
    .filter((r) => r.days.length && r.times.length);
  if (!rules.length) return null;
  return {
    durationMin: Math.max(15, Math.min(1440, Number(v.durationMin) || 60)),
    capacity: Math.max(1, Math.min(1000, Number(v.capacity) || 1)),
    rules,
    leadTimeHours: Math.max(0, Math.min(720, Number(v.leadTimeHours) || 0)),
    horizonDays: 60,
  };
}

/** What still needs filling in before this can be saved, or null. */
export function scheduleProblem(v: ScheduleValue): string | null {
  if (v.kind !== "slots") return null;
  return scheduleFromValue(v) ? null : "Pick at least one day and one start time.";
}

/** "2 hours" → 120, "90 min" → 90, "1.5 h" → 90 — to prefill a class's length. */
export function minutesFromText(text: string | undefined): number | undefined {
  const t = (text ?? "").toLowerCase();
  const n = parseFloat(t.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (/min/.test(t)) return Math.round(n);
  if (/(hour|hr|h\b|час)/.test(t)) return Math.round(n * 60);
  return undefined;
}

export function ScheduleFields({ value, onChange, idPrefix }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void; idPrefix: string }) {
  const set = (patch: Partial<ScheduleValue>) => onChange({ ...value, ...patch });
  const setRule = (idx: number, patch: Partial<ScheduleValue["rules"][number]>) => set({ rules: value.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  const schedule = scheduleFromValue(value);
  const count = schedule ? generateSessionStarts(schedule).length : 0;
  // A day already used by another row is greyed in this one, so each day has one set of times.
  const usedElsewhere = (idx: number) => new Set(value.rules.flatMap((r, i) => (i === idx ? [] : r.days)));
  const field = "h-12 rounded-none text-base sm:h-10 sm:text-sm";

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p className="text-sm font-semibold">How do guests book?</p>
        <div role="radiogroup" aria-label="How guests book" className="grid gap-2 sm:grid-cols-2">
          {([
            { k: "day", icon: CalendarDays, title: "They pick a day", blurb: "Good for private or one-off experiences — you agree the time with the guest." },
            { k: "slots", icon: Clock, title: "They pick a start time", blurb: "You set weekly start times and spots per session — a class, a group run, a tasting. Guests choose a time; full sessions close by themselves." },
          ] as const).map((o) => (
            <button
              key={o.k}
              type="button"
              role="radio"
              aria-checked={value.kind === o.k}
              onClick={() => set({ kind: o.k })}
              className={cn("flex min-h-[88px] gap-3 rounded-none border p-4 text-left transition-colors", value.kind === o.k ? "border-apricot bg-apricot/[0.06]" : "border-basalt/15 hover:border-basalt/35")}
            >
              <o.icon className={cn("mt-0.5 h-5 w-5 shrink-0", value.kind === o.k ? "text-apricot" : "text-basalt/45")} aria-hidden />
              <span>
                <span className="block text-sm font-bold">{o.title}</span>
                <span className="mt-1 block text-xs leading-5 text-basalt/60">{o.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {value.kind === "slots" && (
        <>
          <div className="grid gap-3">
            <p className="text-sm font-semibold">
              When it runs <span className="font-normal text-basalt/50">· Armenia time</span>
            </p>
            {value.rules.map((rule, idx) => {
              const taken = usedElsewhere(idx);
              return (
                <div key={idx} className="grid gap-3 border border-basalt/12 p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Days for row ${idx + 1}`}>
                      {WEEKDAYS.map((d) => {
                        const on = rule.days.includes(d.i);
                        const blocked = !on && taken.has(d.i);
                        return (
                          <button
                            key={d.i}
                            type="button"
                            aria-pressed={on}
                            disabled={blocked}
                            title={blocked ? "Already in another row" : undefined}
                            onClick={() => setRule(idx, { days: on ? rule.days.filter((x) => x !== d.i) : [...rule.days, d.i] })}
                            className={cn(
                              "min-h-10 min-w-12 rounded-none border px-2.5 text-sm font-semibold",
                              on ? "border-apricot bg-apricot text-white" : blocked ? "border-basalt/10 text-basalt/25" : "border-basalt/15 text-basalt/65 hover:border-basalt/35",
                            )}
                          >
                            {d.l}
                          </button>
                        );
                      })}
                    </div>
                    {value.rules.length > 1 && (
                      <button type="button" onClick={() => set({ rules: value.rules.filter((_, i) => i !== idx) })} aria-label={`Remove row ${idx + 1}`} className="grid h-10 w-10 shrink-0 place-items-center text-basalt/40 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {rule.times.map((t, ti) => (
                      <span key={ti} className="inline-flex items-center border border-basalt/15">
                        <Input
                          type="time"
                          aria-label={`Start time ${ti + 1}`}
                          value={t}
                          onChange={(e) => setRule(idx, { times: rule.times.map((x, j) => (j === ti ? e.target.value : x)) })}
                          className="h-11 w-32 rounded-none border-0 text-base sm:h-9 sm:text-sm"
                        />
                        {rule.times.length > 1 && (
                          <button type="button" onClick={() => setRule(idx, { times: rule.times.filter((_, j) => j !== ti) })} aria-label="Remove this time" className="grid h-11 w-10 place-items-center text-basalt/40 hover:text-destructive sm:h-9">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    ))}
                    <button type="button" onClick={() => setRule(idx, { times: [...rule.times, "18:00"] })} className="inline-flex h-11 items-center gap-1 border border-dashed border-basalt/25 px-3 text-sm font-semibold text-basalt/70 hover:border-apricot hover:text-apricot sm:h-9">
                      <Plus className="h-3.5 w-3.5" /> Add a time
                    </button>
                  </div>
                </div>
              );
            })}
            {value.rules.length < 7 && (
              <button
                type="button"
                onClick={() => set({ rules: [...value.rules, { days: [], times: ["10:00"] }] })}
                className="inline-flex min-h-10 items-center gap-1.5 justify-self-start text-sm font-semibold text-apricot hover:underline"
              >
                <Plus className="h-4 w-4" /> Different times on other days
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor={`${idPrefix}-cap`}>
              Spots per session
              <Input id={`${idPrefix}-cap`} type="number" min={1} inputMode="numeric" value={value.capacity} onChange={(e) => set({ capacity: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor={`${idPrefix}-dur`}>
              Length (minutes)
              <Input id={`${idPrefix}-dur`} type="number" min={15} step={15} inputMode="numeric" value={value.durationMin} onChange={(e) => set({ durationMin: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor={`${idPrefix}-lead`}>
              Book at least (hours before)
              <Input id={`${idPrefix}-lead`} type="number" min={0} inputMode="numeric" value={value.leadTimeHours} onChange={(e) => set({ leadTimeHours: e.target.value })} className={field} />
            </label>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-semibold">When a guest books</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                { k: "instant", title: "Instant book", blurb: "The guest pays and the spot is theirs." },
                { k: "request", title: "Approve first", blurb: "You approve, then the guest pays. Safer if you also take bookings elsewhere." },
              ] as const).map((m) => (
                <button
                  key={m.k}
                  type="button"
                  aria-pressed={value.mode === m.k}
                  onClick={() => set({ mode: m.k })}
                  className={cn("rounded-none border p-3 text-left", value.mode === m.k ? "border-apricot bg-apricot/[0.06]" : "border-basalt/15 hover:border-basalt/35")}
                >
                  <span className="block text-sm font-bold">{m.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-basalt/60">{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm text-basalt/65" aria-live="polite">
            {schedule ? (
              <>
                <span className="font-semibold text-basalt">{describeSchedule(schedule)}</span> · {count} session{count === 1 ? "" : "s"} open over the next 60 days
              </>
            ) : (
              "Pick at least one day and one start time."
            )}
          </p>
        </>
      )}
    </div>
  );
}
