/**
 * Operator's virtual-tour editor for a stay (migration 0109). Opened from
 * Dashboard → Listings ⋯ → Virtual tour, or from the "ready to check" toast
 * after saving the stay. Aha's draft is grouped into rooms (shared/tours.ts);
 * the operator renames and reorders rooms, moves photos between rooms or
 * leaves them out, edits captions, adds a 360° photo per room, previews the
 * guest view (VirtualTour) and publishes. Nothing reaches guests until it's
 * published, and only while the stay itself is published.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, Footprints, ImagePlus, Loader2, RefreshCw, Rotate3d, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VirtualTour } from "@/components/VirtualTour";
import { saveListingTour, userMessage } from "@/lib/api";
import { addNewPhotos, buildTour, fetchTour, fetchTourSource, PanoramaError, uploadPanorama, type TourSource } from "@/lib/tours";
import { imgAttrs } from "@/lib/responsiveImg";
import { cn } from "@/lib/utils";
import { kindLabel, newPhotosFor, newRoomId, tourRoomDetails, TOUR_LIMITS, TOUR_ROOM_KINDS, visibleRooms, type ListingTour, type TourRoom, type TourRoomKind } from "@shared/tours";

const LEFT_OUT = "__left_out__";

export function TourEditor({ listing, open, onClose, onChanged }: { listing: { id: string; title: string }; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const { user } = useAuth();
  const [tour, setTour] = useState<ListingTour | null>(null);
  const [src, setSrc] = useState<TourSource | null>(null);
  const [rooms, setRooms] = useState<TourRoom[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"draft" | "live" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const panoInput = useRef<HTMLInputElement>(null);
  const editorPane = useRef<HTMLDivElement>(null);

  // Below lg the room list sits above the editor, so a tap on a room would
  // otherwise change content off-screen — bring the editor into view.
  const pickRoom = (id: string) => {
    setSelected(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => editorPane.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, s] = await Promise.all([fetchTour(listing.id), fetchTourSource(listing.id)]);
      setTour(t);
      setSrc(s);
      const r = t && s ? visibleRooms(t.rooms, s.photos) : [];
      setRooms(r);
      setSeen(t?.seenPhotos ?? []);
      setSelected(r[0]?.id ?? null);
      setDirty(false);
    } catch (e) {
      console.error("[tour editor] load", e);
      setLoadError("Couldn't open the tour right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listing.id]);

  const assigned = useMemo(() => new Set(rooms.flatMap((r) => r.photos.map((p) => p.url))), [rooms]);
  const leftOut = useMemo(() => (src?.photos ?? []).filter((u) => !assigned.has(u)), [src, assigned]);
  const freshPhotos = useMemo(() => (tour && src ? newPhotosFor({ seenPhotos: seen, rooms }, src.photos) : []), [tour, src, seen, rooms]);
  const room = rooms.find((r) => r.id === selected) ?? null;
  const viewingLeftOut = selected === LEFT_OUT;

  const change = (fn: (rs: TourRoom[]) => TourRoom[]) => {
    setRooms((rs) => fn(rs));
    setDirty(true);
  };
  const patchRoom = (id: string, patch: Partial<TourRoom>) => change((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const moveRoom = (id: string, d: -1 | 1) =>
    change((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeRoom = (id: string) => {
    const r = rooms.find((x) => x.id === id);
    if (!r) return;
    if (r.photos.length && !window.confirm(`Remove "${r.name}"? Its ${r.photos.length} photo${r.photos.length === 1 ? "" : "s"} move to "Not in the tour".`)) return;
    change((rs) => rs.filter((x) => x.id !== id));
    setSelected(rooms.find((x) => x.id !== id)?.id ?? null);
  };
  const addRoom = (kind: TourRoomKind) => {
    const created: TourRoom = { id: newRoomId(), name: kindLabel(kind), kind, photos: [], pano: null };
    change((rs) => [...rs, created]);
    setSelected(created.id);
  };
  /** Moves a photo to a room (or out of the tour). */
  const movePhoto = (url: string, to: string) =>
    change((rs) => {
      const photo = rs.flatMap((r) => r.photos).find((p) => p.url === url) ?? { url, caption: "" };
      const without = rs.map((r) => ({ ...r, photos: r.photos.filter((p) => p.url !== url) }));
      if (to === LEFT_OUT) return without;
      return without.map((r) => (r.id === to ? { ...r, photos: [...r.photos, photo] } : r));
    });
  const shiftPhoto = (roomId: string, idx: number, d: -1 | 1) =>
    change((rs) =>
      rs.map((r) => {
        if (r.id !== roomId) return r;
        const j = idx + d;
        if (j < 0 || j >= r.photos.length) return r;
        const photos = [...r.photos];
        [photos[idx], photos[j]] = [photos[j], photos[idx]];
        return { ...r, photos };
      }),
    );
  const setCaption = (roomId: string, url: string, caption: string) =>
    change((rs) => rs.map((r) => (r.id === roomId ? { ...r, photos: r.photos.map((p) => (p.url === url ? { ...p, caption } : p)) } : r)));

  const build = async () => {
    if (rooms.length && !window.confirm("Rebuild the tour from your photos? Your room names, captions and photo moves will be replaced (360° photos are kept on rooms with the same name).")) return;
    setProgress({ done: 0, total: src?.listingPhotos.length ?? 0 });
    try {
      const panos = new Map(rooms.filter((r) => r.pano).map((r) => [r.name, r.pano]));
      const built = await buildTour(listing.id, (done, total) => setProgress({ done, total }));
      const withPanos = built.rooms.map((r) => ({ ...r, pano: panos.get(r.name) ?? null }));
      if (panos.size) await saveListingTour(listing.id, { rooms: withPanos, status: "draft", seenPhotos: built.seen, rebuilt: false });
      setTour({ listingId: listing.id, status: "draft", rooms: withPanos, seenPhotos: built.seen, builtAt: new Date().toISOString(), publishedAt: null });
      setRooms(withPanos);
      setSeen(built.seen);
      setSelected(withPanos[0]?.id ?? null);
      setDirty(false);
      onChanged?.();
      toast.success(`Tour built — ${withPanos.length} room${withPanos.length === 1 ? "" : "s"}. Check it, then publish.`);
    } catch (e) {
      toast(userMessage(e, "Couldn't build the tour right now. Please try again."));
    } finally {
      setProgress(null);
    }
  };

  const sortNew = async () => {
    if (!tour) return;
    setProgress({ done: 0, total: freshPhotos.length });
    try {
      const r = await addNewPhotos(listing.id, { ...tour, rooms, seenPhotos: seen }, (done, total) => setProgress({ done, total }));
      setRooms(r.rooms);
      setSeen(r.seen);
      setDirty(true);
      toast(`${r.added} new photo${r.added === 1 ? "" : "s"} sorted into rooms — save to keep them.`);
    } catch (e) {
      toast(userMessage(e, "Couldn't sort the new photos. Move them by hand from “Not in the tour”."));
    } finally {
      setProgress(null);
    }
  };

  const save = async (status: "draft" | "live") => {
    if (status === "live" && !rooms.some((r) => r.photos.length || r.pano)) {
      toast("Add photos to at least one room before publishing.");
      return;
    }
    setSaving(status);
    try {
      await saveListingTour(listing.id, { rooms, status, seenPhotos: seen, rebuilt: false });
      setTour((t) => (t ? { ...t, status, rooms } : { listingId: listing.id, status, rooms, seenPhotos: seen, builtAt: null, publishedAt: null }));
      setDirty(false);
      onChanged?.();
      toast.success(status === "live" ? (tour?.status === "live" ? "Tour updated — guests see the changes now." : "Tour published — guests can take it from your listing page.") : tour?.status === "live" ? "Tour unpublished — guests no longer see it." : "Tour saved as a draft.");
    } catch (e) {
      toast(userMessage(e, "Couldn't save the tour. Please try again."));
    } finally {
      setSaving(null);
    }
  };

  const onPano = async (file: File) => {
    if (!user || !room) return;
    setUploading(true);
    try {
      const url = await uploadPanorama(file, user.id);
      patchRoom(room.id, { pano: { url } });
      toast.success("360° photo added — preview it, then save.");
    } catch (e) {
      toast(e instanceof PanoramaError ? e.message : "Couldn't add that 360° photo. Please try again.");
      if (!(e instanceof PanoramaError)) console.error("[tour editor] pano", e);
    } finally {
      setUploading(false);
      if (panoInput.current) panoInput.current.value = "";
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Close without saving your tour changes?")) return;
    onClose();
  };

  const isLive = tour?.status === "live";
  const preview = visibleRooms(rooms, src?.photos ?? []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[94dvh] w-full max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-6xl">
        <div className="flex shrink-0 flex-wrap items-start gap-3 border-b border-basalt/10 bg-chalk px-5 py-4 pr-14">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              Virtual tour
              {tour && (
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]", isLive ? "bg-sevan text-white" : "bg-tuff text-white")}>{isLive ? "Live" : "Draft"}</span>
              )}
            </DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-sm text-basalt/55">
              {listing.title} · {isLive ? "Guests see this tour on your listing page." : "Only you can see this until you publish it."}
            </DialogDescription>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-8 text-sm text-basalt/55">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your tour…
          </div>
        ) : loadError ? (
          <div className="p-8 text-sm text-basalt/70">{loadError}</div>
        ) : progress ? (
          <div className="grid place-items-center gap-3 p-12 text-center">
            <Sparkles className="h-6 w-6 text-apricot" aria-hidden />
            <p className="text-base font-semibold">Aha AI is sorting your photos into rooms…</p>
            <div className="h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-basalt/10">
              <div className="h-full bg-apricot transition-[width] duration-500" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }} />
            </div>
            <p className="text-sm tabular-nums text-basalt/55">
              {progress.done} of {progress.total} photos
            </p>
          </div>
        ) : !tour && !rooms.length ? (
          <div className="grid place-items-center gap-3 p-10 text-center">
            <Footprints className="h-7 w-7 text-apricot" aria-hidden />
            <p className="text-lg font-semibold">Turn your photos into a room-by-room tour</p>
            <p className="max-w-md text-sm leading-6 text-basalt/60">
              Aha AI sorts your {src?.photos.length ?? 0} photos into rooms — living room, kitchen, bedrooms, the view — with short captions. You check it, add 360° photos if you have them, then publish.
            </p>
            <Button onClick={() => void build()} disabled={!src?.listingPhotos.length && !src?.roomTypes.length} className="mt-2 h-11 rounded-none bg-apricot px-5 text-white hover:bg-apricot/90">
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Build my tour
            </Button>
            {!src?.photos.length && <p className="text-xs text-basalt/50">Add photos to this stay first.</p>}
          </div>
        ) : (
          <>
            {freshPhotos.length > 0 && (
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-basalt/10 bg-apricot/8 px-5 py-2.5 text-sm">
                <span className="flex-1">
                  {freshPhotos.length} new photo{freshPhotos.length === 1 ? " isn't" : "s aren't"} in the tour yet.
                </span>
                <button type="button" onClick={() => void sortNew()} className="inline-flex h-9 items-center gap-1.5 font-semibold text-apricot hover:underline">
                  <Sparkles className="h-4 w-4" aria-hidden /> Sort them into rooms
                </button>
              </div>
            )}
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
              {/* Rooms */}
              <div className="border-b border-basalt/10 p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
                <p className="mb-2 text-xs font-semibold text-basalt/50">Rooms, in tour order</p>
                <ol className="grid gap-1">
                  {rooms.map((r, i) => (
                    <li key={r.id} className={cn("flex items-center gap-1 rounded-[10px] pr-1", selected === r.id ? "bg-chalk" : "hover:bg-chalk/60")}>
                      <button type="button" onClick={() => pickRoom(r.id)} aria-current={selected === r.id ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 p-2 text-left">
                        <span className="relative h-10 w-14 shrink-0 overflow-hidden rounded-[6px] bg-basalt/10">
                          {r.photos[0] && <img {...imgAttrs(r.photos[0].url, "56px")} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{r.name}</span>
                          <span className="block text-xs text-basalt/50">
                            {r.photos.length} photo{r.photos.length === 1 ? "" : "s"}
                            {r.pano ? " · 360°" : ""}
                          </span>
                        </span>
                      </button>
                      <button type="button" onClick={() => moveRoom(r.id, -1)} disabled={i === 0} aria-label={`Move ${r.name} up`} className="grid h-10 w-10 shrink-0 place-items-center sm:h-8 sm:w-8 rounded-full text-basalt/50 hover:bg-paper hover:text-basalt disabled:opacity-25">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => moveRoom(r.id, 1)} disabled={i === rooms.length - 1} aria-label={`Move ${r.name} down`} className="grid h-10 w-10 shrink-0 place-items-center sm:h-8 sm:w-8 rounded-full text-basalt/50 hover:bg-paper hover:text-basalt disabled:opacity-25">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex items-center gap-2">
                  <Label htmlFor="tour-add-room" className="sr-only">Add a room</Label>
                  <select
                    id="tour-add-room"
                    value=""
                    onChange={(e) => e.target.value && addRoom(e.target.value as TourRoomKind)}
                    disabled={rooms.length >= TOUR_LIMITS.rooms}
                    className="h-12 flex-1 rounded-[10px] border border-basalt/15 bg-paper px-3 text-base sm:h-10 sm:text-sm"
                  >
                    <option value="">+ Add a room…</option>
                    {TOUR_ROOM_KINDS.filter((k) => k.kind !== "other").map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => pickRoom(LEFT_OUT)}
                  aria-current={viewingLeftOut ? "true" : undefined}
                  className={cn("mt-3 flex w-full items-center justify-between rounded-[10px] p-2.5 text-left text-sm", viewingLeftOut ? "bg-chalk font-semibold" : "text-basalt/60 hover:bg-chalk/60")}
                >
                  Not in the tour <span className="tabular-nums text-basalt/45">{leftOut.length}</span>
                </button>
              </div>

              {/* Selected room */}
              <div ref={editorPane} className="scroll-mt-2 p-4 sm:p-5 lg:overflow-y-auto">
                {viewingLeftOut ? (
                  <div className="grid gap-3">
                    <h3 className="text-sm font-semibold">Not in the tour</h3>
                    <p className="text-xs leading-5 text-basalt/55">Photos guests won't see in the tour (they still appear in your gallery). Move one into a room to include it.</p>
                    {leftOut.length === 0 ? (
                      <p className="text-sm text-basalt/45">Every photo is in a room.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {leftOut.map((url) => (
                          <div key={url} className="grid gap-1.5">
                            <img {...imgAttrs(url, "220px")} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-[8px] object-cover" />
                            <select value="" onChange={(e) => e.target.value && movePhoto(url, e.target.value)} aria-label="Move this photo into a room" className="h-12 rounded-[8px] border border-basalt/15 bg-paper px-2 text-base sm:h-9 sm:text-xs">
                              <option value="">Move to…</option>
                              {rooms.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : room ? (
                  <div className="grid gap-5">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="grid min-w-[12rem] flex-1 gap-1.5">
                        <Label htmlFor="tour-room-name" className="text-xs font-semibold">Room name</Label>
                        <Input id="tour-room-name" value={room.name} maxLength={TOUR_LIMITS.name} onChange={(e) => patchRoom(room.id, { name: e.target.value })} className="h-11 rounded-none text-base sm:text-sm" />
                      </div>
                      <Button variant="outline" onClick={() => removeRoom(room.id)} className="h-11 rounded-none border-basalt/20 text-basalt/70">
                        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Remove room
                      </Button>
                    </div>

                    {/* What guests see listed for this room (from the listing) */}
                    {src && (
                      <section className="grid gap-1.5">
                        <p className="text-xs font-semibold text-basalt/50">Shown to guests in this room</p>
                        {tourRoomDetails(room, rooms, src.facts).length ? (
                          <ul className="flex flex-wrap gap-1.5">
                            {tourRoomDetails(room, rooms, src.facts).map((d) => (
                              <li key={d} className="rounded-full bg-chalk px-2.5 py-1 text-xs text-basalt/75">
                                {d}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-basalt/45">Nothing matched yet.</p>
                        )}
                        <p className="text-[11px] leading-4 text-basalt/45">Comes from your listing's amenities and sleeping arrangements — edit them in the listing form.</p>
                      </section>
                    )}

                    {/* 360° */}
                    <section className="grid gap-2 rounded-[12px] border border-basalt/10 p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Rotate3d className="h-5 w-5 text-apricot" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">360° photo {room.pano ? "added" : <span className="font-normal text-basalt/45">(optional)</span>}</p>
                          <p className="text-xs leading-5 text-basalt/55">
                            {room.pano ? "Guests start this room in 360° — they drag to look around." : "From a 360° camera (Insta360, Ricoh Theta…). Guests can look all around the room."}
                          </p>
                        </div>
                        {room.pano ? (
                          <button type="button" onClick={() => patchRoom(room.id, { pano: null })} className="text-sm font-semibold text-basalt/60 hover:text-destructive">
                            Remove
                          </button>
                        ) : (
                          <Button variant="outline" onClick={() => panoInput.current?.click()} disabled={uploading} className="h-10 rounded-none border-basalt/20">
                            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden />}
                            {uploading ? "Preparing…" : "Add 360° photo"}
                          </Button>
                        )}
                      </div>
                      {room.pano && <img src={room.pano.url} alt={`${room.name} 360° photo`} className="h-24 w-full rounded-[8px] object-cover" loading="lazy" />}
                      <input
                        ref={panoInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onPano(f);
                        }}
                      />
                    </section>

                    {/* Photos */}
                    <section className="grid gap-2">
                      <p className="text-xs font-semibold text-basalt/50">Photos in this room — the first one is its cover</p>
                      {room.photos.length === 0 ? (
                        <p className="text-sm text-basalt/45">No photos yet. Move some here from another room or from “Not in the tour”.</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {room.photos.map((p, i) => (
                            <div key={p.url} className="grid gap-1.5 rounded-[12px] border border-basalt/10 p-2">
                              <img {...imgAttrs(p.url, "300px")} alt={p.caption || room.name} loading="lazy" className="aspect-[4/3] w-full rounded-[8px] object-cover" />
                              <Label htmlFor={`cap-${i}`} className="sr-only">Caption</Label>
                              <Input id={`cap-${i}`} value={p.caption} maxLength={TOUR_LIMITS.caption} placeholder="Caption (optional)" onChange={(e) => setCaption(room.id, p.url, e.target.value)} className="h-10 rounded-none text-base sm:text-sm" />
                              <div className="flex items-center gap-1">
                                <select value={room.id} onChange={(e) => movePhoto(p.url, e.target.value)} aria-label="Move this photo" className="h-12 min-w-0 flex-1 rounded-[8px] border border-basalt/15 bg-paper px-2 text-base sm:h-9 sm:text-xs">
                                  {rooms.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.id === room.id ? `In ${r.name}` : `Move to ${r.name}`}
                                    </option>
                                  ))}
                                  <option value={LEFT_OUT}>Leave out of the tour</option>
                                </select>
                                <button type="button" onClick={() => shiftPhoto(room.id, i, -1)} disabled={i === 0} aria-label="Show earlier" className="grid h-9 w-9 place-items-center rounded-full text-basalt/50 hover:bg-chalk hover:text-basalt disabled:opacity-25">
                                  <ArrowLeft className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => shiftPhoto(room.id, i, 1)} disabled={i === room.photos.length - 1} aria-label="Show later" className="grid h-9 w-9 place-items-center rounded-full text-basalt/50 hover:bg-chalk hover:text-basalt disabled:opacity-25">
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                ) : (
                  <p className="text-sm text-basalt/50">Pick a room on the left, or add one.</p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-basalt/10 bg-paper px-5 py-3">
              <Button onClick={() => void save("live")} disabled={!!saving || (isLive && !dirty)} className="h-11 rounded-none bg-apricot px-5 text-white hover:bg-apricot/90">
                {saving === "live" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
                {isLive ? (dirty ? "Save changes" : "Published") : "Publish tour"}
              </Button>
              <Button variant="outline" onClick={() => void save("draft")} disabled={!!saving || (!isLive && !dirty)} className="h-11 rounded-none border-basalt/20">
                {saving === "draft" ? "Saving…" : isLive ? "Unpublish" : "Save draft"}
              </Button>
              <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={!preview.length} className="h-11 rounded-none border-basalt/20">
                <Eye className="mr-1.5 h-4 w-4" aria-hidden /> Preview
              </Button>
              <button type="button" onClick={() => void build()} className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-semibold text-basalt/60 hover:text-apricot sm:ml-auto">
                <RefreshCw className="h-4 w-4" aria-hidden /> Rebuild from photos
              </button>
            </div>
          </>
        )}
        <VirtualTour title={listing.title} rooms={preview} facts={src?.facts} open={previewOpen} onClose={() => setPreviewOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
