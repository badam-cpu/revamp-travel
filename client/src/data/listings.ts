/**
 * Compatibility barrel: the canonical listing model now lives in
 * `shared/listings.ts` so the Express server can seed its store from the
 * same data. `listings` here is the static seed only — pages that need the
 * *live*, editable catalog should use `useListings()` from
 * `@/contexts/ListingsContext` instead of importing `listings` directly.
 */
export type { Listing, ListingFact, ListingType, ListingInput } from "@shared/listings";
export { brandAssets, placeholderImage, regions, typeLabels, EDITABLE_LISTING_TYPES, seedListings as listings } from "@shared/listings";

import type { Listing } from "@shared/listings";
import { seedListings, findListingIn } from "@shared/listings";

export function findListing(slug: string | undefined, list: Listing[] = seedListings) {
  return findListingIn(list, slug);
}
