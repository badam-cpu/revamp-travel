/**
 * Region landing-page guides (SEO/AEO). Each guide is a curated, factual intro +
 * quick facts + FAQ for a place, rendered at /region/<slug> with the live
 * listings that match it. Shared by the client page (client/src/pages/Region.tsx)
 * and the bot prerender (server/prerender.ts) so the visible content and the
 * CollectionPage/FAQPage structured data never drift.
 *
 * Content is factual (general Armenia travel knowledge + how the marketplace
 * works) — no fabricated reviews/ratings. `match` lists the city/region names
 * (any case) whose listings belong on this page — Yerevan matches a whole
 * province, Tsaghkadzor matches a single town inside Kotayk.
 */
export interface RegionFaq {
  q: string;
  a: string;
}
export interface RegionGuide {
  slug: string;
  name: string;
  eyebrow: string;
  tagline: string;
  match: string[];
  intro: string[];
  /** One-line general climate/weather note. */
  climate: string;
  facts: { label: string; value: string }[];
  faq: RegionFaq[];
}

export const REGION_GUIDES: RegionGuide[] = [
  {
    slug: "yerevan",
    name: "Yerevan",
    eyebrow: "City guide",
    tagline: "Armenia's capital",
    match: ["yerevan"],
    intro: [
      "Yerevan is one of the world's oldest continuously inhabited cities — founded in 782 BC as the fortress of Erebuni, and today Armenia's warm, pink-tuff capital. Republic Square, the Cascade complex, the Opera, and a deep café culture sit under the gaze of Mount Ararat.",
      "Below are hand-picked places to stay, plus tours and experiences in and around the city — all bookable on Revamp, with prices in Armenian dram (AMD).",
    ],
    climate: "Yerevan has a dry continental climate: hot summers often reaching 33–37°C in July and August, and cool winters that hover around 0°C. Spring and autumn are mild and the most comfortable for sightseeing.",
    facts: [
      { label: "Region", value: "Yerevan" },
      { label: "Best for", value: "City, food, culture" },
      { label: "Getting there", value: "~15 min from Zvartnots airport" },
      { label: "Best season", value: "Apr–Jun, Sep–Oct" },
    ],
    faq: [
      { q: "Where should I stay in Yerevan?", a: "Most travelers stay in Kentron (the central district) — around Republic Square, the Opera, and the Cascade — where the cafés, restaurants, and main sights are all within walking distance." },
      { q: "How many days should I spend in Yerevan?", a: "Two to three days covers the city comfortably and leaves time for classic day trips to Garni Temple, Geghard Monastery, and Khor Virap with its Ararat views." },
      { q: "Is Yerevan walkable?", a: "Yes — the central district is compact and flat, and most sights are within a 20-minute walk. A small metro, buses, and inexpensive taxis cover longer distances." },
      { q: "What is Yerevan known for?", a: "Its pink-and-apricot tuff architecture, the Cascade stairway, the singing fountains of Republic Square, Armenian brandy, the Vernissage open-air market, and views of Mount Ararat." },
      { q: "When is the best time to visit Yerevan?", a: "Late spring (April–June) and early autumn (September–October) are ideal — warm and clear. Summers are hot and lively; winters are mild with a festive December." },
    ],
  },
  {
    slug: "tsaghkadzor",
    name: "Tsaghkadzor",
    eyebrow: "Region guide · Kotayk",
    tagline: "Armenia's mountain resort",
    match: ["tsaghkadzor"],
    intro: [
      "Tsaghkadzor — literally \"valley of flowers\" — is Armenia's premier mountain resort town, tucked into the forests of Kotayk about an hour from Yerevan. In winter it's the country's main ski destination, with a ropeway climbing Mount Teghenis; in summer it's a cool, green escape for hiking and spa retreats.",
      "It's also home to the medieval Kecharis Monastery. Below are stays, tours, and experiences in and around Tsaghkadzor, bookable on Revamp.",
    ],
    climate: "At around 1,800 m elevation, Tsaghkadzor is markedly cooler than Yerevan — snowy winters well below freezing (great for skiing) and fresh, mild summers around 20°C, making it a popular escape from the summer heat.",
    facts: [
      { label: "Region", value: "Kotayk" },
      { label: "Best for", value: "Skiing, mountains, spa" },
      { label: "Getting there", value: "~50 min from Yerevan" },
      { label: "Best season", value: "Dec–Mar (ski) · Jun–Sep" },
    ],
    faq: [
      { q: "When is ski season in Tsaghkadzor?", a: "The ski season usually runs from December to March, snow depending. A gondola/ropeway carries skiers up Mount Teghenis to a network of runs for a range of levels." },
      { q: "How far is Tsaghkadzor from Yerevan?", a: "About a 50-minute drive (~60 km) north of Yerevan, making it an easy day trip or an overnight mountain break." },
      { q: "What is Tsaghkadzor known for?", a: "It's Armenia's main ski resort, home to the 11th-century Kecharis Monastery, and was a Soviet-era high-altitude training base for Olympic athletes." },
      { q: "Is Tsaghkadzor worth visiting in summer?", a: "Yes — the air is cool and the forests green, the ropeway often runs for mountain views, and there's hiking, the monastery, and spa hotels to enjoy off-season." },
    ],
  },
];

export function findRegionGuide(slug: string): RegionGuide | undefined {
  return REGION_GUIDES.find((g) => g.slug === slug.toLowerCase());
}

/** Normalize a city/region string for matching (lowercase, strip Province/Marz). */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/\s+(province|marz)$/i, "").trim();
}

/** Does a listing (by its city + region) belong on this region guide's page? */
export function listingInRegion(city: string, region: string, guide: RegionGuide): boolean {
  const c = norm(city);
  const r = norm(region);
  return guide.match.some((m) => {
    const n = norm(m);
    return c === n || r === n;
  });
}
