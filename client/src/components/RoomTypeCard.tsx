/**
 * "Choose your room" — the room-type list on a multi-room property's page
 * (hotel, guesthouse, hostel; migration 0092). Each card shows the room's
 * photo, beds · guests · size and price — per night, or the total for the
 * guest's dates once chosen — and opens the room's detail dialog, where the
 * guest reserves it.
 */
import { useState } from "react";
import { BedDouble } from "lucide-react";
import type { RoomType } from "@shared/listings";
import { formatBeds } from "@shared/listings";
import type { LiveListing } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { imgAttrs } from "@/lib/responsiveImg";
import { bestRoomFor, bestRoomsFor, roomsFreeFor, splitGuests, typeFromCents, type RoomAvailability } from "@shared/rooms";
import type { HotelStay } from "@/components/HotelBooking";
import { cn } from "@/lib/utils";

const INITIAL_VISIBLE = 4;

/** "1 King · 1 Sofa bed · 3 guests · 32 m²" */
export function roomSummary(room: RoomType): string {
  return [formatBeds(room.beds), `${room.maxGuests} ${room.maxGuests === 1 ? "guest" : "guests"}`, room.sizeM2 ? `${room.sizeM2} m²` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function roomPhotos(room: RoomType, fallback: string): string[] {
  const photos = Array.from(new Set([room.image, ...room.gallery].filter(Boolean))) as string[];
  return photos.length ? photos : fallback ? [fallback] : [];
}

function RoomTypeCard({
  listing,
  room,
  stay,
  availability,
  onOpen,
}: {
  listing: LiveListing;
  room: RoomType;
  stay: HotelStay;
  availability: RoomAvailability;
  onOpen: () => void;
}) {
  const { format } = useCurrency();
  const photo = roomPhotos(room, listing.image)[0];
  const hasDates = !!(stay.start && stay.end);
  // A party bigger than this room → the fewest rooms of this type that fit it
  // (4 guests in 2-guest rooms → 2 rooms), booked together (0097).
  const split = stay.guests > room.maxGuests ? splitGuests(stay.guests, room.maxGuests) : null;
  const multi = !!split && split.length > 1;
  const tooSmall = stay.guests > room.maxGuests && !split;
  // With dates: the room(s) the guest would get (cheapest free ones) and the price.
  const best = hasDates && !multi ? bestRoomFor(listing, room, availability, stay.start!, stay.end!, stay.guests) : null;
  const group = hasDates && multi ? bestRoomsFor(listing, room, availability, stay.start!, stay.end!, split!) : null;
  const available = !hasDates || (multi ? !!group : !!best);
  const freeRooms = hasDates && multi && !group ? roomsFreeFor(room, availability, stay.start!, stay.end!) : 0;
  const quote = multi
    ? group
      ? { nights: group[0].quote.nights, totalCents: group.reduce((a, p) => a + p.quote.totalCents, 0) }
      : null
    : best?.quote ?? null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col gap-4 border border-basalt/12 bg-paper p-3 text-left transition-colors hover:border-apricot/60 sm:flex-row sm:items-center",
        (!available || tooSmall) && "opacity-70",
        multi && available && "border-apricot/40",
      )}
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-basalt/5 sm:w-36">
        {photo ? (
          <img {...imgAttrs(photo, "(min-width:640px) 144px, 100vw")} alt={room.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <BedDouble className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-basalt/25" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-basalt group-hover:text-apricot">{room.name}</h3>
        <p className="mt-1 text-sm text-basalt/60">{roomSummary(room)}</p>
        {!available ? (
          <p className="mt-1.5 text-sm font-semibold text-apricot">
            {multi && freeRooms > 0 ? `Only ${freeRooms} free — not enough for ${stay.guests} guests` : "Sold out for your dates"}
          </p>
        ) : multi ? (
          <p className="mt-1.5 text-sm font-semibold text-apricot">
            Book {split!.length} rooms for {stay.guests} guests ({split!.join(" + ")})
          </p>
        ) : tooSmall ? (
          <p className="mt-1.5 text-sm font-semibold text-apricot">Fits up to {room.maxGuests} {room.maxGuests === 1 ? "guest" : "guests"}</p>
        ) : (
          room.description && <p className="mt-1.5 line-clamp-2 text-sm text-basalt/55">{room.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center sm:text-right">
        {quote ? (
          <p>
            <strong className="font-display text-xl font-normal">{format(quote.totalCents)}</strong>
            <span className="block text-xs text-basalt/50">
              for {multi ? `${split!.length} rooms · ` : ""}{quote.nights} {quote.nights === 1 ? "night" : "nights"}
            </span>
          </p>
        ) : (
          <p>
            {/* "from" when this type's rooms aren't all the same price. */}
            {room.units.some((u) => u.priceCents != null && u.priceCents !== room.priceCents) && <span className="text-xs text-basalt/50">from </span>}
            <strong className="font-display text-xl font-normal">{format(typeFromCents(room) * (multi && available ? split!.length : 1))}</strong>
            <span className="text-sm text-basalt/50"> / night{multi && available ? ` · ${split!.length} rooms` : ""}</span>
          </p>
        )}
        <span className="inline-flex items-center rounded-none bg-apricot px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-apricot/90">{multi && available ? `View ${split!.length} rooms` : "View room"}</span>
      </div>
    </button>
  );
}

export function RoomTypeList({
  listing,
  rooms,
  stay,
  availability,
  onOpen,
}: {
  listing: LiveListing;
  rooms: RoomType[];
  stay: HotelStay;
  availability: RoomAvailability;
  onOpen: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Rooms that fit the whole party on their own stay on top; smaller rooms
  // (offered as several rooms) follow, in the operator's order otherwise.
  const ordered = [...rooms].sort((a, b) => Number(stay.guests > a.maxGuests) - Number(stay.guests > b.maxGuests));
  const visible = showAll || ordered.length <= INITIAL_VISIBLE ? ordered : ordered.slice(0, INITIAL_VISIBLE);
  return (
    <div className="grid gap-3">
      {visible.map((room) => (
        <RoomTypeCard key={room.id} listing={listing} room={room} stay={stay} availability={availability} onOpen={() => onOpen(room.id)} />
      ))}
      {visible.length < rooms.length && (
        <button type="button" onClick={() => setShowAll(true)} className="justify-self-start text-sm font-semibold underline underline-offset-4 hover:text-apricot">
          Show all {rooms.length} rooms
        </button>
      )}
    </div>
  );
}
