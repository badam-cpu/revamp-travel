/**
 * Operator-acquisition landing pages ("become a host"). One per product type —
 * stays, tours, experiences — pitched to potential operators, plus a hub. Content
 * is factual about the platform's real tools (channel manager, PriceLabs, time
 * slots, unified inbox, payouts) — NO fabricated host counts, earnings, or
 * testimonials (brandbook rule). Rendered at /host and /host/<type>, prerendered
 * for SEO ("list your property in Armenia", "become a tour guide Armenia").
 */
export interface HostFeature {
  title: string;
  body: string;
}
export interface HostStep {
  title: string;
  body: string;
}
export interface HostFaq {
  q: string;
  a: string;
}
export interface HostPage {
  type: "stays" | "tours" | "experiences";
  eyebrow: string;
  title: string;
  subtitle: string;
  features: HostFeature[];
  steps: HostStep[];
  faq: HostFaq[];
}

export const HOST_HUB = {
  eyebrow: "For operators",
  title: "Grow your business with Revamp",
  intro:
    "List once and reach travellers discovering Armenia — with the tools to actually run it: sync with the channels you already use, smart pricing, one inbox for every guest, and fast, transparent payouts. Pick what you offer to get started.",
  cards: [
    { type: "stays" as const, title: "Stays", blurb: "Apartments, guesthouses, hotels, cabins" },
    { type: "tours" as const, title: "Tours", blurb: "Guided routes & day trips" },
    { type: "experiences" as const, title: "Experiences", blurb: "Classes, tastings & crafts" },
  ],
};

const COMMON_FAQ_FEES: HostFaq = {
  q: "What does it cost to list?",
  a: "It's free to create a listing. Revamp earns through a per-booking commission or a simple monthly plan — you choose the model that suits you, and you always see exactly what you keep on each booking.",
};
const COMMON_FAQ_START: HostFaq = {
  q: "How do I get started?",
  a: "Sign up as an operator and build your listing (for stays you can even import the basics from an existing link). Our team reviews it, and once approved it goes live to travellers.",
};
const COMMON_FAQ_PAYOUT: HostFaq = {
  q: "How do payouts work?",
  a: "Guests pay securely through Revamp, and your earnings (net of commission) are paid out to you — with every booking and payout visible in your dashboard.",
};

export const HOST_PAGES: HostPage[] = [
  {
    type: "stays",
    eyebrow: "Hosts · stays",
    title: "List your place on Revamp",
    subtitle: "Fill your calendar with the right guests — and keep every channel in sync, so you never double-book.",
    features: [
      { title: "Channel manager built in", body: "Push your availability and rates out to the OTAs you already use; bookings flow back and dates block automatically, so there are no double-bookings across platforms." },
      { title: "Smart, automatic pricing", body: "Connect PriceLabs to pull recommended nightly rates straight into your calendar, or set your own seasonal rates." },
      { title: "One inbox, less admin", body: "Talk to guests and manage every reservation from a single unified inbox — with email alerts so you never miss a message." },
      { title: "Fast, transparent payouts", body: "Clear commission and prompt payouts. See exactly what you earn on every booking, plus optional concierge add-ons and gift cards." },
      { title: "Your rules", body: "Set your own cancellation policy, cleaning fee, minimum stay, and house rules — and sync your calendar via iCal with Airbnb, Booking.com and more." },
      { title: "Built to be found", body: "Your listing is structured to rank on Google and surface in AI travel answers, so new guests discover you." },
    ],
    steps: [
      { title: "Create your listing", body: "Add photos, details and rates — or import the basics from an existing listing link to save time." },
      { title: "We review & publish", body: "Our team checks your listing for quality, then makes it live to travellers across the marketplace." },
      { title: "Host & get paid", body: "Manage bookings, message guests, and receive your payouts — all from your dashboard." },
    ],
    faq: [
      COMMON_FAQ_FEES,
      { q: "Can I keep my Airbnb and Booking.com listings?", a: "Yes. Revamp is designed to run alongside your existing channels — connect their calendars so availability stays in sync and you avoid double-bookings." },
      COMMON_FAQ_PAYOUT,
      COMMON_FAQ_START,
    ],
  },
  {
    type: "tours",
    eyebrow: "Guides · tours",
    title: "Guide tours on Revamp",
    subtitle: "Sell fixed departures with real-time seats — and keep the platforms you already use in sync.",
    features: [
      { title: "Real time-slot booking", body: "Offer fixed departures with per-session capacity. Guests pick a date and time, and remaining seats update live as they book." },
      { title: "Sync your calendar", body: "Connect your existing booking calendar (GetYourGuide, Fresha, and any iCal feed) so busy times automatically close the matching slots on Revamp." },
      { title: "Instant or request-to-book", body: "Take instant bookings, or approve each request first before the guest pays — your choice, per tour." },
      { title: "One inbox & fast payouts", body: "Handle every guest from one inbox, with transparent commission and prompt payouts on each booking." },
      { title: "Built to be found", body: "Your tour is structured to rank on Google and surface in AI travel answers — new travellers discover it without extra ad spend." },
    ],
    steps: [
      { title: "Create your tour", body: "Add the route, highlights, duration, languages, meeting point and your weekly time slots." },
      { title: "We review & publish", body: "Our team checks it for quality, then makes it live to travellers." },
      { title: "Guide & get paid", body: "Take bookings, manage seats, and receive your payouts from the dashboard." },
    ],
    faq: [
      COMMON_FAQ_FEES,
      { q: "Can I sync with GetYourGuide or Fresha?", a: "Yes — paste your calendar's iCal export and your booked times will automatically block the overlapping slots on Revamp, reducing the risk of overbooking across platforms." },
      { q: "Do I have to accept every booking instantly?", a: "No. Each tour can be set to instant-book or request-to-book, where you approve the guest before payment." },
      COMMON_FAQ_START,
    ],
  },
  {
    type: "experiences",
    eyebrow: "Hosts · experiences",
    title: "Host experiences on Revamp",
    subtitle: "Share what you do best — classes, tastings, crafts — with travellers looking for the real thing.",
    features: [
      { title: "Built for experiences", body: "A guided setup for hands-on classes, tastings and crafts — itinerary, what's included, what to bring, group size and languages." },
      { title: "Time slots & small groups", body: "Run fixed sessions with per-session capacity so your groups stay the size you want, with seats updating live." },
      { title: "Instant or request-to-book", body: "Approve each guest first, or let them book instantly — whichever fits how you run your sessions." },
      { title: "One inbox & fast payouts", body: "Message guests and manage everything in one place, with clear commission and prompt payouts." },
      { title: "Built to be found", body: "Your experience is structured to rank on Google and surface in AI travel answers, reaching curious travellers." },
    ],
    steps: [
      { title: "Create your experience", body: "Use the guided builder to add your itinerary, inclusions, group size and weekly time slots." },
      { title: "We review & publish", body: "Our team checks it for quality, then makes it live to travellers." },
      { title: "Host & get paid", body: "Take bookings, manage your sessions, and receive your payouts from the dashboard." },
    ],
    faq: [
      COMMON_FAQ_FEES,
      { q: "What kinds of experiences can I host?", a: "Hands-on, local experiences — cooking classes, wine and food tastings, crafts, walks, and cultural sessions. If it's authentic and well-run, it fits." },
      { q: "Can I limit my group size?", a: "Yes — set the capacity per session, and Revamp stops selling seats once a session is full." },
      COMMON_FAQ_START,
    ],
  },
];

export function findHostPage(type: string): HostPage | undefined {
  return HOST_PAGES.find((p) => p.type === type);
}
