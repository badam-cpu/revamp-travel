/** Revamp brandbook: the map-led view uses a charcoal rail, orange focus cues, rounded atlas, and clean sans hierarchy. */
import { useMemo, useState } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { ArmeniaMap } from "@/components/ArmeniaMap";
import { ListingType, typeLabels } from "@/data/listings";
import { useListings } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";

export default function MapPage() {
  const { listings } = useListings();
  const [type, setType] = useState("all");
  const [selectedId, setSelectedId] = useState(listings[0]?.id);
  const filtered = useMemo(() => listings.filter((listing) => type === "all" || listing.type === type), [type, listings]);

  return (
    <div className="min-h-screen bg-basalt text-paper">
      <SiteHeader />
      <main className="grid min-h-[calc(100vh-76px)] lg:grid-cols-[390px_1fr]">
        <aside className="relative order-2 max-h-none overflow-hidden overflow-y-auto bg-basalt p-5 lg:order-1 lg:max-h-[calc(100vh-76px)] lg:p-7">
          <div className="pointer-events-none absolute -right-10 -top-14 text-[10rem] font-bold leading-none tracking-[-0.12em] text-white/[0.035]">re.</div>
          <div className="mb-7 flex items-center justify-between border-b border-white/10 pb-4 text-[8px] font-bold uppercase tracking-[0.2em] text-paper/35"><span>Atlas sheet 01</span><span>38.8°—41.3° N</span></div>
          <p className="eyebrow text-apricot">Explore by map</p>
          <h1 className="mt-3 font-display text-5xl leading-none tracking-[-0.04em]">Armenia,<br />place by place.</h1>
          <p className="mt-4 max-w-xs text-sm leading-6 text-paper/48">Follow the volcanic spine from Tavush forest to Syunik’s southern roads.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {["all", "stay", "eat", "tour"].map((value) => (
              <button key={value} onClick={() => { setType(value); const first = listings.find((item) => value === "all" || item.type === value); if (first) setSelectedId(first.id); }} className={cn("border border-white/15 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-paper/55 transition-colors hover:text-white", type === value && "border-apricot bg-apricot text-white")}>
                {value === "all" ? "All" : typeLabels[value as ListingType]}
              </button>
            ))}
          </div>
          <div className="mt-8 space-y-3">
            {filtered.map((listing) => (
              <Link key={listing.id} href={`/listing/${listing.slug}`} onMouseEnter={() => setSelectedId(listing.id)} className={cn("group grid grid-cols-[88px_1fr] gap-4 border-t border-white/10 py-4 transition-colors", selectedId === listing.id && "border-apricot bg-white/[0.04]")}> 
                <img src={listing.image} alt="" className="h-[82px] w-[88px] object-cover" />
                <div>
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-paper/45"><MapPin className="h-3 w-3 text-apricot" /> {listing.city}</p>
                  <h2 className="mt-1 font-display text-xl leading-tight group-hover:text-apricot">{listing.title}</h2>
                  <div className="mt-2 flex items-center justify-between text-xs text-paper/45"><span>{typeLabels[listing.type]}</span><span>{listing.priceLabel}{listing.price > 0 ? ` / ${listing.priceUnit}` : ""} <ArrowRight className="ml-1 inline h-3 w-3" /></span></div>
                </div>
              </Link>
            ))}
          </div>
        </aside>
        <ArmeniaMap listings={filtered} selectedId={selectedId} onSelect={setSelectedId} className="order-1 h-[58vh] min-h-[430px] lg:order-2 lg:h-[calc(100vh-76px)]" />
      </main>
    </div>
  );
}
