/**
 * A room type's detail dialog at a multi-room property (hotel — migration
 * 0092), Airbnb-style: the room's photos on the left; on the right its details,
 * the guest's dates (changeable — only nights when a room of this type is free
 * can be picked), "Keep in mind" (cancellation, room rules), and a footer with
 * the total for those dates and Reserve, which hands off to /checkout with the
 * room. The amount shown uses the same steps the server charges with.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CalendarX2, ClipboardList, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LiveListing } from "@/contexts/ListingsContext";
import type { RoomType } from "@shared/listings";
import { describeCancellationPolicy, nightsBetween } from "@shared/bookings";
import { useCurrency } from "@/contexts/CurrencyContext";
import { imgAttrs } from "@/lib/responsiveImg";
import { quoteRoom, roomAvailable, soldOutNights } from "@/lib/roomTypes";
import { trackEvent } from "@/lib/analytics";
import { roomPhotos, roomSummary } from "@/components/RoomTypeCard";
import { fmtShort, GuestStepper, StayDatesPicker, type HotelStay } from "@/components/HotelBooking";
import { cn } from "@/lib/utils";

export function RoomDetailDialog({
  listing,
  room,
  booked,
  stay,
  onStayChange,
  onClose,
}: {
  listing: LiveListing;
  room: RoomType | null;
  booked: { start: string; end: string }[];
  stay: HotelStay;
  onStayChange: (stay: HotelStay) => void;
  onClose: () => void;
}) {
  const { format, currency: displayCurrency } = useCurrency();
  const [, navigate] = useLocation();
  const [lead, setLead] = useState(0);
  const [datesOpen, setDatesOpen] = useState(false);
  const roomId = room?.id;
  useEffect(() => {
    setLead(0);
    setDatesOpen(false);
  }, [roomId]);

  if (!room) return <Dialog open={false} />;

  const photos = roomPhotos(room, listing.image);
  // The grid shows the selected photo large, then the next three.
  const grid = photos.length ? Array.from({ length: Math.min(4, photos.length) }, (_, i) => photos[(lead + i) % photos.length]) : [];

  const hasDates = !!(stay.start && stay.end);
  const available = !hasDates || roomAvailable(booked, room.quantity, stay.start!, stay.end!);
  const tooSmall = stay.guests > room.maxGuests;
  const quote = hasDates ? quoteRoom(listing, room, stay.start!, stay.end!, stay.guests) : null;
  const factVal = (label: string) => listing.facts?.find((f) => f.label.toLowerCase() === label)?.value?.trim();
  const minStayRaw = parseInt(factVal("minimum stay") ?? "", 10);
  const minStay = Number.isFinite(minStayRaw) && minStayRaw > 1 ? minStayRaw : 1;
  const belowMin = hasDates && nightsBetween(stay.start!, stay.end!) < minStay;
  const problem = !available
    ? "This room is sold out for these dates — try other dates or another room."
    : tooSmall
      ? `This room fits up to ${room.maxGuests} ${room.maxGuests === 1 ? "guest" : "guests"}.`
      : belowMin
        ? `This property has a ${minStay}-night minimum.`
        : null;

  const rules = [`${room.maxGuests} ${room.maxGuests === 1 ? "guest" : "guests"} maximum`, ...(listing.houseRules ?? [])];
  const checkIn = factVal("check-in");
  const checkOut = factVal("checkout");
  if (checkIn) rules.push(`Check-in from ${checkIn}`);
  if (checkOut) rules.push(`Checkout by ${checkOut}`);
  if (minStay > 1) rules.push(`${minStay}-night minimum`);

  const reserve = () => {
    if (!hasDates) {
      setDatesOpen(true);
      return;
    }
    if (problem || !quote) return;
    trackEvent("book_click", { item_id: listing.id, item_name: `${listing.title} · ${room.name}`, item_category: listing.type, value: Math.round(quote.totalCents / 100), currency: "AMD" });
    const q = new URLSearchParams({ start: stay.start!, end: stay.end!, guests: String(stay.guests), room: room.id });
    navigate(`/checkout/${listing.slug}?${q.toString()}`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden rounded-none p-0 sm:max-w-5xl">
        <div className="grid max-h-[92vh] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* Photos: thumbnail rail + a lead photo with the next ones beside it. */}
          <div className="flex gap-3 overflow-hidden bg-paper p-4 lg:p-6">
            {photos.length > 1 && (
              <div className="hidden w-16 shrink-0 flex-col gap-2 overflow-y-auto lg:flex">
                {photos.map((p, i) => (
                  <button
                    key={p + i}
                    type="button"
                    onClick={() => setLead(i)}
                    aria-label={`Show photo ${i + 1}`}
                    className={cn("aspect-square shrink-0 overflow-hidden border-2 transition-colors", i === lead ? "border-basalt" : "border-transparent opacity-80 hover:opacity-100")}
                  >
                    <img {...imgAttrs(p, "64px")} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="grid min-w-0 flex-1 auto-rows-[minmax(0,1fr)] gap-1.5">
              {grid.length ? (
                <>
                  <img
                    {...imgAttrs(grid[0], "(min-width:1024px) 40vw, 100vw")}
                    alt={room.name}
                    className={cn("aspect-[4/3] w-full object-cover", grid.length === 1 && "lg:aspect-auto lg:h-full")}
                  />
                  {grid.length > 1 && (
                    <div className={cn("hidden gap-1.5 sm:grid", grid.length > 2 ? "grid-cols-2" : "grid-cols-1")}>
                      <img {...imgAttrs(grid[1], "20vw")} alt="" className="aspect-[4/3] h-full w-full object-cover" />
                      {grid.length > 2 && (
                        <div className="grid gap-1.5">
                          <img {...imgAttrs(grid[2], "20vw")} alt="" className="h-full max-h-40 w-full object-cover" />
                          {grid[3] && <img {...imgAttrs(grid[3], "20vw")} alt="" className="h-full max-h-40 w-full object-cover" />}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid aspect-[4/3] place-items-center bg-basalt/5 text-sm text-basalt/40">No photos yet</div>
              )}
            </div>
          </div>

          {/* Details + reserve. */}
          <div className="flex min-h-0 flex-col border-t border-basalt/10 lg:border-l lg:border-t-0">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-8 lg:px-8">
              <DialogTitle className="font-display text-3xl font-normal tracking-[-0.03em]">{room.name}</DialogTitle>
              <DialogDescription className="mt-2 text-sm text-basalt/60">{roomSummary(room)}</DialogDescription>
              {room.description && <p className="mt-4 whitespace-pre-line text-[15px] leading-7 text-basalt/85">{room.description}</p>}

              <div className="mt-6 border-t border-basalt/10 pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">Dates</h3>
                    <p className="mt-1 text-sm text-basalt/65">
                      {hasDates ? `${nightsBetween(stay.start!, stay.end!)} nights · ${fmtShort(stay.start)} – ${fmtShort(stay.end)}` : "Add your dates to see the price"}
                    </p>
                  </div>
                  {!datesOpen && (
                    <Button type="button" variant="secondary" size="sm" className="rounded-none" onClick={() => setDatesOpen(true)}>
                      {hasDates ? "Change" : "Add dates"}
                    </Button>
                  )}
                </div>
                {datesOpen && (
                  <div className="mt-4">
                    <StayDatesPicker
                      start={stay.start}
                      end={stay.end}
                      blocked={soldOutNights(booked, room.quantity)}
                      open
                      onOpenChange={setDatesOpen}
                      onCommit={(start, end) => onStayChange({ ...stay, start, end })}
                    />
                  </div>
                )}
              </div>

              <div className="mt-6 border-t border-basalt/10 pt-6">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <Users className="h-4 w-4 text-apricot" strokeWidth={1.75} /> Guests
                </h3>
                <div className="mt-3 max-w-xs">
                  <GuestStepper guests={stay.guests} max={room.maxGuests} onChange={(guests) => onStayChange({ ...stay, guests })} />
                </div>
              </div>

              <div className="mt-6 border-t border-basalt/10 pt-6">
                <h3 className="text-lg font-semibold">Keep in mind</h3>
                <div className="mt-4 grid gap-5">
                  <div className="flex gap-4">
                    <CalendarX2 className="mt-0.5 h-5 w-5 shrink-0 text-basalt/70" strokeWidth={1.5} />
                    <div>
                      <p className="font-semibold">Cancellation policy</p>
                      <p className="mt-1 text-sm leading-6 text-basalt/65">
                        {describeCancellationPolicy(listing.cancellationPolicy, {
                          freeCancelDays: listing.freeCancelDays,
                          startDate: stay.start ?? undefined,
                          discountPercent: listing.nonrefundableDiscountPercent,
                        })}
                        .{listing.cancellationPolicy === "non_refundable" ? " This rate can't be refunded." : " After that, this reservation is non-refundable."}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-basalt/70" strokeWidth={1.5} />
                    <div>
                      <p className="font-semibold">Room rules</p>
                      <ul className="mt-1 grid gap-0.5 text-sm leading-6 text-basalt/65">
                        {rules.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky footer: the total for these dates + Reserve. */}
            <div className="border-t border-basalt/10 bg-paper px-6 py-4 lg:px-8">
              {problem && <p className="mb-3 text-sm font-medium text-apricot">{problem}</p>}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 text-sm">
                  {quote ? (
                    <>
                      {quote.discountCents > 0 && <span className="mr-1.5 text-basalt/45 line-through">{format(quote.undiscountedTotalCents)}</span>}
                      <strong className="font-display text-xl font-normal underline-offset-4">{format(quote.totalCents)}</strong>
                      <span className="text-basalt/55">
                        {" "}
                        for {quote.nights} {quote.nights === 1 ? "night" : "nights"} · {fmtShort(stay.start)} – {fmtShort(stay.end)}
                      </span>
                      <span className="block text-[11px] text-basalt/45">Includes tax{displayCurrency === "USD" ? " · charged in AMD" : ""}</span>
                    </>
                  ) : (
                    <>
                      <strong className="font-display text-xl font-normal">{format(room.priceCents)}</strong>
                      <span className="text-basalt/55"> / night</span>
                    </>
                  )}
                </div>
                <Button
                  onClick={reserve}
                  disabled={hasDates && !!problem}
                  className="h-12 shrink-0 rounded-none bg-apricot px-8 text-base text-white hover:bg-apricot/90"
                >
                  {hasDates ? "Reserve" : "Add dates"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
