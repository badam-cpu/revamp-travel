/**
 * revamp.community — the host community site (2026-10-29, migration 0125).
 * Served by the same build as revampvacations.com (Netlify domain alias); App
 * renders this instead of the travel site when useSite() === "community".
 * Off its own host (`?site=community` preview) every page is noindex.
 * Crawlers get the server-rendered twin in server/communityPages.ts.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { CommunityLockup } from "@/components/BrandMark";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { COMMUNITY_DESCRIPTION, VACATIONS_ORIGIN } from "@shared/community";
import { useGoToSection } from "./communityNav";

const CommunityHome = lazy(() => import("./CommunityHome"));
const CommunityNews = lazy(() => import("./CommunityNews"));
const CommunityNewsArticle = lazy(() => import("./CommunityNews").then((m) => ({ default: m.CommunityNewsArticle })));
const CommunityGuides = lazy(() => import("./CommunityGuides"));
const CommunityGuide = lazy(() => import("./CommunityGuides").then((m) => ({ default: m.CommunityGuide })));

const NAV: { label: string; href?: string; section?: string }[] = [
  { label: "News", href: "/news" },
  { label: "Guides", href: "/guides" },
  { label: "Meetups", section: "meetups" },
  { label: "Refer a host", section: "refer" },
];

function CommunityHeader() {
  const goTo = useGoToSection();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => setOpen(false), [location]);
  const linkClass = "inline-flex min-h-11 items-center text-[15px] font-semibold text-basalt hover:text-apricot";
  const items = NAV.map((n) =>
    n.href ? (
      <Link key={n.label} href={n.href} className={linkClass}>
        {n.label}
      </Link>
    ) : (
      <button key={n.label} type="button" onClick={() => { setOpen(false); goTo(n.section!); }} className={linkClass}>
        {n.label}
      </button>
    ),
  );
  return (
    <header className="sticky top-0 z-40 border-b border-basalt/10 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/" className="rounded-md text-apricot focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-apricot" aria-label="revamp community home">
          <CommunityLockup title={null} className="h-6 sm:h-7" />
        </Link>
        <nav aria-label="Main" className="ml-4 hidden flex-1 items-center gap-7 md:flex">
          {items}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => goTo("join")} className="hidden h-11 items-center rounded-full bg-basalt px-5 text-[15px] font-bold text-paper hover:bg-basalt/90 sm:inline-flex">
            Join the community
          </button>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-basalt/15 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Main" className="flex flex-col border-t border-basalt/10 px-4 pb-4 md:hidden">
          {items}
          <button type="button" onClick={() => { setOpen(false); goTo("join"); }} className="mt-2 inline-flex h-12 items-center justify-center rounded-full bg-basalt text-base font-bold text-paper">
            Join the community
          </button>
        </nav>
      )}
    </header>
  );
}

function CommunityFooter() {
  return (
    <footer className="bg-basalt text-paper">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <CommunityLockup title="revamp community" className="h-7 text-paper" />
          <p className="mt-5 max-w-sm text-sm leading-6 text-paper/65">{COMMUNITY_DESCRIPTION}</p>
        </div>
        <nav aria-label="Community" className="flex flex-col items-start text-sm">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-apricot">Community</p>
          <Link href="/news" className="inline-flex min-h-11 items-center text-paper/75 hover:text-white">News for hosts</Link>
          <Link href="/guides" className="inline-flex min-h-11 items-center text-paper/75 hover:text-white">Guides</Link>
          <a href="mailto:hello@revampvacations.com" className="inline-flex min-h-11 items-center text-paper/75 hover:text-white">hello@revampvacations.com</a>
        </nav>
        <nav aria-label="Revamp" className="flex flex-col items-start text-sm">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-apricot">Revamp</p>
          <a href={`${VACATIONS_ORIGIN}/host`} className="inline-flex items-center gap-1 min-h-11 text-paper/75 hover:text-white">Host on Revamp <ArrowUpRight className="h-3 w-3" /></a>
          <a href={VACATIONS_ORIGIN} className="inline-flex items-center gap-1 min-h-11 text-paper/75 hover:text-white">revampvacations.com <ArrowUpRight className="h-3 w-3" /></a>
          <a href={`${VACATIONS_ORIGIN}/privacy#community`} className="inline-flex items-center gap-1 min-h-11 text-paper/75 hover:text-white">Privacy policy <ArrowUpRight className="h-3 w-3" /></a>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-[1240px] px-4 py-5 text-xs text-paper/50 sm:px-6">© 2026 Revamp Hospitality LLC · Yerevan, Armenia</p>
      </div>
    </footer>
  );
}

/** Legal pages live on revampvacations.com (the cookie banner links to /privacy). */
function ToVacations({ path }: { path: string }) {
  useEffect(() => {
    window.location.replace(`${VACATIONS_ORIGIN}${path}`);
  }, [path]);
  return <div className="min-h-[60vh]" />;
}

function CommunityNotFound() {
  useDocumentMeta({ title: "Page not found — revamp community", description: COMMUNITY_DESCRIPTION, canonicalPath: "/", noindex: true });
  return (
    <section className="mx-auto max-w-[880px] px-4 py-24 text-center sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">We couldn't find that page.</h1>
      <p className="mt-4 text-lg text-basalt/70">It may have moved. The latest news and guides are on the home page.</p>
      <Link href="/" className="mt-8 inline-flex h-12 items-center rounded-full bg-basalt px-6 font-bold text-paper">Back to revamp community</Link>
    </section>
  );
}

export default function CommunityApp() {
  return (
    <div className="community-site flex min-h-screen flex-col bg-paper font-sans text-basalt">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-basalt focus:px-5 focus:py-3 focus:text-[15px] focus:font-bold focus:text-paper">
        Skip to content
      </a>
      <CommunityHeader />
      <main id="main" className="flex-1 scroll-mt-20">
        <Suspense fallback={<div className="min-h-[60vh]" />}>
          <Switch>
            <Route path="/" component={CommunityHome} />
            <Route path="/news" component={CommunityNews} />
            <Route path="/news/:slug" component={CommunityNewsArticle} />
            <Route path="/guides" component={CommunityGuides} />
            <Route path="/guides/:slug" component={CommunityGuide} />
            <Route path="/privacy">{() => <ToVacations path="/privacy#community" />}</Route>
            <Route path="/terms">{() => <ToVacations path="/terms" />}</Route>
            <Route component={CommunityNotFound} />
          </Switch>
        </Suspense>
      </main>
      <CommunityFooter />
    </div>
  );
}
