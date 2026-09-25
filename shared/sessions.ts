/**
 * Time-slot sessions for tours & experiences — shared, dependency-free logic used
 * by the client (schedule preview) and the server (session generation). A
 * listing stores a recurring weekly `SessionSchedule`; `generateSessionStarts`
 * expands it into concrete dated slots over a rolling window.
 *
 * Times in a schedule are Armenia local wall-clock ("HH:MM"). Armenia is UTC+4
 * year-round (DST abolished in 2012), so local → UTC is a fixed −4h. Sessions are
 * stored/compared in UTC (timestamptz) so timed iCal busy intervals (which arrive
 * in UTC) line up with them.
 */
export const ARMENIA_UTC_OFFSET_HOURS = 4;

export interface SessionRule {
  /** Weekdays this rule applies to: 0=Sun … 6=Sat. */
  days: number[];
  /** Local start times, "HH:MM" (24h). */
  times: string[];
}

export interface SessionSchedule {
  durationMin: number;
  capacity: number;
  rules: SessionRule[];
  /** Minimum hours of notice before a slot can be booked (default 0). */
  leadTimeHours?: number;
  /** How many days ahead to open slots (default 60). */
  horizonDays?: number;
}

export interface GeneratedSession {
  /** UTC ISO timestamp for the slot start. */
  startsAt: string;
  durationMin: number;
  capacity: number;
}

const DAY_MS = 86_400_000;

function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** True when `schedule` has at least one rule with a day and a valid time. */
export function scheduleHasSlots(schedule: SessionSchedule | null | undefined): boolean {
  return !!schedule?.rules?.some((r) => r.days?.length && r.times?.some(isValidTime));
}

/**
 * Expand a recurring schedule into concrete UTC slot starts from `from` (a Date,
 * default now) over the schedule's horizon. Skips slots earlier than now + lead
 * time. Deterministic and side-effect-free.
 */
export function generateSessionStarts(schedule: SessionSchedule, from: Date = new Date()): GeneratedSession[] {
  if (!scheduleHasSlots(schedule)) return [];
  const horizon = Math.max(1, Math.min(365, schedule.horizonDays ?? 60));
  const lead = Math.max(0, schedule.leadTimeHours ?? 0);
  const earliest = from.getTime() + lead * 3_600_000;

  const out: GeneratedSession[] = [];
  // Walk each calendar day in the window using Armenia-local date parts.
  for (let i = 0; i <= horizon; i++) {
    const dayUtc = new Date(from.getTime() + i * DAY_MS);
    // The Armenia-local calendar day for this point in time.
    const local = new Date(dayUtc.getTime() + ARMENIA_UTC_OFFSET_HOURS * 3_600_000);
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    const d = local.getUTCDate();
    const weekday = local.getUTCDay();
    for (const rule of schedule.rules) {
      if (!rule.days?.includes(weekday)) continue;
      for (const t of rule.times ?? []) {
        if (!isValidTime(t)) continue;
        const [hh, mm] = t.split(":").map(Number);
        // Local wall-clock (Armenia, UTC+4) → UTC instant.
        const utcMs = Date.UTC(y, m, d, hh, mm) - ARMENIA_UTC_OFFSET_HOURS * 3_600_000;
        if (utcMs < earliest) continue;
        out.push({ startsAt: new Date(utcMs).toISOString(), durationMin: schedule.durationMin, capacity: schedule.capacity });
      }
    }
  }
  // Dedupe + sort (a day could match two rules at the same time).
  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(s.startsAt) ? false : (seen.add(s.startsAt), true)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Compress a sorted weekday list into "Mon–Sat" / "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const uniq = Array.from(new Set(days)).sort((a, b) => a - b);
  if (uniq.length === 7) return "Every day";
  // Detect a single contiguous run (Mon–Sat etc.).
  const contiguous = uniq.every((d, i) => i === 0 || d === uniq[i - 1] + 1);
  if (contiguous && uniq.length > 2) return `${WEEKDAY_ABBR[uniq[0]]}–${WEEKDAY_ABBR[uniq[uniq.length - 1]]}`;
  return uniq.map((d) => WEEKDAY_ABBR[d]).join(", ");
}

/** Human summary of a schedule, e.g. "Mon–Sat · 10:00, 15:00 · up to 8". */
export function describeSchedule(schedule: SessionSchedule | null | undefined): string {
  if (!scheduleHasSlots(schedule)) return "No sessions scheduled yet";
  const parts = schedule!.rules
    .filter((r) => r.days?.length && r.times?.length)
    .map((r) => `${describeDays(r.days)} · ${r.times.filter(isValidTime).join(", ")}`);
  return `${parts.join(" · ")} · up to ${schedule!.capacity}`;
}

/** Format a UTC ISO instant as an Armenia-local time label, e.g. "10:00". */
export function formatSlotTime(startsAtIso: string): string {
  const local = new Date(Date.parse(startsAtIso) + ARMENIA_UTC_OFFSET_HOURS * 3_600_000);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** The Armenia-local calendar date (YYYY-MM-DD) a UTC slot falls on. */
export function slotLocalDate(startsAtIso: string): string {
  const local = new Date(Date.parse(startsAtIso) + ARMENIA_UTC_OFFSET_HOURS * 3_600_000);
  return local.toISOString().slice(0, 10);
}
