/**
 * Operator-acquisition landing pages. /host (hub) + /host/:type (stays, tours,
 * experiences). Pitches the platform's real tools to potential operators, with
 * two CTAs: "Become an operator" (→ signup) and "Book a quick call" (an admin-set
 * scheduling link from Site content; falls back to signup when unset). Prerendered
 * for SEO. No fabricated numbers — features only.
 */
import { Link } from "wouter";
import { Check, ArrowRight, Home as HomeIcon, Compass, Sparkles, type LucideIcon } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { HOST_HUB, HOST_PAGES, findHostPage, type HostPage } from "@shared/hostLanding";
import { buildBreadcrumbJsonLd, buildFaqJsonLd } from "@shared/seo";

const TYPE_ICON: Record<HostPage["type"], LucideIcon> = { stays: HomeIcon, tours: Compass, experiences: Sparkles };

function CallToActions({ callUrl, className = "" }: { callUrl: string; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <Button asChild className="rounded-none bg-apricot text-white hover:bg-apricot/90"><Link href="/signup">Become an operator</Link></Button>
      {callUrl.startsWith("http") ? (
        <Button asChild variant="outline" className="rounded-none border-basalt/20"><a href={callUrl} target="_blank" rel="noreferrer">Book a quick call</a></Button>
      ) : (
        <Button asChild variant="outline" className="rounded-none border-basalt/20"><Link href="/signup">Book a quick call</Link></Button>
      )}
    </div>
  );
}

export default function Host({ type }: { type?: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const { settings } = useSiteSettings();
  const callUrl = settings.homeContent.operatorCallUrl?.trim() || "";
  const page = type ? findHostPage(type) : undefined;

  useDocumentMeta({
    title: page ? `${page.title} | Revamp Vacations` : "List with Revamp — Become an Operator in Armenia | Revamp Vacations",
    description: page ? page.subtitle.slice(0, 155) : HOST_HUB.intro.slice(0, 155),
    canonicalPath: page ? `/host/${page.type}` : "/host",
    noindex: !!type && !page,
    jsonLd: page
      ? [
          buildFaqJsonLd(page.faq),
          buildBreadcrumbJsonLd(origin, [
            { name: "Home", path: "/" },
            { name: "List with us", path: "/host" },
            { name: page.title, path: `/host/${page.type}` },
          ]),
        ]
      : [buildBreadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, { name: "List with us", path: "/host" }])],
  });

  // Bad type → not found.
  if (type && !page) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <div className="container py-24 text-center">
          <p className="eyebrow">Not found</p>
          <h1 className="mt-4 font-display text-5xl">That page doesn't exist.</h1>
          <Button asChild className="mt-7 rounded-none bg-apricot text-white"><Link href="/host">List with Revamp</Link></Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  // ---- Hub -----------------------------------------------------------------
  if (!page) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <main className="container py-12 lg:py-16">
          <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
            <span className="font-semibold text-basalt">List with us</span>
          </nav>
          <header className="mt-5 max-w-2xl">
            <p className="eyebrow">{HOST_HUB.eyebrow}</p>
            <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">{HOST_HUB.title}</h1>
            <p className="mt-6 text-lg leading-8 text-basalt/85">{HOST_HUB.intro}</p>
            <CallToActions callUrl={callUrl} className="mt-8" />
          </header>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {HOST_HUB.cards.map((c) => {
              const Icon = TYPE_ICON[c.type];
              return (
                <Link key={c.type} href={`/host/${c.type}`} className="group flex flex-col rounded-none border border-basalt/12 bg-paper p-6 transition-colors hover:border-apricot">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-apricot/10 text-apricot"><Icon className="h-5 w-5" /></span>
                  <h2 className="mt-4 font-display text-2xl tracking-[-0.02em]">{c.title}</h2>
                  <p className="mt-1 text-sm text-basalt/60">{c.blurb}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-apricot">Learn more <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
                </Link>
              );
            })}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  // ---- Type page -----------------------------------------------------------
  const others = HOST_PAGES.filter((p) => p.type !== page.type);
  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="border-b border-basalt/10 bg-chalk">
          <div className="container py-14 lg:py-20">
            <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
              <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
              <Link href="/host" className="hover:text-apricot">List with us</Link><span>›</span>
              <span className="font-semibold text-basalt">{page.title}</span>
            </nav>
            <div className="mt-5 max-w-3xl">
              <p className="eyebrow">{page.eyebrow}</p>
              <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">{page.title}</h1>
              <p className="mt-6 text-lg leading-8 text-basalt/80">{page.subtitle}</p>
              <CallToActions callUrl={callUrl} className="mt-8" />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="container py-14 lg:py-20">
          <h2 className="font-display text-3xl tracking-[-0.03em] sm:text-4xl">Everything you need to run it</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {page.features.map((f) => (
              <div key={f.title} className="border border-basalt/12 bg-paper p-6">
                <Check className="h-5 w-5 text-apricot" />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-basalt/65">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-basalt/10 bg-chalk/50">
          <div className="container py-14 lg:py-20">
            <h2 className="font-display text-3xl tracking-[-0.03em] sm:text-4xl">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {page.steps.map((s, i) => (
                <li key={s.title} className="border border-basalt/12 bg-paper p-6">
                  <span className="font-display text-3xl text-apricot tabular-nums">{i + 1}</span>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-basalt/65">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section className="container py-14 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl tracking-[-0.03em] sm:text-4xl">Questions, answered</h2>
              <dl className="mt-6 divide-y divide-basalt/10 border-t border-basalt/10">
                {page.faq.map((f) => (
                  <div key={f.q} className="py-4">
                    <dt className="font-semibold">{f.q}</dt>
                    <dd className="mt-1.5 text-sm leading-6 text-basalt/65">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <aside className="border border-basalt/12 bg-chalk/40 p-6 lg:sticky lg:top-[100px]">
              <h3 className="font-display text-2xl">Ready to start?</h3>
              <p className="mt-2 text-sm leading-6 text-basalt/60">Create your listing in minutes, or book a quick call and we'll walk you through it.</p>
              <CallToActions callUrl={callUrl} className="mt-5" />
              <div className="mt-6 border-t border-basalt/10 pt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">Also on Revamp</p>
                <ul className="mt-3 grid gap-2.5">
                  {others.map((o) => {
                    const OI = TYPE_ICON[o.type];
                    return (
                      <li key={o.type}>
                        <Link href={`/host/${o.type}`} className="flex items-center gap-2.5 text-sm text-basalt/75 hover:text-apricot"><OI className="h-4 w-4 shrink-0 text-apricot" /> {o.title}</Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
