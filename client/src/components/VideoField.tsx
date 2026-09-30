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

export type VideoFieldHandle = { getValue: () => string };

export const VideoField = forwardRef<VideoFieldHandle, { defaultValue?: string }>(function VideoField({ defaultValue = "" }, ref) {
  const { user } = useAuth();
  const [value, setValue] = useState(defaultValue.trim());
  const [busy, setBusy] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ getValue: () => value.trim() }), [value]);

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
          <button type="button" onClick={() => setValue("")} className="shrink-0 text-basalt/45 hover:text-basalt" aria-label="Remove video"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="grid gap-2">
          <input ref={inputRef} type="file" accept={ACCEPTED_VIDEO} onChange={onFile} className="hidden" />
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy} className="h-11 justify-center rounded-none border-dashed">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="mr-2 h-4 w-4" /> Upload a short clip (≤ {MAX_VIDEO_SECONDS}s, MP4/WebM)</>}
          </Button>
          <div className="flex items-center gap-2">
            <Input value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }} placeholder="…or paste a YouTube / Vimeo link" className="h-10 rounded-none" />
            <Button type="button" variant="outline" onClick={addUrl} className="h-10 shrink-0 rounded-none border-basalt/20"><Link2 className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
});
