/**
 * Public /faq page — visible, crawlable Q&A about the marketplace and traveling
 * in Armenia, plus FAQPage structured data (buildFaqJsonLd). Optimized for
 * Google rich results and AI answer engines, which quote FAQ answers directly.
 * Content lives in shared/faq.ts so the page, the JSON-LD, and the bot
 * prerender all use the same source.
 */
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { FAQ_ITEMS } from "@shared/faq";
import { buildFaqJsonLd, buildBreadcrumbJsonLd } from "@shared/seo";

export default function Faq() {
  const { settings } = useSiteSettings();
  const items = settings.homeContent.faq?.filter((f) => f.q?.trim() && f.a?.trim()).length
    ? settings.homeContent.faq!.filter((f) => f.q?.trim() && f.a?.trim())
    : FAQ_ITEMS;

  useDocumentMeta({
    title: "FAQ — Booking & Traveling in Armenia | Revamp Vacations",
    description: "Answers about booking stays, tours, and experiences on Revamp Vacations, payments in Armenian dram, cancellations, and traveling in Armenia.",
    canonicalPath: "/faq",
    jsonLd: [
      buildFaqJsonLd(items),
      buildBreadcrumbJsonLd(window.location.origin, [
        { name: "Home", path: "/" },
        { name: "FAQ", path: "/faq" },
      ]),
    ],
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-14 lg:py-20">
        <div className="mx-auto max-w-[72ch]">
          <p className="eyebrow">Good to know</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Frequently asked questions</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-basalt/60">
            How booking works on Revamp Vacations, and a few essentials for planning a trip to Armenia.
          </p>

          <dl className="mt-10 divide-y divide-basalt/10 border-t border-basalt/10">
            {items.map((item) => (
              <div key={item.q} className="py-6">
                <dt className="font-display text-xl leading-snug tracking-[-0.01em] text-basalt">{item.q}</dt>
                <dd className="mt-2.5 text-[15px] leading-7 text-basalt/70">{item.a}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-10 text-sm text-basalt/55">
            Still have a question? Email{" "}
            <a href="mailto:hello@revampvacations.com" className="font-semibold text-apricot hover:underline">hello@revampvacations.com</a>
            {" "}or use the chat on any page.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
