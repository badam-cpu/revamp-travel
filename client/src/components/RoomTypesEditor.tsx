/**
 * Room-type editor for a multi-room property (hotel, guesthouse, hostel —
 * migration 0092). Each room type has its beds, max guests, size and a default
 * nightly price, plus its actual ROOMS (101, 102, …). A room uses the type's
 * price unless the operator sets its own; per-date prices and blocked dates
 * per room are set in the pricing calendar. Guests book a type and are given
 * the cheapest free room. Uncontrolled with ref.getValue() like the other
 * pickers (RoomsEditor, PhotoUploader); the Dashboard reads it once at submit
 * and saves the rows after the listing itself is saved.
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
type UnitRow = { key: string; id?: string; name: string; price: string };
type Row = {
  key: string;
  id?: string;
  name: string;
  description: string;
  beds: BedRow[];
  maxGuests: string;
  sizeM2: string;
  price: string; // default nightly price, whole drams as typed
  units: UnitRow[];
  gallery: string[];
  amenities: string[];
};

const unitRow = (name = "", price = "", id?: string): UnitRow => ({ key: crypto.randomUUID(), id, name, price });

const blankRow = (): Row => ({
  key: crypto.randomUUID(),
  name: "",
  description: "",
  beds: [{ key: crypto.randomUUID(), type: BED_TYPES[0], count: 1 }],
  maxGuests: "2",
  sizeM2: "",
  price: "",
  units: [unitRow()],
  gallery: [],
  amenities: [],
});

function seed(types: RoomType[]): Row[] {
  return types.map((t) => ({
    key: crypto.randomUUID(),
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    beds: t.beds.map((b) => ({ key: crypto.randomUUID(), type: b.type || BED_TYPES[0], count: b.count || 1 })),
    maxGuests: String(t.maxGuests),
    sizeM2: t.sizeM2 ? String(t.sizeM2) : "",
    price: t.priceCents ? String(Math.round(t.priceCents / 100)) : "",
    // A type saved before individual rooms existed gets its count as numbered rooms.
    units: t.units.length
      ? t.units.map((u) => unitRow(u.name, u.priceCents != null ? String(Math.round(u.priceCents / 100)) : "", u.id))
      : Array.from({ length: Math.max(1, t.quantity) }, (_, i) => unitRow(String(i + 1))),
    gallery: t.gallery.length ? t.gallery : t.image ? [t.image] : [],
    amenities: t.amenities,
  }));
}

/** The next room number after the type's highest numbered room ("" if none are numbered). */
function nextNumber(units: UnitRow[]): string {
  const nums = units.map((u) => Number(u.name.trim())).filter((n) => Number.isInteger(n) && n >= 0);
  return nums.length ? String(Math.max(...nums) + 1) : "";
}

/** First problem with the editor's room types, or null when they're ready to save. */
export function validateRoomTypes(types: RoomTypeInput[]): string | null {
  if (types.length === 0) return "Add at least one room type — guests book a room type at a hotel.";
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const label = t.name.trim() || `Room type ${i + 1}`;
    if (!t.name.trim()) return `Give room type ${i + 1} a name.`;
    if (!(t.priceCents > 0)) return `Set a default nightly price for "${label}".`;
    if (!(t.maxGuests >= 1)) return `"${label}" needs at least 1 guest.`;
    if (t.units.length === 0) return `Add at least one room to "${label}".`;
    const seen = new Set<string>();
    for (const u of t.units) {
      const n = u.name.trim().toLowerCase();
      if (!n) return `Give every room in "${label}" a name or number.`;
      if (seen.has(n)) return `"${label}" has two rooms called "${u.name.trim()}". Give each room its own name.`;
      seen.add(n);
      if (u.priceCents != null && !(u.priceCents > 0)) return `Room "${u.name.trim()}" in "${label}" needs a price above ֏0, or leave it empty to use the default.`;
    }
  }
  return null;
}

export const RoomTypesEditor = forwardRef<RoomTypesEditorHandle, { defaultValue: RoomType[] }>(function RoomTypesEditor({ defaultValue }, ref) {
  const [rows, setRows] = useState<Row[]>(() => (defaultValue.length ? seed(defaultValue) : [blankRow()]));
  // "Add several rooms" inputs, per room type.
  const [bulk, setBulk] = useState<Record<string, { count: string; from: string }>>({});
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
            quantity: Math.max(1, r.units.length),
            image: gallery[0],
            gallery,
            amenities: r.amenities,
            sortOrder: i,
            units: r.units.map((u) => ({
              id: u.id,
              name: u.name.trim(),
              priceCents: u.price.trim() === "" ? undefined : Math.round((Number(u.price) || 0) * 100),
            })),
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
  const setUnit = (key: string, unitKey: string, p: Partial<UnitRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, units: r.units.map((u) => (u.key === unitKey ? { ...u, ...p } : u)) } : r)));
  const addUnit = (key: string) => setRows((all) => all.map((r) => (r.key === key ? { ...r, units: [...r.units, unitRow(nextNumber(r.units))] } : r)));
  const removeUnit = (key: string, unitKey: string) => setRows((all) => all.map((r) => (r.key === key ? { ...r, units: r.units.filter((u) => u.key !== unitKey) } : r)));
  const addSeveral = (key: string) => {
    const b = bulk[key] ?? { count: "", from: "" };
    const count = Math.min(200, Math.max(0, Math.round(Number(b.count) || 0)));
    if (!count) return;
    setRows((all) =>
      all.map((r) => {
        if (r.key !== key) return r;
        // Drop the untouched blank starter row, then append the numbered rooms.
        const kept = r.units.filter((u) => u.id || u.name.trim() || u.price.trim());
        const start = Math.round(Number(b.from)) || Number(nextNumber(kept)) || 1;
        const taken = new Set(kept.map((u) => u.name.trim().toLowerCase()));
        const added: UnitRow[] = [];
        for (let n = start; added.length < count; n++) if (!taken.has(String(n))) added.push(unitRow(String(n)));
        return { ...r, units: [...kept, ...added] };
      }),
    );
    setBulk((s) => ({ ...s, [key]: { count: "", from: "" } }));
  };
  const removeRow = (key: string) => {
    photoRefs.current.delete(key);
    setRows((all) => all.filter((r) => r.key !== key));
  };

  return (
    <div className="grid gap-3">
      <div>
        <Label>Room types</Label>
        <p className="mt-1 text-xs text-basalt/45">Add each kind of room you rent, then the actual rooms of that kind. Guests choose a room type on your page and get the cheapest room of it that's free.</p>
      </div>

      {rows.map((row, i) => (
        <div key={row.key} className="grid gap-4 border border-basalt/10 bg-paper p-4">
          <div className="flex items-center gap-2">
            <Input
              id={`room-type-name-${i}`}
              value={row.name}
              onChange={(e) => patch(row.key, { name: e.target.value })}
              placeholder="Room type (e.g. Deluxe king room)"
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`room-type-guests-${i}`} className="text-xs">Max guests</Label>
              <Input id={`room-type-guests-${i}`} type="number" min={1} max={30} value={row.maxGuests} onChange={(e) => patch(row.key, { maxGuests: e.target.value })} className="h-10 rounded-none" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`room-type-size-${i}`} className="text-xs">Size m² <span className="font-normal text-basalt/40">(optional)</span></Label>
              <Input id={`room-type-size-${i}`} type="number" min={1} value={row.sizeM2} onChange={(e) => patch(row.key, { sizeM2: e.target.value })} className="h-10 rounded-none" />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor={`room-type-price-${i}`} className="text-xs">Default price / night (֏)</Label>
              <Input id={`room-type-price-${i}`} type="number" min={0} step={500} value={row.price} onChange={(e) => patch(row.key, { price: e.target.value })} placeholder="32000" className="h-10 rounded-none" />
            </div>
          </div>

          {/* The actual rooms of this type. */}
          <div className="grid gap-2 border border-basalt/10 bg-chalk/40 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-basalt/70">
                Rooms <span className="font-normal text-basalt/45">({row.units.length})</span>
              </p>
              <p className="text-[11px] text-basalt/45">Leave a price empty to use the default. Set date-by-date prices and blocked dates per room in the Calendar.</p>
            </div>
            {row.units.map((u, ui) => (
              <div key={u.key} className="flex items-center gap-2">
                <Input
                  id={`room-unit-name-${i}-${ui}`}
                  value={u.name}
                  onChange={(e) => setUnit(row.key, u.key, { name: e.target.value })}
                  placeholder="101"
                  aria-label="Room name or number"
                  className="h-10 w-28 shrink-0 rounded-none text-sm font-semibold"
                />
                <Input
                  id={`room-unit-price-${i}-${ui}`}
                  type="number"
                  min={0}
                  step={500}
                  value={u.price}
                  onChange={(e) => setUnit(row.key, u.key, { price: e.target.value })}
                  placeholder={row.price ? `${Number(row.price).toLocaleString()} (default)` : "Default price"}
                  aria-label="This room's own price per night (optional)"
                  className="h-10 min-w-0 flex-1 rounded-none text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeUnit(row.key, u.key)}
                  aria-label={`Remove room ${u.name || ui + 1}`}
                  className="grid h-10 w-10 shrink-0 place-items-center text-basalt/40 transition-colors hover:text-destructive"
                >
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              <button type="button" onClick={() => addUnit(row.key)} className="inline-flex items-center gap-1 text-xs font-semibold text-apricot hover:underline">
                <Plus className="h-3.5 w-3.5" /> Add room
              </button>
              <span className="flex items-center gap-1.5 text-xs text-basalt/55">
                Add
                <Input
                  id={`room-bulk-count-${i}`}
                  type="number"
                  min={1}
                  max={200}
                  value={bulk[row.key]?.count ?? ""}
                  onChange={(e) => setBulk((s) => ({ ...s, [row.key]: { from: s[row.key]?.from ?? "", count: e.target.value } }))}
                  placeholder="5"
                  aria-label="How many rooms to add"
                  className="h-8 w-14 rounded-none px-2 text-xs"
                />
                rooms numbered from
                <Input
                  id={`room-bulk-from-${i}`}
                  type="number"
                  min={0}
                  value={bulk[row.key]?.from ?? ""}
                  onChange={(e) => setBulk((s) => ({ ...s, [row.key]: { count: s[row.key]?.count ?? "", from: e.target.value } }))}
                  placeholder={nextNumber(row.units) || "101"}
                  aria-label="First room number"
                  className="h-8 w-16 rounded-none px-2 text-xs"
                />
                <button type="button" onClick={() => addSeveral(row.key)} className="font-semibold text-apricot hover:underline">
                  Add
                </button>
              </span>
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
