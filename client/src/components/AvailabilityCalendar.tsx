/**
 * Read-only availability calendar for a listing detail page. Greys out the
 * unavailable dates synced from the host's own calendar (Airbnb iCal import —
 * see server/ical.ts). Display only: no date selection, and — per the product's
 * honesty rule — no booking is taken here yet (that's the Stripe milestone).
 */
import { Calendar } from "@/components/ui/calendar";
import type { BlockedRange } from "@/contexts/ListingsContext";

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function AvailabilityCalendar({ blockedRanges }: { blockedRanges: BlockedRange[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const disabled = [
    { before: today },
    ...blockedRanges.map((range) => {
      const to = toDate(range.end);
      to.setDate(to.getDate() - 1); // stored end is exclusive; react-day-picker range is inclusive
      return { from: toDate(range.start), to };
    }),
  ];

  return (
    <div>
      <Calendar disabled={disabled} showOutsideDays={false} className="rounded-none border border-basalt/10 bg-paper p-3" />
      <p className="mt-2 text-xs text-basalt/50">
        Greyed-out dates are unavailable, synced from the host's own calendar. Availability is a guide — no booking is taken on Revamp yet.
      </p>
    </div>
  );
}
