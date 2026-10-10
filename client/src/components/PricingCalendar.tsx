/**
 * Single-listing month calendar (Airbnb host style) for any offer. Each open
 * day shows its price (base or a per-date override) and its availability
 * (confirmed booking / externally-synced block / operator manual block). Click
 * a day or drag a range, then either set an AMD price for the selection or
 * block/open those dates.
 *
 * Pricing writes seasonal_rates (per-date rate — honored by the booking charge
 * for both per-night stays and per-person activities). Availability writes
 * manual_blocked_ranges (end EXCLUSIVE), kept separate from iCal blocked_ranges
 * so the daily sync can't wipe it. Both are content-only writes (status
 * untouched) via ListingsContext.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useListings, type LiveListing, type BlockedRange } from "@/contexts/ListingsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { RoomType, RoomUnit, SeasonalRate } from "@shared/listings";
import { roomUnitLabel, unitBaseCents } from "@shared/rooms";
import { fetchRoomTypes, updateRoomUnitCalendar } from "@/lib/roomTypes";

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDaysIso = (s: string, n: number) => iso(new Date(Date.parse(s + "T00:00:00Z") + n * DAY_MS));
const todayIso = () => iso(new Date());

/** Expand [start,end) ranges into a set of ISO days. */
function expand(ranges: BlockedRange[]): Set<string> {
  const s = new Set<string>();
  for (const r of ranges) for (let d = r.start; d < r.end; d = addDaysIso(d, 1)) s.add(d);
  return s;
}
/** Collapse a set of ISO days back into contiguous [start,end) ranges. */
function collapse(set: Set<string>): BlockedRange[] {
  const days = Array.from(set).sort();
  const out: BlockedRange[] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && last.end === d) last.end = addDaysIso(d, 1);
    else out.push({ start: d, end: addDaysIso(d, 1) });
  }
  return out;
}

/** A hotel room being edited (0092): its type, the room itself, and a callback with the saved room. */
export interface PricingCalendarRoom {
  type: RoomType;
  unit: RoomUnit;
  onSaved: (unit: RoomUnit) => void;
}

export function PricingCalendar({ listing, room }: { listing: LiveListing; room?: PricingCalendarRoom }) {
  const { setSeasonalRates, setManualBlocks, setListingFacts } = useListings();
  // Room mode edits ONE hotel room's prices and blocked dates (room_units);
  // without it, this is the single-unit listing calendar, unchanged.
  const saveRates = async (rates: SeasonalRate[]) => {
    if (room) room.onSaved(await updateRoomUnitCalendar(room.unit.id, { seasonalRates: rates }));
    else await setSeasonalRates(listing.id, rates);
  };
  const saveBlocks = async (ranges: BlockedRange[]) => {
    if (room) room.onSaved(await updateRoomUnitCalendar(room.unit.id, { manualBlockedRanges: ranges }));
    else await setManualBlocks(listing.id, ranges);
  };
  const { format } = useCurrency();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });
  const [booked, setBooked] = useState<{ start: string; end: string }[]>([]);
  const [sel, setSel] = useState<{ a: string; b: string } | null>(null);
  const dragging = useRef(false);
  const [priceInput, setPriceInput] = useState("");
  const [saving, setSaving] = useState(false);
  const currentMinStay = (() => {
    const raw = listing.facts?.find((f) => f.label.toLowerCase() === "minimum stay")?.value;
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 1 ? n : 1;
  })();
  const [minStayInput, setMinStayInput] = useState(String(currentMinStay));
  const [savingMin, setSavingMin] = useState(false);

  // Confirmed/pending bookings for this listing — or, in room mode, this room —
  // to mark booked days.
  const unitId = room?.unit.id;
  useEffect(() => {
    supabase
      .from("bookings")
      .select("start_date, end_date")
      .eq(unitId ? "room_unit_id" : "listing_id", unitId ?? listing.id)
      .in("status", ["pending_payment", "confirmed", "completed"])
      .then(({ data }) => setBooked((data ?? []).map((r) => ({ start: r.start_date as string, end: r.end_date as string }))));
  }, [listing.id, unitId]);

  const isStay = listing.type === "stay";
  const base = room ? unitBaseCents(room.type, room.unit) : Math.round(listing.price * 100);
  const rates = room ? room.unit.seasonalRates : listing.seasonalRates ?? [];
  const manual = room ? room.unit.manualBlockedRanges : listing.manualBlockedRanges ?? [];
  const priceForDate = (d: string) => {
    const match = rates.filter((r) => r.start <= d && d <= r.end).pop();
    return match ? match.priceCents : base;
  };
  const isBooked = (d: string) => booked.some((b) => b.start <= d && d < b.end);
  // The hotel's synced calendar doesn't apply to individual rooms (v1).
  const isExternal = (d: string) => !room && (listing.blockedRanges ?? []).some((b) => b.start <= d && d < b.end);
  const isManual = (d: string) => manual.some((b) => b.start <= d && d < b.end);

  // Month grid: leading blanks + each day.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const startPad = first.getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
    const out: (string | null)[] = Array(startPad).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(iso(new Date(Date.UTC(month.y, month.m, d))));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const monthLabel = new Date(Date.UTC(month.y, month.m, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  const today = todayIso();

  const selStart = sel && (sel.a < sel.b ? sel.a : sel.b);
  const selEnd = sel && (sel.a < sel.b ? sel.b : sel.a);
  const inSel = (d: string) => Boolean(selStart && selEnd && d >= selStart && d <= selEnd);
  const selNights = sel && selStart && selEnd ? Math.round((Date.parse(selEnd) - Date.parse(selStart)) / DAY_MS) + 1 : 0;

  // A day is selectable if it isn't in the past, confirmed-booked, or synced.
  const selectable = (d: string) => d >= today && !isBooked(d) && !isExternal(d);
  const startDrag = (d: string) => {
    if (!selectable(d)) return;
    dragging.current = true;
    setSel({ a: d, b: d });
  };
  const extendDrag = (d: string) => {
    if (dragging.current && selectable(d)) setSel((s) => (s ? { ...s, b: d } : s));
  };
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const clearSel = () => {
    setSel(null);
    setPriceInput("");
  };

  const applyPrice = async () => {
    if (!selStart || !selEnd) return;
    const amd = Math.round(Number(priceInput) || 0);
    if (amd <= 0) {
      toast("Enter a price in AMD.");
      return;
    }
    setSaving(true);
    try {
      const kept = rates.filter((r) => !(r.start >= selStart && r.end <= selEnd));
      await saveRates([...kept, { start: selStart, end: selEnd, priceCents: amd * 100 }]);
      toast(`Price set for ${selNights} day${selNights === 1 ? "" : "s"}.`);
      clearSel();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the price.");
    } finally {
      setSaving(false);
    }
  };

  const resetToBase = async () => {
    if (!selStart || !selEnd) return;
    setSaving(true);
    try {
      const kept = rates.filter((r) => r.end < selStart || r.start > selEnd);
      await saveRates(kept);
      toast("Reset to base price.");
      clearSel();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't reset.");
    } finally {
      setSaving(false);
    }
  };

  const applyBlock = async (block: boolean) => {
    if (!selStart || !selEnd) return;
    setSaving(true);
    try {
      const set = expand(manual);
      for (let d = selStart; d <= selEnd; d = addDaysIso(d, 1)) (block ? set.add(d) : set.delete(d));
      await saveBlocks(collapse(set));
      toast(`${block ? "Blocked" : "Opened"} ${selNights} day${selNights === 1 ? "" : "s"}.`);
      clearSel();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update availability.");
    } finally {
      setSaving(false);
    }
  };

  const saveMinStay = async () => {
    const n = Math.round(Number(minStayInput) || 1);
    setSavingMin(true);
    try {
      const others = (listing.facts ?? []).filter((f) => f.label.toLowerCase() !== "minimum stay");
      const next = n >= 2 ? [...others, { label: "Minimum stay", value: `${n} nights` }] : others;
      await setListingFacts(listing.id, next);
      toast(n >= 2 ? `Minimum stay set to ${n} nights.` : "Minimum stay cleared.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the minimum stay.");
    } finally {
      setSavingMin(false);
    }
  };

  const unit = room ? " / night" : listing.priceUnit ? ` / ${listing.priceUnit}` : "";
  // Does the selection contain any manually-blocked day (→ offer "Open")?
  const selHasBlocked = Boolean(selStart && selEnd && manual.some((r) => !(r.end <= selStart! || r.start > selEnd!)));

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth((m) => (m.m === 0 ? { y: m.y - 1, m: 11 } : { y: m.y, m: m.m - 1 }))} aria-label="Previous month" className="grid h-8 w-8 place-items-center border border-basalt/15 hover:border-apricot hover:text-apricot"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setMonth((m) => (m.m === 11 ? { y: m.y + 1, m: 0 } : { y: m.y, m: m.m + 1 }))} aria-label="Next month" className="grid h-8 w-8 place-items-center border border-basalt/15 hover:border-apricot hover:text-apricot"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <p className="font-display text-xl">{monthLabel}</p>
        <span className="ml-auto text-xs text-basalt/45">
          {base > 0 ? `Base rate ${format(base)}${unit}` : "Rate on request"}
          {room && room.unit.priceCents == null && " (room type default)"}
        </span>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-basalt/55">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-sevan" /> Booked</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-blue-500/40 bg-[repeating-linear-gradient(45deg,#3b82f640,#3b82f640_3px,transparent_3px,transparent_6px)]" /> External (synced)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-basalt/25" /> Blocked (you)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-apricot bg-apricot/15" /> Selected</span>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-basalt/10 text-center text-[10px] font-bold uppercase tracking-wide text-basalt/40">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 border-l border-t border-basalt/10 select-none">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} className="min-h-[74px] border-b border-r border-basalt/10 bg-basalt/[0.02]" />;
          const past = d < today;
          const bk = isBooked(d);
          const ext = isExternal(d);
          const mb = isManual(d);
          const selected = inSel(d);
          const price = priceForDate(d);
          const overridden = rates.some((r) => r.start <= d && d <= r.end);
          const canSelect = selectable(d);
          return (
            <div
              key={d}
              onPointerDown={() => canSelect && startDrag(d)}
              onPointerEnter={() => extendDrag(d)}
              className={cn(
                "relative min-h-[74px] border-b border-r border-basalt/10 p-1.5 text-left transition-colors",
                past ? "bg-basalt/[0.02] text-basalt/30" : canSelect ? "cursor-pointer hover:bg-apricot/[0.04]" : "cursor-not-allowed",
                selected && "bg-apricot/15 ring-1 ring-inset ring-apricot",
                bk && "bg-sevan/10",
                ext && "bg-[repeating-linear-gradient(45deg,#3b82f626,#3b82f626_4px,transparent_4px,transparent_8px)]",
                mb && !bk && !ext && "bg-basalt/[0.06]",
              )}
            >
              <span className={cn("text-xs font-semibold tabular-nums", d === today && "text-apricot")}>{Number(d.slice(8, 10))}</span>
              {!past && !bk && !ext && base > 0 && (
                <span className={cn("mt-3 block text-[11px] font-semibold", mb ? "text-basalt/35 line-through" : overridden ? "text-apricot" : "text-basalt/70")}>{format(price)}</span>
              )}
              {bk && <span className="mt-3 block text-[10px] font-semibold text-sevan">Booked</span>}
              {ext && !bk && <span className="mt-3 block text-[10px] font-semibold text-blue-600">External</span>}
              {mb && !bk && !ext && <span className="absolute bottom-1 right-1.5 text-[9px] font-bold uppercase tracking-wide text-basalt/45">Blocked</span>}
            </div>
          );
        })}
      </div>

      {/* Selection → price + availability actions */}
      {sel && selStart && selEnd && (
        <div className="mt-4 border border-apricot/40 bg-apricot/[0.06] p-4">
          <p className="text-sm font-semibold">
            {selNights} day{selNights === 1 ? "" : "s"} selected
            <span className="ml-2 font-normal text-basalt/55">{selStart}{selNights > 1 ? ` → ${selEnd}` : ""}</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-basalt/55">֏</span>
            <Input type="number" min={0} value={priceInput} onChange={(e) => setPriceInput(e.target.value)} placeholder={`price${unit} (AMD)`} className="h-9 w-44 rounded-none" />
            <Button size="sm" disabled={saving} onClick={applyPrice} className="rounded-none bg-apricot text-white hover:bg-apricot/90">{saving ? "Saving…" : "Set price"}</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={resetToBase} className="rounded-none">Reset to base</Button>
            <span className="mx-1 h-6 w-px bg-basalt/15" />
            {selHasBlocked ? (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => applyBlock(false)} className="rounded-none">Open dates</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => applyBlock(true)} className="rounded-none">Block dates</Button>
            )}
            <Button size="sm" variant="ghost" onClick={clearSel}>Cancel</Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-basalt/45">
        {room
          ? `Click a day or drag across several, then set this room's price (AMD per night) or block/open those dates — e.g. when the room is under repair. Confirmed bookings can't be changed here.`
          : `Click a day or drag across several, then set a price (AMD) or block/open those dates. Prices are per ${listing.priceUnit || "booking"}. Confirmed bookings and externally-synced days can't be changed here.`}
      </p>

      {/* Minimum stay (stays only) — a per-listing setting, saved to facts. */}
      {isStay && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border border-basalt/12 bg-chalk px-3 py-2 text-sm">
          <span className="font-semibold">{room ? "Minimum stay (whole property)" : "Minimum stay"}</span>
          <Input type="number" min={1} max={365} value={minStayInput} onChange={(e) => setMinStayInput(e.target.value)} className="h-9 w-20 rounded-none" />
          <span className="text-basalt/55">night{Number(minStayInput) === 1 ? "" : "s"}</span>
          <Button size="sm" variant="outline" disabled={savingMin} onClick={saveMinStay} className="ml-1 rounded-none">{savingMin ? "Saving…" : "Save"}</Button>
          <span className="text-xs text-basalt/45">Guests must book at least this many nights. Set 1 for no minimum.</span>
        </div>
      )}
    </div>
  );
}

/**
 * Hotel calendar (multi-room property, 0092): pick a room type, then one of
 * its rooms, and price / block that room exactly like a single-unit listing.
 * Rooms are added in the listing form; this only edits their dates.
 */
export function HotelPricingCalendar({ listing }: { listing: LiveListing }) {
  const { format } = useCurrency();
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [typeId, setTypeId] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("");

  useEffect(() => {
    let alive = true;
    setTypes(null);
    fetchRoomTypes(listing.id).then((t) => {
      if (!alive) return;
      setTypes(t);
      const first = t.find((x) => x.units.length) ?? t[0];
      setTypeId(first?.id ?? "");
      setUnitId(first?.units[0]?.id ?? "");
    });
    return () => {
      alive = false;
    };
  }, [listing.id]);

  if (types === null) return <p className="text-sm text-basalt/50">Loading your rooms…</p>;
  const withRooms = types.filter((t) => t.units.length);
  if (withRooms.length === 0) {
    return (
      <p className="border border-dashed border-basalt/20 bg-chalk px-4 py-6 text-sm text-basalt/60">
        This property has no rooms yet. Edit the listing and add rooms under each room type — then price and block them here.
      </p>
    );
  }

  const type = types.find((t) => t.id === typeId) ?? withRooms[0];
  const unit = type.units.find((u) => u.id === unitId) ?? type.units[0];
  // Keep the edited room in local state so the calendar shows saved changes at once.
  const onSaved = (saved: RoomUnit) => setTypes((all) => (all ?? []).map((t) => (t.id === saved.roomTypeId ? { ...t, units: t.units.map((u) => (u.id === saved.id ? saved : u)) } : t)));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="cal-room-type" className="text-xs font-semibold">Room type</Label>
          <Select
            value={type.id}
            onValueChange={(v) => {
              const next = types.find((t) => t.id === v);
              setTypeId(v);
              setUnitId(next?.units[0]?.id ?? "");
            }}
          >
            <SelectTrigger id="cal-room-type" className="h-11 rounded-none"><SelectValue /></SelectTrigger>
            <SelectContent>
              {withRooms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} · {t.units.length} room{t.units.length === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cal-room" className="text-xs font-semibold">Room</Label>
          <Select value={unit.id} onValueChange={setUnitId}>
            <SelectTrigger id="cal-room" className="h-11 rounded-none"><SelectValue /></SelectTrigger>
            <SelectContent>
              {type.units.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {roomUnitLabel(u.name)} · {format(unitBaseCents(type, u))}
                  {u.priceCents == null ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <PricingCalendar key={unit.id} listing={listing} room={{ type, unit, onSaved }} />
    </div>
  );
}
