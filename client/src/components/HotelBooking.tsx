/**
 * Booking controls for a multi-room property (hotel, guesthouse, hostel —
 * migration 0092), Airbnb-style: the side panel holds the stay's dates and
 * guests ("From ֏X" = the cheapest room) and sends the guest to the room list;
 * each room's detail dialog (RoomDetailDialog) then reserves that room. The
 * ordinary single-unit BookingPanel is not involved.
 */
import { useState } from "react";
import { Calendar, ChevronRight, Minus, Plus, Users } from "lucide-react";
import type { BlockedRange, LiveListing } from "@/contexts/ListingsContext";
import type { RoomType } from "@shared/listings";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { AskHostButton } from "@/components/AskHostButton";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

/** The dates + party the guest is shopping for, shared by the panel, the room cards and the room dialog. */
export interface HotelStay {
  start: string | null;
  end: string | null;
  guests: number;
}

/** "Oct 12" from an ISO date (local, no timezone shift). */
export function fmtShort(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Check-in › check-out field that opens a month calendar. The calendar keeps
 * its own draft and only a complete range is committed — so opening it to look
 * (or abandoning a half-picked range) never clears the dates already chosen.
 */
export function StayDatesPicker({
  start,
  end,
  blocked = [],
  open,
  onOpenChange,
  onCommit,
}: {
  start: string | null;
  end: string | null;
  blocked?: BlockedRange[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (start: string, end: string) => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={false}
        className="grid w-full grid-cols-[1fr_auto_1fr] items-center border border-basalt/15 bg-paper px-3 py-3 text-left text-sm transition-colors hover:border-apricot/50"
      >
        <span className="flex items-center gap-2 truncate">
          <Calendar className="h-4 w-4 shrink-0 text-basalt/45" />
          <span className={cn("truncate", start ? "font-semibold text-basalt" : "text-basalt/45")}>{start ? fmtShort(start) : "Check in"}</span>
        </span>
        <ChevronRight className="mx-2 h-4 w-4 text-basalt/30" />
        <span className={cn("truncate text-right", end ? "font-semibold text-basalt" : "text-basalt/45")}>{end ? fmtShort(end) : "Check out"}</span>
      </button>
    );
  }
  return (
    <div className="grid gap-2">
      <AvailabilityCalendar
        mode="range"
        blockedRanges={blocked}
        onChange={(r) => {
          if (r.start && r.end) {
            onCommit(r.start, r.end);
            onOpenChange(false);
          }
        }}
      />
      <button type="button" onClick={() => onOpenChange(false)} className="justify-self-end text-xs font-semibold text-basalt/55 underline underline-offset-2 hover:text-apricot">
        Close
      </button>
    </div>
  );
}

export function GuestStepper({ guests, max, onChange }: { guests: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between border border-basalt/15 bg-paper px-3 py-2">
      <button
        type="button"
        aria-label="Fewer guests"
        disabled={guests <= 1}
        onClick={() => onChange(Math.max(1, guests - 1))}
        className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="text-sm font-semibold">
        {guests} {guests === 1 ? "guest" : "guests"}
      </span>
      <button
        type="button"
        aria-label="More guests"
        disabled={guests >= max}
        onClick={() => onChange(Math.min(max, guests + 1))}
        className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function HotelBookingPanel({
  listing,
  rooms,
  stay,
  onStayChange,
  onChooseRoom,
}: {
  listing: LiveListing;
  rooms: RoomType[];
  stay: HotelStay;
  onStayChange: (stay: HotelStay) => void;
  onChooseRoom: () => void;
}) {
  const { format } = useCurrency();
  const [datesOpen, setDatesOpen] = useState(false);
  const fromCents = rooms.length ? Math.min(...rooms.map((r) => r.priceCents)) : Math.round(listing.price * 100);
  const maxGuests = rooms.length ? Math.max(...rooms.map((r) => r.maxGuests)) : listing.maxGuests ?? 8;

  return (
    <div id="book" className="brand-notch sticky top-[104px] border border-basalt/12 bg-chalk p-6 shadow-[0_20px_55px_rgba(35,35,33,0.1)] lg:max-h-[calc(100vh_-_124px)] lg:overflow-y-auto">
      <div className="border-b border-basalt/10 pb-5">
        <p>
          {fromCents > 0 && <span className="text-sm text-basalt/50">from </span>}
          <strong className="font-display text-[1.75rem] font-normal">{fromCents > 0 ? format(fromCents) : "Rate on request"}</strong>
          {fromCents > 0 && <span className="text-sm text-basalt/50"> / night</span>}
        </p>
        <p className="mt-1 text-xs text-basalt/50">
          {rooms.length === 0
            ? "Loading rooms…"
            : stay.start && stay.end
              ? `${rooms.length} room type${rooms.length === 1 ? "" : "s"} — prices in the room list are for your dates.`
              : `${rooms.length} room type${rooms.length === 1 ? "" : "s"} — add your dates to see each room's price.`}
        </p>
      </div>

      <div className="mt-5">
        <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">Choose your dates</span>
        <StayDatesPicker
          start={stay.start}
          end={stay.end}
          open={datesOpen}
          onOpenChange={setDatesOpen}
          onCommit={(start, end) => onStayChange({ ...stay, start, end })}
        />
      </div>

      <div className="mt-4">
        <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/45">
          <Users className="h-3.5 w-3.5 text-tuff" /> Guests
        </span>
        <GuestStepper guests={stay.guests} max={maxGuests} onChange={(guests) => onStayChange({ ...stay, guests })} />
      </div>

      <Button onClick={onChooseRoom} disabled={rooms.length === 0} className="mt-5 h-12 w-full rounded-none bg-apricot text-white hover:bg-apricot/90">
        Choose room
      </Button>
      <p className="mt-3 text-center text-[11px] leading-5 text-basalt/42">You won't be charged yet.</p>
      <div className="mt-4 border-t border-basalt/10 pt-4">
        <AskHostButton listing={listing} />
        <p className="mt-2 text-center text-[11px] leading-5 text-basalt/42">Have a question? Ask the host before you book.</p>
      </div>
    </div>
  );
}
