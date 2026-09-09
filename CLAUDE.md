# Revamp Travel: Claude Code Guide

This file is the primary operating guide for Claude Code. Read it before changing the repository. The application is a **full-stack, two-sided Armenian travel marketplace**: a React/TypeScript/Vite/Tailwind CSS 4/Wouter/Radix-shadcn/Sonner client talking directly to **Supabase** (Postgres + Auth + Row-Level Security) for accounts and listings, plus a small **Express + Zod** API that does exactly one remaining job — the server-side **Anthropic API** integration for AI trip planning.

## Product Intent

Revamp Travel connects two kinds of users. **Travelers** (front-end users) discover Armenian places to stay, restaurants, and tours through editorial content, search, filtering, listing cards, an interactive SVG atlas, and individual listing pages, and can sign up for an account. **Operators** (back-end users — owners, guides, hosts) sign up for their own account and build stay/tour listings from `/dashboard`, optionally starting from a link to an existing listing elsewhere (best-effort title/description/photo prefill — see `server/urlPrefill.ts`); a submitted listing goes into review and only appears anywhere else once an **admin** approves it from `/admin`. An **AI trip planner** (`/plan`) generates day-by-day itineraries grounded in the live, published catalog via the Anthropic API.

This is **Milestone A** of the marketplace build: real accounts, real operator-owned listings, real Row-Level Security — but **no real payments yet**. A signed-in traveler sees a plainly-labeled "Payments coming soon" state on every booking CTA instead of a fake confirmation; a signed-out visitor is sent to sign in first. Real Stripe-backed booking and payment collection is **Milestone B**, a deliberate follow-up, not something to bolt on ad hoc — see "Milestone B (not yet built)" near the end of this file.

## Non-Negotiable Rules

| Rule | Required behavior |
| --- | --- |
| Brandbook | Preserve the lowercase **`revamp.`** wordmark, compact **`re.`** mark, **#F15822** orange, **#212121** charcoal, **#FFFFFF** white, Circular-like sans typography, rounded containers, and large cropped logo patterns. Read `brandbook-implementation.md` before visual work. |
| Customer content | Never invent customer reviews, ratings, testimonials, booking counts, "verified" claims, or social proof — including inside AI-generated itinerary text **or any JSON-LD structured data** (`shared/seo.ts`, consumed by both `client/src/hooks/useDocumentMeta.ts` and `server/prerender.ts`). Never add an `aggregateRating`, `review`, or rating/count field to that structured data — there is no real ratings pipeline anywhere in this app. Curatorial labels are acceptable only when clearly editorial. |
| Payments and booking | No booking CTA may claim a payment or reservation succeeded — Milestone A collects no money. Signed-out visitors get "Sign in to book" (`client/src/components/BookingCta.tsx`); signed-in visitors get a disabled "Payments coming soon" state. Don't reintroduce a silent "noted" toast in its place. |
| Trust boundary | Every trust decision — who owns a listing, who may publish a `stay`/`tour`, that `eat` listings can't be created or edited by any operator, who may move a listing's `status` — is enforced by Postgres Row-Level Security and the `enforce_listing_review_gate` trigger in `supabase/migrations/0001_init.sql`/`0002_review_gate_and_admin.sql`, never by client-side checks alone. A client-supplied `operatorId`, `role`, or `status` must never be trusted. |
| Review gate | Every new operator-created listing starts `status: "pending"` — RLS's insert policy requires it, so the client can't publish directly. Only an `admin` profile can move a listing to `published` (`/admin`, `AdminReview.tsx`) or send it back to `draft` with a `review_note`; the `enforce_listing_review_gate` trigger in `0002_review_gate_and_admin.sql` is what actually enforces this (RLS alone can't compare a row's old and new status). Don't add a path that lets an operator or the client set `status` directly. |
| Editable inventory | Only `type: "stay"` and `type: "tour"` listings are operator-writable (`EDITABLE_LISTING_TYPES` in `shared/listings.ts`, mirrored by the `type in ('stay','tour')` check in every write policy on `public.listings`). Restaurants (`type: "eat"`) have **no insert policy at all** — not even the seed script's house operator account can create one through the normal client path; `scripts/seed-catalog.ts` uses the service-role key for that one narrow case (see its header comment). |
| Link-import honesty | `POST /api/import-listing` (`server/urlPrefill.ts`) reads a page's own public OpenGraph/meta tags — and, when present, its own JSON-LD structured data (`amenityFeature`, `offers.price`, `address`) — to pre-fill a draft. It is not a scraper: it makes exactly one plain fetch, never renders JS, and must never try to defeat a site's bot protection to get more out of a source that blocks it; it must never silently fail the rest of the form when a site returns nothing. The fetched image URL is shown only as a reference preview in `Dashboard.tsx` and must never be written into a listing's `image`/`gallery` fields automatically — see the Assets rule below. Prefilled amenities/price/city/region are a starting draft only — they land in the same editable form fields (the amenity picker's own "custom" chips for anything not curated) an operator reviews before saving, never written anywhere automatically. Imported title/description are run through `stripRatings()` so a listing never inherits someone else's star score (see Customer content rule). The endpoint requires a signed-in caller (bearer token, checked server-side) and guards against SSRF (rejects private/loopback addresses); don't loosen either without re-reading `server/urlPrefill.ts`'s header comment. |
| Secrets | `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-side/local-script only. Never read either from client code, log them, echo them in an API response, or hardcode a fallback. `VITE_SUPABASE_ANON_KEY` is the one Supabase key that's meant to ship to the browser — it's safe specifically because RLS, not the key, is what limits what it can do. |
| Assets | Site/brand imagery is self-hosted SVG under `client/public/images/` and `client/public/brand/` — no external image hosts for those. Operator listing photos are the one exception, and still deployer-hosted: they're uploaded to the deployer's own Supabase Storage bucket `listing-photos` (`supabase/migrations/0005_listing_photos_storage.sql`) via `client/src/components/PhotoUploader.tsx`, and their public URLs are stored in the listing's `image` (cover) / `gallery`. When no photo is uploaded, a listing falls back to a brand illustration. Anything that renders a listing image must handle **both** a root-relative brand path (`/images/…`) and an absolute uploaded URL — see `imgUrl()` in `server/prerender.ts` and `absoluteUrl()` in `shared/seo.ts`. |
| Maps | `client/src/components/ArmeniaMap.tsx` is a real, location-based map — **Leaflet, keyless** (the old deterministic SVG atlas was replaced on explicit request), using **CARTO Positron** tiles (muted light basemap over OpenStreetMap data) and **leaflet.markercluster** to merge nearby listings into a brand count pill. It's location-aware: `single`/detail listings center on their coordinates (street zoom for Yerevan, wider elsewhere), multi-listing views fit to all pins. Keep its public props (`listings`/`selectedId`/`onSelect`/`single`/`className`) stable — every discovery surface depends on them. The CARTO/OSM tiles are the one sanctioned external image source (the "Assets" rule's no-external-hosts applies to listing/brand imagery, not this explicitly-chosen map); keep the OSM + CARTO attribution control. Don't swap to a keyed provider (Google) without asking — the point here is zero key/billing. |
| Routing | Every detail page must retain an escape route. Preserve the global header and back links. `/dashboard` must redirect a signed-out visitor to `/login` and a signed-in traveler back to `/` (see `client/src/components/RequireRole.tsx`) — never render the operator form to someone who isn't an operator. |
| Accessibility | Keep semantic labels, visible focus treatment, keyboard-reachable controls, `SheetDescription` values, image alt text, and reduced-motion behavior. |
| Bot prerendering | Non-JS crawlers get server-rendered HTML from `server/prerender.ts` — hand-built HTML strings, deliberately not a headless browser (Chromium is operationally fragile on both a single `pnpm start` process and a serverless target). On Netlify the UA sniffing runs in the **edge function** (`netlify/edge-functions/prerender.ts`), which calls the API function's `/api/prerender`; `pnpm start`/self-hosting uses the equivalent Express middleware in `server/index.ts`. Same renderer either way. Every interpolated listing field (operator-submitted, from `Dashboard.tsx`) MUST go through `escapeHtml()`, and JSON-LD through the `<` → `<` script-breakout guard in `jsonLdScript()` — this is a stored-XSS surface that doesn't exist in the React-rendered SPA, where the same content is auto-escaped. Don't add a prerendered field or page kind without escaping it the same way. The bot list is duplicated in two places (`server/botDetect.ts` for Node, the token array in the edge function for Deno) — keep them in sync. |

## Fast Start

Use **Node.js 22+** and **pnpm 10+**.

```bash
pnpm install
cp .env.example .env   # fill in the Supabase vars to run against real data; ANTHROPIC_API_KEY to exercise /plan
pnpm dev
```

`pnpm dev` runs two processes concurrently: Vite (client, HMR, port 3000) and the Express API (`server/index.ts` via `tsx watch`, `API_PORT`, default 3001). Vite proxies `/api/*` to the API process — open the URL Vite prints; there's nothing to visit on the API port directly. The API process today only serves `/api/plan-trip`; everything else the client does (auth, listings CRUD) talks to Supabase directly from the browser.

Without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` set, `ListingsContext` catches the failed request and falls back to the static `shared/listings.ts` seed as a read-only preview (`offline: true`) — enough to look at the UI, but sign-up/sign-in and any write will fail until real Supabase credentials are set.

For validation, run:

```bash
pnpm check
pnpm build
pnpm preview   # client-only static preview
pnpm start     # real production run: one process, built SPA + /api/*
```

`pnpm check` runs TypeScript without emitting files (covers `client/`, `server/`, `shared/`, and `scripts/` — `netlify/` is intentionally outside `tsconfig`, so the Deno edge function and the loosely-typed function handler aren't type-checked there). `pnpm build` builds the browser application into `dist/public` and bundles the Express server into `dist/index.js`.

For crawler discoverability, `pnpm build && pnpm start`, then against `localhost:$PORT`: `curl -A "Googlebot" /`, `curl -A "GPTBot" /explore`, and `curl -A "ClaudeBot" /listing/<slug>` should each return real headings/OG tags/JSON-LD in the raw HTML, not an empty `<div id="root">`; a normal-browser UA on `/` should still get the plain SPA shell; `curl -I -A "GPTBot" /dashboard` should carry `X-Robots-Tag: noindex, nofollow` with the body still the untouched SPA shell; `curl /robots.txt` and `curl /sitemap.xml` should list every bot/route/published listing. (`pnpm start` exercises the Express middleware path; the Netlify edge function is the same renderer and is best verified on a deploy preview.)

## Repository Map

| Path | Responsibility |
| --- | --- |
| `client/src/App.tsx` | Top-level providers (`ThemeProvider`, `AuthProvider`, `ListingsProvider`) and route declarations, including `/plan`, `/dashboard`, `/login`, `/signup`. |
| `client/src/pages/Home.tsx` | Editorial home experience, categories, featured listings, regions, map preview, and main search entry. Reads live listings via `useListings()`. |
| `client/src/pages/Explore.tsx` | Searchable and filterable marketplace results with desktop list/map split and mobile map sheet. Reads live listings via `useListings()`. |
| `client/src/pages/Tours.tsx` | Dedicated GetYourGuide-style browser for `/explore/tour` (hero band + search, real-tag category pills, duration buckets, sort, map sheet, boxed card grid). All filters/pills derive from the live catalog's own tags and facts. |
| `client/src/pages/MapPage.tsx` | Map-led discovery view with synchronized listing rail. Reads live listings via `useListings()`. |
| `client/src/pages/ListingPage.tsx` | Dispatcher + shared detail-page template. For `type: "tour"` it renders `TourDetail`; for stays and restaurants it renders the original shared layout below. Reads live listings via `useListings()`. |
| `client/src/components/TourCard.tsx` / `TourDetail.tsx` | Boxed activity card and GetYourGuide-style tour detail layout; read facts via `client/src/lib/tourFacts.ts`'s `factValue()`/`otherFacts()` so a host-added tour with sparser data still renders cleanly. |
| `client/src/components/PlaceAutocomplete.tsx` / `client/src/lib/googleMaps.ts` | Optional Google Places (New) address autocomplete on the dashboard listing form's location step — type an address, and city/region/lat/lng fill in. Self-gating: renders nothing unless `VITE_GOOGLE_MAPS_API_KEY` is set, so the manual fields work unchanged otherwise. `googleMaps.ts` hand-loads the Maps JS API (no bundled dep) and `extractResolvedPlace()` reads the `gmp-select` event defensively across two known event shapes — that function is the one place to touch if Google revises the `PlaceAutocompleteElement` API again. |
| `client/src/components/PhotoUploader.tsx` | Drag-and-drop / click multi-photo uploader used by `Dashboard.tsx`'s listing form (replaces the old single "Image URL" field). Uploads straight from the browser to the Supabase Storage bucket `listing-photos` (RLS-scoped to the user's own `<uid>/…` folder, see migration `0005`), downscaling/compressing in-canvas first (max 1600px, JPEG q≈0.82). First photo = cover; reorder/remove; a "paste a URL" fallback remains. Uncontrolled like `AmenityPicker` — exposes ordered URLs via `ref.getValue()`, read at submit into the listing's `image`/`gallery`. |
| `client/src/components/AmenityPicker.tsx` | Type-aware, categorized amenity/inclusion checklist used by `Dashboard.tsx`'s listing form — replaces the old free-text "Amenities (comma separated)" input. Curated `stay`/`tour` catalogs live in this file (`CATALOGS`/`STAY_GROUPS`/`TOUR_GROUPS`, drawn from the seed data). Uncontrolled like every other form field: owns its selection state (seeded from `defaultValue`), keeps any legacy/custom values that aren't in the curated list as removable chips so editing never drops data, offers an "add a custom one" field, and exposes the current value via `ref.getValue()`, read once at submit in `toInputPayload`. |
| `client/src/components/BookingCta.tsx` | The one place booking-CTA auth logic lives — signed out: "Sign in to book" (links to `/login?redirect=/listing/:slug`); signed in: disabled "Payments coming soon". Used by both `TourDetail.tsx` and `ListingPage.tsx`'s stay/eat sidebar, in both their sticky desktop and mobile-bar forms. Extend *this* component for Milestone B rather than re-forking the CTA per page. |
| `client/src/pages/Dashboard.tsx` | Operator-only add/edit/delete UI for the signed-in operator's own stay/tour listings (replaces the old open `/manage` panel). Wrapped in `<RequireRole role="operator">`. Also has the "prefill from a link" control (calls `importListingPrefill()`) and a per-listing status badge (Pending review / Published / Needs changes) that surfaces `reviewNote` when an admin sent something back. Listings write straight to Supabase; RLS + the review-gate trigger — not this component — are what actually scope writes and gate publishing. |
| `client/src/pages/AdminReview.tsx` | Admin-only review queue (`/admin`), wrapped in `<RequireRole role="admin">`. Lists every `status: "pending"` listing (any operator) with the submitter's name embedded via a Supabase foreign-table select; Approve sets `published`, Reject sets `draft` + a `review_note` the operator sees on `/dashboard`. |
| `client/src/pages/Login.tsx` / `Signup.tsx` | Email/password auth forms. Signup includes a traveler/operator role toggle (operator reveals a business-name field) and handles Supabase's optional "confirm your email" flow — there is no self-serve admin option; see `supabase/migrations/0002_review_gate_and_admin.sql`'s header comment for promoting an account by hand. Login honors a `?redirect=` query param so `BookingCta` can send a visitor back to the listing they were trying to book. |
| `client/src/components/RequireRole.tsx` | Route guard: redirects signed-out visitors to `/login`, wrong-role visitors to `/` with a toast, and shows a "Checking access" fallback while auth is still loading. Generic over `UserRole` (`traveler`/`operator`/`admin`) — used by both `Dashboard.tsx` and `AdminReview.tsx`. |
| `client/src/contexts/AuthContext.tsx` | Session/user/profile state via Supabase Auth (`onAuthStateChange`). Exposes `user`, `profile` (`role`, `displayName`, `businessName`, `bio`), `loading`, `signUp`, `signIn`, `signOut`. `profile` is populated server-side by the `handle_new_user` trigger — never something the client assembles or can forge. `role` is `"traveler" | "operator" | "admin"`. |
| `client/src/contexts/ListingsContext.tsx` | Live catalog, read/written straight from the Supabase `listings` table (no more Express round-trip). Public interface (`listings`, `refresh`, `createListing`, `updateListing`, `deleteListing`, `offline`) is unchanged from the old version so every consumer keeps working. `LiveListing` also carries `reviewNote`/`reviewedAt`. Re-fetches whenever the signed-in user changes, since RLS returns a different row set for a signed-in operator (their own drafts/pending rows included) or admin (every row) than for a signed-out visitor. `createListing` always inserts `status: "pending"`; `updateListing` resubmits (`status: "pending"`) only when the row being edited is currently `"draft"`. |
| `client/src/lib/supabase.ts` | Browser Supabase client (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). |
| `client/src/hooks/useDocumentMeta.ts` | Per-page `document.title`/description/robots/canonical/OG/Twitter/JSON-LD upsert hook — plain DOM APIs, no new dependency. Called by every public page (`Home`, `Explore`, `Tours`, `MapPage`, `ListingPage`, `Plan`, `Login`, `Signup`) with real per-page copy, and by `Dashboard`/`AdminReview` with `noindex: true`. This is the client-rendered half of SEO: real browsers and JS-executing crawlers (Googlebot) get correct metadata this way; non-JS crawlers hit `server/prerender.ts` instead, which mirrors the same data via `shared/seo.ts`. |
| `client/src/lib/slug.ts` | `slugify()` — used by `createListing` to derive a URL slug from a title, retried with a numeric suffix on a unique-constraint collision (`error.code === "23505"`) rather than pre-checked, which stays correct under concurrent writers. |
| `client/src/lib/api.ts` | Typed fetch wrapper for the one remaining server route, `POST /api/plan-trip`. Listings CRUD used to live here; it's gone (see `ListingsContext.tsx`). |
| `client/src/data/listings.ts` | Thin compatibility barrel re-exporting types/constants/seed data from `shared/listings.ts`. |
| `shared/seo.ts` | JSON-LD builders (`buildListingJsonLd`, `buildWebsiteJsonLd`, `buildCollectionPageJsonLd`, `buildBreadcrumbJsonLd`) shared by `useDocumentMeta.ts` and `server/prerender.ts` — the one place structured data is assembled, so the "no fabricated ratings" rule only needs auditing here. `buildListingJsonLd` omits the `offers`/`priceRange` block entirely when a listing has no price (shown as "Rate on request"), so JSON-LD never publishes a fabricated `price: 0`. Imported the same dual-path way as `shared/listings.ts`. |
| `shared/listings.ts` | **Canonical** `Listing`/`ListingInput` types, `EDITABLE_LISTING_TYPES`, seed data, regions, labels, and image asset map. Imported by the client via the `@shared/*` alias and by the server/scripts via relative `../shared/listings.js` paths. No longer the runtime source of truth for live inventory — the Supabase `listings` table is; this file is now the TypeScript type source, the one-time seed (`scripts/seed-catalog.ts`), and the offline-fallback data. |
| `client/src/components/ArmeniaMap.tsx` | Real Leaflet map (no key), CARTO Positron tiles. Brand price-pill DivIcon markers clustered via leaflet.markercluster (apricot count pill), click→`onSelect`, selected-listing summary card, location-based framing (see the Maps rule). Leaflet is created imperatively in effects (no react-leaflet dep); a ResizeObserver + `invalidateSize()` keep it correct inside the mobile map Sheet. Used by Home, Explore, Tours, MapPage, ListingPage, and TourDetail. |
| `client/src/components/BrandMark.tsx` | Approved full and compact Revamp marks. |
| `client/src/components/SearchBar.tsx` | Home and compact catalog search forms. |
| `client/src/components/ListingCard.tsx` | Shared marketplace card and saved-place interaction. |
| `client/src/components/SiteHeader.tsx` | Desktop nav, mobile nav sheet, and the auth-aware account menu — "Sign in"/"Sign up" when signed out; display name + "Sign out" when signed in; a "Dashboard" link appended only for `profile.role === "operator"`. |
| `client/src/components/SiteFooter.tsx` | Footer navigation, brand statement, and illustrative-marketplace disclosure. |
| `client/src/index.css` | Tailwind import, design tokens, brand colors, typography, component geometry, atlas styling, and motion rules. |
| `client/src/components/ui/` | Reusable shadcn/Radix primitives. Prefer these before creating new controls. |
| `client/index.html` | Document metadata, fonts, favicon, and application mount. |
| `server/app.ts` | The Express `app` itself — `trust proxy` (so `req.protocol`/host reflect the real https origin behind Netlify's proxy, used by robots/sitemap/prerender URLs), JSON body parsing, and `registerApiRoutes(app)` — exported with no `listen()`/static-serving. Shared by `server/index.ts` and the Netlify function so the API is defined once. |
| `server/index.ts` | Node entrypoint (`pnpm dev:server`, `pnpm start`): imports `app`, adds the `X-Robots-Tag` noindex header on `/dashboard`/`/admin`, the UA-sniffing bot-prerender middleware, then static SPA serving + the catch-all + `listen()`. Ordering matters — prerender before static. (This UA sniffing only runs for a self-hosted/`pnpm start` deploy; on Netlify the edge function does it — see below.) |
| `netlify/functions/api.ts` | Netlify Function: wraps `server/app.ts` with `serverless-http` and normalizes the incoming path back to `/api/*`. Serves the API (`/api/plan-trip`, `/api/import-listing`, `/api/sync-ical`), the dynamic `/api/robots.txt` + `/api/sitemap.xml` (reached via redirects), and `/api/prerender` (called by the edge function); the CDN serves the SPA. |
| `netlify/edge-functions/prerender.ts` | Netlify **Edge Function** (Deno), the production bot-prerender path. Runs at the edge on page routes, sniffs the UA against a token list (kept in sync with `server/botDetect.ts`), and for a known crawler fetches `/api/prerender` and returns that HTML; everything else (real visitors, assets, `/api/*`, `/dashboard`, `/admin`, dotted paths) falls straight through to the SPA untouched. The heavy rendering stays in `server/prerender.ts` — this file only routes to it, because on Netlify the Node process never sees non-`/api` page routes. |
| `netlify.toml` | Netlify config: `pnpm build` → `dist/public`, functions dir, the `prerender` edge function on `/*` (excluding `/api`/asset dirs), `/api/*` rewrite (force), `/robots.txt` + `/sitemap.xml` rewrites to the function (force), `/* → /index.html` SPA fallback, and `X-Robots-Tag: noindex` headers on `/dashboard`/`/admin`. `VITE_SUPABASE_*` must be set in the Netlify env at build time (see README → Netlify). |
| `server/routes.ts` | `registerApiRoutes(app)` — `POST /api/plan-trip`, `POST /api/import-listing`, `POST /api/sync-ical`, the dynamic `robots.txt`/`sitemap.xml` handlers (registered at both the bare path and an `/api`-prefixed alias for the Netlify function), and `GET /api/prerender` (renders a route's bot HTML; called by the edge function). Listings CRUD used to live here; it's gone (RLS-protected direct-to-Supabase writes replaced it). |
| `server/botDetect.ts` | `KNOWN_BOTS` registry (search engines, AI training/crawl bots, AI answer/search bots, social link-preview bots) and `isCrawlerUserAgent()`. Source of truth for the Node prerender middleware and `server/robots.ts`; the edge function keeps a parallel copy of the same token list for Deno. |
| `server/prerender.ts` | `matchRoute()` (mirrors `App.tsx`'s route order) and `renderForBot()` — hand-written template-string HTML for non-JS crawlers: title/meta/OG/Twitter/JSON-LD plus real visible content and internal links, from `getPublishedCatalog()`. Every operator field is `escapeHtml()`'d and JSON-LD goes through `jsonLdScript()`'s script-breakout guard. A listing slug not in the published catalog renders a real 404. See the "Bot prerendering" Non-Negotiable Rule. |
| `server/robots.ts` / `server/sitemap.ts` | Dynamic `robots.txt` (every `KNOWN_BOTS` entry, `Disallow: /dashboard` and `/admin`, `Sitemap:` line) and `sitemap.xml` (static public routes + one `<url>` per published listing with `<lastmod>`). Origin derives from `req.protocol`/`req.get("host")` (with `trust proxy` set in `server/app.ts`), so both are correct under any domain with no env var. |
| `server/urlPrefill.ts` | `fetchPrefill(url)` for the dashboard's link-import assist — SSRF-guarded fetch (rejects private/loopback addresses, times out, caps response size) plus a small regex-based OpenGraph/meta-tag extractor and a JSON-LD reader (`amenityFeature`/`offers.price`/`address` → `amenities`/`price`/`city`/`region`), with `stripRatings()` scrubbing any star score out of the imported title/description. Best-effort by design: never throws for "nothing found," only for a genuinely bad URL or network failure; malformed/absent JSON-LD is skipped the same way. See its header comment and the "Link-import honesty" Non-Negotiable Rule above before changing it. |
| `server/supabase.ts` | Server-side Supabase client, **anon key only, deliberately** — exports `listPublishedForPlanner()` (planner catalog digest), `verifyUser(token)` (bearer check on import/sync), `userClient(token)` (a per-caller client scoped by RLS for `POST /api/sync-ical`), and `getPublishedCatalog()` (full published-listing projection + `updatedAt`, 5-minute in-memory cache, used by `server/prerender.ts` and `server/sitemap.ts`; its `priceLabel` mirrors the client's "Rate on request" rule for price-0 listings). None need a more privileged key. |
| `server/planner.ts` | Anthropic API call for the trip planner: prompt construction grounded in the live published catalog (via a lightweight `CatalogEntry` projection, not the full `Listing` shape), tolerant JSON extraction/validation of the model's response, mapped error codes. |
| `supabase/migrations/0001_init.sql` | The base schema: `profiles` (+ RLS + `handle_new_user` trigger), `listings` (+ indexes + `set_updated_at` trigger + RLS). |
| `supabase/migrations/0002_review_gate_and_admin.sql` | Adds the review gate: `profiles.role` gains `'admin'`; `listings` gains `'pending'` status plus `review_note`/`reviewed_at`/`reviewed_by`; `is_admin()` helper; updated RLS (operator insert now requires `status = 'pending'`; new admin read/update/delete policies); the `enforce_listing_review_gate` trigger. Run both migrations in order per Supabase project — see "Supabase Setup" below. |
| `scripts/seed-catalog.ts` | One-time script that imports `shared/listings.ts`'s seed rows into the `listings` table under a house "Revamp" operator account, auto-approving the stay/tour rows right after insert (see its header comment) so the seed catalog doesn't clutter the admin's review queue. Run with `pnpm seed:catalog`. |
| `brandbook-implementation.md` | Formal translation of the supplied brandbook into web rules. |
| `marketplace-spec.md` | Product model, route behavior, search logic, page composition, and responsive expectations. |
| `ENVIRONMENT.md` | Environment variable reference. |
| `.env.example` | Template for local `.env`. |

## Routes

| Route | Component | Notes |
| --- | --- | --- |
| `/` | `Home` | Primary discovery landing page. |
| `/explore` | `Explore` | Reads `query`, `type`, and `date` query parameters. |
| `/explore/tour` | `Tours` | Dedicated GetYourGuide-style tours browser. Matched before the generic `:category` route below. |
| `/explore/:category` | `Explore` | Preselects `stay` or `eat` (tour is intercepted by the route above). |
| `/map` | `MapPage` | Full map-first catalog. |
| `/listing/:slug` | `ListingPage` | Resolves records through `findListing`/`findListingIn` against live listings. Tours render via `TourDetail`. |
| `/plan` | `Plan` | AI trip planner form + generated itinerary. Requires `ANTHROPIC_API_KEY` server-side. |
| `/dashboard` | `Dashboard` | Operator-only: add/edit/delete the signed-in operator's own stay/tour listings, optionally starting from a link-import prefill. `RequireRole role="operator"` redirects anyone else. |
| `/admin` | `AdminReview` | Admin-only: approve or send back every `pending` listing. `RequireRole role="admin"` redirects anyone else. |
| `/login` | `Login` | Email/password sign-in. Honors `?redirect=` to return to a listing after `BookingCta` sends someone here. |
| `/signup` | `Signup` | Email/password sign-up with a traveler/operator role toggle. |
| `/404` and fallback | `NotFound` | Branded error state. |

## Data Model

Two Supabase Postgres tables, defined in `supabase/migrations/0001_init.sql` and protected end-to-end by Row-Level Security — application code never needs to (and must never) re-implement an ownership or role check that RLS already does.

**`profiles`** — one row per `auth.users` row, created automatically by the `handle_new_user` trigger from the `role`/`display_name`/`business_name` passed in `AuthContext.signUp()`'s `options.data`. `role` is `'traveler'`, `'operator'`, or (since `0002_review_gate_and_admin.sql`) `'admin'` — chosen once at signup and never client-editable after (the update policy lets a user edit their own `display_name`/`bio`/`business_name`, not `role`). There's no self-serve path to `'admin'`; it's granted with a one-line SQL update, documented in that migration's header comment. Publicly readable (needed to show an operator's name on their listings).

**`listings`** — operator-owned, replaces the old `server/store.ts` JSON file entirely. Canonical shape:

```sql
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles(id),
  type text not null check (type in ('stay','tour','eat')),
  slug text not null unique,
  title text not null, eyebrow text not null,
  city text not null, region text not null,
  lat double precision not null check (lat between 38 and 42),
  lng double precision not null check (lng between 43 and 47),
  image text not null, gallery text[] not null default '{}',
  short_description text not null, long_description text not null,
  price_cents integer not null check (price_cents >= 0),
  price_unit text not null,
  tags text[] not null default '{}',
  amenities text[] not null default '{}',
  facts jsonb not null default '[]',
  featured boolean not null default false,
  accent text not null default 'apricot',
  status text not null check (status in ('draft','pending','published')) default 'draft',
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

(`status`/`review_note`/`reviewed_at`/`reviewed_by` are `0002_review_gate_and_admin.sql`'s additions on top of `0001_init.sql`'s base table.)

RLS on `listings` (see both migrations for the exact policies): anyone (including signed-out visitors) can `select` where `status = 'published'`; an operator can additionally `select` their own rows regardless of status; an admin can `select`/`update`/`delete` every row (`is_admin(auth.uid())`); an operator can `insert` only where `operator_id = auth.uid()` **and** `type in ('stay','tour')` **and** `status = 'pending'` **and** their `profiles.role = 'operator'`, and can `update` their own `stay`/`tour` rows' content freely. There is deliberately no insert policy for `type = 'eat'` at all — see `scripts/seed-catalog.ts`'s header comment for how the seed restaurants get in regardless.

What actually stops an operator from setting `status = 'published'` on their own update is the `enforce_listing_review_gate` trigger (`0002_review_gate_and_admin.sql`), not the update policy — RLS's `with check` can't compare a row's old and new `status`, so a `before update` trigger does: any client-attempted status change is silently reverted unless the caller is an admin, or is the row's own operator moving it `draft → pending` (a resubmission after an admin sent it back). A `null auth.uid()` (a service-role connection — the seed script) is trusted and skips the gate entirely, same as it already skips RLS.

The client-side `LiveListing` type (`client/src/contexts/ListingsContext.tsx`) is `Listing & { operatorId: string; status: "draft" | "pending" | "published"; reviewNote: string | null; reviewedAt: string | null }` — a superset of the original `Listing` type from `shared/listings.ts`, so every existing UI consumer (`TourCard`, `Explore`, `Home`, etc.) keeps compiling and rendering unchanged.

`price_cents` (an integer) is the single source of truth for price at the DB layer, replacing the old hand-maintained `priceLabel` string. `mapListingRow()` in `ListingsContext.tsx` derives the display `priceLabel` (`$78`, `$42.50`, …) from it — nothing stores a formatted price string anymore.

*(Milestone B adds a `bookings` table with a `daterange` exclusion constraint to prevent double-booking a listing, plus Stripe fields; not built yet, but `price_cents` and `operator_id` above are already shaped so that addition won't require touching `listings` again.)*

## State and Navigation

Auth state (`AuthContext`) and listings (`ListingsContext`) both read live from Supabase and both react to sign-in/out — `ListingsContext.refresh()` re-runs whenever `user?.id` changes, since RLS returns a different row set for a signed-in operator (or admin) than for a signed-out visitor. `RequireRole` gates `/dashboard` and `/admin` the same way on the client (for UX — redirect before rendering the form), while RLS + the review-gate trigger are what actually prevent a non-operator/non-admin, or the wrong operator, from writing, regardless of what the client renders.

A submitted stay/tour listing is never visible outside its own operator's `/dashboard` until an admin approves it from `/admin` — `Dashboard.tsx`'s status badge and `AdminReview.tsx`'s queue are two views onto the same `status`/`review_note` columns, not separate systems. Rejecting sets `status: "draft"` with a note; the operator's next save (any edit) resubmits it (`status: "pending"`) automatically, per `enforce_listing_review_gate`.

Booking CTAs (`BookingCta.tsx`) are auth-aware, not simulated: signed out → "Sign in to book" (redirects to `/login?redirect=<current listing>` and back); signed in → a disabled "Payments coming soon" control. This supersedes the old "book" toast entirely — do not reintroduce a toast that implies a booking was noted or confirmed; that's exactly the false claim Milestone A is designed to avoid until Milestone B's real payment flow exists.

Search submission still writes query parameters and navigates to `/explore`; catalog filtering is still client-side; list/map selection still shares listing IDs through component state. Saved/share actions still use Sonner feedback or clipboard behavior only and do not persist.

## Supabase Setup (for whoever deploys this)

1. Create a Supabase project. Copy its URL and anon key into `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `ENVIRONMENT.md`).
2. Run the migrations in `supabase/migrations/` once each, **in order** — `0001_init.sql`, `0002_review_gate_and_admin.sql`, `0003_ical_and_pricing.sql`, `0004_max_guests.sql`, `0005_listing_photos_storage.sql` (SQL Editor, or `supabase db push`/`psql` with the CLI). `0005` creates the public `listing-photos` Storage bucket + RLS so operators can upload listing photos; without it the photo uploader on `/dashboard` reports an upload error (the "paste a URL" fallback still works).
3. Deploy (or run locally with those two vars set) and sign up for a real account at `/signup`, choosing "Operator" — this becomes the house "Revamp" account that owns the seed catalog.
4. Fill in `SUPABASE_SERVICE_ROLE_KEY`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` locally (never commit these) and run `pnpm seed:catalog` once. See `scripts/seed-catalog.ts`'s header comment for exactly what it does and why.
5. To review real operator submissions, sign up a **separate** account for yourself and promote it to admin with the one-line SQL in `0002_review_gate_and_admin.sql`'s header comment — there's no self-serve admin signup.

## Styling and Brand Rules

The interface is light-first and uses CSS variables through Tailwind 4. New colors should not bypass the official palette. Use `bg-apricot` for primary brand orange, `bg-basalt` for charcoal, `bg-paper` for white, and `bg-chalk` for neutral surface tint. Prefer rounded rectangles and rounded squares — note that `.rounded-none` is deliberately repurposed in this codebase to force the brand's standard corner radius (`border-radius: 0.875rem !important`), not to remove rounding; keep using it as the existing components do. Do not restore clipped corners, serif display type, multicolor branding, drop shadows on the wordmark, or non-brand teal/red accents.

The full wordmark must remain **`revamp.`** in lowercase with its terminal period. It must not be split, stacked, outlined, distorted, or recolored letter-by-letter. The compact mark is **`re.`** inside a rounded square.

## Component Conventions

Use TypeScript function components and named exports for reusable components. Page files use default exports. Keep shared UI in `client/src/components`; keep route-level composition in `client/src/pages`; keep canonical types/seed content in `shared/listings.ts` (not duplicated into `client/src/data`). Prefer existing shadcn/Radix primitives from `client/src/components/ui` rather than rebuilding dialogs, sheets, selects, buttons, or tooltips — `Dashboard.tsx`'s form dialog and `Plan.tsx`'s selects already show the pattern.

Use `cn()` from `client/src/lib/utils.ts` for conditional class composition. Use Lucide icons and Sonner toasts already included in the package. Avoid adding dependencies for functionality already present. Use `client/src/lib/api.ts` for any new *server* call (there's only `planTrip` today); use `client/src/lib/supabase.ts` directly, inside the relevant context, for anything that's really a database read/write.

## Assets

Marketplace imagery is self-hosted SVG illustration under `client/public/images/` (11 files: hero, per-region, per-category) and `client/public/brand/revamp-mark.svg` for the logo/favicon, referenced from the `assets` map at the top of `shared/listings.ts`. The marketplace has zero external image dependencies as shipped.

To use real photography: host the images yourself (object storage, CDN, or a `public/` path in this repo if the deployer's build pipeline supports it) and either update the `assets` map in `shared/listings.ts`, or set `image`/`gallery` per listing through `/dashboard` (stay/tour only — restaurant imagery is still edited by hand in `shared/listings.ts` and re-seeded).

## Environment Contract

The catalog and browsing experience need `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` to be genuinely live (accounts, real writes); without them the app still renders using the static seed as a read-only fallback. The AI trip planner (`/plan`, `POST /api/plan-trip`) requires `ANTHROPIC_API_KEY` on the server; without it, the endpoint returns a 503 with a clear message instead of crashing. The link-import assist (`/dashboard`, `POST /api/import-listing`) needs no secret of its own — it reuses the same Supabase anon key to verify the caller's session. `ANTHROPIC_MODEL` optionally overrides the model (defaults to `claude-sonnet-4-5`). `API_PORT` sets the dev-only Express port (default `3001`); `PORT` sets the production port (default `3000`). `SUPABASE_SERVICE_ROLE_KEY`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` are for `scripts/seed-catalog.ts` only — never referenced by any app code, client or server. See `ENVIRONMENT.md` and `.env.example`.

## Quality Gate

Before completing any change, run:

```bash
pnpm check
pnpm build
```

For visual/behavioral changes, inspect at least `/`, `/explore`, `/map`, one `/listing/:slug` route (a stay/eat and a tour), `/dashboard`, `/admin`, `/login`, `/signup`, and `/plan` at desktop and mobile widths. For auth, verify: signing up as a traveler and as an operator; a signed-out visitor is redirected off `/dashboard`/`/admin` to `/login`; a signed-in traveler is redirected off `/dashboard`/`/admin` to `/` with a toast; `SiteHeader`'s account menu and mobile sheet reflect signed-out/traveler/operator/admin state correctly. For `/dashboard`, verify create/edit/delete round-trip through the UI, a new listing lands "Pending review" and does **not** yet appear on `/explore`, that an operator only ever sees/edits their **own** listings, and that the "prefill from a link" control fills the title/description best-effort without ever writing the fetched image into the listing. For `/admin`, verify a non-admin is redirected away, the pending queue shows the operator's name, approving makes the listing appear on `/explore` immediately, and rejecting-with-a-note surfaces that note on the operator's `/dashboard` and resubmitting (any edit) moves it back to "Pending review." For booking CTAs, verify: signed-out shows "Sign in to book" and returns to the same listing after signing in; signed-in shows the disabled "Payments coming soon" state, never a toast implying success. For `/plan`, verify the request/response wiring and error states (missing API key, validation errors) even if a live `ANTHROPIC_API_KEY` isn't available in the current environment. Confirm there are no console errors, overflow issues, unreadable image overlays, or dead navigation paths.

## Common Change Recipes

| Change | Preferred edit |
| --- | --- |
| Add or modify seed inventory | Edit `shared/listings.ts` (`seedListings`), then re-run `pnpm seed:catalog` against a project that already ran the migration (it skips rows that already exist by slug). Only affects what the seed script inserts — not already-live rows. |
| Change what's operator-writable | Edit `EDITABLE_LISTING_TYPES` in `shared/listings.ts` **and** the matching `type in (...)` checks in every write policy on `public.listings` in `supabase/migrations/0001_init.sql` — the client constant alone changes nothing without the RLS update, and vice versa. |
| Change route behavior | Edit `client/src/App.tsx` and the relevant page. |
| Update brand tokens | Edit `client/src/index.css` and verify all four representative routes plus `/dashboard`, `/login`/`/signup`, and `/plan`. |
| Modify global navigation | Edit `SiteHeader.tsx` and `SiteFooter.tsx` together; keep the auth-aware account menu logic in `SiteHeader.tsx` in sync with `AuthContext`'s `profile.role`. |
| Change map selection or marker layout | Edit `ArmeniaMap.tsx`; preserve ID-based synchronization. |
| Change what a listing stores, or an RLS policy | Add a new migration file (don't edit `0001_init.sql`/`0002_review_gate_and_admin.sql` in place once they've been run anywhere real) and the matching `ListingRow`/`toRow`/`mapListingRow` in `client/src/contexts/ListingsContext.tsx`. |
| Change auth/profile fields, or add a role | Edit `supabase/migrations/*.sql` (the `profiles` table + `handle_new_user`) and `client/src/contexts/AuthContext.tsx` (`UserRole`, `Profile` type, `mapProfile`, `signUp`) together. |
| Change the review-gate state machine | Edit the `enforce_listing_review_gate` trigger function in a new migration (never loosen the "only an admin, or the row's own operator resubmitting draft→pending, may change status" rule without deliberately deciding to) and `client/src/contexts/ListingsContext.tsx`'s `createListing`/`updateListing` to match. |
| Fix / change the dashboard address autocomplete | Edit `client/src/lib/googleMaps.ts` — `extractResolvedPlace()` for the result shape, or the `v=weekly`→`v=beta` channel in the script URL if the widget won't load. `PlaceAutocomplete.tsx` and `Dashboard.tsx`'s `setField` calls consume its normalized `ResolvedPlace` and rarely need changing. Requires `VITE_GOOGLE_MAPS_API_KEY` (browser key, "Places API (New)" — see ENVIRONMENT.md). |
| Change listing-photo upload (limits, compression, bucket) | Edit `client/src/components/PhotoUploader.tsx` (`MAX_PHOTOS`/`MAX_DIMENSION`/`JPEG_QUALITY`/`BUCKET`); the bucket + RLS live in `supabase/migrations/0005_listing_photos_storage.sql`. Photos flow into `image`/`gallery` via `toInputPayload` in `Dashboard.tsx`; anything rendering an image must handle absolute URLs (see the Assets rule). |
| Change the curated amenity/inclusion options an operator can pick from | Edit `CATALOGS`/`STAY_GROUPS`/`TOUR_GROUPS` in `client/src/components/AmenityPicker.tsx`. No schema change needed — amenities are still stored as a `text[]`; this only changes the checkbox options offered in the dashboard form. |
| Change the booking CTA | Edit `client/src/components/BookingCta.tsx` — it's shared by every call site; don't re-fork the auth-state logic per page. |
| Add a prerendered page kind, or change per-page SEO copy | Edit `PageKind`/`matchRoute()`/the relevant `render*` in `server/prerender.ts` (bots) **and** that page's `useDocumentMeta()` call (real browsers/JS crawlers) so both agree; add the route to `STATIC_ROUTES` in `server/sitemap.ts` if it isn't listing-derived. |
| Change which bots are recognized, or the robots policy | Edit `KNOWN_BOTS` in `server/botDetect.ts` (drives the Node middleware + `server/robots.ts`) **and** the parallel token array in `netlify/edge-functions/prerender.ts` (the Deno edge path) — keep the two in sync. |
| Change structured data (JSON-LD) | Edit `shared/seo.ts` — never add a rating/review field (see the "Customer content" rule); it feeds both the client hook and the prerenderer. |
| Change the link-import prefill | Edit `server/urlPrefill.ts` (OpenGraph/JSON-LD extraction, SSRF-guard logic — extend `PrefillResult` for a new field), `client/src/lib/api.ts`'s `ListingPrefill` type to match, and `client/src/pages/Dashboard.tsx`'s `handleImport` (what the returned fields prefill). Keep the fetched image reference-only — see the Link-import honesty rule. |
| Change the trip-planner prompt or response shape | Edit `server/planner.ts` (`buildPrompt`, `validateItinerary`) and the matching types in `client/src/lib/api.ts`/`client/src/pages/Plan.tsx`. |
| Add real payments/bookings (Milestone B) | Stop and design a deliberate upgrade — new schema (`bookings` with an overlap-exclusion constraint), new Netlify Functions for Stripe Checkout + webhook, and an update to this file's Non-Negotiable Rules — rather than wiring Stripe into `BookingCta.tsx` ad hoc. |

## Milestone B (not yet built)

Scoped here for continuity, not implemented: a `bookings` table with a `daterange` exclusion constraint (`EXCLUDE USING gist`, needs the `btree_gist` extension) to make double-booking structurally impossible; two new Netlify Functions (`create-checkout-session`, `stripe-webhook` — the webhook needs to bypass Express's JSON body parser to verify Stripe's signature against the raw request body); a real date/traveler-count booking UI in `BookingCta.tsx` replacing the "Payments coming soon" state; `/trips` for travelers; a "Bookings" tab on `/dashboard` for operators; `/booking/success`/`/booking/cancelled` return pages. Needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in addition to this milestone's Supabase keys.

## Definition of Done

A change is complete when the requested behavior works on relevant routes, TypeScript and production builds pass, responsive states remain usable, the brandbook is respected, no false customer, inventory, or payment claims were introduced (including in AI-generated text, a booking CTA's label, or any JSON-LD structured data), restaurant listings remain non-writable at the RLS layer (not just hidden in the UI), operator-owned data stays scoped to its owner under RLS, a new or edited-after-rejection listing cannot become publicly visible without an admin's approval, the link-import assist never writes a fetched third-party image into a listing automatically, a public page still returns correct real content to a known crawler UA (`curl -A "GPTBot" ...`) after any route or content change while `/dashboard`/`/admin` are never handed to a crawler as rendered content, and any new architectural decision is reflected in this file or the README.
