/**
 * Armenia travel-essentials guides. Two modes in one file:
 *   /guide         → the hub (cards for every topic)
 *   /guide/:slug   → one article (visa, currency, transport, …)
 * Content is static (shared/guides.ts); emits Article + FAQPage + BreadcrumbList
 * JSON-LD and is prerendered for crawlers. Cross-links into Explore/Plan so the
 * evergreen traffic flows into the marketplace.
 */
import { Link } from "wouter";
import { Plane, Wallet, Bus, Sun, CalendarDays, Phone, ArrowRight, ExternalLink, type LucideIcon } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { GUIDES, GUIDE_HUB, findGuide, type Guide } from "@shared/guides";
import { buildFaqJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";

const ICONS: Record<Guide["icon"], LucideIcon> = {
  visa: Plane,
  currency: Wallet,
  transport: Bus,
  seasons: Sun,
  holidays: CalendarDays,
  emergency: Phone,
};

export default function Guide({ slug }: { slug?: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const guide = slug ? findGuide(slug) : undefined;

  // ---- Article JSON-LD (built inline; Article isn't blog-specific) ----------
  const articleJsonLd = guide
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: guide.title,
        description: guide.summary,
        url: `${origin}/guide/${guide.slug}`,
        mainEntityOfPage: `${origin}/guide/${guide.slug}`,
        dateModified: guide.updated,
        inLanguage: "en",
        publisher: { "@type": "Organization", name: "Revamp Vacations" },
        about: { "@type": "Country", name: "Armenia" },
      }
    : null;

  useDocumentMeta({
    title: guide ? `${guide.title} | Revamp Vacations` : "Armenia Travel Essentials — Visa, Money, Transport & More | Revamp Vacations",
    description: guide ? guide.summary.slice(0, 155) : GUIDE_HUB.intro.slice(0, 155),
    canonicalPath: guide ? `/guide/${guide.slug}` : "/guide",
    noindex: !!slug && !guide,
    jsonLd: guide
      ? [
          articleJsonLd!,
          buildFaqJsonLd(guide.faq),
          buildBreadcrumbJsonLd(origin, [
            { name: "Home", path: "/" },
            { name: "Travel guide", path: "/guide" },
            { name: guide.cardTitle, path: `/guide/${guide.slug}` },
          ]),
        ]
      : [buildBreadcrumbJsonLd(origin, [
          { name: "Home", path: "/" },
          { name: "Travel guide", path: "/guide" },
        ])],
  });

  // ---- Not found (bad slug) -------------------------------------------------
  if (slug && !guide) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <div className="container py-24 text-center">
          <p className="eyebrow">Not found</p>
          <h1 className="mt-4 font-display text-5xl">We don't have that guide yet.</h1>
          <Button asChild className="mt-7 rounded-none bg-apricot text-white"><Link href="/guide">All travel essentials</Link></Button>
        </div>
        <SiteFooter />
      </div>
    );
  }

  // ---- Hub -----------------------------------------------------------------
  if (!guide) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <main className="container py-10 lg:py-14">
          <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
            <span className="font-semibold text-basalt">Travel guide</span>
          </nav>
          <header className="mt-5 max-w-2xl">
            <p className="eyebrow">{GUIDE_HUB.eyebrow}</p>
            <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">{GUIDE_HUB.title}</h1>
            <p className="mt-6 text-lg leading-8 text-basalt/85">{GUIDE_HUB.intro}</p>
          </header>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDES.map((g) => {
              const Icon = ICONS[g.icon];
              return (
                <Link key={g.slug} href={`/guide/${g.slug}`} className="group flex flex-col rounded-none border border-basalt/12 bg-paper p-6 transition-colors hover:border-apricot">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-apricot/10 text-apricot"><Icon className="h-5 w-5" /></span>
                  <h2 className="mt-4 font-display text-2xl tracking-[-0.02em]">{g.cardTitle}</h2>
                  <p className="mt-1 text-sm text-basalt/60">{g.cardBlurb}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-apricot">Read <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
                </Link>
              );
            })}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  // ---- Article -------------------------------------------------------------
  const Icon = ICONS[guide.icon];
  const others = GUIDES.filter((g) => g.slug !== guide.slug);
  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-8 lg:py-12">
        <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-apricot">Home</Link><span>›</span>
          <Link href="/guide" className="hover:text-apricot">Travel guide</Link><span>›</span>
          <span className="font-semibold text-basalt">{guide.cardTitle}</span>
        </nav>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <article className="max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-apricot/10 text-apricot"><Icon className="h-5 w-5" /></span>
              <p className="eyebrow">{guide.eyebrow}</p>
            </div>
            <h1 className="mt-4 font-display text-[2.75rem] leading-[0.98] tracking-[-0.04em] sm:text-5xl">{guide.title}</h1>
            <p className="mt-5 text-lg leading-8 text-basalt/85">{guide.summary}</p>

            {guide.sections.map((s, i) => (
              <section key={i} className="mt-9">
                {s.heading && <h2 className="font-display text-2xl tracking-[-0.02em]">{s.heading}</h2>}
                {s.body?.map((p, j) => <p key={j} className="mt-3 text-base leading-7 text-basalt/75">{p}</p>)}
                {s.bullets && (
                  <ul className="mt-3 grid gap-2.5">
                    {s.bullets.map((b, j) => (
                      <li key={j} className="flex gap-2.5 text-base leading-7 text-basalt/75">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-apricot" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {/* FAQ */}
            <section className="mt-12">
              <h2 className="font-display text-3xl tracking-[-0.03em]">Good to know</h2>
              <dl className="mt-5 divide-y divide-basalt/10 border-t border-basalt/10">
                {guide.faq.map((f, i) => (
                  <div key={i} className="py-4">
                    <dt className="font-semibold">{f.q}</dt>
                    <dd className="mt-1.5 text-sm leading-6 text-basalt/65">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {guide.sources && guide.sources.length > 0 && (
              <p className="mt-8 text-sm text-basalt/55">
                Official sources:{" "}
                {guide.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && " · "}
                    <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-apricot hover:underline">{s.label} <ExternalLink className="h-3 w-3" /></a>
                  </span>
                ))}
              </p>
            )}
          </article>

          {/* Sidebar: other guides + a soft CTA into the marketplace */}
          <aside className="lg:sticky lg:top-[100px] lg:self-start">
            <div className="border border-basalt/12 bg-chalk/40 p-6">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">More essentials</p>
              <ul className="mt-3 grid gap-2.5">
                {others.map((g) => {
                  const OI = ICONS[g.icon];
                  return (
                    <li key={g.slug}>
                      <Link href={`/guide/${g.slug}`} className="flex items-center gap-2.5 text-sm text-basalt/75 hover:text-apricot">
                        <OI className="h-4 w-4 shrink-0 text-apricot" /> {g.cardTitle}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-6 border-t border-basalt/10 pt-5">
                <p className="text-sm font-semibold">Ready to plan?</p>
                <p className="mt-1 text-xs leading-5 text-basalt/55">Turn the essentials into a trip — browse stays and experiences, or let the AI planner draft an itinerary.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" className="rounded-none bg-apricot text-white"><Link href="/explore">Browse</Link></Button>
                  <Button asChild size="sm" variant="outline" className="rounded-none border-basalt/20"><Link href="/plan">AI planner</Link></Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
