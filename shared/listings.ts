/**
 * Canonical Revamp Travel listing model — shared by the client (via the
 * `@shared` alias) and the server (via a relative import, since the
 * production server bundle is built with esbuild rather than Vite).
 *
 * `seedListings` is the one-time seed for the persistent store in
 * `server/store.ts`. Once the server has written `server/data/listings.json`,
 * that file — not this array — is the source of truth for live inventory.
 * Edit this array only to change what a *fresh* install seeds with.
 */

export type ListingType = "stay" | "eat" | "tour";

export interface ListingFact {
  label: string;
  value: string;
}

export interface Listing {
  id: string;
  slug: string;
  type: ListingType;
  title: string;
  eyebrow: string;
  city: string;
  region: string;
  coordinates: { lat: number; lng: number };
  image: string;
  gallery: string[];
  shortDescription: string;
  longDescription: string;
  price: number;
  priceLabel: string;
  priceUnit: string;
  tags: string[];
  facts: ListingFact[];
  amenities: string[];
  featured?: boolean;
  accent: "apricot" | "sevan" | "tuff";
}

// Deployment note: this fork replaces the Manus-managed `/manus-storage/...`
// image paths — and the previous build's hardcoded images.unsplash.com photo
// IDs, which this environment could not verify are still live — with
// self-hosted brand illustrations in `client/public/images`. The site now
// has zero external image dependencies; swap in real photography whenever
// it's available.
const assets = {
  hero: "/images/hero-armenia.svg",
  sevan: "/images/sevan.svg",
  dilijan: "/images/dilijan.svg",
  garni: "/images/garni.svg",
  tatev: "/images/tatev.svg",
  hotel: "/images/hotel.svg",
  cabin: "/images/cabin.svg",
  restaurant: "/images/restaurant.svg",
  food: "/images/food.svg",
  wine: "/images/wine.svg",
  landscape: "/images/landscape.svg",
};

export const brandAssets = {
  logo: "/brand/revamp-mark.svg",
  hero: assets.hero,
  categories: {
    stay: assets.dilijan,
    eat: assets.food,
    tour: assets.garni,
  },
};

/** Fallback illustration used for a listing added through /manage without a photo. */
export const placeholderImage = assets.hero;

export const seedListings: Listing[] = [
  {
    id: "stay-dilijan",
    slug: "forest-house-dilijan",
    type: "stay",
    title: "Forest House Dilijan",
    eyebrow: "Timber hideaway",
    city: "Dilijan",
    region: "Tavush",
    coordinates: { lat: 40.741, lng: 44.863 },
    image: assets.cabin,
    gallery: [assets.cabin, assets.dilijan, assets.sevan, assets.landscape],
    shortDescription: "A quiet timber house at the edge of Dilijan National Park, made for slow mornings and trail days.",
    longDescription: "Set where Dilijan’s tiled roofs give way to beech forest, this warm timber retreat balances simple contemporary rooms with a strong sense of place. Mornings begin with local preserves and mountain herbs; afternoons can be spent walking toward Parz Lake or the old town’s craft studios.",
    price: 112,
    priceLabel: "$112",
    priceUnit: "night",
    tags: ["Forest", "Breakfast", "Design stay"],
    facts: [
      { label: "Sleeps", value: "2 guests" },
      { label: "Setting", value: "Forest edge" },
      { label: "Best for", value: "Slow weekends" },
    ],
    amenities: ["Breakfast basket", "Wood stove", "Trail maps", "Garden terrace", "Wi-Fi", "Local transfers"],
    featured: true,
    accent: "sevan",
  },
  {
    id: "eat-yerevan",
    slug: "tuff-courtyard-kitchen",
    type: "eat",
    title: "Tuff Courtyard Kitchen",
    eyebrow: "New Armenian table",
    city: "Yerevan",
    region: "Yerevan",
    coordinates: { lat: 40.1815, lng: 44.5146 },
    image: assets.food,
    gallery: [assets.food, assets.restaurant, assets.wine, assets.tatev],
    shortDescription: "Market-led Armenian plates, lavash from the tonir, and a leafy courtyard hidden behind rose stone.",
    longDescription: "This courtyard kitchen translates Armenia’s seasonal pantry into generous, modern plates without losing the memory of the family table. Come for ember-roasted vegetables, regional cheeses, hand-torn lavash, and a concise list of Armenian wines served under vine leaves.",
    price: 34,
    priceLabel: "$34",
    priceUnit: "average",
    tags: ["Armenian", "Courtyard", "Natural wine"],
    facts: [
      { label: "Cuisine", value: "Modern Armenian" },
      { label: "Service", value: "Lunch & dinner" },
      { label: "Setting", value: "Garden courtyard" },
    ],
    amenities: ["Vegetarian choices", "Outdoor tables", "Armenian wine list", "Open kitchen", "Group table", "English menu"],
    featured: true,
    accent: "tuff",
  },
  {
    id: "tour-geghama",
    slug: "geghama-volcanic-trail",
    type: "tour",
    title: "Geghama Volcanic Trail",
    eyebrow: "Small-group hike",
    city: "Garni",
    region: "Kotayk",
    coordinates: { lat: 40.1196, lng: 44.7289 },
    image: assets.garni,
    gallery: [assets.garni, assets.tatev, assets.landscape, assets.hero],
    shortDescription: "A guided highland route through basalt columns, open pasture, and the quiet edges of Garni Gorge.",
    longDescription: "Leave Yerevan early for a day shaped by geology and open horizons. A local mountain guide leads the way from Garni’s basalt formations into the lower Geghama landscape, with a village lunch and plenty of time to understand the terrain rather than rush through it.",
    price: 78,
    priceLabel: "$78",
    priceUnit: "person",
    tags: ["Hiking", "Geology", "Village lunch"],
    facts: [
      { label: "Duration", value: "7 hours" },
      { label: "Group", value: "Up to 8" },
      { label: "Level", value: "Moderate" },
    ],
    amenities: ["Local guide", "Yerevan transfer", "Village lunch", "Walking poles", "Water refill", "Entrance fees"],
    featured: true,
    accent: "apricot",
  },
  {
    id: "stay-sevan",
    slug: "sevan-horizon-cabins",
    type: "stay",
    title: "Sevan Horizon Cabins",
    eyebrow: "Lakeside cabins",
    city: "Sevan",
    region: "Gegharkunik",
    coordinates: { lat: 40.564, lng: 45.011 },
    image: assets.sevan,
    gallery: [assets.sevan, assets.hotel, assets.landscape, assets.cabin],
    shortDescription: "Compact lakeside cabins with broad water views, morning swims, and easy access to Sevanavank.",
    longDescription: "A small cluster of cabins sits above Lake Sevan with uninterrupted views toward the peninsula. Interiors are straightforward and warm; the draw is the changing blue of the lake, a private path to the shore, and evenings around the outdoor hearth.",
    price: 96,
    priceLabel: "$96",
    priceUnit: "night",
    tags: ["Lake", "Cabin", "Sauna"],
    facts: [
      { label: "Sleeps", value: "2–4 guests" },
      { label: "Water", value: "3 min walk" },
      { label: "Best for", value: "Summer swims" },
    ],
    amenities: ["Lake access", "Shared sauna", "Outdoor hearth", "Kitchenette", "Parking", "Bike hire"],
    featured: true,
    accent: "sevan",
  },
  {
    id: "tour-tatev",
    slug: "tatev-above-the-clouds",
    type: "tour",
    title: "Tatev Above the Clouds",
    eyebrow: "South Armenia journey",
    city: "Tatev",
    region: "Syunik",
    coordinates: { lat: 39.3792, lng: 46.2503 },
    image: assets.tatev,
    gallery: [assets.tatev, assets.hero, assets.landscape, assets.garni],
    shortDescription: "A deeply paced two-day journey through Areni, Noravank, Tatev, and the folds of southern Armenia.",
    longDescription: "Travel south through wine country and red-rock canyons before reaching Tatev by the aerial tramway. The route is intentionally unhurried, with time for monastery architecture, village conversations, and the vast evening light that defines Syunik.",
    price: 188,
    priceLabel: "$188",
    priceUnit: "person",
    tags: ["Monasteries", "Road trip", "Overnight"],
    facts: [
      { label: "Duration", value: "2 days" },
      { label: "Group", value: "Up to 6" },
      { label: "Start", value: "Yerevan" },
    ],
    amenities: ["Driver-guide", "Guesthouse night", "Two breakfasts", "Tramway ticket", "Wine tasting", "All transfers"],
    featured: true,
    accent: "tuff",
  },
  {
    id: "eat-areni",
    slug: "areni-cellar-table",
    type: "eat",
    title: "Areni Cellar Table",
    eyebrow: "Winemaker’s lunch",
    city: "Areni",
    region: "Vayots Dzor",
    coordinates: { lat: 39.7197, lng: 45.1858 },
    image: assets.wine,
    gallery: [assets.wine, assets.food, assets.restaurant, assets.tatev],
    shortDescription: "A long-table lunch pairing village recipes with small-production wines in Armenia’s historic wine country.",
    longDescription: "The experience begins in the vines and ends at a shaded cellar table. A winemaking family pours indigenous varieties alongside dishes that follow the season: greens, cheeses, slow-cooked meats, stone fruit, and still-warm bread.",
    price: 42,
    priceLabel: "$42",
    priceUnit: "menu",
    tags: ["Wine", "Family table", "Vineyard"],
    facts: [
      { label: "Menu", value: "5 shared courses" },
      { label: "Pairing", value: "4 local wines" },
      { label: "Duration", value: "2.5 hours" },
    ],
    amenities: ["Cellar visit", "Wine pairing", "Vegetarian menu", "Vineyard walk", "Small groups", "Yerevan transfer add-on"],
    featured: true,
    accent: "apricot",
  },
  {
    id: "stay-yerevan",
    slug: "republic-house-yerevan",
    type: "stay",
    title: "Republic House Yerevan",
    eyebrow: "City design hotel",
    city: "Yerevan",
    region: "Yerevan",
    coordinates: { lat: 40.1777, lng: 44.5126 },
    image: assets.hotel,
    gallery: [assets.hotel, assets.restaurant, assets.dilijan, assets.food],
    shortDescription: "A compact city stay mixing 1960s Armenian details with calm rooms near Republic Square.",
    longDescription: "Inside a rose-stone city block, Republic House brings together local furniture, graphic art, and genuinely useful city guidance. The scale is intimate, the rooms are quiet, and most central neighborhoods are an easy walk away.",
    price: 138,
    priceLabel: "$138",
    priceUnit: "night",
    tags: ["City center", "Design", "Roof terrace"],
    facts: [
      { label: "Rooms", value: "18 rooms" },
      { label: "Center", value: "5 min walk" },
      { label: "Style", value: "Modernist" },
    ],
    amenities: ["Breakfast", "Roof terrace", "Airport transfer", "Laundry", "Work tables", "Concierge notes"],
    accent: "tuff",
  },
  {
    id: "eat-gyumri",
    slug: "black-fortress-supper-club",
    type: "eat",
    title: "Black Fortress Supper Club",
    eyebrow: "Gyumri evenings",
    city: "Gyumri",
    region: "Shirak",
    coordinates: { lat: 40.789, lng: 43.847 },
    image: assets.restaurant,
    gallery: [assets.restaurant, assets.food, assets.tatev, assets.wine],
    shortDescription: "A spirited supper club celebrating Shirak’s hearty kitchen, dry humor, and black-stone architecture.",
    longDescription: "Part dinner, part neighborhood gathering, this weekly table moves through Gyumri classics with a light contemporary hand. Expect generous soups, grains, herbs, baked dishes, live acoustic music, and stories that stretch after dessert.",
    price: 29,
    priceLabel: "$29",
    priceUnit: "set menu",
    tags: ["Shirak", "Supper club", "Live music"],
    facts: [
      { label: "Menu", value: "Shared supper" },
      { label: "When", value: "Fri & Sat" },
      { label: "Seats", value: "24 guests" },
    ],
    amenities: ["Set menu", "Vegetarian option", "Live music", "Local beer", "Communal seating", "English host"],
    accent: "sevan",
  },
  {
    id: "tour-dilijan",
    slug: "dilijan-craft-and-forest-walk",
    type: "tour",
    title: "Dilijan Craft & Forest Walk",
    eyebrow: "Culture on foot",
    city: "Dilijan",
    region: "Tavush",
    coordinates: { lat: 40.7406, lng: 44.8626 },
    image: assets.dilijan,
    gallery: [assets.dilijan, assets.sevan, assets.garni, assets.cabin],
    shortDescription: "An easy-paced walk connecting old Dilijan, working studios, forest paths, and a cook’s lunch.",
    longDescription: "Begin among the balconies and workshops of old Dilijan before following a local path into the forest. Along the way, meet makers working in wood and clay, then finish at a family table where lunch follows the day’s market.",
    price: 58,
    priceLabel: "$58",
    priceUnit: "person",
    tags: ["Craft", "Easy walk", "Lunch"],
    facts: [
      { label: "Duration", value: "5 hours" },
      { label: "Group", value: "Up to 10" },
      { label: "Level", value: "Easy" },
    ],
    amenities: ["Local host", "Studio visits", "Family lunch", "Tea stop", "Materials demo", "Route notes"],
    accent: "sevan",
  },
];

export const regions = [
  { name: "Tavush", label: "Forest & craft", image: assets.dilijan, query: "Tavush" },
  { name: "Gegharkunik", label: "Lake & highlands", image: assets.sevan, query: "Gegharkunik" },
  { name: "Syunik", label: "Canyons & monasteries", image: assets.tatev, query: "Syunik" },
];

export const typeLabels: Record<ListingType, string> = {
  stay: "Stay",
  eat: "Eat",
  tour: "Tour",
};

export function findListingIn(list: Listing[], slug: string | undefined) {
  return list.find((listing) => listing.slug === slug);
}

/** Fields accepted from the Manage UI when creating or updating a listing.
 * `id` and `slug` are always derived server-side from `title` (+ a
 * disambiguating suffix on collision) so the client never has to invent them. */
export const EDITABLE_LISTING_TYPES: ListingType[] = ["stay", "tour"];

export interface ListingInput {
  type: ListingType;
  title: string;
  eyebrow: string;
  city: string;
  region: string;
  coordinates: { lat: number; lng: number };
  image?: string;
  gallery?: string[];
  shortDescription: string;
  longDescription: string;
  price: number;
  priceLabel: string;
  priceUnit: string;
  tags: string[];
  facts: ListingFact[];
  amenities: string[];
  featured?: boolean;
  accent: "apricot" | "sevan" | "tuff";
}
