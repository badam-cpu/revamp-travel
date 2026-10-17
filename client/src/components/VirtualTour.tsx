/**
 * The guest's virtual tour of a stay (migration 0109): full screen, room by
 * room. Rooms come from shared/tours.ts (Aha sorted the operator's photos;
 * the operator checked them). A room with a 360° photo opens on it — drag to
 * look around (PanoramaView, lazy-loaded) — then its ordinary photos follow.
 * Arrow keys / swipe step through photos and roll on to the next room; the
 * room list (side rail on desktop, chips on phones) jumps straight to one.
 *
 * Motion, like a walk-through: every photo gets a slow camera move (push-in
 * or pan, varied photo to photo); moving on to the next room "walks forward"
 * (the photo zooms through and fades into the next), going back pulls out,
 * photos within a room cross-fade. The tour PLAYS itself when opened (a thin
 * progress line, Play/Pause, Space); any manual step, swipe or drag pauses it.
 * 360° rooms turn slowly until the guest drags. With reduced motion: still
 * photos, instant changes, no autoplay. Also the operator editor's preview.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Rotate3d, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { imgAttrs } from "@/lib/responsiveImg";
import { cn } from "@/lib/utils";
import { tourRoomDetails, type TourFacts, type TourRoom } from "@shared/tours";

const PanoramaView = lazy(() => import("@/components/PanoramaView"));

type Item = { type: "pano"; url: string } | { type: "photo"; url: string; caption: string };
const itemsOf = (r: TourRoom): Item[] => [...(r.pano ? [{ type: "pano" as const, url: r.pano.url }] : []), ...r.photos.map((p) => ({ type: "photo" as const, url: p.url, caption: p.caption }))];
const thumbOf = (r: TourRoom) => r.photos[0]?.url ?? null;

/** How long the tour stays on each item while playing. */
const DWELL_PHOTO = 5200;
const DWELL_PANO = 11000;
/** The camera moves cycle through these (index.css .tour-kb-*). */
const KB_MOVES = ["tour-kb-in", "tour-kb-right", "tour-kb-out", "tour-kb-left"];
type Transition = "fade" | "forward" | "back";

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function VirtualTour({ title, rooms, open, onClose, startRoom = 0, facts }: { title: string; rooms: TourRoom[]; open: boolean; onClose: () => void; startRoom?: number; facts?: TourFacts }) {
  const [roomIdx, setRoomIdx] = useState(startRoom);
  const [allDetails, setAllDetails] = useState(false);
  const [itemIdx, setItemIdx] = useState(0);
  const [reduce] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(false);
  // The photo we just left, animating out on top of the new one.
  const [leaving, setLeaving] = useState<{ url: string; transition: Transition; key: number } | null>(null);
  const [transition, setTransition] = useState<Transition>("fade");
  const touch = useRef<{ x: number; y: number } | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRoomIdx(Math.min(startRoom, Math.max(0, rooms.length - 1)));
      setItemIdx(0);
      setLeaving(null);
      setPlaying(!reduce);
    } else setPlaying(false);
  }, [open, startRoom, rooms.length, reduce]);

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

  /** Moves to a room/item with the right transition; a manual move pauses the tour. */
  const jump = (r: number, i: number, manual: boolean) => {
    if (r === roomIdx && i === itemIdx) return;
    const t: Transition = r > roomIdx ? "forward" : r < roomIdx ? "back" : "fade";
    if (!reduce && item?.type === "photo") setLeaving({ url: item.url, transition: t, key: Date.now() });
    setTransition(t);
    setRoomIdx(r);
    setItemIdx(i);
    if (manual) setPlaying(false);
  };
  const goRoom = (i: number, manual = true) => jump(i, 0, manual);
  const nextPos = (d: 1 | -1): [number, number] | null => {
    if (d === 1) {
      if (itemIdx < items.length - 1) return [roomIdx, itemIdx + 1];
      if (nextRoom) return [roomIdx + 1, 0];
      return null;
    }
    if (itemIdx > 0) return [roomIdx, itemIdx - 1];
    if (roomIdx > 0) return [roomIdx - 1, itemsOf(rooms[roomIdx - 1]).length - 1];
    return null;
  };
  const step = (d: 1 | -1, manual = true) => {
    const p = nextPos(d);
    if (p) jump(p[0], p[1], manual);
  };

  // The leaving photo is removed when its animation ends — and by a timer too,
  // since animationend never fires when the browser skips the animation
  // (background tab, power saving), which would leave it covering the new photo.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving((l) => (l?.key === leaving.key ? null : l)), 1100);
    return () => clearTimeout(t);
  }, [leaving]);

  // Autoplay: dwell on each item, then move on; stop at the end of the tour.
  const dwell = item?.type === "pano" ? DWELL_PANO : DWELL_PHOTO;
  useEffect(() => {
    if (!open || !playing || !item) return;
    const t = setTimeout(() => {
      if (atEnd) setPlaying(false);
      else step(1, false);
    }, dwell);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, playing, roomIdx, itemIdx, dwell, atEnd]);

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
          else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            setPlaying((p) => !p);
          }
        }}
      >
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base font-semibold text-white">Virtual tour</DialogTitle>
            <DialogDescription className="truncate text-xs text-white/55">{title}</DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!playing && atEnd) jump(0, 0, false);
              setPlaying((p) => !p);
            }}
            aria-pressed={playing}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-apricot"
          >
            {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {playing ? "Pause" : "Play"}
          </button>
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
                  <PanoramaView key={item.url} url={item.url} label={room.name} autoRotate={playing && !reduce} onInteract={() => setPlaying(false)} />
                </Suspense>
              ) : item ? (
                // Entering photo: fades in (zooming in from the doorway when we walked forward),
                // then the slow camera move runs for as long as it's on screen.
                <div key={`${roomIdx}-${itemIdx}`} className={cn("absolute inset-0", !reduce && `tour-enter-${transition}`)}>
                  <img
                    {...imgAttrs(item.url, "(min-width:1024px) calc(100vw - 264px), 100vw")}
                    alt={item.caption || room.name}
                    style={reduce ? undefined : { animationDuration: `${DWELL_PHOTO + 1500}ms` }}
                    className={cn("h-full w-full object-contain", !reduce && KB_MOVES[(roomIdx * 3 + itemIdx) % KB_MOVES.length])}
                  />
                </div>
              ) : null}

              {/* The photo we just left, walking out (forward/back) or fading. */}
              {leaving && !reduce && (
                <div key={leaving.key} aria-hidden className={cn("pointer-events-none absolute inset-0", `tour-leave-${leaving.transition}`)} onAnimationEnd={() => setLeaving(null)}>
                  <img {...imgAttrs(leaving.url, "(min-width:1024px) calc(100vw - 264px), 100vw")} alt="" className="h-full w-full object-contain" />
                </div>
              )}

              {/* Autoplay progress */}
              {playing && item && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-white/15" aria-hidden>
                  <div key={`${roomIdx}-${itemIdx}`} className="tour-progress h-full bg-white" style={{ animationDuration: `${dwell}ms` }} />
                </div>
              )}

              {item?.type === "pano" && (
                <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                  <Rotate3d className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                  {playing ? "Turning slowly — drag to look around" : "Drag to look around"}
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
                <button
                  type="button"
                  onClick={() => {
                    jump(0, 0, false);
                    setPlaying(!reduce);
                  }}
                  className="inline-flex h-10 items-center rounded-full border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10">
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
                    onClick={() => jump(roomIdx, i, true)}
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
