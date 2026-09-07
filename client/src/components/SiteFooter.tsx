/** Revamp brandbook: use a charcoal closing surface, intact wordmark, cropped logo pattern, and practical marketplace context. */
import { ArrowUpRight, Instagram, Mail } from "lucide-react";
import { Link } from "wouter";
import { BrandMark } from "./BrandMark";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-basalt text-paper">
      <div className="pointer-events-none absolute -bottom-24 right-0 text-[19rem] font-bold leading-none tracking-[-0.12em] text-white/[0.035]">revamp.</div>
      <div className="container grid gap-12 py-16 md:grid-cols-[1.4fr_0.8fr_0.8fr] lg:py-24">
        <div>
          <BrandMark light />
          <p className="mt-7 max-w-md font-display text-3xl leading-tight tracking-tight text-paper">Find the Armenia that lives between the landmarks.</p>
          <p className="mt-5 max-w-md text-sm leading-6 text-paper/55">Curated stays, tables, and local routes across the country’s cities, forests, lakes, and southern roads.</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">Explore</p>
          <div className="mt-5 flex flex-col gap-3 text-sm text-paper/70">
            <Link href="/explore/stay" className="hover:text-white">Places to stay</Link>
            <Link href="/explore/eat" className="hover:text-white">Restaurants</Link>
            <Link href="/explore/tour" className="hover:text-white">Tours & experiences</Link>
            <Link href="/map" className="hover:text-white">Open the map</Link>
            <Link href="/plan" className="hover:text-white">AI trip planner</Link>
            <Link href="/manage" className="hover:text-white">Manage listings</Link>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">Keep close</p>
          <div className="mt-5 flex flex-col gap-3 text-sm text-paper/70">
            <a href="mailto:hello@revamp.travel" className="inline-flex items-center gap-2 hover:text-white"><Mail className="h-4 w-4" /> hello@revamp.travel</a>
            <a href="https://www.instagram.com/explore/tags/armenia/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-white"><Instagram className="h-4 w-4" /> Field notes <ArrowUpRight className="h-3 w-3" /></a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container flex flex-col gap-2 py-5 text-[11px] text-paper/40 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Revamp Travel.</span>
          <span>Curated marketplace concept · availability and prices shown are illustrative.</span>
        </div>
      </div>
    </footer>
  );
}
