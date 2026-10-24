/**
 * Dashboard → listing card, hotels only (migration 0096): calendar sync per
 * individual room. Each room (101, 102, …) imports its own Airbnb/Booking.com
 * calendars, and exports its own Revamp link to paste into that room's OTA
 * listing. Links are saved under RLS (owner/admin only — an Airbnb export link
 * works as a key to that calendar); syncing runs server-side
 * (POST /api/room-calendars/sync) and again every hour (refresh-ical cron).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fetchRoomCalendars, fetchRoomTypes, saveRoomFeeds, type RoomCalendar } from "@/lib/roomTypes";
import { syncRoomCalendars } from "@/lib/api";
import { roomUnitLabel } from "@shared/rooms";
import type { RoomType } from "@shared/listings";

type Draft = { airbnb: string; booking: string };
const urlOf = (cal: RoomCalendar | undefined, label: string) => cal?.feeds.find((f) => f.label.toLowerCase() === label.toLowerCase())?.url ?? "";
const feedsOf = (d: Draft) => [{ label: "Airbnb", url: d.airbnb.trim() }, { label: "Booking.com", url: d.booking.trim() }].filter((f) => f.url);

export function HotelCalendarSync({ listingId, published }: { listingId: string; published: boolean }) {
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [cals, setCals] = useState<Map<string, RoomCalendar>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await fetchRoomTypes(listingId);
    const ids = t.flatMap((x) => x.units.map((u) => u.id));
    const c = await fetchRoomCalendars(ids);
    setTypes(t);
    setCals(c);
    setDrafts(Object.fromEntries(ids.map((id) => [id, { airbnb: urlOf(c.get(id), "Airbnb"), booking: urlOf(c.get(id), "Booking.com") }])));
  }, [listingId]);
  useEffect(() => {
    void load();
  }, [load]);

  const rooms = useMemo(() => (types ?? []).flatMap((t) => t.units.filter((u) => u.active).map((u) => ({ type: t, unit: u }))), [types]);
  const connected = rooms.filter(({ unit }) => (cals.get(unit.id)?.feeds.length ?? 0) > 0).length;
  const issues = rooms.filter(({ unit }) => cals.get(unit.id)?.error).length;
  const lastSync = rooms.map(({ unit }) => cals.get(unit.id)?.syncedAt).filter(Boolean).sort().pop();

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async (unitId: string) => {
    try {
      await navigator.clipboard?.writeText(`${origin}/api/ical/room/${unitId}.ics`);
      setCopied(unitId);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable — the link is still visible to select */
    }
  };

  const saveAndSync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      for (const { unit } of rooms) {
        const next = feedsOf(drafts[unit.id] ?? { airbnb: "", booking: "" });
        const prev = cals.get(unit.id)?.feeds ?? [];
        if (JSON.stringify(next) !== JSON.stringify(prev.map((f) => ({ label: f.label, url: f.url })))) await saveRoomFeeds(unit.id, next);
      }
      const results = await syncRoomCalendars(listingId);
      const vals = Object.values(results);
      const failed = vals.filter((r) => "error" in r || (r.feeds > 0 && r.errors.length === r.feeds)).length;
      const clashes = vals.reduce((a, r) => a + ("conflicts" in r ? r.conflicts : 0), 0);
      const synced = vals.filter((r) => !("error" in r) && r.feeds > 0).length - failed;
      await load();
      if (clashes) setMsg({ tone: "warn", text: `${clashes} Revamp ${clashes === 1 ? "booking clashes" : "bookings clash"} with Airbnb/Booking.com — we've emailed you the details. Use “Move to another room” on the booking.` });
      else if (failed) setMsg({ tone: "error", text: `Synced ${synced} ${synced === 1 ? "room" : "rooms"}; ${failed} couldn't be read — check the links marked below.` });
      else setMsg({ tone: "ok", text: synced ? `Synced ${synced} ${synced === 1 ? "room" : "rooms"}.` : "Saved. No room calendars connected." });
    } catch (e) {
      console.error("[hotel-calendar-sync]", e);
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't sync right now. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  if (types === null) return null;

  return (
    <div className="mt-3 border-t border-basalt/10 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
      >
        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-basalt/45" />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">Room calendars</span>
        <span className="min-w-0 flex-1 truncate text-xs text-basalt/55">
          {rooms.length === 0
            ? "Add rooms (101, 102…) to your room types to sync each one"
            : `${connected} of ${rooms.length} ${rooms.length === 1 ? "room" : "rooms"} connected${issues ? ` · ${issues} with issues` : ""}${lastSync ? ` · synced ${new Date(lastSync).toLocaleString()}` : ""}`}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-basalt/40 transition-transform", open && "rotate-180")} />
      </button>

      {open && rooms.length > 0 && (
        <div className="mt-3 grid gap-3">
          <p className="text-xs leading-5 text-basalt/55">
            For each room, paste the calendar-export (.ics) link from <strong>that room's</strong> Airbnb or Booking.com listing, and add the room's Revamp link there under “Import calendar”. Rooms re-sync every hour.
          </p>
          <ul className="grid divide-y divide-basalt/8 border border-basalt/10">
            {rooms.map(({ type, unit }) => {
              const cal = cals.get(unit.id);
              const d = drafts[unit.id] ?? { airbnb: "", booking: "" };
              const set = (k: keyof Draft, v: string) => setDrafts((p) => ({ ...p, [unit.id]: { ...d, [k]: v } }));
              const state = cal?.error
                ? { cls: "text-destructive", text: cal.error }
                : cal?.feeds.length && cal.syncedAt
                  ? { cls: "text-green-700", text: `${unit.blockedRanges?.length ?? 0} busy ${unit.blockedRanges?.length === 1 ? "range" : "ranges"} · ${new Date(cal.syncedAt).toLocaleString()}` }
                  : { cls: "text-basalt/45", text: "Not connected" };
              return (
                <li key={unit.id} className="grid gap-2 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold">{roomUnitLabel(unit.name)}</span>
                    <span className="text-xs text-basalt/45">{type.name}</span>
                    <span className={cn("ml-auto inline-flex items-center gap-1 text-xs", state.cls)}>
                      {cal?.error ? <AlertTriangle className="h-3.5 w-3.5" /> : cal?.feeds.length ? <Check className="h-3.5 w-3.5" /> : null}
                      <span className="max-w-[22rem] truncate">{state.text}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-[11px] font-semibold text-basalt/55">Airbnb</span>
                      <Input id={`rc-airbnb-${unit.id}`} type="url" value={d.airbnb} onChange={(e) => set("airbnb", e.target.value)} placeholder="https://www.airbnb.com/calendar/ical/….ics" className="h-11 min-w-0 rounded-none text-base sm:h-10 sm:text-xs" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[11px] font-semibold text-basalt/55">Booking.com</span>
                      <Input id={`rc-booking-${unit.id}`} type="url" value={d.booking} onChange={(e) => set("booking", e.target.value)} placeholder="https://admin.booking.com/…/ical.html?…" className="h-11 min-w-0 rounded-none text-base sm:h-10 sm:text-xs" />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[11px] font-semibold text-basalt/55">Revamp link</span>
                    {published ? (
                      <>
                        <Input readOnly value={`${origin}/api/ical/room/${unit.id}.ics`} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-none bg-chalk text-base sm:h-9 sm:text-xs" />
                        <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 rounded-none border-basalt/15 text-xs sm:h-9" onClick={() => void copy(unit.id)}>
                          {copied === unit.id ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied</> : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</>}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-basalt/45">Available once the hotel is published.</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void saveAndSync()} disabled={busy} className="h-10 rounded-none bg-apricot text-white hover:bg-apricot/90">
              <RefreshCw className={cn("mr-1.5 h-4 w-4", busy && "animate-spin")} /> {busy ? "Syncing…" : "Save & sync rooms"}
            </Button>
            {msg && (
              <p className={cn("text-xs", msg.tone === "ok" ? "font-semibold text-green-700" : msg.tone === "warn" ? "font-semibold text-amber-700" : "text-destructive")}>{msg.text}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
