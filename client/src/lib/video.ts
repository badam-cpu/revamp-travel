/**
 * Detect what kind of "short video" a listing's videoUrl is and how to play it.
 * A listing stores ONE video (shared/listings.ts `videoUrl`): either a self-
 * hosted MP4/WebM public URL (uploaded to the listing-videos bucket) or a pasted
 * YouTube/Vimeo link. This turns the stored string into a render decision.
 */
export type VideoSource =
  | { kind: "file"; src: string }
  | { kind: "youtube"; embedUrl: string }
  | { kind: "vimeo"; embedUrl: string }
  | null;

export function parseVideo(url?: string | null): VideoSource {
  const u = (url || "").trim();
  if (!u) return null;

  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1` };

  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: "vimeo", embedUrl: `https://player.vimeo.com/video/${vm[1]}` };

  // Anything else is treated as a direct video file (our uploads, or a hosted mp4).
  return { kind: "file", src: u };
}

/** True when the listing has a playable video — cheap check for card badges. */
export function hasVideo(url?: string | null): boolean {
  return parseVideo(url) !== null;
}
