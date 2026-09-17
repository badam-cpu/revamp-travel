/**
 * Curated list of the major sights in central Yerevan, with real coordinates,
 * so a listing page can show relevant, English-named "sights nearby" with
 * distances computed on the client — no Google Places call, no localized/minor
 * results (Places' `historical_landmark` returns every memorial plaque).
 *
 * `nearbySights()` returns the closest sights to a listing within `maxKm`,
 * so a central-Yerevan stay shows the famous landmarks and a listing far from
 * the centre (Dilijan, Sevan, …) shows none until a regional list is added.
 */
export interface Sight {
  name: string;
  category: string;
  lat: number;
  lng: number;
}

// Coordinates are approximate (good enough for a straight-line distance). Keep
// this to genuinely notable, visitor-facing places.
export const YEREVAN_SIGHTS: Sight[] = [
  { name: "Republic Square", category: "Landmark", lat: 40.1772, lng: 44.5133 },
  { name: "History Museum of Armenia", category: "Museum", lat: 40.1779, lng: 44.5138 },
  { name: "Cascade Complex", category: "Landmark", lat: 40.1889, lng: 44.5158 },
  { name: "Cafesjian Center for the Arts", category: "Museum", lat: 40.1884, lng: 44.5155 },
  { name: "Yerevan Opera Theatre", category: "Opera house", lat: 40.1856, lng: 44.5136 },
  { name: "Swan Lake", category: "Park", lat: 40.1835, lng: 44.5145 },
  { name: "Vernissage Market", category: "Market", lat: 40.1766, lng: 44.5155 },
  { name: "Northern Avenue", category: "Promenade", lat: 40.1820, lng: 44.5140 },
  { name: "Matenadaran", category: "Museum", lat: 40.1912, lng: 44.5211 },
  { name: "Katoghike Holy Mother of God Church", category: "Church", lat: 40.1847, lng: 44.5169 },
  { name: "St. Gregory the Illuminator Cathedral", category: "Cathedral", lat: 40.1838, lng: 44.5241 },
  { name: "Blue Mosque", category: "Mosque", lat: 40.1806, lng: 44.5028 },
  { name: "Lovers' Park", category: "Park", lat: 40.1893, lng: 44.5236 },
  { name: "Victory Park & Mother Armenia", category: "Park", lat: 40.1963, lng: 44.5253 },
  { name: "Tsitsernakaberd (Genocide Memorial)", category: "Memorial", lat: 40.1517, lng: 44.4886 },
  { name: "Sergei Parajanov Museum", category: "Museum", lat: 40.1553, lng: 44.4790 },
  { name: "Yerevan Brandy Company (ARARAT)", category: "Landmark", lat: 40.1649, lng: 44.4972 },
  { name: "GUM Market", category: "Market", lat: 40.1876, lng: 44.5299 },
  { name: "English Park", category: "Park", lat: 40.1797, lng: 44.5106 },
  { name: "Saryan Park (Art Market)", category: "Park", lat: 40.1841, lng: 44.5118 },
];

export interface NearbySight {
  name: string;
  category: string;
  distanceM: number;
}

/** Great-circle metres between two lat/lng points (Haversine). */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

/** Closest curated sights to a point, within `maxKm`, nearest first. */
export function nearbySights(lat: number, lng: number, limit = 7, maxKm = 7): NearbySight[] {
  return YEREVAN_SIGHTS.map((s) => ({ name: s.name, category: s.category, distanceM: distanceMeters(lat, lng, s.lat, s.lng) }))
    .filter((s) => s.distanceM <= maxKm * 1000)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}
