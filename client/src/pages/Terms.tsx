/**
 * Terms of Service — a real, tailored starting document (not legal advice),
 * describing the marketplace, bookings/payments (PayLink, AMD, tax, cleaning
 * fee), cancellation policies, and operator obligations as the app actually
 * implements them. Have it reviewed by counsel before relying on it. Public +
 * indexable; the Google OAuth consent screen points its "Terms" link here.
 */
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";

const UPDATED = "September 16, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl tracking-[-0.02em] text-basalt">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-basalt/70">{children}</div>
    </section>
  );
}

export default function Terms() {
  useDocumentMeta({
    title: "Terms of Service | Revamp Vacations",
    description: "The terms that govern your use of the Revamp Vacations marketplace.",
    canonicalPath: "/terms",
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-14 lg:py-20">
        <div className="mx-auto max-w-[68ch]">
          <p className="eyebrow">Legal</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Terms of Service</h1>
          <p className="mt-4 text-sm text-basalt/50">Last updated {UPDATED}</p>

          <p className="mt-8 text-[15px] leading-7 text-basalt/70">
            These terms govern your use of the Revamp Vacations marketplace. By using the service you agree to them. This
            is a starting document and not legal advice; please have it reviewed by qualified counsel before relying on it.
          </p>

          <Section title="What Revamp is">
            <p>Revamp Vacations is a marketplace that connects travelers with independent local operators offering stays, tours, and experiences across Armenia (restaurants are listed for discovery and are not booked online). Operators provide the actual services; Revamp facilitates discovery, booking, and payment. For bookings made through the platform, Revamp acts as the merchant of record and collects payment on the operator's behalf.</p>
          </Section>

          <Section title="Your account">
            <p>You must provide accurate information and keep your login credentials secure. You are responsible for activity under your account. There are separate traveler and operator roles; operators additionally agree to the operator terms below.</p>
          </Section>

          <Section title="Bookings &amp; payment">
            <p>Listing prices are shown in Armenian dram (AMD); a tax is added to the booking, and an operator may add a per-booking cleaning fee. Payment is processed securely by PayLink (Ameriabank) and charged in Armenian dram. A booking is confirmed only once payment has cleared and we have verified it — arriving on a return page alone does not confirm a booking. You can view your bookings under your account.</p>
            <p>Prices may be displayed in US dollars for convenience at an approximate rate; the amount actually charged is always in Armenian dram, as shown at checkout.</p>
          </Section>

          <Section title="Cancellations &amp; refunds">
            <p>Each listing states its cancellation policy. <strong className="text-basalt">Flexible</strong> bookings can be cancelled for a full refund up to the stated cutoff before the start date, with no refund after. <strong className="text-basalt">Non-refundable</strong> bookings are offered at a discount and are not refundable. The refund amount for a cancellation is determined by the policy in effect when you booked. Refunds, where due, are processed to your original payment method; processing may take several business days.</p>
          </Section>

          <Section title="Operator terms">
            <p>Operators are solely responsible for the accuracy of their listings, their availability, and delivering the booked service safely and as described. Revamp charges a commission on each confirmed booking and pays operators the remainder on a schedule (stays the day after check-in; tours and experiences monthly). Operators are responsible for their own taxes and for issuing refunds due under their cancellation policy.</p>
          </Section>

          <Section title="Acceptable use">
            <p>Don't use the service unlawfully, attempt to defraud travelers or operators, scrape or disrupt the platform, or post content you don't have the right to share. We may suspend accounts that violate these terms.</p>
          </Section>

          <Section title="Content">
            <p>Operators retain ownership of the listing content and photos they upload and grant Revamp a license to display and promote them on the platform. Revamp does not publish fabricated reviews, ratings, or endorsements.</p>
          </Section>

          <Section title="Disclaimers &amp; liability">
            <p>The service is provided "as is." Revamp facilitates bookings but does not itself provide the stays, tours, or experiences and is not responsible for an operator's acts or omissions. To the fullest extent permitted by law, Revamp is not liable for indirect or consequential damages arising from your use of the service.</p>
          </Section>

          <Section title="Governing law">
            <p>These terms are governed by the laws of the Republic of Armenia, without regard to conflict-of-laws rules. (Confirm the appropriate jurisdiction with your counsel.)</p>
          </Section>

          <Section title="Changes &amp; contact">
            <p>We may update these terms; material changes are reflected by the date above. Continued use after an update means you accept the revised terms. Questions? Email <a href="mailto:hello@revampvacations.com" className="font-semibold text-apricot hover:underline">hello@revampvacations.com</a>.</p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
