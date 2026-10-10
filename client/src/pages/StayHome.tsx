/**
 * revampstay.com home page. Rendered at "/" when useSite() === "stay" (see
 * App.tsx). Same brand system as revampvacations (lowercase wordmark via
 * BrandMark, apricot/basalt/paper/chalk, rounded-none geometry) but positioned
 * for short + long-term rentals and sales — the look agreed in the mockup.
 *
 * "Homes ready now" reads the real catalog via publicListings (on the stay site
 * that's every published stay). Everything else is static positioning content.
 */
import { Link } from "wouter";
import { Search, FileSignature, Video, Compass, ArrowRight, Wifi, Home as HomeIcon } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ListingCard } from "@/components/ListingCard";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";
import { Button } from "@/components/ui/button";
import { useListings } from "@/contexts/ListingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { isStayHost } from "@/contexts/SiteContext";

const AUDIENCES = [
  { emoji: "🧑‍💻", title: "Remote workers & nomads", body: "Fast Wi-Fi, a real desk, and monthly rates. Land, plug in, and work — residency help if you stay." },
  { emoji: "✈️", title: "Relocators & expats", body: "Move-in-ready homes, clear leases, and someone local to call when the boiler acts up." },
  { emoji: "🇦🇲", title: "Coming home", body: "For the diaspora moving back — neighborhoods, schools, and the paperwork, sorted before you land." },
] as const;

const NEIGHBORHOODS = [
  { name: "Kentron", blurb: "Central, walkable, café life", from: "from ֏400k/mo", grad: "linear-gradient(135deg,#2d2b28,#44403a)" },
  { name: "Arabkir", blurb: "Leafy, residential, families", from: "from ֏320k/mo", grad: "linear-gradient(135deg,#8a4b2e,#c4703f)" },
  { name: "Davtashen", blurb: "Quiet, green, better value", from: "from ֏250k/mo", grad: "linear-gradient(135deg,#3a4a3f,#5f7a64)" },
  { name: "Cascade / Opera", blurb: "Culture, views, premium", from: "from ֏500k/mo", grad: "linear-gradient(135deg,#55506b,#7b7498)" },
] as const;

const CONCIERGE = [
  { icon: Video, title: "Video viewings", body: "Tour the place by video before you commit — no sight-unseen gamble from abroad." },
  { icon: FileSignature, title: "Leases & deposits", body: "A clear digital rental agreement and a secure deposit — signed and paid online." },
  { icon: Compass, title: "Relocation help", body: "SIM card, bank account, residency, airport pickup — optional add-ons when you land." },
] as const;

export default function StayHome() {
  const { publicListings: listings, loading } = useListings();
  const homes = listings.filter((l) => l.type === "stay").slice(0, 6);

  useDocumentMeta({
    title: "Revamp Stay — Rent or Buy a Home in Armenia",
    description:
      "Furnished, verified homes in Armenia for a week, a month, or a year — plus properties for sale. Short-term and long-term rentals for travelers, remote workers, relocators, and the diaspora coming home.",
    canonicalPath: "/",
    // Only index on the real revampstay host; a `?site=stay` preview on any
    // other host stays out of the index.
    noindex: !isStayHost(),
  });

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main>
        {/* HERO */}
        <section className="bg-chalk">
          <div className="container py-16 md:py-20">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-apricot">Short-term &amp; long-term rentals · Armenia</p>
            <h1 className="mt-5 max-w-3xl font-display text-5xl leading-[1.02] tracking-[-0.035em] text-basalt md:text-6xl">
              Stay in Armenia — for a week, a month, or a year.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-7 text-basalt/60">
              Furnished, verified homes for travelers, remote workers, and anyone moving to — or back to — Armenia. Book a night or sign a lease, all in one place.
            </p>

            {/* search card — links into the stay catalog (full offer-filtering comes next) */}
            <div className="mt-9 max-w-3xl rounded-none border border-basalt/10 bg-paper p-3 shadow-sm">
              <div className="mb-3 inline-flex rounded-none bg-chalk p-1 text-sm font-semibold">
                <span className="rounded-none bg-paper px-5 py-2 text-basalt shadow-sm">Long-term</span>
                <span className="px-5 py-2 text-basalt/50">Short-term</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1 rounded-none bg-chalk px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-basalt/50">Where</p>
                  <p className="text-sm text-basalt/80">Yerevan · Kentron</p>
                </div>
                <div className="flex-1 rounded-none bg-chalk px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-basalt/50">Move in · Length</p>
                  <p className="text-sm text-basalt/80">Flexible · 3+ months</p>
                </div>
                <Button asChild className="h-auto rounded-none bg-apricot px-7 text-sm font-bold text-paper hover:bg-apricot/90">
                  <Link href="/explore/stay"><Search className="mr-2 h-4 w-4" /> Search</Link>
                </Button>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] font-medium text-basalt/55">
              <span>✓ Furnished &amp; move-in ready</span>
              <span>✓ Video tours</span>
              <span>✓ Flexible leases &amp; deposits</span>
              <span>✓ Local support on the ground</span>
            </div>
          </div>
        </section>

        {/* HOMES READY NOW — real catalog */}
        <section className="container py-16">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-3xl tracking-[-0.03em] text-basalt">Homes ready now</h2>
            <Link href="/explore/stay" className="text-sm font-semibold text-apricot hover:underline">View all →</Link>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <ListingCardSkeleton key={i} />)
              : homes.length
                ? homes.map((l) => <ListingCard key={l.id} listing={l} surface="stay-home" />)
                : <p className="col-span-full py-10 text-center text-basalt/50">No homes published yet — operators can list one from their dashboard.</p>}
          </div>
        </section>

        {/* WHO IT'S FOR */}
        <section className="bg-basalt text-paper">
          <div className="container py-16">
            <h2 className="font-display text-3xl tracking-[-0.03em]">Built for people who stay a while</h2>
            <div className="mt-9 grid gap-6 md:grid-cols-3">
              {AUDIENCES.map((a) => (
                <div key={a.title} className="rounded-none border border-white/10 p-6">
                  <p className="text-2xl">{a.emoji}</p>
                  <p className="mt-3 font-semibold">{a.title}</p>
                  <p className="mt-2 text-sm leading-6 text-paper/60">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* NEIGHBORHOODS */}
        <section className="container py-16">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-3xl tracking-[-0.03em] text-basalt">Where to live in Yerevan</h2>
              <p className="mt-2 max-w-md text-basalt/55">Pick the neighborhood before the apartment. Vibe, cost, and what's walkable.</p>
            </div>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {NEIGHBORHOODS.map((n) => (
              <Link key={n.name} href="/explore/stay" className="group overflow-hidden rounded-none border border-basalt/10">
                <div className="flex h-36 items-end p-4 transition group-hover:brightness-110" style={{ background: n.grad }}>
                  <span className="text-lg font-semibold text-paper">{n.name}</span>
                </div>
                <div className="bg-paper p-4">
                  <p className="text-xs text-basalt/55">{n.blurb}</p>
                  <p className="mt-1 text-sm font-semibold text-basalt">{n.from}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* MORE THAN A LISTING */}
        <section className="bg-chalk">
          <div className="container py-16">
            <h2 className="font-display text-3xl tracking-[-0.03em] text-basalt">More than a listing</h2>
            <p className="mt-2 max-w-lg text-basalt/55">The hard parts of a long stay, handled.</p>
            <div className="mt-9 grid gap-6 md:grid-cols-3">
              {CONCIERGE.map((c) => (
                <div key={c.title} className="rounded-none bg-paper p-6">
                  <c.icon className="h-5 w-5 text-apricot" />
                  <p className="mt-3 font-semibold text-basalt">{c.title}</p>
                  <p className="mt-2 text-sm leading-6 text-basalt/60">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOST CTA */}
        <section className="container py-16">
          <div className="rounded-none bg-apricot px-8 py-12 text-center md:px-16">
            <h2 className="mx-auto max-w-2xl font-display text-3xl leading-tight tracking-[-0.03em] text-paper md:text-4xl">
              Have a place? List it once — reach guests and long-stay tenants.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-paper/85">
              One listing, both markets. Set it for nights, months, or both — we bring the demand and handle the leases.
            </p>
            <Button asChild className="mt-7 rounded-none bg-basalt px-7 text-sm font-semibold text-paper hover:bg-basalt/90">
              <Link href="/host"><HomeIcon className="mr-2 h-4 w-4" /> List your place</Link>
            </Button>
          </div>
        </section>

        {/* CROSS-LINK */}
        <section className="border-y border-basalt/10 bg-chalk">
          <div className="container flex flex-col items-center justify-between gap-4 py-8 sm:flex-row">
            <p className="text-sm text-basalt/70">Here for a visit, not a move? Explore tours, tables &amp; experiences across Armenia.</p>
            <a href="https://revampvacations.com" className="inline-flex items-center gap-2 rounded-none border border-basalt/20 px-5 py-2.5 text-sm font-semibold text-basalt hover:border-apricot hover:text-apricot">
              Open revampvacations.com <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
