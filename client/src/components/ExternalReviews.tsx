/**
 * Public "reviews from around the web" block on a listing page. Shows the
 * operator's Google Business reviews (live, via /api/google-reviews) and any
 * Airbnb reviews the host self-imported — each clearly attributed and kept
 * visually separate from native Revamp reviews. Renders nothing when there's
 * nothing to show. These are NEVER folded into Revamp's own aggregateRating.
 */
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { fetchGoogleReviews, listHostReviews, type GoogleReviewsResult, type HostReview } from "@/lib/externalReviews";

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={i < Math.round(n) ? "h-3.5 w-3.5 fill-apricot text-apricot" : "h-3.5 w-3.5 text-basalt/20"} />
      ))}
    </span>
  );
}

export function ExternalReviews({ operatorId, className = "" }: { operatorId: string; className?: string }) {
  const [google, setGoogle] = useState<GoogleReviewsResult | null>(null);
  const [airbnb, setAirbnb] = useState<HostReview[]>([]);

  useEffect(() => {
    if (!operatorId || operatorId === "seed") return;
    let active = true;
    fetchGoogleReviews(operatorId).then((g) => active && setGoogle(g));
    listHostReviews(operatorId).then((r) => active && setAirbnb(r.filter((x) => x.source === "airbnb")));
    return () => {
      active = false;
    };
  }, [operatorId]);

  const hasGoogle = google?.configured && (google.reviews?.length || google.rating);
  if (!hasGoogle && airbnb.length === 0) return null;

  return (
    <section className={`border-t border-basalt/10 pt-8 ${className}`}>
      <p className="eyebrow">From around the web</p>
      <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Reviews on other platforms.</h2>

      {hasGoogle && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Google</span>
            {typeof google?.rating === "number" && (
              <span className="inline-flex items-center gap-1.5">
                <Stars n={google.rating} /> <span className="font-semibold">{google.rating.toFixed(1)}</span>
                <span className="text-basalt/50">({google.total} reviews)</span>
              </span>
            )}
            {google?.url && <a href={google.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-apricot hover:underline">View on Google</a>}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(google?.reviews ?? []).map((r, i) => (
              <div key={i} className="rounded-none border border-basalt/12 bg-paper p-4">
                <Stars n={r.rating} />
                <p className="mt-2 line-clamp-5 text-sm leading-6 text-basalt/75">{r.text}</p>
                <p className="mt-3 text-xs text-basalt/50">{r.author}{r.relativeTime ? ` · ${r.relativeTime}` : ""}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-basalt/40">Ratings and reviews from Google, shown via the Google Places API.</p>
        </div>
      )}

      {airbnb.length > 0 && (
        <div className="mt-8">
          <p className="text-sm font-semibold">Airbnb <span className="font-normal text-basalt/45">— imported by the host</span></p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {airbnb.map((r) => (
              <div key={r.id} className="rounded-none border border-basalt/12 bg-paper p-4">
                {typeof r.rating === "number" && <Stars n={r.rating} />}
                <p className="mt-2 line-clamp-5 text-sm leading-6 text-basalt/75">{r.body}</p>
                <p className="mt-3 text-xs text-basalt/50">{r.reviewerName}{r.reviewDate ? ` · ${r.reviewDate}` : ""}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-basalt/40">Imported from Airbnb by the host.</p>
        </div>
      )}
    </section>
  );
}
