/**
 * Public "reviews from around the web" block on a listing page. Shows the
 * operator's Google Business reviews (live, via /api/google-reviews) and any
 * Airbnb reviews the host self-imported — each clearly attributed and kept
 * visually separate from native Revamp reviews. Renders nothing when there's
 * nothing to show. These are NEVER folded into Revamp's own aggregateRating.
 */
import { useEffect, useState } from "react";
import { Languages, Star } from "lucide-react";
import { fetchGoogleReviews, listHostReviews, translateReviews, ratingScaleFor, toFiveStar, type GoogleReviewsResult, type HostReview, type HostReviewSource } from "@/lib/externalReviews";
import { computeMentions } from "@/lib/reviewMentions";

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={i < Math.round(n) ? "h-3.5 w-3.5 fill-apricot text-apricot" : "h-3.5 w-3.5 text-basalt/20"} />
      ))}
    </span>
  );
}

const HOST_PREVIEW = 6;
// Display order + labels for self-imported platforms.
const HOST_SOURCES: { key: HostReviewSource; label: string }[] = [
  { key: "airbnb", label: "Airbnb" },
  { key: "getyourguide", label: "GetYourGuide" },
  { key: "booking", label: "Booking.com" },
];

/** One platform's self-imported reviews (own show-more state). */
function HostReviewBlock({ label, source, reviews, show }: { label: string; source: HostReviewSource; reviews: HostReview[]; show: (t: string) => string }) {
  const [showAll, setShowAll] = useState(false);
  const scale = ratingScaleFor(source);
  const suffix = scale === 10 ? "/10" : "";
  const rated = reviews.filter((r) => typeof r.rating === "number") as (HostReview & { rating: number })[];
  const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-semibold">{label} <span className="font-normal text-basalt/45">— imported by the host</span></p>
        {avg !== null && (
          <span className="inline-flex items-center gap-1.5">
            <Stars n={toFiveStar(avg, source)} /> <span className="font-semibold">{avg.toFixed(1)}{suffix}</span>
            <span className="text-basalt/50">({reviews.length} review{reviews.length === 1 ? "" : "s"})</span>
          </span>
        )}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(showAll ? reviews : reviews.slice(0, HOST_PREVIEW)).map((r) => (
          <div key={r.id} className="rounded-none border border-basalt/12 bg-paper p-4">
            {typeof r.rating === "number" && (
              <span className="inline-flex items-center gap-1.5">
                <Stars n={toFiveStar(r.rating, source)} />
                {scale === 10 && <span className="text-xs font-semibold text-basalt/50">{r.rating}/10</span>}
              </span>
            )}
            <p className="mt-2 line-clamp-5 text-sm leading-6 text-basalt/75">{show(r.body)}</p>
            <p className="mt-3 text-xs text-basalt/50">{r.reviewerName}{r.reviewDate ? ` · ${r.reviewDate}` : ""}</p>
          </div>
        ))}
      </div>
      {reviews.length > HOST_PREVIEW && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-4 rounded-[0.875rem] border border-basalt/20 px-4 py-2 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot">
          {showAll ? "Show fewer" : `Show all ${reviews.length} reviews`}
        </button>
      )}
      <p className="mt-3 text-[11px] text-basalt/40">Imported from {label} by the host.</p>
    </div>
  );
}

export function ExternalReviews({ operatorId, listingId, className = "" }: { operatorId: string; listingId?: string; className?: string }) {
  const [google, setGoogle] = useState<GoogleReviewsResult | null>(null);
  const [host, setHost] = useState<HostReview[]>([]);
  const [translated, setTranslated] = useState<Map<string, string> | null>(null);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    if (!operatorId || operatorId === "seed") return;
    let active = true;
    fetchGoogleReviews(operatorId).then((g) => active && setGoogle(g));
    // Show a host review if it's operator-wide (no listing) or assigned to THIS listing.
    listHostReviews(operatorId).then(
      (r) => active && setHost(r.filter((x) => !x.listingId || x.listingId === listingId)),
    );
    return () => {
      active = false;
    };
  }, [operatorId, listingId]);

  const hasGoogle = google?.configured && (google.reviews?.length || google.rating);
  if (!hasGoogle && host.length === 0) return null;

  const show = (t: string) => (translated?.get(t) ?? t);
  const toggleTranslate = async () => {
    if (translated) {
      setTranslated(null);
      return;
    }
    setTranslating(true);
    try {
      const target = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2) || "en";
      const texts = Array.from(new Set([...host.map((r) => r.body), ...((google?.reviews ?? []).map((r) => r.text))].filter(Boolean)));
      const results = await translateReviews(texts, target);
      const map = new Map<string, string>();
      texts.forEach((t, i) => {
        const tr = results[i];
        if (tr && tr.text && tr.text !== t) map.set(t, tr.text);
      });
      setTranslated(map);
    } finally {
      setTranslating(false);
    }
  };

  // "Guest reviews mention" — themes across all the external review text we have.
  const mentions = computeMentions([...host.map((r) => r.body), ...((google?.reviews ?? []).map((r) => r.text))]).slice(0, 6);

  return (
    <section className={`border-t border-basalt/10 pt-8 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">From around the web</p>
          <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Reviews on other platforms.</h2>
        </div>
        <button
          type="button"
          onClick={toggleTranslate}
          disabled={translating}
          className="mt-1 inline-flex items-center gap-1.5 rounded-[0.875rem] border border-basalt/20 px-3.5 py-2 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot disabled:opacity-50"
        >
          <Languages className="h-4 w-4" /> {translating ? "Translating…" : translated ? "Show original" : "Translate"}
        </button>
      </div>
      {translated && <p className="mt-1 text-[11px] text-basalt/40">Translated by Google.</p>}

      {mentions.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-semibold text-basalt/70">Guests mention</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {mentions.map((m) => (
              <span key={m.key} className="inline-flex items-center gap-2 rounded-[0.875rem] border border-basalt/12 bg-paper px-3.5 py-2 text-sm">
                <span aria-hidden="true">{m.emoji}</span>
                <span className="font-semibold text-basalt">{m.label}</span>
                <span className="text-basalt/45">{m.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

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
                <p className="mt-2 line-clamp-5 text-sm leading-6 text-basalt/75">{show(r.text)}</p>
                <p className="mt-3 text-xs text-basalt/50">{r.author}{r.relativeTime ? ` · ${r.relativeTime}` : ""}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-basalt/40">Ratings and reviews from Google, shown via the Google Places API.</p>
        </div>
      )}

      {HOST_SOURCES.map(({ key, label }) => {
        const rows = host.filter((r) => r.source === key);
        return rows.length > 0 ? <HostReviewBlock key={key} label={label} source={key} reviews={rows} show={show} /> : null;
      })}
    </section>
  );
}
