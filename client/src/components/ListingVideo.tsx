/**
 * Renders a listing's short intro video (shared/listings.ts `videoUrl`): a self-
 * hosted MP4/WebM plays inline (muted autoplay loop, reel-style, with controls),
 * a YouTube/Vimeo link renders as an embedded player. Nothing renders when the
 * listing has no video. Used on the tour/experience and stay detail pages.
 */
import { parseVideo } from "@/lib/video";
import { cn } from "@/lib/utils";

export function ListingVideo({ url, poster, className }: { url?: string | null; poster?: string; className?: string }) {
  const v = parseVideo(url);
  if (!v) return null;

  if (v.kind === "file") {
    return (
      <video
        controls
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        poster={poster}
        className={cn("w-full rounded-2xl bg-basalt/5 object-cover", className)}
      >
        <source src={v.src} />
      </video>
    );
  }

  return (
    <div className={cn("aspect-video w-full overflow-hidden rounded-2xl bg-basalt/5", className)}>
      <iframe
        src={v.embedUrl}
        title="Listing video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        className="h-full w-full border-0"
        loading="lazy"
      />
    </div>
  );
}
