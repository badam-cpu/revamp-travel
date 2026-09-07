/** Revamp brandbook: keep the Armenia atlas reliable and synchronized, using only orange, charcoal, white, and approved tints. */
import { useMemo } from "react";
import { Listing } from "@/data/listings";
import { cn } from "@/lib/utils";

interface ArmeniaMapProps {
  listings: Listing[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
  single?: boolean;
}

const bounds = { minLat: 38.8, maxLat: 41.35, minLng: 43.35, maxLng: 46.7 };

function markerPosition(listing: Listing) {
  const x = 13 + ((listing.coordinates.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 74;
  const y = 10 + ((bounds.maxLat - listing.coordinates.lat) / (bounds.maxLat - bounds.minLat)) * 80;
  return { left: `${Math.max(8, Math.min(90, x))}%`, top: `${Math.max(7, Math.min(90, y))}%` };
}

export function ArmeniaMap({ listings, selectedId, onSelect, className, single = false }: ArmeniaMapProps) {
  const active = useMemo(() => listings.find((listing) => listing.id === selectedId) || listings[0], [listings, selectedId]);

  return (
    <div className={cn("atlas-map relative overflow-hidden bg-[#D9D8CD]", className)}>
      <div className="absolute inset-0 atlas-grid" />
      <svg className="absolute inset-[4%_7%] h-[92%] w-[86%]" viewBox="0 0 500 700" aria-hidden="true">
        <path className="atlas-country-shadow" d="M224 18L283 35L307 77L348 91L363 132L397 157L381 201L414 241L397 280L430 321L401 351L410 397L370 423L379 469L347 500L360 546L329 574L315 626L271 653L235 686L198 661L179 619L144 596L152 549L118 518L131 476L98 439L119 399L86 356L108 317L84 271L116 238L105 190L145 164L151 116L188 93L196 49Z" />
        <path className="atlas-country" d="M219 12L277 31L300 72L342 86L356 127L390 151L374 196L406 236L389 275L422 316L393 346L402 391L362 418L371 463L339 495L352 540L321 568L307 620L263 647L228 680L191 655L172 613L137 590L145 543L111 512L124 470L91 433L112 393L79 350L101 311L77 265L109 232L98 184L138 158L144 110L181 87L189 43Z" />
        <path className="atlas-region" d="M180 88C230 128 300 126 354 127M111 231C196 250 311 238 388 195M102 311C180 344 319 341 394 346M119 393C210 413 303 405 363 418M132 470C212 478 279 489 340 495M153 543C211 553 263 575 320 568" />
        <path className="atlas-route" d="M176 164C236 203 220 274 291 313C349 344 282 416 321 486C343 528 293 571 264 628" />
        <circle cx="176" cy="164" r="5" /><circle cx="291" cy="313" r="5" /><circle cx="321" cy="486" r="5" /><circle cx="264" cy="628" r="5" />
      </svg>

      <div className="absolute left-5 top-5 flex items-center gap-3">
        <span className="h-8 w-8 rounded-full bg-apricot" />
        <div className="bg-paper/94 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-basalt shadow-sm">Armenia · 40.18° N</div>
      </div>
      <span className="absolute right-5 top-5 text-[9px] font-bold uppercase tracking-[0.18em] text-basalt/42">43.35°—46.70° E</span>
      <span className="absolute bottom-5 left-5 [writing-mode:vertical-rl] text-[8px] font-bold uppercase tracking-[0.2em] text-basalt/35">revamp. field atlas · elevation lines</span>

      {listings.map((listing) => (
        <button
          key={listing.id}
          type="button"
          aria-label={`Select ${listing.title}`}
          onClick={() => onSelect?.(listing.id)}
          style={markerPosition(listing)}
          className={cn("atlas-marker", `marker-${listing.accent}`, (selectedId === listing.id || (single && listing.id === active?.id)) && "selected")}
        >
          <span>{listing.priceLabel}</span>
        </button>
      ))}

      {active && (
        <div className="absolute bottom-5 right-5 max-w-[220px] border-l-2 border-apricot bg-basalt px-4 py-3 text-paper shadow-xl">
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-paper/45">{active.city} · {active.region}</p>
          <p className="mt-1 font-display text-lg leading-tight">{active.title}</p>
        </div>
      )}
    </div>
  );
}
