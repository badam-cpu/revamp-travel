/**
 * Room-type editor for a multi-room property (hotel, guesthouse, hostel —
 * migration 0092). Each room type is booked on its own: name, beds, max guests,
 * size, nightly price, and how many identical rooms there are (= how many can
 * be booked for the same dates). Uncontrolled with ref.getValue() like the
 * other pickers (RoomsEditor, PhotoUploader); the Dashboard reads it once at
 * submit and saves the rows after the listing itself is saved.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhotoUploader, type PhotoUploaderHandle } from "@/components/PhotoUploader";
import { BED_TYPES } from "@/components/RoomsEditor";
import type { RoomType, RoomTypeInput } from "@shared/listings";

export type RoomTypesEditorHandle = { getValue: () => RoomTypeInput[] };

type BedRow = { key: string; type: string; count: number };
type Row = {
  key: string;
  id?: string;
  name: string;
  description: string;
  beds: BedRow[];
  maxGuests: string;
  sizeM2: string;
  price: string; // whole drams, as typed
  quantity: string;
  gallery: string[];
  amenities: string[];
};

const blankRow = (): Row => ({
  key: crypto.randomUUID(),
  name: "",
  description: "",
  beds: [{ key: crypto.randomUUID(), type: BED_TYPES[0], count: 1 }],
  maxGuests: "2",
  sizeM2: "",
  price: "",
  quantity: "1",
  gallery: [],
  amenities: [],
});

function seed(rooms: RoomType[]): Row[] {
  return rooms.map((r) => ({
    key: crypto.randomUUID(),
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    beds: r.beds.map((b) => ({ key: crypto.randomUUID(), type: b.type || BED_TYPES[0], count: b.count || 1 })),
    maxGuests: String(r.maxGuests),
    sizeM2: r.sizeM2 ? String(r.sizeM2) : "",
    price: r.priceCents ? String(Math.round(r.priceCents / 100)) : "",
    quantity: String(r.quantity),
    gallery: r.gallery.length ? r.gallery : r.image ? [r.image] : [],
    amenities: r.amenities,
  }));
}

/** First problem with the editor's rooms, or null when they're ready to save. */
export function validateRoomTypes(rooms: RoomTypeInput[]): string | null {
  if (rooms.length === 0) return "Add at least one room type — guests book a specific room at a hotel.";
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const label = r.name.trim() || `Room type ${i + 1}`;
    if (!r.name.trim()) return `Give room type ${i + 1} a name.`;
    if (!(r.priceCents > 0)) return `Set a nightly price for "${label}".`;
    if (!(r.quantity >= 1)) return `"${label}" needs at least 1 room.`;
    if (!(r.maxGuests >= 1)) return `"${label}" needs at least 1 guest.`;
  }
  return null;
}

export const RoomTypesEditor = forwardRef<RoomTypesEditorHandle, { defaultValue: RoomType[] }>(function RoomTypesEditor({ defaultValue }, ref) {
  const [rows, setRows] = useState<Row[]>(() => (defaultValue.length ? seed(defaultValue) : [blankRow()]));
  const photoRefs = useRef(new Map<string, PhotoUploaderHandle | null>());

  useImperativeHandle(
    ref,
    () => ({
      getValue: () =>
        rows.map((r, i) => {
          const gallery = photoRefs.current.get(r.key)?.getValue() ?? r.gallery;
          return {
            id: r.id,
            name: r.name.trim(),
            description: r.description.trim() || undefined,
            beds: r.beds.filter((b) => b.type).map((b) => ({ type: b.type, count: Math.max(1, b.count) })),
            maxGuests: Math.max(0, Math.round(Number(r.maxGuests) || 0)),
            sizeM2: Number(r.sizeM2) > 0 ? Math.round(Number(r.sizeM2)) : undefined,
            priceCents: Math.max(0, Math.round((Number(r.price) || 0) * 100)),
            priceUnit: "night",
            quantity: Math.max(0, Math.round(Number(r.quantity) || 0)),
            image: gallery[0],
            gallery,
            amenities: r.amenities,
            sortOrder: i,
          };
        }),
    }),
    [rows],
  );

  const patch = (key: string, p: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setBed = (key: string, bedKey: string, p: Partial<BedRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, beds: r.beds.map((b) => (b.key === bedKey ? { ...b, ...p } : b)) } : r)));
  const addBed = (key: string) => setRows((all) => all.map((r) => (r.key === key ? { ...r, beds: [...r.beds, { key: crypto.randomUUID(), type: BED_TYPES[0], count: 1 }] } : r)));
  const removeBed = (key: string, bedKey: string) => setRows((all) => all.map((r) => (r.key === key ? { ...r, beds: r.beds.filter((b) => b.key !== bedKey) } : r)));
  const removeRow = (key: string) => {
    photoRefs.current.delete(key);
    setRows((all) => all.filter((r) => r.key !== key));
  };

  return (
    <div className="grid gap-3">
      <div>
        <Label>Room types</Label>
        <p className="mt-1 text-xs text-basalt/45">Add each kind of room you rent. Guests choose one on your page; "Rooms" is how many identical rooms of that type you have.</p>
      </div>

      {rows.map((row, i) => (
        <div key={row.key} className="grid gap-4 border border-basalt/10 bg-paper p-4">
          <div className="flex items-center gap-2">
            <Input
              id={`room-type-name-${i}`}
              value={row.name}
              onChange={(e) => patch(row.key, { name: e.target.value })}
              placeholder="Room name (e.g. Deluxe king room)"
              className="h-11 rounded-none font-semibold"
              aria-label="Room type name"
            />
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              aria-label="Remove room type"
              className="grid h-11 w-11 shrink-0 place-items-center border border-basalt/15 text-basalt/50 transition-colors hover:border-destructive hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`room-type-guests-${i}`} className="text-xs">Max guests</Label>
              <Input id={`room-type-guests-${i}`} type="number" min={1} max={30} value={row.maxGuests} onChange={(e) => patch(row.key, { maxGuests: e.target.value })} className="h-10 rounded-none" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`room-type-size-${i}`} className="text-xs">Size m² <span className="font-normal text-basalt/40">(optional)</span></Label>
              <Input id={`room-type-size-${i}`} type="number" min={1} value={row.sizeM2} onChange={(e) => patch(row.key, { sizeM2: e.target.value })} className="h-10 rounded-none" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`room-type-price-${i}`} className="text-xs">Price / night (֏)</Label>
              <Input id={`room-type-price-${i}`} type="number" min={0} step={500} value={row.price} onChange={(e) => patch(row.key, { price: e.target.value })} placeholder="32000" className="h-10 rounded-none" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`room-type-qty-${i}`} className="text-xs">Rooms of this type</Label>
              <Input id={`room-type-qty-${i}`} type="number" min={1} max={500} value={row.quantity} onChange={(e) => patch(row.key, { quantity: e.target.value })} className="h-10 rounded-none" />
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold text-basalt/70">Beds</p>
            {row.beds.map((bed) => (
              <div key={bed.key} className="flex items-center gap-2">
                <Select value={bed.type} onValueChange={(v) => setBed(row.key, bed.key, { type: v })}>
                  <SelectTrigger className="h-10 flex-1 rounded-none text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BED_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={bed.count}
                  onChange={(e) => setBed(row.key, bed.key, { count: Number(e.target.value) || 1 })}
                  className="h-10 w-20 rounded-none text-sm"
                  aria-label="How many"
                />
                <button type="button" onClick={() => removeBed(row.key, bed.key)} aria-label="Remove bed" className="grid h-10 w-10 shrink-0 place-items-center text-basalt/40 transition-colors hover:text-destructive">
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addBed(row.key)} className="inline-flex items-center gap-1 self-start text-xs font-semibold text-apricot hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add bed
            </button>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`room-type-desc-${i}`} className="text-xs">Description <span className="font-normal text-basalt/40">(optional)</span></Label>
            <Textarea
              id={`room-type-desc-${i}`}
              rows={2}
              value={row.description}
              onChange={(e) => patch(row.key, { description: e.target.value })}
              placeholder="Courtyard view, rain shower, breakfast included"
              className="rounded-none"
            />
          </div>

          <div className="grid gap-1.5">
            <p className="text-xs font-semibold text-basalt/70">Room photos</p>
            <PhotoUploader
              ref={(h) => {
                photoRefs.current.set(row.key, h);
              }}
              defaultValue={row.gallery}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((all) => [...all, blankRow()])}
        className="inline-flex items-center gap-1.5 self-start rounded-none border border-basalt/20 bg-paper px-4 py-2 text-sm font-semibold text-basalt transition-colors hover:border-apricot"
      >
        <Plus className="h-4 w-4" /> Add room type
      </button>
    </div>
  );
});
