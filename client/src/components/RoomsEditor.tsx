/**
 * Sleeping-arrangement editor for the operator stay form — add rooms (bedroom,
 * living room, …) and assign beds to each with a bed type + count. Uncontrolled
 * with a ref.getValue() like the other pickers; read once at submit into the
 * listing's `rooms` (migration 0027). Shown as "Where you'll sleep" on the page.
 */
import { forwardRef, useImperativeHandle, useState } from "react";
import { Plus, Minus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ListingRoom } from "@shared/listings";

export const BED_TYPES = ["King", "Queen", "Double", "Single", "Twin", "Sofa bed", "Bunk bed", "Floor mattress", "Crib"];

export type RoomsEditorHandle = { getValue: () => ListingRoom[] };

type BedRow = { id: string; type: string; count: number };
type RoomRow = { id: string; name: string; beds: BedRow[] };

function seed(rooms: ListingRoom[]): RoomRow[] {
  return rooms.map((r) => ({
    id: crypto.randomUUID(),
    name: r.name ?? "",
    beds: (r.beds ?? []).map((b) => ({ id: crypto.randomUUID(), type: b.type || BED_TYPES[0], count: b.count || 1 })),
  }));
}

export const RoomsEditor = forwardRef<RoomsEditorHandle, { defaultValue: ListingRoom[] }>(function RoomsEditor({ defaultValue }, ref) {
  const [rooms, setRooms] = useState<RoomRow[]>(() => seed(defaultValue));

  useImperativeHandle(
    ref,
    () => ({
      getValue: () =>
        rooms
          .map((r) => ({ name: r.name.trim(), beds: r.beds.filter((b) => b.type).map((b) => ({ type: b.type, count: Math.max(1, b.count) })) }))
          .filter((r) => r.name || r.beds.length),
    }),
    [rooms],
  );

  const addRoom = () => setRooms((p) => [...p, { id: crypto.randomUUID(), name: "", beds: [{ id: crypto.randomUUID(), type: BED_TYPES[0], count: 1 }] }]);
  const removeRoom = (id: string) => setRooms((p) => p.filter((r) => r.id !== id));
  const setRoomName = (id: string, name: string) => setRooms((p) => p.map((r) => (r.id === id ? { ...r, name } : r)));
  const addBed = (roomId: string) => setRooms((p) => p.map((r) => (r.id === roomId ? { ...r, beds: [...r.beds, { id: crypto.randomUUID(), type: BED_TYPES[0], count: 1 }] } : r)));
  const removeBed = (roomId: string, bedId: string) => setRooms((p) => p.map((r) => (r.id === roomId ? { ...r, beds: r.beds.filter((b) => b.id !== bedId) } : r)));
  const setBed = (roomId: string, bedId: string, patch: Partial<BedRow>) =>
    setRooms((p) => p.map((r) => (r.id === roomId ? { ...r, beds: r.beds.map((b) => (b.id === bedId ? { ...b, ...patch } : b)) } : r)));

  return (
    <div className="grid gap-3">
      <div>
        <Label>Rooms &amp; beds</Label>
        <p className="mt-1 text-xs text-basalt/45">Add each room (Bedroom, Living room…) and the beds in it. Shown as "Where you'll sleep".</p>
      </div>

      {rooms.map((room) => (
        <div key={room.id} className="grid gap-3 border border-basalt/10 bg-paper p-4">
          <div className="flex items-center gap-2">
            <Input value={room.name} onChange={(e) => setRoomName(room.id, e.target.value)} placeholder="Room name (e.g. Bedroom, Living room)" className="h-11 rounded-none" />
            <button type="button" onClick={() => removeRoom(room.id)} aria-label="Remove room" className="grid h-11 w-11 shrink-0 place-items-center border border-basalt/15 text-basalt/50 transition-colors hover:border-destructive hover:text-destructive">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2">
            {room.beds.map((bed) => (
              <div key={bed.id} className="flex items-center gap-2">
                <Select value={bed.type} onValueChange={(v) => setBed(room.id, bed.id, { type: v })}>
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
                  onChange={(e) => setBed(room.id, bed.id, { count: Number(e.target.value) || 1 })}
                  className="h-10 w-20 rounded-none text-sm"
                  aria-label="How many"
                />
                <button type="button" onClick={() => removeBed(room.id, bed.id)} aria-label="Remove bed" className="grid h-10 w-10 shrink-0 place-items-center text-basalt/40 transition-colors hover:text-destructive">
                  <Minus className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addBed(room.id)} className="inline-flex items-center gap-1 self-start text-xs font-semibold text-apricot hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add bed
            </button>
          </div>
        </div>
      ))}

      <button type="button" onClick={addRoom} className="inline-flex items-center gap-1.5 self-start rounded-none border border-basalt/20 bg-paper px-4 py-2 text-sm font-semibold text-basalt transition-colors hover:border-apricot">
        <Plus className="h-4 w-4" /> Add room
      </button>
    </div>
  );
});
