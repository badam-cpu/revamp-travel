/**
 * Distinctive categories for the Eat guide (restaurants & eateries). Admins pick
 * one when curating, and can add a new one on the fly via the "Other" option —
 * any custom category they save becomes a real value on that listing, so it then
 * shows up as a group on /explore/eat and as an option next time (the admin form
 * unions this list with categories already in use).
 *
 * Curated for Yerevan/Armenia: a mix of cuisines and venue kinds so a traveler
 * can scan by what they're actually in the mood for.
 */
/** Standard venue types (what kind of place it is) — the primary category the
 *  guide groups by. Distinct from cuisine below. */
export const VENUE_TYPES: string[] = [
  "Restaurant",
  "Café / coffee shop",
  "Bakery",
  "Dessert & ice cream",
  "Bar",
  "Wine bar",
  "Pub & brewery",
  "Nightclub",
  "Fine dining",
  "Fast food",
  "Street food",
  "Brunch & breakfast",
  "Tea house",
  "Food hall & market",
];

/** Cuisines (what kind of food) — a secondary descriptor. */
export const EAT_CATEGORIES: string[] = [
  "Armenian",
  "Georgian",
  "Middle Eastern",
  "Mediterranean",
  "European",
  "Italian & pizza",
  "Asian",
  "American & grill",
  "Seafood",
  "Vegetarian & vegan",
  "Café & coffee",
  "Bakery & dessert",
  "Breakfast & brunch",
  "Wine bar",
  "Bar & pub",
  "Fine dining",
  "Fast & casual",
  "Street food",
];
