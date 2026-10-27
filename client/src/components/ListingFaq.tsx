/**
 * "Questions guests ask" on a listing page (0118): the host's approved FAQ as an
 * accordion. Renders nothing when the listing has none. Mirrored for crawlers in
 * server/prerender.ts (with FAQPage JSON-LD).
 */
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { FaqItem } from "@shared/listingFaq";

export function ListingFaq({ items, className }: { items?: FaqItem[]; className?: string }) {
  if (!items?.length) return null;
  return (
    <section id="faq" aria-labelledby="listing-faq-title" className={className}>
      <p className="eyebrow" id="listing-faq-title">Questions guests ask</p>
      <Accordion type="multiple" className="mt-4 border-t border-basalt/10">
        {items.map((it, i) => (
          <AccordionItem key={`${i}-${it.q}`} value={`q${i}`} className="border-b border-basalt/10">
            <AccordionTrigger className="min-h-12 py-4 text-left text-base font-semibold text-basalt hover:no-underline">{it.q}</AccordionTrigger>
            <AccordionContent className="whitespace-pre-line pb-4 text-[15px] leading-7 text-basalt/70">{it.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
