# Revamp Travel: Claude Code Guide

This file is the primary operating guide for Claude Code. Read it before changing the repository. The application is a **full-stack Armenian travel marketplace**: a React/TypeScript/Vite/Tailwind CSS 4/Wouter/Radix-shadcn/Sonner client in front of a small **Express + Zod** API with file-backed persistence, plus a server-side **Anthropic API** integration for AI trip planning.

## Product Intent

Revamp Travel helps visitors discover Armenian places to stay, restaurants, tours, and regions through editorial content, search, filtering, listing cards, an interactive SVG atlas, and individual listing pages. Stay and tour listings are now a **real, shared, editable inventory** (add/edit/delete via `/manage`, persisted server-side and visible to every visitor); restaurants remain curated/editorial content. An **AI trip planner** (`/plan`) generates day-by-day itineraries grounded in the live catalog via the Anthropic API. The product still does not claim live pricing sync, real booking/payment processing, or verified customer feedback.

## Non-Negotiable Rules

| Rule | Required behavior |
| --- | --- |
| Brandbook | Preserve the lowercase **`revamp.`** wordmark, compact **`re.`** mark, **#F15822** orange, **#212121** charcoal, **#FFFFFF** white, Circular-like sans typography, rounded containers, and large cropped logo patterns. Read `brandbook-implementation.md` before visual work. |
| Customer content | Never invent customer reviews, ratings, testimonials, booking counts, "verified" claims, or social proof — including inside AI-generated itinerary text. Curatorial labels are acceptable only when clearly editorial. |
| Inventory claims | Rates and availability are illustrative. Do not imply that payment, reservation, or real-time inventory sync is live. The **listings themselves** are genuinely persisted (stay/tour), which is different from claiming live booking. |
| Source boundaries | The server does two, and only two, deliberate jobs: (1) CRUD persistence for stay/tour listings (`server/store.ts`, `server/routes.ts`) and (2) the Anthropic-backed trip planner (`server/planner.ts`). Do not add authentication, payments, or other backend surface area without a deliberate upgrade discussion the same way this one happened. |
| Editable inventory | Only `type: "stay"` and `type: "tour"` listings are editable (`EDITABLE_LISTING_TYPES` in `shared/listings.ts`). Restaurants (`type: "eat"`) must stay creation/edit/delete-proof at the API layer, not just hidden in the UI. |
| Assets | Site imagery is self-hosted SVG under `client/public/images/` and `client/public/brand/` — no external image hosts (this environment cannot reach arbitrary remote hosts, and it removes a fragile dependency). New imagery should follow the same pattern, or be a real photo the deployer hosts themselves and points `image`/`gallery` at. |
| Maps | The current map is a deterministic SVG-based Armenia atlas in `client/src/components/ArmeniaMap.tsx`. It requires no API key. Do not replace it with a third-party map unless explicitly requested. |
| Secrets | `ANTHROPIC_API_KEY` is server-side only. Never read it from client code, log it, echo it in an API response, or hardcode a fallback value. |
| Routing | Every detail page must retain an escape route. Preserve the global header and back links. |
| Accessibility | Keep semantic labels, visible focus treatment, keyboard-reachable controls, `SheetDescription` values, image alt text, and reduced-motion behavior. |

## Fast Start

Use **Node.js 22+** and **pnpm 10+**.

```bash
pnpm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY to exercise /plan
pnpm dev
```

`pnpm dev` runs two processes concurrently: Vite (client, HMR, port 3000) and the Express API (`server/index.ts` via `tsx watch`, `API_PORT`, default 3001). Vite proxies `/api/*` to the API process — open the URL Vite prints; there's nothing to visit on the API port directly.

For validation, run:

```bash
pnpm check
pnpm build
pnpm preview   # client-only static preview
pnpm start     # real production run: one process, built SPA + /api/*
```

`pnpm check` runs TypeScript without emitting files. `pnpm build` builds the browser application into `dist/public` and bundles the Express server into `dist/index.js`.

## Repository Map

| Path | Responsibility |
| --- | --- |
| `client/src/App.tsx` | Top-level providers (`ThemeProvider`, `ListingsProvider`) and route declarations, including `/plan` and `/manage`. |
| `client/src/pages/Home.tsx` | Editorial home experience, categories, featured listings, regions, map preview, and main search entry. Reads live listings via `useListings()`. |
| `client/src/pages/Explore.tsx` | Searchable and filterable marketplace results with desktop list/map split and mobile map sheet. Reads live listings via `useListings()`. |
| `client/src/pages/MapPage.tsx` | Map-led discovery view with synchronized listing rail. Reads live listings via `useListings()`. |
| `client/src/pages/ListingPage.tsx` | Shared detail-page template for stays, restaurants, and tours. Reads live listings via `useListings()`. |
| `client/src/pages/Manage.tsx` | Add/edit/delete UI for stay and tour listings. Calls the CRUD API through `client/src/lib/api.ts`; restaurants are shown read-only. |
| `client/src/pages/Tours.tsx` | Dedicated GetYourGuide-style browser for `/explore/tour` specifically (hero band + search, real-tag category pills, duration buckets, sort, map sheet, boxed card grid). Kept separate from `Explore.tsx` so stay/eat/all keep the original editorial layout. All filters/pills are derived from the live catalog's own tags and facts — never hardcoded categories. |
| `client/src/components/TourCard.tsx` | Boxed activity card used only on `/explore/tour`: hoverable photo carousel from the listing's `gallery`, and a duration/group/level facts row in the slot where a card like this would normally show star ratings — deliberate, since fabricated ratings/reviews are banned (see Non-Negotiable Rules). |
| `client/src/pages/Plan.tsx` | AI trip planner UI: trip-parameter form plus itinerary result panel (loading/error/empty/success). Calls `POST /api/plan-trip`. |
| `client/src/pages/NotFound.tsx` | Branded fallback route. |
| `client/src/contexts/ListingsContext.tsx` | Fetches `/api/listings` on mount, exposes `listings`, `create`/`update`/`remove`, `refresh()`, and an `offline` flag (falls back to `shared/listings.ts` seed data if the API is unreachable). |
| `client/src/lib/api.ts` | Typed fetch wrappers for `/api/listings` CRUD and `/api/plan-trip`; `ApiError` for structured error handling. |
| `client/src/data/listings.ts` | Thin compatibility barrel re-exporting types/constants/seed data from `shared/listings.ts` (kept so existing type-only importers didn't need to change). |
| `shared/listings.ts` | **Canonical** `Listing`/`ListingInput` types, `EDITABLE_LISTING_TYPES`, seed data, regions, labels, and image asset map. Imported by the client via the `@shared/*` alias and by the server via relative `../shared/*.js` paths. |
| `client/src/components/ArmeniaMap.tsx` | Interactive SVG atlas, coordinate projection, markers, and selected-listing summary. |
| `client/src/components/BrandMark.tsx` | Approved full and compact Revamp marks. |
| `client/src/components/SearchBar.tsx` | Home and compact catalog search forms. |
| `client/src/components/ListingCard.tsx` | Shared marketplace card and saved-place interaction. |
| `client/src/components/SiteHeader.tsx` | Desktop navigation, mobile navigation sheet, and global discovery action. Includes `/plan` and `/manage` links. |
| `client/src/components/SiteFooter.tsx` | Footer navigation, brand statement, and illustrative-marketplace disclosure. Includes `/plan` and `/manage` links. |
| `client/src/index.css` | Tailwind import, design tokens, brand colors, typography, component geometry, atlas styling, and motion rules. |
| `client/src/components/ui/` | Reusable shadcn/Radix primitives. Prefer these before creating new controls. |
| `client/index.html` | Document metadata, fonts, favicon, and application mount. |
| `server/app.ts` | The Express `app` itself — JSON body parsing + `registerApiRoutes(app)` — exported with no `listen()`/static-serving. Shared by `server/index.ts` and the Netlify function so the API is defined once. |
| `server/index.ts` | Node entrypoint (`pnpm dev:server`, `pnpm start`): imports `app`, adds static SPA serving + the catch-all + `listen()`. These are the parts a persistent process needs and a serverless function doesn't. |
| `netlify/functions/api.ts` | Netlify Function: wraps `server/app.ts` with `serverless-http`. Normalizes the incoming path back to `/api/*` (Netlify rewrite) before handing off to Express. Netlify's CDN serves the SPA; this serves only the API. |
| `netlify.toml` | Netlify config: `pnpm build` → `dist/public`, functions dir, `/api/* → /.netlify/functions/api/:splat` rewrite (force), and `/* → /index.html` SPA fallback. |
| `server/routes.ts` | `registerApiRoutes(app)` — `/api/listings` CRUD (Zod-validated, enforces `EDITABLE_LISTING_TYPES`) and `POST /api/plan-trip`. |
| `server/store.ts` | Persistence for listings behind one read/create/update/remove/slugify contract, with two backends chosen at load: a JSON file (`server/data/listings.json`, gitignored, local dev/`pnpm start`) or **Netlify Blobs** (`getStore("listings")`, one JSON blob) when `process.env.NETLIFY` is set. Both seed once from `shared/listings.ts` and serialize writes through a queue. |
| `server/planner.ts` | Anthropic API call for the trip planner: prompt construction grounded in the live catalog, tolerant JSON extraction/validation of the model's response, mapped error codes. |
| `brandbook-implementation.md` | Formal translation of the supplied brandbook into web rules. |
| `marketplace-spec.md` | Product model, route behavior, search logic, page composition, and responsive expectations. |
| `ENVIRONMENT.md` | Environment variable reference. |
| `.env.example` | Template for local `.env` (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `API_PORT`). |

## Routes

| Route | Component | Notes |
| --- | --- | --- |
| `/` | `Home` | Primary discovery landing page. |
| `/explore` | `Explore` | Reads `query`, `type`, and `date` query parameters. |
| `/explore/tour` | `Tours` | Dedicated GetYourGuide-style tours browser. Matched before the generic `:category` route below. |
| `/explore/:category` | `Explore` | Preselects `stay` or `eat` (tour is intercepted by the route above). |
| `/map` | `MapPage` | Full map-first catalog. |
| `/listing/:slug` | `ListingPage` | Resolves records through `findListing`/`findListingIn` against live listings. |
| `/plan` | `Plan` | AI trip planner form + generated itinerary. Requires `ANTHROPIC_API_KEY` server-side. |
| `/manage` | `Manage` | Add/edit/delete stay and tour listings. Restaurants shown read-only. |
| `/404` and fallback | `NotFound` | Branded error state. |

## Data Model

The canonical `Listing` interface lives in `shared/listings.ts` (re-exported through `client/src/data/listings.ts` for existing importers). Every listing has a stable `id` and URL-safe `slug`; one of three `type` values (`stay`, `eat`, `tour`); city, region, and coordinates (must stay inside Armenia: lat 38–42, lng 43–47); image and gallery URLs; short and long descriptions; numeric and formatted price data; tags, facts, and amenities; optional featured placement; and a marker accent token.

`ListingInput` (also in `shared/listings.ts`) is the create/update payload shape (everything but `id`/`slug`, which the server derives/keeps stable). `EDITABLE_LISTING_TYPES = ["stay", "tour"]` gates which types the API will create, update, or delete — restaurants are seed/editorial-only and the API returns 403 for write attempts against them.

Listings are no longer a static import consumed directly by pages — they flow through `ListingsContext` (`GET /api/listings` on mount, live thereafter). `shared/listings.ts`'s `seedListings` is now only: (a) the one-time seed written to `server/data/listings.json` on first run, and (b) the client's offline fallback if the API can't be reached. Do not add star ratings or testimonials to any listing, seed or user-created.

## State and Navigation

Listings persistence is now real: `POST/PUT/DELETE /api/listings/:id` write through `server/store.ts` to `server/data/listings.json`, and every client page reads the same live catalog via `useListings()` (`ListingsContext`), so changes appear everywhere immediately (cards, filters, map, detail pages) for every visitor of that server instance — this supersedes the old "do not simulate persistence" framing, since persistence is now genuinely implemented, not simulated. Search submission still writes query parameters and navigates to `/explore`; catalog filtering is still client-side; list/map selection still shares listing IDs through component state. Saved/share actions still use Sonner feedback or clipboard behavior only and do not persist — extending those, or adding accounts/auth/payments, is a new deliberate upgrade, not something to bolt onto the existing endpoints.

## Styling and Brand Rules

The interface is light-first and uses CSS variables through Tailwind 4. New colors should not bypass the official palette. Use `bg-apricot` for primary brand orange, `bg-basalt` for charcoal, `bg-paper` for white, and `bg-chalk` for neutral surface tint. Prefer rounded rectangles and rounded squares — note that `.rounded-none` is deliberately repurposed in this codebase to force the brand's standard corner radius (`border-radius: 0.875rem !important`), not to remove rounding; keep using it as the existing components do. Do not restore clipped corners, serif display type, multicolor branding, drop shadows on the wordmark, or non-brand teal/red accents.

The full wordmark must remain **`revamp.`** in lowercase with its terminal period. It must not be split, stacked, outlined, distorted, or recolored letter-by-letter. The compact mark is **`re.`** inside a rounded square.

## Component Conventions

Use TypeScript function components and named exports for reusable components. Page files use default exports. Keep shared UI in `client/src/components`; keep route-level composition in `client/src/pages`; keep canonical types/seed content in `shared/listings.ts` (not duplicated into `client/src/data`). Prefer existing shadcn/Radix primitives from `client/src/components/ui` rather than rebuilding dialogs, sheets, selects, buttons, or tooltips — `Manage.tsx`'s form dialog and `Plan.tsx`'s selects already show the pattern.

Use `cn()` from `client/src/lib/utils.ts` for conditional class composition. Use Lucide icons and Sonner toasts already included in the package. Avoid adding dependencies for functionality already present. Use `client/src/lib/api.ts` for any new server call rather than calling `fetch` directly from a component.

## Assets

Marketplace imagery is self-hosted SVG illustration under `client/public/images/` (11 files: hero, per-region, per-category) and `client/public/brand/revamp-mark.svg` for the logo/favicon, referenced from the `assets` map at the top of `shared/listings.ts`. This replaced the original Manus-managed `/manus-storage/...` paths and the previous build's `images.unsplash.com` URLs — this sandbox has no outbound network access to arbitrary external hosts, so any external image dependency was unverifiable and a real deployment risk. The marketplace has zero external image dependencies as shipped.

To use real photography: host the images yourself (object storage, CDN, or a `public/` path in this repo if the deployer's build pipeline supports it) and either update the `assets` map in `shared/listings.ts`, or set `image`/`gallery` per listing through `/manage` (stay/tour only — restaurant imagery is still edited by hand in `shared/listings.ts`).

## Environment Contract

The catalog and browsing experience need no secrets. The AI trip planner (`/plan`, `POST /api/plan-trip`) requires `ANTHROPIC_API_KEY` on the server; without it, the endpoint returns a 503 with a clear message instead of crashing. `ANTHROPIC_MODEL` optionally overrides the model (defaults to `claude-sonnet-4-5`). `API_PORT` sets the dev-only Express port (default `3001`); `PORT` sets the production port (default `3000`). See `ENVIRONMENT.md` and `.env.example`.

On Netlify, set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) in the site environment (`netlify env:set …` or the dashboard) — never commit it. `NETLIFY` is set automatically by the Functions runtime and switches `server/store.ts` to the Netlify Blobs backend; you never set it yourself, and Blobs needs no separate credentials from inside a function. See the README's "Deployment → Option B — Netlify" section for the full flow.

## Quality Gate

Before completing any change, run:

```bash
pnpm check
pnpm build
```

For visual/behavioral changes, inspect at least `/`, `/explore`, `/map`, one `/listing/:slug` route, `/manage`, and `/plan` at desktop and mobile widths. For `/manage`, verify create/edit/delete round-trip through the UI and that changes show up on `/`, `/explore`, and the listing detail page. For `/plan`, verify the request/response wiring and error states (missing API key, validation errors) even if a live `ANTHROPIC_API_KEY` isn't available in the current environment. Confirm there are no console errors, overflow issues, unreadable image overlays, or dead navigation paths.

## Common Change Recipes

| Change | Preferred edit |
| --- | --- |
| Add or modify seed inventory | Edit `shared/listings.ts` (`seedListings`). Only affects fresh installs — see Data Model. |
| Change what's editable via `/manage` | Edit `EDITABLE_LISTING_TYPES` in `shared/listings.ts` and the corresponding checks in `server/routes.ts`. |
| Change route behavior | Edit `client/src/App.tsx` and the relevant page. |
| Update brand tokens | Edit `client/src/index.css` and verify all four representative routes plus `/manage` and `/plan`. |
| Modify global navigation | Edit `SiteHeader.tsx` and `SiteFooter.tsx` together. |
| Change map selection or marker layout | Edit `ArmeniaMap.tsx`; preserve ID-based synchronization. |
| Change the CRUD API or validation | Edit `server/routes.ts` (Zod schemas) and `server/store.ts` (persistence) together; update `client/src/lib/api.ts` types to match. |
| Change the trip-planner prompt or response shape | Edit `server/planner.ts` (`buildPrompt`, `validateItinerary`) and the matching types in `client/src/lib/api.ts`/`client/src/pages/Plan.tsx`. |
| Add genuinely new backend surface area (auth, payments, bookings) | Stop and design a deliberate upgrade — new schema, error states, and a Non-Negotiable Rules update — rather than extending `routes.ts`/`store.ts` ad hoc. |

## Definition of Done

A change is complete when the requested behavior works on relevant routes, TypeScript and production builds pass, responsive states remain usable, the brandbook is respected, no false customer or inventory claims were introduced (including in AI-generated text), restaurant listings remain non-editable via the API, and any new architectural decision is reflected in this file or the README.
