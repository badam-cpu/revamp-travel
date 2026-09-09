/**
 * Drag-and-drop / click-to-upload photo manager for the operator listing
 * onboarding (client/src/pages/Dashboard.tsx). Replaces the old single
 * "Image URL" text field with a real gallery: the first photo is the cover
 * (listing card + hero), the rest fill the listing page's gallery.
 *
 * Photos go straight from the browser to the deployer's own Supabase Storage
 * bucket `listing-photos` (see supabase/migrations/0005_listing_photos_storage.sql),
 * scoped by RLS to the signed-in user's own `<uid>/…` folder — the same
 * anon-key-plus-RLS trust model as everything else the client writes. Uploads
 * are downscaled/compressed in-browser first (max 1600px wide, JPEG q≈0.82) so
 * hosts don't fight file-size limits and pages stay fast. HEIC or anything the
 * canvas can't decode is uploaded as-is.
 *
 * Uncontrolled like AmenityPicker: it owns its ordered list and exposes it via
 * `ref.getValue()` (an array of public URLs), read once at submit time. A
 * "paste a URL" fallback remains for externally-hosted images and for the
 * link-import reference photo the operator may choose to keep.
 */
import { forwardRef, useImperativeHandle, useRef, useState, type DragEvent } from "react";
import { ImagePlus, Star, X, ArrowLeft, ArrowRight, Loader2, Link2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type PhotoUploaderHandle = { getValue: () => string[] };

const BUCKET = "listing-photos";
const MAX_PHOTOS = 12;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

type Photo = { id: string; url: string };
type Pending = { id: string; name: string; error?: string };

/** Downscale + re-encode an image in the browser. Falls back to the original file if the canvas can't handle it (e.g. HEIC). */
async function compressImage(file: File): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const fallback = { blob: file, ext: (file.name.split(".").pop() || "bin").toLowerCase(), contentType: file.type || "application/octet-stream" };
  if (!file.type.startsWith("image/")) return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return fallback;
    // Only keep the re-encode if it actually helped (small already-optimized files can grow).
    if (blob.size >= file.size && scale === 1) return fallback;
    return { blob, ext: "jpg", contentType: "image/jpeg" };
  } catch {
    return fallback;
  }
}

export const PhotoUploader = forwardRef<PhotoUploaderHandle, { defaultValue?: string[] }>(function PhotoUploader({ defaultValue = [] }, ref) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>(() => defaultValue.filter(Boolean).map((url) => ({ id: crypto.randomUUID(), url })));
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ getValue: () => photos.map((p) => p.url) }), [photos]);

  const canUpload = isSupabaseConfigured && Boolean(user?.id);
  const atCapacity = photos.length + pending.length >= MAX_PHOTOS;

  const uploadOne = async (file: File) => {
    if (!user?.id) return;
    const id = crypto.randomUUID();
    setPending((prev) => [...prev, { id, name: file.name }]);
    try {
      const { blob, ext, contentType } = await compressImage(file);
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      setPhotos((prev) => [...prev, { id, url: data.publicUrl }]);
      setPending((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setPending((prev) => prev.map((p) => (p.id === id ? { ...p, error: message } : p)));
    }
  };

  const handleFiles = (files: FileList | File[]) => {
    if (!canUpload) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const room = MAX_PHOTOS - photos.length - pending.length;
    images.slice(0, Math.max(0, room)).forEach(uploadOne);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const move = (index: number, dir: -1 | 1) => {
    setPhotos((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const remove = (id: string) => setPhotos((prev) => prev.filter((p) => p.id !== id));

  const addUrl = () => {
    const url = urlDraft.trim();
    if (!url || atCapacity) return;
    setPhotos((prev) => (prev.some((p) => p.url === url) ? prev : [...prev, { id: crypto.randomUUID(), url }]));
    setUrlDraft("");
  };

  return (
    <div className="grid gap-3">
      <div>
        <Label className="text-sm font-semibold">Photos</Label>
        <p className="mt-1 text-xs text-basalt/45">
          JPG or PNG, landscape works best, at least 1200px wide (up to ~10 MB each). The first photo is the cover; drag to reorder. Large images are optimized automatically.
        </p>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={canUpload && !atCapacity ? 0 : -1}
        aria-disabled={!canUpload || atCapacity}
        onClick={() => canUpload && !atCapacity && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && canUpload && !atCapacity) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (canUpload && !atCapacity) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 border border-dashed px-6 py-10 text-center transition-colors",
          dragOver ? "border-apricot bg-apricot/5" : "border-basalt/25 bg-chalk",
          !canUpload || atCapacity ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-apricot/60",
        )}
      >
        <ImagePlus className="h-6 w-6 text-apricot" />
        <p className="text-sm font-semibold">
          {atCapacity ? `Up to ${MAX_PHOTOS} photos` : "Drag & drop photos, or click to choose"}
        </p>
        <p className="text-xs text-basalt/45">
          {canUpload ? `${photos.length}/${MAX_PHOTOS} added` : "Sign in as an operator to upload — or paste an image URL below."}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Thumbnails */}
      {(photos.length > 0 || pending.length > 0) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo, i) => (
            <div key={photo.id} className="group relative aspect-[4/3] overflow-hidden border border-basalt/15 bg-basalt/5">
              <img src={photo.url} alt={`Listing photo ${i + 1}`} className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 bg-apricot px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white">
                  <Star className="h-2.5 w-2.5" /> Cover
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(photo.id)}
                aria-label="Remove photo"
                className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center bg-basalt/70 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-basalt/55 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move earlier"
                  className="grid h-6 w-6 place-items-center text-white disabled:opacity-30"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === photos.length - 1}
                  aria-label="Move later"
                  className="grid h-6 w-6 place-items-center text-white disabled:opacity-30"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.id} className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 border border-dashed border-basalt/20 bg-chalk p-2 text-center">
              {p.error ? (
                <>
                  <X className="h-4 w-4 text-destructive" />
                  <p className="text-[10px] leading-tight text-destructive">{p.error}</p>
                  <button type="button" className="text-[10px] underline" onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}>
                    Dismiss
                  </button>
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-apricot" />
                  <p className="truncate text-[10px] text-basalt/50">{p.name}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* URL fallback */}
      <div className="flex items-center gap-2">
        <Input
          type="url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addUrl();
            }
          }}
          placeholder="Or paste an image URL"
          className="h-9 rounded-none text-xs"
          disabled={atCapacity}
        />
        <Button type="button" variant="outline" size="sm" onClick={addUrl} disabled={!urlDraft.trim() || atCapacity} className="h-9 shrink-0 rounded-none border-basalt/15 text-xs">
          <Link2 className="mr-1.5 h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
});
