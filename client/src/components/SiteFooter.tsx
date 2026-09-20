/** Revamp brandbook: use a charcoal closing surface, intact wordmark, cropped logo pattern, and practical marketplace context. */
import { ArrowUpRight, Instagram, Mail } from "lucide-react";
import { Link } from "wouter";
import { BrandMark } from "./BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { cn } from "@/lib/utils";

export function SiteFooter({ minimal = false, wide = false }: { minimal?: boolean; wide?: boolean } = {}) {
  const { profile } = useAuth();
  const { settings } = useSiteSettings();

  // Slim footer for app surfaces (operator dashboard) — just the wordmark,
  // copyright, and legal links, without the tall marketing columns. `wide`
  // matches the dashboard's wider content wrapper so it lines up with the page.
  if (minimal) {
    return (
      <footer className="border-t border-basalt/10 bg-paper text-basalt">
        <div className={cn("flex flex-col gap-3 py-6 text-[13px] text-basalt/55 sm:flex-row sm:items-center sm:justify-between", wide ? "mx-auto w-full max-w-[1680px] px-4 sm:px-6 lg:px-10" : "container")}>
          <BrandMark />
          <span>© 2026 Revamp Hospitality.</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-basalt">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-basalt">Terms of Service</Link>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="relative overflow-hidden bg-basalt text-paper">
      <div className="pointer-events-none absolute -bottom-24 right-0 text-[19rem] font-bold leading-none tracking-[-0.12em] text-white/[0.035]">revamp.</div>
      <div className="container grid gap-12 py-16 md:grid-cols-[1.4fr_0.8fr_0.8fr] lg:py-24">
        <div>
          <BrandMark light />
          <p className="mt-7 max-w-md font-display text-3xl leading-tight tracking-tight text-paper">{settings.homeContent.footerTagline?.trim() || "Find the Armenia that lives between the landmarks."}</p>
          <p className="mt-5 max-w-md text-sm leading-6 text-paper/55">{settings.homeContent.footerSubcopy?.trim() || "Curated stays, tables, and local routes across the country’s cities, forests, lakes, and southern roads."}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">Explore</p>
          <div className="mt-5 flex flex-col gap-3 text-sm text-paper/70">
            <Link href="/explore/stay" className="hover:text-white">Places to stay</Link>
            <Link href="/explore/eat" className="hover:text-white">Restaurants</Link>
            <Link href="/explore/tour" className="hover:text-white">Tours</Link>
            <Link href="/explore/experience" className="hover:text-white">Experiences</Link>
            <Link href="/map" className="hover:text-white">Open the map</Link>
            <Link href="/plan" className="hover:text-white">AI trip planner</Link>
            <Link href="/blog" className="hover:text-white">Blog</Link>
            <Link href="/faq" className="hover:text-white">FAQ</Link>
            {profile?.role === "operator" ? (
              <Link href="/dashboard" className="hover:text-white">Your dashboard</Link>
            ) : (
              <Link href="/signup" className="hover:text-white">Become an operator</Link>
            )}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">Keep close</p>
          <div className="mt-5 flex flex-col gap-3 text-sm text-paper/70">
            <a href="mailto:hello@revampvacations.com" className="inline-flex items-center gap-2 hover:text-white"><Mail className="h-4 w-4" /> hello@revampvacations.com</a>
            <a href="https://www.instagram.com/revamphomes_yerevan/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-white"><Instagram className="h-4 w-4" /> Field notes <ArrowUpRight className="h-3 w-3" /></a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container flex flex-col gap-3 py-5 text-[11px] text-paper/40 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Revamp Hospitality.</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
