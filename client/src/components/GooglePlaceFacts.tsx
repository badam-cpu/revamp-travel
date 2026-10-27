/**
 * "Good to know · from Google" on restaurant / place-to-visit pages: the venue's
 * own Google attributes (parking, accessibility, reservations, …), fetched live
 * from GET /api/google-place-facts and labelled as Google's — never stored or
 * folded into Revamp's FAQ (Google's terms). Renders nothing when there's none.
 */
import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";

export function GooglePlaceFacts({ listingId, className }: { listingId: string; className?: string }) {
  const [facts, setFacts] = useState<{ items: string[]; url: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/google-place-facts?listingId=${encodeURIComponent(listingId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && j?.configured && Array.isArray(j.items) && j.items.length && setFacts({ items: j.items, url: j.url ?? null }))
      .catch((err) => console.error("[google-place-facts]", err));
    return () => {
      alive = false;
    };
  }, [listingId]);
  if (!facts) return null;
  return (
    <section aria-labelledby="google-facts-title" className={className}>
      <p className="eyebrow" id="google-facts-title">Good to know · from Google</p>
      <ul className="mt-5 flex flex-wrap gap-2.5">
        {facts.items.map((it) => (
          <li key={it} className="inline-flex items-center gap-2 border border-basalt/12 bg-chalk px-3.5 py-2 text-sm font-medium text-basalt">
            <Check className="h-3.5 w-3.5 text-basalt/55" aria-hidden /> {it}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-basalt/50">
        Information from Google{facts.url ? " · " : ""}
        {facts.url && (
          <a href={facts.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
            View on Google Maps <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </p>
    </section>
  );
}
