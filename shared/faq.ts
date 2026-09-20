/**
 * Canonical FAQ content, shared by the client /faq page and the bot prerender so
 * the visible Q&A and the FAQPage structured data never drift. Answers are
 * factual (how the marketplace actually works + general Armenia travel facts) —
 * no fabricated reviews, ratings, or claims (see the Customer-content rule).
 * Editing here updates the page, the JSON-LD, and what AI answer engines read.
 */
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "What is Revamp Vacations?",
    a: "Revamp Vacations is Armenia's travel marketplace — a single place to discover and book curated places to stay, Armenian restaurants, guided tours, and hands-on experiences across the country. Listings are created by local operators and reviewed before they go live.",
  },
  {
    q: "What can I book on Revamp Vacations?",
    a: "Stays (apartments, guesthouses, hotels, and cabins), guided tours and day trips, and hands-on experiences such as classes, crafts, and tastings. Restaurants are listed to help you discover where to eat. Prices are shown in Armenian dram (AMD), with US dollars available as a reference.",
  },
  {
    q: "How do I book and pay?",
    a: "Open a listing, choose your dates and guests, and check out through PayLink's secure hosted payment page. You don't need an account — you can book as a guest with just your name, email, and phone number. Payments are charged in Armenian dram (AMD).",
  },
  {
    q: "Do I need an account to book?",
    a: "No. You can book as a guest. Creating a free account lets you keep track of your trips and saved places, but it isn't required to make a booking.",
  },
  {
    q: "Can I cancel my booking or get a refund?",
    a: "Each listing sets its own cancellation policy, shown before you book. Flexible bookings can be cancelled for a refund up to the listing's free-cancellation cutoff; non-refundable rates are offered at a discount and aren't refundable. Refunds are processed back to your original payment.",
  },
  {
    q: "What currency are prices in?",
    a: "All prices and payments are in Armenian dram (AMD), the local currency. You can switch the display to US dollars as a reference, but the amount charged is always in AMD.",
  },
  {
    q: "Does Revamp Vacations have an AI trip planner?",
    a: "Yes. The trip planner builds a day-by-day Armenia itinerary from the live catalog of real stays, tours, and experiences, so the suggestions are things you can actually book.",
  },
  {
    q: "Where in Armenia can I book?",
    a: "Across the whole country — Yerevan and the surrounding sights, Dilijan and the Tavush forests, Lake Sevan, Tatev and the deep south of Syunik, and more. Browse by region on the map or the explore pages.",
  },
  {
    q: "How do I list my property, tour, or experience?",
    a: "Sign up for an operator account and create your listing from the dashboard. Each new listing goes through a quick review before it's published. You can manage pricing, availability, and bookings, and sync your Airbnb and Booking.com calendars.",
  },
  {
    q: "When is the best time to visit Armenia?",
    a: "Late spring (April–June) and early autumn (September–October) bring mild weather and are ideal for sightseeing and hiking. Summer is warm and popular for Dilijan's forests and Lake Sevan, while winter suits the ski slopes near Tsaghkadzor.",
  },
  {
    q: "What language is spoken in Armenia, and what currency is used?",
    a: "Armenian is the official language; Russian is widely understood and English is common in tourism. The currency is the Armenian dram (AMD).",
  },
];
