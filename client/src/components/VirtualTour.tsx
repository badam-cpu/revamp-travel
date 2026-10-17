/**
 * The guest's virtual tour of a stay (migration 0109): full screen, room by
 * room. Rooms come from shared/tours.ts (Aha sorted the operator's photos;
 * the operator checked them). A room with a 360° photo opens on it — drag to
 * look around (PanoramaView, lazy-loaded) — then its ordinary photos follow.
 * Arrow keys / swipe step through photos and roll on to the next room; the
 * room list (side rail on desktop, chips on phones) jumps straight to one.
 * Photos drift gently (off with reduced motion). Also used by the operator's
 * editor as its preview.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Rotate3d, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { imgAttrs } from "@/lib/responsiveImg";
import { cn } from "@/lib/utils";
import { tourRoomDetails, type TourFacts, type TourRoom } from "@shared/tours";

const PanoramaView = lazy(() => import("@/components/PanoramaView"));

type Item = { type: "pano"; url: string } | { type: "photo"; url: string; caption: string };
const itemsOf = (r: TourRoom): Item[] => [...(r.pano ? [{ type: "pano" as const, url: r.pano.url }] : []), ...r.photos.map((p) => ({ type: "photo" as const, url: p.url, caption: p.caption }))];
const thumbOf = (r: TourRoom) => r.photos[0]?.url ?? null;

export function VirtualTour({ title, rooms, open, onClose, startRoom = 0, facts }: { title: string; rooms: TourRoom[]; open: boolean; onClose: () => void; startRoom?: number; facts?: TourFacts }) {
  const [roomIdx, setRoomIdx] = useState(startRoom);
  const [allDetails, setAllDetails] = useState(false);
  const [itemIdx, setItemIdx] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRoomIdx(Math.min(startRoom, Math.max(0, rooms.length - 1)));
      setItemIdx(0);
    }
  }, [open, startRoom, rooms.length]);

  const room = rooms[roomIdx];
  const items = useMemo(() => (room ? itemsOf(room) : []), [room]);
  // What's in this room — the operator's own amenities / beds (shared/tours.ts).
  const details = useMemo(() => (room && facts ? tourRoomDetails(room, rooms, facts) : []), [room, rooms, facts]);
  useEffect(() => setAllDetails(false), [roomIdx]);
  const DETAILS_SHOWN = 5;
  const item = items[itemIdx];
  const nextRoom = rooms[roomIdx + 1];
  const atEnd = !nextRoom && itemIdx >= items.length - 1;
  const atStart = roomIdx === 0 && itemIdx === 0;

  const goRoom = (i: number) => {
    setRoomIdx(i);
    setItemIdx(0);
  };
  const step = (d: 1 | -1) => {
    if (d === 1) {
      if (itemIdx < items.length - 1) setItemIdx(itemIdx + 1);
      else if (nextRoom) goRoom(roomIdx + 1);
    } else if (itemIdx > 0) setItemIdx(itemIdx - 1);
    else if (roomIdx > 0) {
      const prev = rooms[roomIdx - 1];
      setRoomIdx(roomIdx - 1);
      setItemIdx(itemsOf(prev).length - 1);
    }
  };

  // Keep the active room chip in view on phones.
  useEffect(() => {
    chipsRef.current?.querySelector<HTMLElement>(`[data-room="${roomIdx}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [roomIdx]);

  // Warm the next photo.
  useEffect(() => {
    const nxt = items[itemIdx + 1] ?? (nextRoom ? itemsOf(nextRoom)[0] : undefined);
    if (nxt?.type === "photo") {
      const img = new Image();
      const a = imgAttrs(nxt.url, "100vw");
      if (a.srcSet) img.srcset = a.srcSet;
      img.sizes = "100vw";
      img.src = a.src;
    }
  }, [items, itemIdx, nextRoom]);

  if (!room) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[#161514] p-0 text-white sm:max-w-none"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          else if (e.key === "ArrowLeft") step(-1);
        }}
      >
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold text-white">Virtual tour</DialogTitle>
            <DialogDescription className="truncate text-xs text-white/55">{title}</DialogDescription>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the tour" className="grid h-11 w-11 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-apricot">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Rooms — chips on phones */}
        <div ref={chipsRef} className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Parts of the tour">
          {rooms.map((r, i) => (
            <button
              key={r.id}
              data-room={i}
              role="tab"
              aria-selected={i === roomIdx}
              type="button"
              onClick={() => goRoom(i)}
              className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors", i === roomIdx ? "bg-white font-semibold text-basalt" : "bg-white/10 text-white/80 hover:bg-white/15")}
            >
              {r.pano && <Rotate3d className="h-3.5 w-3.5" aria-hidden />}
              {r.name}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[264px_minmax(0,1fr)]">
          {/* Rooms — side rail on desktop */}
          <nav aria-label="Parts of the tour" className="hidden overflow-y-auto px-4 pb-6 lg:block">
            <ol className="grid gap-1">
              {rooms.map((r, i) => {
                const thumb = thumbOf(r);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => goRoom(i)}
                      aria-current={i === roomIdx ? "true" : undefined}
                      className={cn("flex w-full items-center gap-3 rounded-[10px] p-2 text-left transition-colors", i === roomIdx ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white")}
                    >
                      <span className="relative h-11 w-16 shrink-0 overflow-hidden rounded-[6px] bg-white/10">
                        {thumb && <img {...imgAttrs(thumb, "64px")} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        {r.pano && (
                          <span className="absolute bottom-0.5 right-0.5 rounded-full bg-basalt/80 px-1 text-[9px] font-bold leading-4 text-white">360°</span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{r.name}</span>
                        <span className="block text-xs text-white/45">
                          {r.photos.length} photo{r.photos.length === 1 ? "" : "s"}
                          {r.pano ? " · 360°" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* Stage */}
          <div className="flex min-h-0 flex-col">
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              onTouchStart={(e) => {
                if (item?.type !== "photo") return;
                touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              }}
              onTouchEnd={(e) => {
                const t = touch.current;
                touch.current = null;
                if (!t) return;
                const dx = e.changedTouches[0].clientX - t.x;
                const dy = e.changedTouches[0].clientY - t.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
              }}
            >
              {item?.type === "pano" ? (
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center text-sm text-white/60">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading 360° view…
                      </span>
                    </div>
                  }
                >
                  <PanoramaView key={item.url} url={item.url} label={room.name} />
                </Suspense>
              ) : item ? (
                <img
                  key={item.url}
                  {...imgAttrs(item.url, "(min-width:1024px) calc(100vw - 264px), 100vw")}
                  alt={item.caption || room.name}
                  className="tour-drift h-full w-full object-contain"
                />
              ) : null}

              {item?.type === "pano" && (
                <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <Rotate3d className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                  Drag to look around
                </span>
              )}

              <button type="button" onClick={() => step(-1)} disabled={atStart} aria-label="Previous" className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-opacity hover:bg-black/60 disabled:opacity-0">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label="Next" className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-opacity hover:bg-black/60 disabled:opacity-0">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Caption + where you are */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
              <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                <p className="truncate text-sm font-semibold text-white">{item?.type === "photo" && item.caption ? item.caption : room.name}</p>
                <p className="text-xs tabular-nums text-white/50">
                  {room.name} · {itemIdx + 1} of {items.length}
                </p>
                {details.length > 0 && (
                  <ul className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden" aria-label={`In the ${room.name.toLowerCase()}`}>
                    {(allDetails ? details : details.slice(0, DETAILS_SHOWN)).map((d) => (
                      <li key={d} className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/85">
                        {d}
                      </li>
                    ))}
                    {!allDetails && details.length > DETAILS_SHOWN && (
                      <li className="shrink-0">
                        <button type="button" onClick={() => setAllDetails(true)} className="rounded-full px-2.5 py-1 text-xs font-semibold text-white/70 underline-offset-2 hover:text-white hover:underline">
                          +{details.length - DETAILS_SHOWN} more
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
              {itemIdx >= items.length - 1 && nextRoom && (
                <button type="button" onClick={() => goRoom(roomIdx + 1)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-basalt transition-colors hover:bg-white/90">
                  Next: {nextRoom.name} <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              )}
              {atEnd && rooms.length > 1 && (
                <button type="button" onClick={() => goRoom(0)} className="inline-flex h-10 items-center rounded-full border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                  Start again
                </button>
              )}
            </div>

            {/* This room's photos */}
            {items.length > 1 && (
              <div className="hidden shrink-0 gap-2 overflow-x-auto px-6 pb-4 sm:flex" aria-label={`${room.name} photos`}>
                {items.map((it, i) => (
                  <button
                    key={it.url + i}
                    type="button"
                    onClick={() => setItemIdx(i)}
                    aria-label={it.type === "pano" ? "360° view" : it.caption || `Photo ${i + 1}`}
                    aria-current={i === itemIdx ? "true" : undefined}
                    className={cn("relative h-14 w-20 shrink-0 overflow-hidden rounded-[6px] border-2 transition-colors", i === itemIdx ? "border-white" : "border-transparent opacity-60 hover:opacity-100")}
                  >
                    {it.type === "pano" ? (
                      <span className="grid h-full w-full place-items-center bg-white/10 text-[11px] font-bold">360°</span>
                    ) : (
                      <img {...imgAttrs(it.url, "80px")} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
