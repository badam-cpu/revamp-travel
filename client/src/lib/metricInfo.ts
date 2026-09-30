/**
 * Plain-language explanations for the engagement metrics, shared by the admin
 * and operator analytics dashboards and the restaurant owner /venue view so the
 * wording stays identical everywhere. Keyed by the analytics event `kind`
 * (listing_analytics_daily). Used in tooltips next to each metric label.
 */
export const METRIC_INFO: Record<string, { label: string; help: string }> = {
  impression: { label: "Impressions", help: "How often your listing's card was shown in a list, search results, or the map — seen, not necessarily clicked." },
  view: { label: "Views", help: "Opens of your listing's own detail page — a deeper signal of interest than an impression." },
  card_click: { label: "Clicks", help: "Clicks on your card that opened the listing from a browse or search view." },
  directions: { label: "Directions", help: "Taps on “Get directions,” which open your location in Google Maps." },
  website: { label: "Website", help: "Clicks on your website link." },
  call: { label: "Calls", help: "Taps on your phone number to call." },
  menu: { label: "Menu", help: "Clicks to view your menu." },
  save: { label: "Saves", help: "Times a traveler bookmarked your listing to their saved places." },
  share: { label: "Shares", help: "Times someone used the share action on your listing." },
};
