/**
 * Campaign visual (0107): the layout (Title · Body, Title · Image · Body,
 * Image · Title · Body, Body only) and — for image layouts — a saved image
 * library with upload, a size/quality check, alt text and an optional link.
 * Email only; the composer's preview and the server's email builder read the
 * same CampaignVisual (shared/campaignVisual.ts).
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ImagePlus, Info, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CAMPAIGN_LAYOUTS, layoutHasImage, type CampaignLayout, type CampaignVisual } from "@shared/campaignVisual";
import { IMAGE_GUIDE, STARTER_IMAGES, displaySrc, imageQuality, listCampaignImages, removeCampaignImage, uploadCampaignImage, type CampaignImage } from "@/lib/campaignImage";

const LEVEL = {
  good: { label: "Good quality", cls: "bg-basalt text-paper" },
  okay: { label: "Okay — see notes", cls: "bg-tuff text-white" },
  low: { label: "Low quality", cls: "bg-apricot text-white" },
} as const;

/** `imageOnly` (Telegram): just pick an image — no layout, alt text or image link (the photo always sits on top). */
export function CampaignVisualPicker({ value, onChange, imageOnly = false }: { value: CampaignVisual; onChange: (v: CampaignVisual) => void; imageOnly?: boolean }) {
  const { user } = useAuth();
  const [images, setImages] = useState<CampaignImage[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const withImage = imageOnly || layoutHasImage(value.layout);

  useEffect(() => {
    if (!withImage || images) return;
    listCampaignImages().then((r) => {
      setImages(r.images);
      setMissing(r.missing);
    });
  }, [withImage, images]);

  const selected = [...(images ?? []), ...STARTER_IMAGES].find((i) => i.url === value.imageUrl) ?? null;
  const quality = selected ? imageQuality(selected, imageOnly ? undefined : value.imageAlt ?? "") : null;

  const upload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const img = await uploadCampaignImage(file, user.id);
      setImages((prev) => [img, ...(prev ?? [])]);
      onChange({ ...value, imageUrl: img.url, imageAlt: value.imageAlt || img.name });
      const q = imageQuality(img);
      toast.success(q.level === "good" ? "Image added to your library." : "Image added — check the quality notes below.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't upload that image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (img: CampaignImage) => {
    if (!window.confirm(`Remove "${img.name}" from the library? Emails already sent keep showing it.`)) return;
    try {
      await removeCampaignImage(img.id);
      setImages((prev) => (prev ?? []).filter((i) => i.id !== img.id));
      if (value.imageUrl === img.url) onChange({ ...value, imageUrl: null });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't remove it.");
    }
  };

  const tile = (img: CampaignImage) => {
    const on = value.imageUrl === img.url;
    const q = imageQuality(img);
    return (
      <div key={img.id} className="group relative">
        <button
          type="button"
          onClick={() => onChange({ ...value, imageUrl: on ? null : img.url, imageAlt: on ? value.imageAlt : value.imageAlt || img.name })}
          aria-pressed={on}
          title={`${img.name} · ${q.summary}`}
          className={cn("block aspect-[2/1] w-full overflow-hidden border-2", on ? "border-apricot" : "border-transparent hover:border-basalt/30")}
        >
          <img src={displaySrc(img.url)} alt={img.name} className="h-full w-full object-cover" loading="lazy" />
        </button>
        {q.level !== "good" && (
          <span className="pointer-events-none absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-apricot text-white" title="Check quality notes">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
          </span>
        )}
        {on && (
          <span className="pointer-events-none absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-apricot text-white">
            <Check className="h-2.5 w-2.5" aria-hidden />
          </span>
        )}
        {!img.starter && (
          <button
            type="button"
            onClick={() => remove(img)}
            aria-label={`Remove ${img.name} from the library`}
            className="absolute bottom-1 right-1 hidden h-5 w-5 place-items-center rounded-full bg-basalt/80 text-paper group-hover:grid group-focus-within:grid"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4">
      {!imageOnly && <div className="grid gap-1.5 sm:max-w-[260px]">
        <Label htmlFor="cv-layout" className="text-xs font-semibold">Layout</Label>
        <Select value={value.layout} onValueChange={(v) => onChange({ ...value, layout: v as CampaignLayout })}>
          <SelectTrigger id="cv-layout" className="h-10 rounded-none"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CAMPAIGN_LAYOUTS.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>}

      {withImage && (
        <>
          {/* Guidance first — before anyone picks a file */}
          <div className="flex gap-2.5 bg-chalk/60 p-3 text-xs leading-5 text-basalt/70">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-apricot" aria-hidden />
            <ul className="grid gap-1">
              {IMAGE_GUIDE.map((g) => <li key={g}>{g}</li>)}
            </ul>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Image <span className="font-normal text-basalt/45">— your uploads</span></Label>
              {missing && <span className="text-[11px] text-basalt/50">Run migration 0107 to save images.</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || missing}
                className="flex aspect-[2/1] flex-col items-center justify-center gap-1 border border-dashed border-basalt/25 text-[11px] font-semibold text-basalt/60 hover:border-apricot hover:text-apricot disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? "Optimising…" : "Upload"}
              </button>
              {(images ?? []).map((img) => tile(img))}
            </div>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/40">Revamp starters</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{STARTER_IMAGES.map((img) => tile(img))}</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </div>

          {selected && quality && (
            <div className="grid gap-2 border border-basalt/10 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]", LEVEL[quality.level].cls)}>{LEVEL[quality.level].label}</span>
                <span className="text-xs tabular-nums text-basalt/55">{selected.name} · {quality.summary}</span>
              </div>
              <ul className="grid gap-1">
                {quality.notes.map((n) => (
                  <li key={n.text} className="flex items-start gap-2 text-xs leading-5">
                    {n.level === "ok" ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-basalt/50" aria-hidden />
                    ) : (
                      <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", n.level === "bad" ? "text-apricot" : "text-tuff")} aria-hidden />
                    )}
                    <span className={n.level === "ok" ? "text-basalt/60" : "text-basalt/85"}>{n.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!imageOnly && <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cv-alt" className="text-xs font-semibold">Alt text <span className="font-normal text-basalt/45">(shown if images are hidden)</span></Label>
              <Input id="cv-alt" value={value.imageAlt ?? ""} onChange={(e) => onChange({ ...value, imageAlt: e.target.value })} maxLength={200} placeholder="e.g. Lake Sevan at sunset" className="h-10 rounded-none" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cv-link" className="text-xs font-semibold">Image link <span className="font-normal text-basalt/45">(optional)</span></Label>
              <Input id="cv-link" type="url" value={value.imageLink ?? ""} onChange={(e) => onChange({ ...value, imageLink: e.target.value })} placeholder="https://revampvacations.com/explore/stay" className="h-10 rounded-none" />
            </div>
          </div>}
        </>
      )}
    </div>
  );
}
