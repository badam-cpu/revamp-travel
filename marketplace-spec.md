# Revamp Travel Marketplace Specification

## Product Model

Revamp Travel is a travel-discovery marketplace with one shared content model across three inventory types. It demonstrates a complete browse-to-detail journey without implying live rates, payments, or verified customer feedback. Stay and tour listings are a real, shared, editable inventory (see `/manage` below); restaurant listings remain curated/editorial content maintained in source.

| Type | Discovery fields | Detail-specific fields | Primary action |
| --- | --- | --- | --- |
| Property | Region, place type, price band, highlights | Stay style, sleeps, amenities, check-in context | Check dates |
| Restaurant | Region, cuisine, meal context, price band | Cuisine, setting, opening context, house specialties | Reserve a table |
| Tour | Region, theme, duration, activity level | Duration, group format, inclusions, meeting point | Choose a date |

No fabricated customer ratings, reviews, or testimonials will be displayed. Curatorial labels such as “Revamp pick,” “New route,” and “Local favorite” describe editorial placement rather than customer sentiment.

## Shared Listing Vocabulary

Each listing has an `id`, `slug`, `type`, `title`, `eyebrow`, `city`, `region`, `coordinates`, `image`, `gallery`, `shortDescription`, `longDescription`, `priceLabel`, `priceUnit`, `tags`, `facts`, `amenities`, `featured`, and `accent`.

Coordinates connect each card to its map marker. The same shared record powers home sections, category results, map results, and the individual listing page so naming and metadata remain consistent.

## Routes and Navigation

| Route | Purpose | Required interaction |
| --- | --- | --- |
| `/` | Brand-led discovery homepage | Unified search, category links, featured cards, regions, map preview |
| `/explore` | Searchable marketplace catalog | Query search, type filters, region filters, list/map toggle, empty state |
| `/explore/:category` | Category-filtered catalog | Stay, restaurant, or tour preselection |
| `/map` | Full map-led discovery | Marker-card synchronization and category filtering |
| `/listing/:slug` | Individual listing page | Gallery, facts, description, location map, contextual action card |
| `/plan` | AI trip planner | Trip-parameter form (days, start city, travelers, pace, budget, interests) generates a day-by-day itinerary via the Anthropic API, grounded in the live stay/eat/tour catalog |
| `/manage` | Inventory management | Add, edit, and delete stay and tour listings; restaurants are shown read-only |

The persistent header contains the symbol/wordmark, Stay, Eat, Tours, Map, AI Planner, Manage, a saved-items control, and an “Explore Armenia” action. The footer provides region links, marketplace categories, travel context, links to the planner and manager, and an explicit note that displayed availability and rates are illustrative.

## Inventory Management (`/manage`)

Stay and tour listings can be created, edited, and deleted through a form UI backed by `POST`/`PUT`/`DELETE /api/listings/:id`. Writes persist server-side (file-backed store) and are visible to every visitor immediately — the same `Listing` records power the home page, category pages, map, and detail pages, live. Restaurant listings (`type: "eat"`) are excluded from write operations by the API itself, not just hidden in the UI, so the curated table content can't be edited away by mistake. New or edited listings must stay within Armenia's coordinate bounds and must not introduce fabricated ratings, reviews, or booking counts — the same content rules that apply to the seed data apply to anything entered here.

## AI Trip Planner (`/plan`)

The planner is a real Anthropic API call made server-side (never from the browser). The request includes trip parameters (length, starting city, traveler count, pace, budget, interests) and a digest of the current stay/eat/tour catalog, so the model can name real listings where they fit naturally. The response is a structured day-by-day itinerary (title, summary, per-day morning/afternoon/evening blocks, an optional tip, an estimated budget, and a packing tip), validated server-side before it reaches the client. Generated text must not claim live pricing, guaranteed availability, or a completed booking — it's a starting point, not a reservation. The endpoint requires `ANTHROPIC_API_KEY`; without it, it fails clearly (503) rather than silently degrading to fake data.

## Search Behavior

The home search console accepts a free-text destination or interest, a category, and a travel date context. Submitting it routes to `/explore` with query parameters. The explore page reads these values on load and allows immediate refinement.

Search matches title, city, region, listing type, tags, and description. Category and region chips compose with the text query. If the active result set is empty, the interface explains which filters are active and offers a one-click reset.

## Map Behavior

The map is a deterministic, self-hosted SVG atlas of Armenia (no external map API or key required). Every visible result receives a custom marker whose shape and color correspond to property, restaurant, or tour. Selecting a card pans to and emphasizes its marker; selecting a marker emphasizes its card. Detail pages show a quieter single-location map.

## Page Composition

The homepage opens with an asymmetric editorial hero, then an overlapping search console, category gateways, curated mixed listings, a region-led discovery band, an interactive map/list feature, and a closing planning invitation.

The explore page uses a compact editorial masthead followed by a filter rail and results composition. Desktop presents a 58/42 list-and-map split; mobile presents cards first with a sticky “Show map” control and full-screen map sheet.

The listing page begins with a dense image mosaic and back/saved controls. The content below uses a two-column composition: narrative and features on the left; a compact, sticky action card on the right. The map and related listings complete the page.

## Responsive Rules

Below 768px, navigation becomes a drawer, the hero image stack becomes one strong image, search fields stack, map/list split becomes toggled views, image mosaics become horizontal galleries, and the detail action becomes a sticky bottom bar. At all sizes, controls retain visible labels, generous touch targets, and keyboard focus.
