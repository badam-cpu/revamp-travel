/**
 * Short intro-video picker for the listing form (stay / tour / experience). One
 * video per listing: upload a short MP4/WebM (to the listing-videos bucket) OR
 * paste a YouTube/Vimeo link. Uncontrolled like PhotoUploader/AmenityPicker —
 * owns its value, exposed via `ref.getValue()` and read once at submit into the
 * listing's `videoUrl`. A tiny preview confirms what's set.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Film, X, Loader2, Link2, Upload } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { uploadVideo, ACCEPTED_VIDEO, MAX_VIDEO_SECONDS } from "@/lib/videoUpload";
import { parseVideo } from "@/lib/video";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export type VideoFieldHandle = { getValue: () => string; getPosition: () => number };

/** Where the video shows among the photos (0120): 1 = right after the cover; 40 = at the end. */
const POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40];
const positionLabel = (p: number) => (p === 40 ? "At the end of the photos" : p === 1 ? "2nd — right after the cover photo" : `${p + 1}${p + 1 === 3 ? "rd" : "th"} in the gallery`);

export const VideoField = forwardRef<VideoFieldHandle, { defaultValue?: string; defaultPosition?: number }>(function VideoField({ defaultValue = "", defaultPosition = 1 }, ref) {
  const { user } = useAuth();
  const [value, setValue] = useState(defaultValue.trim());
  const [position, setPosition] = useState(POSITIONS.includes(defaultPosition) ? defaultPosition : 1);
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ getValue: () => value.trim(), getPosition: () => position }), [value, position]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (!isSupabaseConfigured || !user) return toast("Sign in to upload a video.");
    setBusy(true);
    try {
      setValue(await uploadVideo(file, user.id));
      toast.success("Video added.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't upload that video.");
    } finally {
      setBusy(false);
    }
  };

  const addUrl = () => {
    const u = urlDraft.trim();
    if (!u) return;
    if (!parseVideo(u)) return toast("Paste a YouTube, Vimeo, or direct .mp4 link.");
    setValue(u);
    setUrlDraft("");
  };

  const parsed = parseVideo(value);

  return (
    <div className="grid gap-3">
      {value ? (
        <div className="flex items-center gap-3 border border-basalt/12 bg-paper p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center bg-basalt/5 text-basalt/60"><Film className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-basalt">{parsed?.kind === "youtube" ? "YouTube video" : parsed?.kind === "vimeo" ? "Vimeo video" : "Uploaded video"}</p>
            <p className="truncate text-xs text-basalt/45">{value}</p>
          </div>
          <button type="button" onClick={() => setValue("")} className="grid h-10 w-10 shrink-0 place-items-center text-basalt/45 hover:text-basalt" aria-label="Remove video"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="grid gap-2">
          <input ref={inputRef} type="file" accept={ACCEPTED_VIDEO} onChange={onFile} className="hidden" />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy} className="h-12 justify-center rounded-none border-dashed">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mr-2 h-4 w-4" /> Upload a short clip (≤ {MAX_VIDEO_SECONDS}s, MP4/WebM)</>}
          </Button>
          <div className="flex items-center gap-2">
            <Input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }} placeholder="…or paste a YouTube / Vimeo link" className="h-12 rounded-none text-base md:text-base" />
            <Button type="button" variant="outline" onClick={addUrl} className="h-12 shrink-0 rounded-none border-basalt/20 px-5"><Link2 className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
      {value && (
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold">Where it shows in your photos</span>
          <select value={position} onChange={(e) => setPosition(Number(e.target.value))} className="h-12 w-full rounded-none border border-basalt/15 bg-paper px-3 text-base sm:h-10 sm:text-sm">
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {positionLabel(p)}
              </option>
            ))}
          </select>
          <span className="text-xs text-basalt/45">Your cover photo always comes first — it's what search results and shared links show.</span>
        </label>
      )}
    </div>
  );
});
