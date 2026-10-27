/** Revamp brandbook: use a charcoal closing surface, intact wordmark, cropped logo pattern, and practical marketplace context. */
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, Instagram, Mail, Send } from "lucide-react";
import { Link } from "wouter";
import { Slogan } from "./Slogan";
import { BrandMark, Wordmark } from "./BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useListings } from "@/contexts/ListingsContext";
import { cn } from "@/lib/utils";
import { slugify } from "@/lib/slug";
import { PaymentMethods } from "@/components/PaymentMethods";
import { useSite } from "@/contexts/SiteContext";

const normalizeRegion = (r: string) => r.trim().replace(/\s+(province|marz)$/i, "").trim();

// Footer nav grouped into themed columns (replaces the old single 13-link list).
const FOOTER_EXPLORE: [string, string][] = [
  ["/explore/stay", "Places to stay"],
  ["/explore/eat", "Restaurants"],
  ["/explore/tour", "Tours"],
  ["/explore/experience", "Experiences"],
  ["/explore/place", "Places to visit"],
  ["/map", "Open the map"],
];
const FOOTER_PLAN: [string, string][] = [
  ["/plan", "Plan with Aha AI"],
  ["/ai", "Revamp in ChatGPT & Claude"],
  ["/guide", "Travel guide"],
  ["/events", "Events in Armenia"],
  ["/gift-cards", "Gift cards"],
];
const FOOTER_COMPANY: [string, string][] = [
  ["/blog", "Blog"],
  ["/partners", "Partners"],
  ["/faq", "FAQ"],
  ["/developers", "Developers & MCP"],
];

// revampstay footer groups — stay/relocation categories, not restaurants/tours.
// Rent/Buy route to the offer-filtered Explore (?offer=…) built with the
// viewing-request flow.
const FOOTER_STAY_RENT: [string, string][] = [
  ["/explore/stay", "Browse homes"],
  ["/explore/stay?offer=monthly", "Long-term rentals"],
  ["/explore/stay?offer=nightly", "Short stays"],
  ["/explore/stay?offer=sale", "For sale"],
];
const FOOTER_STAY_HOSTS: [string, string][] = [
  ["/host", "List your place"],
  ["/map", "Open the map"],
  ["/faq", "FAQ"],
];

/** True at/above a min-width (the footer's sections are always open there). */
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/**
 * A footer link column. Desktop: heading + links, always open. Phones: the
 * heading is a toggle and the links start collapsed (still in the DOM, so
 * crawlers keep every internal link).
 */
function FooterGroup({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const alwaysOpen = useMinWidth(640); // sm: plain columns, nothing to toggle
  return (
    <div className="border-b border-white/10 pb-4 sm:border-0 sm:pb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={alwaysOpen || open}
        tabIndex={alwaysOpen ? -1 : undefined}
        className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-apricot sm:pointer-events-none sm:cursor-default"
      >
        {title}
        <ChevronDown className={cn("h-4 w-4 transition-transform sm:hidden", open && "rotate-180")} />
      </button>
      <div className={cn("mt-5 flex-col gap-3 text-sm text-paper/70 sm:flex", open ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}

// The Telegram bot's t.me link comes from the server (its @username is server
// env only); fetched once per page load. No link while unknown or not set up.
let telegramBotPromise: Promise<string | null> | null = null;
function useTelegramBotUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    telegramBotPromise ??= fetch("/api/telegram/bot")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { url?: string | null } | null) => d?.url ?? null)
      .catch(() => null);
    let live = true;
    void telegramBotPromise.then((u) => live && setUrl(u));
    return () => { live = false; };
  }, []);
  return url;
}

export function SiteFooter({ minimal = false, wide = false }: { minimal?: boolean; wide?: boolean } = {}) {
  const { profile } = useAuth();
  const { settings } = useSiteSettings();
  const { publicListings: listings } = useListings();
  const site = useSite();
  const isStay = site === "stay";
  const telegramUrl = useTelegramBotUrl();

  // Regions that actually have listings of each type → footer crawl paths into
  // the per-region landing pages (SEO internal links). Deduped, capped. Only
  // populated regions appear, so no links to empty/thin pages.
  const regionsForType = (t: string) =>
    Array.from(new Set(listings.filter((l) => l.type === t).map((l) => normalizeRegion(l.region || "")).filter(Boolean))).slice(0, 6);
  const eatRegions = regionsForType("eat");
  const stayRegions = regionsForType("stay");
  const tourRegions = regionsForType("tour");
  const visitRegions = regionsForType("place");
  // Phones: the destinations block starts collapsed (links stay in the DOM for
  // crawlers — only hidden visually).
  const [destOpen, setDestOpen] = useState(false);
  const destAlwaysOpen = useMinWidth(768); // md: the destinations grid is always shown

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
      <div className="pointer-events-none absolute -bottom-24 right-0 text-[19rem] font-bold leading-none tracking-[-0.12em] text-white/[0.035]">{isStay ? "revampstay." : <Wordmark title={null} className="h-[0.69em]" />}</div>
      <div className="container grid gap-x-8 gap-y-4 py-14 sm:grid-cols-2 sm:gap-y-10 lg:grid-cols-6 lg:py-16">
        <div className="pb-6 sm:col-span-2 sm:pb-0">
          <BrandMark light />
          {isStay ? (
            <>
              <p className="mt-7 max-w-md font-display text-3xl leading-tight tracking-tight text-paper">Short &amp; long-term homes in Armenia — for a week, a month, or a new chapter.</p>
              <p className="mt-5 max-w-md text-sm leading-6 text-paper/55">Furnished rentals and properties for sale for travelers, remote workers, and anyone moving to — or back to — Armenia.</p>
            </>
          ) : (
            <>
              {/* The footer's one statement is the slogan (fixed brand asset). */}
              <Slogan onDark className="mt-7 text-[2.75rem] lg:text-[3.25rem]" />
              <p className="mt-6 max-w-md text-sm leading-6 text-paper/55">{settings.homeContent.footerSubcopy?.trim() || "Curated stays, tables, and local routes across the country’s cities, forests, lakes, and southern roads."}</p>
            </>
          )}
        </div>
        {isStay ? (
          <>
            <FooterGroup title="Rent & buy">
                {FOOTER_STAY_RENT.map(([href, label]) => (
                  <Link key={label} href={href} className="hover:text-white">{label}</Link>
                ))}
            </FooterGroup>
            <FooterGroup title="Hosts & owners">
                {FOOTER_STAY_HOSTS.map(([href, label]) => (
                  <Link key={label} href={href} className="hover:text-white">{label}</Link>
                ))}
                {profile?.role === "operator" && <Link href="/dashboard" className="hover:text-white">Your dashboard</Link>}
            </FooterGroup>
            <FooterGroup title="Revamp">
                <a href="https://revampvacations.com" className="inline-flex items-center gap-1 hover:text-white">revampvacations.com <ArrowUpRight className="h-3 w-3" /></a>
                <Link href="/partners" className="hover:text-white">Partners</Link>
                <Link href="/developers" className="hover:text-white">Developers &amp; MCP</Link>
            </FooterGroup>
          </>
        ) : (
          <>
            <FooterGroup title="Explore">
                {FOOTER_EXPLORE.map(([href, label]) => (
                  <Link key={href} href={href} className="hover:text-white">{label}</Link>
                ))}
            </FooterGroup>
            <FooterGroup title="Plan">
                {FOOTER_PLAN.map(([href, label]) => (
                  <Link key={href} href={href} className="hover:text-white">{label}</Link>
                ))}
            </FooterGroup>
            <FooterGroup title="Company">
                {FOOTER_COMPANY.map(([href, label]) => (
                  <Link key={href} href={href} className="hover:text-white">{label}</Link>
                ))}
                {profile?.role === "operator" ? (
                  <>
                    <Link href="/dashboard" className="hover:text-white">Your dashboard</Link>
                    <Link href="/dashboard?section=referrals" className="hover:text-white">Refer &amp; Earn</Link>
                  </>
                ) : (
                  <Link href="/host" className="hover:text-white">Become an operator</Link>
                )}
            </FooterGroup>
          </>
        )}
        <div className="pt-4 sm:pt-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-apricot">Keep close</p>
          <div className="mt-5 flex flex-col gap-3 text-sm text-paper/70">
            <a href="mailto:hello@revampvacations.com" className="inline-flex items-center gap-2 hover:text-white"><Mail className="h-4 w-4" /> hello@revampvacations.com</a>
            <a href="https://www.instagram.com/revamphomes_yerevan/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-white"><Instagram className="h-4 w-4" /> Field notes <ArrowUpRight className="h-3 w-3" /></a>
            {telegramUrl && (
              <a href={telegramUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-white"><Send className="h-4 w-4" /> Plan on Telegram <ArrowUpRight className="h-3 w-3" /></a>
            )}
          </div>
        </div>
      </div>
      {(() => {
        // One compact "Destinations" block (was four full-width rows): crawl
        // paths into the per-region landing pages, side by side on desktop,
        // a collapsible section on phones.
        const rows = (isStay
          ? [{ title: "Where to stay", regions: stayRegions, base: "/stay", verb: "Homes in" }]
          : [
              { title: "Where to stay", regions: stayRegions, base: "/stay", verb: "Stay in" },
              { title: "Where to eat", regions: eatRegions, base: "/eat", verb: "Eat in" },
              { title: "Things to do", regions: tourRegions, base: "/tour", verb: "Tours in" },
              { title: "Where to visit", regions: visitRegions, base: "/visit", verb: "Visit" },
            ]
        ).filter((row) => row.regions.length > 0);
        if (!rows.length) return null;
        return (
          <div className="border-t border-white/10">
            <div className="container py-6 md:py-8">
              <button
                type="button"
                onClick={() => setDestOpen((o) => !o)}
                aria-expanded={destAlwaysOpen || destOpen}
                aria-controls="footer-destinations"
                className="flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-apricot md:hidden"
              >
                Destinations <ChevronDown className={cn("h-4 w-4 transition-transform", destOpen && "rotate-180")} />
              </button>
              <div id="footer-destinations" className={cn("mt-5 gap-x-8 gap-y-6 sm:grid-cols-2 md:mt-0 md:grid md:grid-cols-4", destOpen ? "grid" : "hidden")}>
                {rows.map((row) => (
                  <div key={row.base}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-paper/45">{row.title}</p>
                    <div className="mt-3 flex flex-col gap-2 text-[13px] text-paper/60">
                      {row.regions.map((r) => (
                        <Link key={r} href={`${row.base}/${slugify(r)}`} className="hover:text-white">{row.verb} {r}</Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="border-t border-white/10">
        <div className="container flex flex-col gap-4 py-5 text-[11px] text-paper/40 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Revamp Hospitality.</span>
          <div className="flex items-center gap-2">
            <PaymentMethods note={false} />
            <span className="whitespace-nowrap text-paper/40">Secured by PayLink</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-white">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
