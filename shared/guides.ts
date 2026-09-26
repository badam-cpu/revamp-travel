/**
 * "Know before you go" — evergreen Armenia travel-essentials guides (visa,
 * currency, transport, seasons, holidays, emergency). SEO/AEO content: these are
 * high-intent, low-competition queries ("do I need a visa for Armenia", "best
 * time to visit Armenia", "how to get around Yerevan") that also feed AI answer
 * engines. Rendered at /guide (hub) and /guide/<slug> (article), prerendered for
 * crawlers, and cross-linked into stays/tours/eat.
 *
 * Content is directional and kept current-ish; anything that changes by
 * nationality or over time (esp. VISA rules) points to an official source and is
 * worded cautiously — never stated as a guarantee.
 */
export interface GuideSection {
  heading?: string;
  body?: string[];
  bullets?: string[];
}
export interface GuideFaq {
  q: string;
  a: string;
}
export interface GuideSource {
  label: string;
  url: string;
}
export interface Guide {
  slug: string;
  /** icon key mapped to a Lucide icon in the page. */
  icon: "visa" | "currency" | "transport" | "seasons" | "holidays" | "emergency";
  eyebrow: string;
  title: string; // H1
  cardTitle: string; // short label on the hub card
  cardBlurb: string; // one line on the hub card
  summary: string; // lead paragraph + meta description
  sections: GuideSection[];
  faq: GuideFaq[];
  sources?: GuideSource[];
  updated: string; // ISO date → dateModified
}

export const GUIDE_HUB = {
  eyebrow: "The Armenia edit · Know before you go",
  title: "Armenia travel essentials",
  intro:
    "The practical stuff, in one place — visas, money, getting around, when to come, public holidays, and who to call in an emergency. Everything here is kept current and points to official sources where the details can change.",
};

const UPDATED = "2026-09-26";

export const GUIDES: Guide[] = [
  {
    slug: "visa",
    icon: "visa",
    eyebrow: "Entry & visas",
    title: "Do I need a visa for Armenia?",
    cardTitle: "Visa",
    cardBlurb: "Do I need one?",
    summary:
      "Armenia is one of the easier countries to enter: many nationalities travel visa-free, and most others get a quick electronic visa. Rules depend on your passport, so always confirm with Armenia's Ministry of Foreign Affairs before you fly.",
    sections: [
      {
        heading: "Visa-free entry",
        body: [
          "Citizens of the EU, United States, United Kingdom, Canada, Australia, Japan, and the EAEU/CIS countries (among many others) can typically enter Armenia visa-free — commonly for stays of up to 180 days within a year. The exact allowance depends on your nationality.",
        ],
      },
      {
        heading: "eVisa & visa on arrival",
        body: [
          "If your nationality isn't visa-free, Armenia offers a straightforward electronic visa (eVisa) applied for online before travel, and a visa on arrival at Zvartnots International Airport for eligible nationalities. The eVisa is usually issued within a few business days.",
        ],
      },
      {
        heading: "What to have ready",
        bullets: [
          "A passport valid for the duration of your stay.",
          "Proof of onward or return travel (occasionally asked for).",
          "An address for your stay and, rarely, proof of funds.",
        ],
      },
      {
        heading: "Staying longer",
        body: [
          "Planning to stay beyond your visa-free/eVisa allowance? You can apply for a temporary residence permit. For anything over the standard period, check the current registration rules on the official portals below.",
        ],
      },
    ],
    faq: [
      { q: "How long can I stay in Armenia without a visa?", a: "Many nationalities can stay visa-free for up to 180 days in a one-year period, but the exact allowance varies by passport — confirm yours on the MFA site." },
      { q: "Is there a visa on arrival?", a: "Yes, for eligible nationalities at Zvartnots Airport. Travellers who aren't visa-free can also apply for an eVisa online before departure." },
      { q: "Where do I apply for an eVisa?", a: "Through Armenia's official electronic visa portal (evisa.mfa.am). Avoid third-party sites that add fees." },
    ],
    sources: [
      { label: "Ministry of Foreign Affairs of Armenia", url: "https://www.mfa.am/en/visa/" },
      { label: "Official eVisa portal", url: "https://evisa.mfa.am/" },
    ],
    updated: UPDATED,
  },
  {
    slug: "currency",
    icon: "currency",
    eyebrow: "Money",
    title: "Money & prices in Armenia",
    cardTitle: "Currency",
    cardBlurb: "Money & average prices",
    summary:
      "Armenia's currency is the Armenian dram (AMD, ֏). Cards are widely accepted in Yerevan, but a little cash goes a long way in the regions, at markets, and in small cafés. Here's how to handle money on your trip.",
    sections: [
      {
        heading: "The currency",
        body: [
          "The Armenian dram (AMD, symbol ֏) is the only legal tender. Notes come in 1,000 / 2,000 / 5,000 / 10,000 / 20,000 / 50,000 dram. Exchange rates move, so check a live rate before converting.",
        ],
      },
      {
        heading: "Cards vs. cash",
        bullets: [
          "Visa and Mastercard are accepted at most Yerevan restaurants, hotels, and shops.",
          "Carry cash for marshrutkas (minibuses), markets, small family cafés, and travel in the regions.",
          "ATMs are plentiful in Yerevan and in larger towns; fewer in villages.",
          "Exchange offices and banks give better rates than the airport — and are everywhere in the centre.",
        ],
      },
      {
        heading: "Tipping",
        body: [
          "Tipping isn't obligatory but is appreciated — around 10% in restaurants is common, and many bills already add a service charge, so check before adding more.",
        ],
      },
    ],
    faq: [
      { q: "What currency is used in Armenia?", a: "The Armenian dram (AMD, ֏). It's the only currency accepted for payments." },
      { q: "Can I pay by card in Armenia?", a: "Yes, cards work in most places in Yerevan. Keep some cash for minibuses, markets, and the regions." },
      { q: "Should I tip in Armenia?", a: "Around 10% is customary in restaurants when a service charge isn't already included." },
    ],
    updated: UPDATED,
  },
  {
    slug: "getting-around",
    icon: "transport",
    eyebrow: "Transport",
    title: "Getting around Armenia & Yerevan",
    cardTitle: "Transport",
    cardBlurb: "Metro, buses, taxis & intercity",
    summary:
      "Armenia is small and easy to explore. In Yerevan, ride-hailing apps are the simplest way around; between cities, minibuses and shared taxis connect almost everywhere. Here are your options.",
    sections: [
      {
        heading: "Around Yerevan",
        bullets: [
          "Ride-hailing apps (GG and Yandex Go) are cheap, reliable, and the easiest option for visitors — no haggling.",
          "The metro has a single line through the centre with a flat fare — quick for a few central stops.",
          "Buses and minibuses (marshrutkas) cover the whole city for a small flat fare, paid in cash or by card on newer buses.",
        ],
      },
      {
        heading: "Between cities & sights",
        bullets: [
          "Marshrutkas (shared minibuses) leave from Yerevan's stations to most towns — inexpensive, frequent, cash only.",
          "Shared and private taxis are affordable for day trips (Garni-Geghard, Khor Virap, Lake Sevan).",
          "Trains (South Caucasus Railway) run seasonally to Gyumri, Lake Sevan, and Tbilisi.",
          "Car rental gives the most freedom for the regions; roads to major sights are good.",
        ],
      },
      {
        heading: "Tips",
        body: [
          "Download GG or Yandex Go before you arrive. Keep small dram notes for minibuses, and having your destination written in Armenian or Russian helps with older taxi drivers.",
        ],
      },
    ],
    faq: [
      { q: "What's the best way to get around Yerevan?", a: "Ride-hailing apps (GG, Yandex Go) — they're cheap, quick, and avoid fare haggling. The metro and minibuses are even cheaper for central trips." },
      { q: "How do I travel between cities in Armenia?", a: "Marshrutkas (shared minibuses) and shared taxis connect most towns from Yerevan; seasonal trains and car rental are also options." },
      { q: "Is public transport in Yerevan expensive?", a: "No — the metro and buses run on a small flat fare, and ride-hailing trips across the city are inexpensive." },
    ],
    updated: UPDATED,
  },
  {
    slug: "when-to-visit",
    icon: "seasons",
    eyebrow: "Seasons",
    title: "Best time to visit Armenia",
    cardTitle: "Seasons",
    cardBlurb: "There's no bad weather!",
    summary:
      "Armenia has a dry continental climate and four distinct seasons. Spring and autumn are the sweet spots for sightseeing, summer is glorious in the highlands, and winter turns the mountains into a ski destination.",
    sections: [
      {
        heading: "Spring (April–June)",
        body: ["Mild, green, and blooming — arguably the best time to visit. Comfortable for city walks and monastery day trips, with wildflowers across the hills."],
      },
      {
        heading: "Summer (July–August)",
        body: ["Hot and dry in Yerevan (often 33–37°C), but perfect in the cooler highlands — Dilijan's forests, Lake Sevan's shore, and Jermuk's springs. Evenings in the capital come alive."],
      },
      {
        heading: "Autumn (September–October)",
        body: ["Warm days, cool nights, and harvest season — vineyards, pomegranates, and golden light. Excellent for both the city and the countryside."],
      },
      {
        heading: "Winter (December–February)",
        body: ["Cold with snow in the mountains. Yerevan is festive around the New Year, and Tsaghkadzor and Jermuk open for skiing. Some remote sights are harder to reach."],
      },
    ],
    faq: [
      { q: "When is the best time to visit Armenia?", a: "Late spring (May–June) and early autumn (September–October) offer the most comfortable weather for sightseeing across the country." },
      { q: "Is Armenia good to visit in summer?", a: "Yes — the capital is hot, but the highlands (Dilijan, Lake Sevan, Jermuk) are cool and beautiful, making summer ideal for nature." },
      { q: "Can you visit Armenia in winter?", a: "Absolutely. Yerevan is festive and the mountains offer skiing at Tsaghkadzor and Jermuk, though some remote sites are harder to reach." },
    ],
    updated: UPDATED,
  },
  {
    slug: "public-holidays",
    icon: "holidays",
    eyebrow: "Holidays",
    title: "Public holidays in Armenia",
    cardTitle: "Holidays",
    cardBlurb: "Calendar & closures",
    summary:
      "On public holidays, banks and government offices close, and some businesses keep shorter hours — though most restaurants, cafés, and major sights in Yerevan stay open. Here are Armenia's official non-working holidays.",
    sections: [
      {
        heading: "Official public holidays",
        bullets: [
          "1–2 January — New Year",
          "6 January — Christmas & Epiphany (Armenian Apostolic Church)",
          "28 January — Army Day",
          "8 March — International Women's Day",
          "24 April — Armenian Genocide Remembrance Day",
          "1 May — Labour Day",
          "9 May — Victory & Peace Day",
          "28 May — First Republic Day",
          "5 July — Constitution Day",
          "21 September — Independence Day",
          "31 December — New Year's Eve",
        ],
      },
      {
        heading: "Good to know",
        body: [
          "The New Year and Christmas stretch (roughly 31 December–6 January) is the biggest celebration — expect many small businesses to close for several days while the city is at its most festive. 24 April is a solemn day of remembrance.",
        ],
      },
    ],
    faq: [
      { q: "What are the main public holidays in Armenia?", a: "New Year (1–2 Jan), Christmas (6 Jan), Genocide Remembrance Day (24 Apr), First Republic Day (28 May), and Independence Day (21 Sep) are among the most significant." },
      { q: "Do shops close on Armenian holidays?", a: "Banks and government offices close, and some businesses shorten hours, but most restaurants, cafés, and major attractions in Yerevan stay open." },
      { q: "When is the biggest holiday in Armenia?", a: "The New Year and Christmas period (31 December–6 January) is the largest celebration of the year." },
    ],
    updated: UPDATED,
  },
  {
    slug: "emergency",
    icon: "emergency",
    eyebrow: "Safety",
    title: "Emergency numbers in Armenia",
    cardTitle: "Hotline",
    cardBlurb: "Who to call",
    summary:
      "Armenia is a safe, welcoming country for travellers. If something does go wrong, there's a single number to remember for any emergency — police, ambulance, or fire.",
    sections: [
      {
        heading: "The number to know",
        bullets: [
          "911 — the unified emergency number for police, ambulance, and fire. Operators can assist in Armenian and Russian, with English support available.",
          "112 — the European emergency number also connects in Armenia.",
        ],
      },
      {
        heading: "Practical notes",
        bullets: [
          "Yerevan has 24-hour pharmacies and modern hospitals; care in the regions is more basic, so travel insurance is worth having.",
          "Save your country's embassy or consulate contact before you travel.",
          "Tap water is generally safe to drink in Yerevan, and the city's public drinking fountains (pulpulaks) are a local institution.",
        ],
      },
    ],
    faq: [
      { q: "What is the emergency number in Armenia?", a: "Dial 911 for any emergency — police, ambulance, or fire. The European number 112 also works." },
      { q: "Is Armenia safe for tourists?", a: "Yes, Armenia is considered very safe for visitors, with low crime and famously warm hospitality. Normal travel precautions apply." },
      { q: "Can I drink the tap water in Yerevan?", a: "Yes, tap water in Yerevan is generally safe, and the city's public pulpulak fountains are safe and refreshing." },
    ],
    updated: UPDATED,
  },
];

export function findGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
