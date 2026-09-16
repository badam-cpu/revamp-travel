/**
 * Privacy Policy — a real, tailored starting document (not legal advice). It
 * describes what the app actually does: Supabase auth, PayLink payments, Google
 * sign-in + Maps, the AI-first support chat (Anthropic), and Resend email.
 * Have it reviewed by counsel before relying on it. Public + indexable; the
 * Google OAuth consent screen points its "Privacy policy" link here.
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

export default function Privacy() {
  useDocumentMeta({
    title: "Privacy Policy | Revamp Vacations",
    description: "How Revamp Vacations collects, uses, and protects your information.",
    canonicalPath: "/privacy",
  });

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-14 lg:py-20">
        <div className="mx-auto max-w-[68ch]">
          <p className="eyebrow">Legal</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">Privacy Policy</h1>
          <p className="mt-4 text-sm text-basalt/50">Last updated {UPDATED}</p>

          <p className="mt-8 text-[15px] leading-7 text-basalt/70">
            Revamp Vacations ("Revamp," "we," "us") operates an Armenia-focused travel marketplace connecting travelers
            with local operators. This policy explains what we collect, how we use it, and the choices you have. It is a
            starting document and not legal advice; please have it reviewed by qualified counsel for your jurisdiction.
          </p>

          <Section title="Information we collect">
            <p><strong className="text-basalt">Account information.</strong> When you sign up we collect your name and email, your role (traveler or operator), and for operators an optional business name and bio. Passwords are handled and stored by our authentication provider (Supabase) — we never see them in plain text. If you sign in with Google, we receive your name, email, and profile picture from Google.</p>
            <p><strong className="text-basalt">Bookings &amp; saved places.</strong> The listings you save, and the dates, guest counts, and amounts of bookings you make.</p>
            <p><strong className="text-basalt">Payments.</strong> Payments are processed by PayLink (Ameriabank). We do <strong className="text-basalt">not</strong> collect or store your card or bank details — those go directly to PayLink. We retain the booking amount, currency, and a payment reference to confirm and manage your booking.</p>
            <p><strong className="text-basalt">Support messages.</strong> Messages you send to our support chat, and an email address if you choose to leave one as a guest. An AI assistant helps answer first; our team may follow up.</p>
            <p><strong className="text-basalt">Technical &amp; preferences.</strong> Basic device and log data needed to run and secure the service, and small items stored in your browser (your currency choice, dismissed notices, unsent drafts). We do not run third-party advertising trackers.</p>
          </Section>

          <Section title="How we use your information">
            <p>To create and manage your account; to process bookings and pay operators; to provide customer support (an AI assistant answers first, and a human may follow up); to send transactional emails such as booking confirmations and cancellation notices; to operate, secure, and improve the service; and to comply with legal and financial obligations.</p>
          </Section>

          <Section title="Service providers we share with">
            <p>We share the minimum necessary with the providers that run the service. We do not sell your personal information.</p>
            <ul className="ml-5 list-disc space-y-1.5">
              <li><strong className="text-basalt">Supabase</strong> — database, authentication, and secure storage of your account and booking data.</li>
              <li><strong className="text-basalt">PayLink (Ameriabank)</strong> — payment processing. Your payment details are provided directly to them.</li>
              <li><strong className="text-basalt">Netlify</strong> — website and application hosting.</li>
              <li><strong className="text-basalt">Google</strong> — optional sign-in and the maps shown on listing pages.</li>
              <li><strong className="text-basalt">Resend</strong> — delivery of transactional emails.</li>
              <li><strong className="text-basalt">Anthropic</strong> — the AI that powers the support chat and trip planner; the messages you send to those features are processed by Anthropic to generate a response.</li>
            </ul>
          </Section>

          <Section title="Cookies &amp; local storage">
            <p>We use essential cookies and browser storage to keep you signed in and to remember preferences (for example, your display currency). These are necessary for the service to function; we do not use them for cross-site advertising.</p>
          </Section>

          <Section title="Data retention">
            <p>We keep your information while your account is active and as needed to provide the service. Booking and payment records may be retained longer where required for legal, tax, or accounting purposes.</p>
          </Section>

          <Section title="Your rights">
            <p>Subject to applicable law, you may request access to, correction of, or deletion of your personal information, and you may object to or restrict certain processing. To make a request, contact us using the details below. You can update your profile and password at any time from your account.</p>
          </Section>

          <Section title="International processing">
            <p>Some of our providers process data outside the Republic of Armenia. Where we transfer information internationally, we rely on the providers' safeguards and applicable legal mechanisms.</p>
          </Section>

          <Section title="Children">
            <p>The service is not directed to children under 18, and we do not knowingly collect their personal information.</p>
          </Section>

          <Section title="Changes to this policy">
            <p>We may update this policy from time to time. Material changes will be reflected by the "Last updated" date above.</p>
          </Section>

          <Section title="Contact us">
            <p>Questions about this policy or your data? Email <a href="mailto:hello@revampvacations.com" className="font-semibold text-apricot hover:underline">hello@revampvacations.com</a>.</p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
