# Revamp Travel Marketplace Specification

## Product Model

Revamp Travel is a two-sided travel marketplace with one shared content model across three inventory types. **Travelers** (front-end users) browse and, once signed in, can eventually book; **operators** (back-end users — owners, guides, hosts) sign up for their own account and build/publish their own stay and tour listings from `/dashboard` (see "Accounts and Operator Dashboard" below). Restaurant listings remain curated/editorial content, seeded from source and never operator-writable, even by the house account. This is Milestone A: accounts and operator-owned listings are real; payment collection is not yet — see "Booking and Payments" below.

| Type | Discovery fields | Detail-specific fields | Primary action |
| --- | --- | --- | --- |
| Property | Region, place type, price band, highlights | Stay style, sleeps, amenities, check-in context | Booking CTA (see "Booking and Payments") |
| Restaurant | Region, cuisine, meal context, price band | Cuisine, setting, opening context, house specialties | Booking CTA (see "Booking and Payments") |
| Tour | Region, theme, duration, activity level | Duration, group format, inclusions, meeting point | Booking CTA (see "Booking and Payments") |

No fabricated customer ratings, reviews, or testimonials will be displayed. Curatorial labels such as “Revamp pick,” “New route,” and “Local favorite” describe editorial placement rather than customer sentiment.

## Shared Listing Vocabulary

Each listing has an `id`, `slug`, `type`, `title`, `eyebrow`, `city`, `region`, `coordinates`, `image`, `gallery`, `shortDescription`, `longDescription`, `priceLabel`, `priceUnit`, `tags`, `facts`, `amenities`, `featured`, and `accent` — plus, on the live catalog, `operatorId` (who owns/published it) and `status` (`draft` or `published`; only `published` listings are visible to anyone other than their owner).

Coordinates connect each card to its map marker. The same shared record powers home sections, category results, map results, and the individual listing page so naming and metadata remain consistent.

## Accounts and Operator Dashboard

Anyone can sign up at `/signup` as a **traveler** or an **operator**; sign in at `/login`. An operator's account additionally gets a **Dashboard** link in the header and access to `/dashboard`, where they add, edit, and delete their own stay and tour listings through the same kind of form UI the old open manager used — except now every write is scoped to that operator's own rows, enforced by the database itself (Row-Level Security), not by anything the page merely chooses to show or hide. A traveler who tries to visit `/dashboard` is redirected to `/` with an explanatory toast; a signed-out visitor is redirected to `/login`. Restaurant listings are excluded from `/dashboard` and from every operator's write access, including the house "Revamp" account that owns the seed catalog — they stay curated/editorial only.

## Booking and Payments

Every listing detail page has a booking action, and its behavior depends on who's looking: **signed out**, it reads "Sign in to book" and sends the visitor to `/login`, returning them to the same listing afterward. **Signed in**, it's a clearly disabled "Payments coming soon" control — nothing is charged, and nothing is confirmed, because real payment collection (Stripe-backed checkout, a real booking record, double-booking prevention) doesn't exist yet. Displayed prices are real numbers set by the operator (not fabricated), but no rate becomes a charge until that later milestone ships. Neither state should ever imply a completed reservation.

## Routes and Navigation

| Route | Purpose | Required interaction |
| --- | --- | --- |
| `/` | Brand-led discovery homepage | Unified search, category links, featured cards, regions, map preview |
| `/explore` | Searchable marketplace catalog | Query search, type filters, region filters, list/map toggle, empty state |
| `/explore/:category` | Category-filtered catalog | Stay, restaurant, or tour preselection |
| `/map` | Full map-led discovery | Marker-card synchronization and category filtering |
| `/listing/:slug` | Individual listing page | Gallery, facts, description, location map, contextual action card |
| `/explore/tour` | Dedicated tours browser (GetYourGuide-inspired) | Hero band with search, real-tag category pills, duration buckets, sort, map sheet, and a boxed activity-card grid — see "Tours Browsing (`/explore/tour`)" below |
| `/plan` | AI trip planner | Trip-parameter form (days, start city, travelers, pace, budget, interests) generates a day-by-day itinerary via the Anthropic API, grounded in the live, published stay/eat/tour catalog |
| `/dashboard` | Operator dashboard | Add, edit, and delete the signed-in operator's own stay and tour listings; restaurants are never shown as writable. Requires an operator account (see "Accounts and Operator Dashboard" above). |
| `/login`, `/signup` | Accounts | Email/password sign-in and sign-up; sign-up includes a traveler/operator role choice. |

The persistent header contains the symbol/wordmark, Stay, Eat, Tours, Map, AI Planner, a saved-items control, an “Explore Armenia” action, and an auth-aware account area: Sign in/Sign up when signed out; the account's display name plus Sign out when signed in, with a Dashboard link appended for operators. The footer provides region links, marketplace categories, travel context, a link to the planner, and an explicit note that displayed availability and payment status are illustrative/not-yet-live.

## Tours Browsing (`/explore/tour`)

Tours get their own browsing UI, modeled on GetYourGuide's activity grid, rather than sharing the generic `/explore` layout used by stays/restaurants/all. It opens with a full-width hero (search included), then category pills built from the *actual* tags present on current tour listings (not a fixed taxonomy — as more tours are published by operators via `/dashboard`, the pill list reflects them), duration buckets (half-day / full-day / multi-day, computed from each listing's own "Duration" fact), a sort control (recommended / price / duration), and an optional map sheet. Cards show a hoverable photo carousel across the listing's `gallery`, then duration/group-size/difficulty in the visual slot a marketplace like this would normally spend on star ratings.

That substitution is deliberate: GetYourGuide's density comes partly from ratings, review counts, and urgency badges ("likely to sell out", "booked X times today"), and this product's own content rules forbid fabricating any of that. So the tours page borrows the layout and information density of that pattern — boxed cards, hover carousel, pill filters, sort control — without inventing customer sentiment or urgency it can't back up. `/explore` (stays, restaurants, "all") keeps its original editorial list/map layout unchanged.

The individual tour detail page (`/listing/:slug` for a `type: "tour"` record) gets the same treatment: a hero photo with a clickable thumbnail filmstrip (any number of photos, not a fixed 4-photo assumption — a host-added tour with 2 or 3 gallery photos renders cleanly instead of leaving a gap), a quick-facts row (duration/group size/difficulty, whatever the listing actually has), an overview, a real "what's included" checklist from the listing's `amenities`, a starting-point map, and a sticky booking card with a price, a date field, a travelers-count stepper that computes an estimated total client-side, and the auth-aware booking action described in "Booking and Payments" above. Stays and restaurants keep the original shared detail template with the same booking action.

## Inventory Management (`/dashboard`)

Stay and tour listings can be created, edited, and deleted by their owning operator through a form UI at `/dashboard`. Writes go straight to the Supabase `listings` table and are visible to every visitor immediately once published — the same live records power the home page, category pages, map, and detail pages. Restaurant listings (`type: "eat"`) are excluded from write operations at the database layer (no Row-Level Security insert policy exists for that type at all), not just hidden in the UI, so the curated table content can't be edited away by mistake, and an operator can only ever see/edit/delete rows where they are the owner. New or edited listings must stay within Armenia's coordinate bounds and must not introduce fabricated ratings, reviews, or booking counts — the same content rules that apply to the seed data apply to anything entered here.

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
