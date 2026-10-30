/**
 * revamp.community — the host community site (2026-10-29, migration 0125).
 * Served by the same build as revampvacations.com (Netlify domain alias); App
 * renders this instead of the travel site when useSite() === "community".
 * Off its own host (`?site=community` preview) every page is noindex.
 * Crawlers get the server-rendered twin in server/communityPages.ts.
 *
 * English at /, Armenian at /hy (migration 0131): the whole site runs inside a
 * wouter Router with base "/hy", so every in-site link stays in its language;
 * the header's switch uses "~/…" to step outside the base.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { CommunityLockup } from "@/components/BrandMark";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { LANG_NAMES, VACATIONS_ORIGIN } from "@shared/community";
import { useGoToSection } from "./communityNav";
import { CommunityLangProvider, langPath, useCommunityLang } from "./communityLang";

const CommunityHome = lazy(() => import("./CommunityHome"));
const CommunityNews = lazy(() => import("./CommunityNews"));
const CommunityNewsArticle = lazy(() => import("./CommunityNews").then((m) => ({ default: m.CommunityNewsArticle })));
const CommunityGuides = lazy(() => import("./CommunityGuides"));
const CommunityGuide = lazy(() => import("./CommunityGuides").then((m) => ({ default: m.CommunityGuide })));

const NAV: { label: string; href?: string; section?: string }[] = [
  { label: "nav.news", href: "/news" },
  { label: "nav.guides", href: "/guides" },
  { label: "nav.meetups", section: "meetups" },
  { label: "nav.refer", section: "refer" },
];

const LANGS = [
  { code: "hy", short: "ՀԱՅ" },
  { code: "en", short: "ENG" },
] as const;

/** Language dropdown: same page in the other language. */
function LangSwitch() {
  const { lang } = useCommunityLang();
  const [location, navigate] = useLocation();
  // Focus returns to the button only for keyboard users; after a click it would light up the focus ring.
  const usedKeyboard = useRef(false);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger aria-label={LANG_NAMES[lang]} className="community-lang group inline-flex h-11 items-center gap-0.5 rounded-full px-1.5 text-[15px] font-semibold text-basalt hover:text-apricot data-[state=open]:text-apricot sm:px-2.5">
        {LANGS.find((l) => l.code === lang)!.short}
        <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onKeyDown={() => { usedKeyboard.current = true; }}
        onCloseAutoFocus={(e) => {
          if (!usedKeyboard.current) e.preventDefault();
          usedKeyboard.current = false;
        }}
        className="min-w-[5.5rem] rounded-xl border-basalt/10 bg-paper p-1 font-sans text-basalt shadow-sm"
      >
        {LANGS.map(({ code, short }) => (
          <DropdownMenuItem
            key={code}
            lang={code}
            aria-label={LANG_NAMES[code]}
            aria-current={code === lang ? "true" : undefined}
            onSelect={() => navigate(`~${code === "hy" ? langPath("hy", location) : location}`)}
            className={`min-h-10 cursor-pointer justify-center rounded-lg px-3 text-[15px] font-semibold focus:bg-basalt/5 ${code === lang ? "text-apricot focus:text-apricot" : "text-basalt focus:text-basalt"}`}
          >
            {short}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommunityHeader() {
  const { t } = useCommunityLang();
  const goTo = useGoToSection();
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => setOpen(false), [location]);
  const linkClass = "inline-flex min-h-11 items-center whitespace-nowrap text-[15px] font-semibold text-basalt hover:text-apricot";
  const items = NAV.map((n) =>
    n.href ? (
      <Link key={n.label} href={n.href} className={linkClass}>
        {t(n.label)}
      </Link>
    ) : (
      <button key={n.label} type="button" onClick={() => { setOpen(false); goTo(n.section!); }} className={linkClass}>
        {t(n.label)}
      </button>
    ),
  );
  return (
    <header className="sticky top-0 z-40 border-b border-basalt/10 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-2 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/" className="shrink-0 rounded-md text-apricot focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-apricot" aria-label={t("nav.home")}>
          <CommunityLockup title={null} className="h-4 min-[360px]:h-5 sm:h-7" />
        </Link>
        <nav aria-label="Main" className="ml-4 hidden min-w-0 flex-1 items-center gap-7 xl:flex">
          {items}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <LangSwitch />
          <button type="button" onClick={() => goTo("join")} className="hidden h-11 items-center whitespace-nowrap rounded-full bg-basalt px-5 text-[15px] font-bold text-paper hover:bg-basalt/90 md:inline-flex">
            {t("cta.join")}
          </button>
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-basalt/15 xl:hidden" aria-label={t(open ? "nav.closeMenu" : "nav.openMenu")} aria-expanded={open}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Main" className="flex flex-col border-t border-basalt/10 px-4 pb-4 xl:hidden">
          {items}
          <button type="button" onClick={() => { setOpen(false); goTo("join"); }} className="mt-2 inline-flex h-12 items-center justify-center rounded-full bg-basalt text-base font-bold text-paper">
            {t("cta.join")}
          </button>
        </nav>
      )}
    </header>
  );
}

function CommunityFooter() {
  const { t } = useCommunityLang();
  return (
    <footer className="bg-basalt text-paper">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <CommunityLockup title="revamp community" className="h-7 text-paper" />
          <p className="mt-5 max-w-sm text-sm leading-6 text-paper/65">{t("meta.description")}</p>
        </div>
        <nav aria-label="Community" className="flex flex-col items-start text-sm">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-apricot">{t("footer.community")}</p>
          <Link href="/news" className="inline-flex min-h-11 items-center text-paper/75 hover:text-white">{t("footer.newsForHosts")}</Link>
          <Link href="/guides" className="inline-flex min-h-11 items-center text-paper/75 hover:text-white">{t("nav.guides")}</Link>
          <a href="mailto:hello@revampvacations.com" className="inline-flex min-h-11 items-center text-paper/75 hover:text-white">hello@revampvacations.com</a>
        </nav>
        <nav aria-label="Revamp" className="flex flex-col items-start text-sm">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-apricot">Revamp</p>
          <a href={`${VACATIONS_ORIGIN}/host`} className="inline-flex items-center gap-1 min-h-11 text-paper/75 hover:text-white">{t("footer.hostOnRevamp")} <ArrowUpRight className="h-3 w-3" /></a>
          <a href={VACATIONS_ORIGIN} className="inline-flex items-center gap-1 min-h-11 text-paper/75 hover:text-white">revampvacations.com <ArrowUpRight className="h-3 w-3" /></a>
          <a href={`${VACATIONS_ORIGIN}/privacy#community`} className="inline-flex items-center gap-1 min-h-11 text-paper/75 hover:text-white">{t("footer.privacy")} <ArrowUpRight className="h-3 w-3" /></a>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-[1240px] px-4 py-5 text-xs text-paper/50 sm:px-6">{t("footer.copyright")}</p>
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
  const { t, path } = useCommunityLang();
  useDocumentMeta({ title: t("meta.notFoundTitle"), description: t("meta.description"), canonicalPath: path("/"), noindex: true });
  return (
    <section className="mx-auto max-w-[880px] px-4 py-24 text-center sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">{t("notFound.title")}</h1>
      <p className="mt-4 text-lg text-basalt/70">{t("notFound.body")}</p>
      <Link href="/" className="mt-8 inline-flex h-12 items-center rounded-full bg-basalt px-6 font-bold text-paper">{t("notFound.back")}</Link>
    </section>
  );
}

function CommunitySite() {
  const { lang, t } = useCommunityLang();
  const [location] = useLocation();
  // The language of the page + links between the two versions, for browsers and search engines.
  useEffect(() => {
    document.documentElement.lang = lang;
    const set = (hreflang: string, href: string) => {
      let el = document.head.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${hreflang}"]`);
      if (!el) {
        el = document.createElement("link");
        el.rel = "alternate";
        el.hreflang = hreflang;
        document.head.appendChild(el);
      }
      el.href = href;
    };
    set("en", `${window.location.origin}${location}`);
    set("hy", `${window.location.origin}${langPath("hy", location)}`);
    set("x-default", `${window.location.origin}${location}`);
  }, [lang, location]);
  return (
    <div className="community-site flex min-h-screen flex-col bg-paper font-sans text-basalt">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-basalt focus:px-5 focus:py-3 focus:text-[15px] focus:font-bold focus:text-paper">
        {t("nav.skip")}
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

export default function CommunityApp() {
  const [location] = useLocation();
  const lang = location === "/hy" || location.startsWith("/hy/") ? "hy" : "en";
  return (
    <CommunityLangProvider lang={lang}>
      <Router base={lang === "hy" ? "/hy" : ""}>
        <CommunitySite />
      </Router>
    </CommunityLangProvider>
  );
}
