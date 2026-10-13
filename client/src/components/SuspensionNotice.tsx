/**
 * Guest-side handling of a suspended listing (0101): the dates the host paused
 * are unavailable in every booking calendar, and the booking box says so. The
 * server refuses those dates whatever the page shows (start-checkout).
 */
import { PauseCircle } from "lucide-react";
import type { BlockedRange } from "@/contexts/ListingsContext";
import { suspensionLabel, suspensionRange } from "@shared/listings";

type Paused = { suspendedFrom?: string | null; suspendedUntil?: string | null };

/** The paused period as a blocked range for calendars ([] when none / already over). */
export function suspensionBlocked(l: Paused): BlockedRange[] {
  const r = suspensionRange(l);
  return r && r.end > new Date().toISOString().slice(0, 10) ? [r] : [];
}

export function SuspensionNotice({ listing }: { listing: Paused }) {
  if (!suspensionBlocked(listing).length) return null;
  return (
    <p className="mt-4 flex items-start gap-2 rounded-[0.875rem] border border-basalt/12 bg-paper px-3 py-2.5 text-sm leading-6 text-basalt/80">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-basalt/60" />
      <span>The host isn't taking bookings {suspensionLabel(listing)}.</span>
    </p>
  );
}
