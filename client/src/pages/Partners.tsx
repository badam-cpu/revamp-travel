/**
 * /partners — a trust page with two parts:
 *   1. Hosts & operators: every operator with a published listing, derived live
 *      from the catalog (useListings) + their public profile (name/logo). Admin-
 *      pinned "featured" operators (settings.homeContent.featuredOperatorIds)
 *      show first ("big names first"), the rest alphabetical.
 *   2. Services we use: an admin-editable strip (settings.homeContent.partners,
 *      falling back to DEFAULT_SERVICE_PARTNERS). Name + factual blurb only — no
 *      third-party logos (permission), per the "no fabricated endorsement" rule.
 * SEO is client-rendered here (useDocumentMeta); non-JS crawlers get the mirror
 * in server/prerender.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useListings } from "@/contexts/ListingsContext";
import { useSiteSettings, DEFAULT_SERVICE_PARTNERS } from "@/contexts/SiteSettingsContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { supabase } from "@/lib/supabase";
import { typeLabels } from "@shared/listings";
import { buildBreadcrumbJsonLd } from "@shared/seo";
import { ArrowUpRight, ExternalLink } from "lucide-react";

interface OperatorCard {
  id: string;
  name: string;
  logo: string | null;
  counts: Record<string, number>;
  listings: { slug: string; title: string }[];
}

export default function Partners() {
  const { listings } = useListings();
  const { settings } = useSiteSettings();
  const [profiles, setProfiles] = useState<Record<string, { name: string; logo: string | null; role: string | null }>>({});

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  useDocumentMeta({
    title: "Partners — Hosts & services | Revamp Vacations",
    description:
      "The hosts, guides, and businesses behind Revamp Vacations — every operator with a published stay, tour, or experience in Armenia — plus the services that power the platform.",
    canonicalPath: "/partners",
    jsonLd: buildBreadcrumbJsonLd(origin, [
      { name: "Home", path: "/" },
      { name: "Partners", path: "/partners" },
    ]),
  });

  // Distinct operators from the published catalog, with per-type counts and a
  // few listings each (the context already returns only published rows to a
  // signed-out visitor; a signed-in operator/admin might see extras, harmless).
  const operators = useMemo<OperatorCard[]>(() => {
    const map = new Map<string, OperatorCard>();
    for (const l of listings) {
      const id = (l as { operatorId?: string }).operatorId;
      if (!id || id === "seed") continue;
      // "Eat" listings are Revamp's free, admin-curated restaurant guide — not
      // operator-run inventory — so they don't count toward "Hosts & operators"
      // (and keep the admin/curator account out of this public list).
      if (l.type === "eat") continue;
      const entry = map.get(id) ?? { id, name: "", logo: null, counts: {}, listings: [] };
      entry.counts[l.type] = (entry.counts[l.type] ?? 0) + 1;
      if (entry.listings.length < 4) entry.listings.push({ slug: l.slug, title: l.title });
      map.set(id, entry);
    }
    return Array.from(map.values());
  }, [listings]);

  // Fetch operator display names + logos in one query (profiles are public).
  useEffect(() => {
    const ids = operators.map((o) => o.id);
    if (!ids.length) return;
    let active = true;
    // select("*") stays resilient if logo_url (0037) isn't added yet.
    supabase
      .from("profiles")
      .select("*")
      .in("id", ids)
      .then(({ data }) => {
        if (!active || !data) return;
        const next: Record<string, { name: string; logo: string | null; role: string | null }> = {};
        for (const p of data) {
          const row = p as { id: string; business_name?: string | null; display_name?: string | null; logo_url?: string | null; role?: string | null };
          next[row.id] = { name: row.business_name || row.display_name || "Host", logo: row.logo_url ?? null, role: row.role ?? null };
        }
        setProfiles(next);
      });
    return () => {
      active = false;
    };
  }, [operators]);

  const featuredIds = settings.homeContent.featuredOperatorIds ?? [];
  const ordered = useMemo(() => {
    const withNames = operators
      // Never surface an admin account publicly, even if it owns a stay/tour.
      .filter((o) => profiles[o.id]?.role !== "admin")
      .map((o) => ({ ...o, name: profiles[o.id]?.name ?? o.name, logo: profiles[o.id]?.logo ?? null }));
    const rank = (id: string) => {
      const i = featuredIds.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return withNames.sort((a, b) => {
      const ra = rank(a.id);
      const rb = rank(b.id);
      if (ra !== rb) return ra - rb;
      return (a.name || "z").localeCompare(b.name || "z");
    });
  }, [operators, profiles, featuredIds]);

  const services = settings.homeContent.partners?.filter((p) => p.name?.trim()) ?? DEFAULT_SERVICE_PARTNERS;

  const countLabel = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([type, n]) => `${n} ${n === 1 ? typeLabels[type as keyof typeof typeLabels] ?? type : `${typeLabels[type as keyof typeof typeLabels] ?? type}s`}`)
      .join(" · ");

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="border-b border-basalt/10 bg-chalk">
          <div className="container py-14 lg:py-20">
            <p className="eyebrow">The people & tools behind Revamp</p>
            <h1 className="mt-3 max-w-3xl font-display text-5xl leading-[1.02] tracking-[-0.04em] lg:text-6xl">Our partners.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-basalt/60">
              Every stay, tour, and experience on Revamp is run by a real, independent host in Armenia. Meet the operators building the marketplace — and the services that keep it running.
            </p>
          </div>
        </section>

        {/* Operators */}
        <section className="container py-14 lg:py-20">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Hosts & operators</p>
              <h2 className="mt-3 font-display text-4xl tracking-[-0.03em]">{ordered.length > 0 ? `${ordered.length} ${ordered.length === 1 ? "operator" : "operators"} and counting.` : "Our operators."}</h2>
            </div>
            <Link href="/signup" className="hidden shrink-0 text-xs font-bold uppercase tracking-[0.15em] text-apricot hover:underline sm:block">
              Become an operator
            </Link>
          </div>

          {ordered.length === 0 ? (
            <p className="mt-8 text-sm text-basalt/50">Operators will appear here as listings go live.</p>
          ) : (
            <ul className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {ordered.map((op) => (
                <li key={op.id} className="flex h-full flex-col rounded-none border border-basalt/12 bg-paper p-5">
                  <div className="flex items-center gap-3">
                    {op.logo ? (
                      <img src={op.logo} alt="" className="h-12 w-12 shrink-0 rounded-full border border-basalt/10 object-cover" />
                    ) : (
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-apricot/10 text-lg font-bold text-apricot">{(op.name || "H").slice(0, 1).toUpperCase()}</div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg leading-tight">{op.name || "Host"}</p>
                      <p className="truncate text-xs text-basalt/45">{countLabel(op.counts)}</p>
                    </div>
                  </div>
                  {op.listings.length > 0 && (
                    <ul className="mt-4 space-y-1.5 border-t border-basalt/8 pt-4">
                      {op.listings.map((l) => (
                        <li key={l.slug}>
                          <Link href={`/listing/${l.slug}`} className="group inline-flex items-center gap-1 text-sm text-basalt/70 hover:text-apricot">
                            <span className="truncate">{l.title}</span>
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Services we use */}
        {services.length > 0 && (
          <section className="border-t border-basalt/10 bg-chalk">
            <div className="container py-14 lg:py-20">
              <p className="eyebrow">Services we use</p>
              <h2 className="mt-3 font-display text-4xl tracking-[-0.03em]">The tools that power Revamp.</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-basalt/60">The trusted services we rely on to run bookings, payments, and communication safely.</p>
              <ul className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((s) => (
                  <li key={s.name} className="rounded-none border border-basalt/12 bg-paper p-6">
                    {s.logo ? (
                      <img src={s.logo} alt={s.name} className="mb-3 h-10 w-auto max-w-[160px] object-contain" />
                    ) : null}
                    <p className="font-display text-xl leading-tight">{s.name}</p>
                    <p className="mt-2 text-sm leading-6 text-basalt/60">{s.blurb}</p>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-apricot hover:underline">
                        Visit <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="container py-16 text-center lg:py-20">
          <h2 className="mx-auto max-w-2xl font-display text-3xl tracking-[-0.03em] lg:text-4xl">Run a stay, tour, or experience in Armenia?</h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-basalt/60">List with Revamp and reach travelers planning their trip — through search, our map, and AI trip planners.</p>
          <Link href="/signup" className="mt-7 inline-flex items-center gap-2 rounded-none bg-apricot px-7 py-3 text-sm font-bold text-white hover:bg-apricot/90">
            Become an operator <ArrowUpRight className="h-4 w-4" />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
