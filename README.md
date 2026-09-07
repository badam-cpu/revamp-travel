# Revamp Travel Marketplace

Revamp Travel is a polished Armenian travel-discovery marketplace for browsing places to stay, restaurants, tours, and regional experiences. It combines editorial storytelling with client-side search, category and region filters, a responsive interactive Armenia atlas, shared detail pages, an editable stay/tour catalog, and an AI trip planner.

## Current Status

The repository is a **full-stack application**: a React SPA in front of a small Express API with file-backed persistence. It demonstrates the full discovery journey and now supports a real, shared, editable inventory for stays and tours plus AI-generated itineraries — but it still has no reservation processing, accounts, payments, or real booking availability. Displayed rates remain illustrative.

| Area | Included |
| --- | --- |
| Home discovery | Hero, unified search, category gateways, featured listings, regions, atlas preview, and closing CTA. |
| Marketplace catalog | Text search, category filters, region filter, empty state, responsive cards, and desktop/mobile map presentation. |
| Listings | Shared stay, restaurant, and tour detail page with gallery, facts, amenities, date input, location atlas, and related records. |
| **Manage (`/manage`)** | **Add, edit, and delete stay and tour listings** through a form UI. Changes persist server-side and appear everywhere (cards, filters, map, detail pages) immediately for every visitor. Restaurants stay editorial/static. |
| **AI Trip Planner (`/plan`)** | **A day-by-day itinerary generator** that calls the Anthropic API server-side, grounded in the site's *live* stay/tour/restaurant catalog. Requires `ANTHROPIC_API_KEY` (see Environment below). |
| Maps | Deterministic SVG-based Armenia atlas with price markers and synchronized selection. No external map key is required. |
| Brand | Revamp brandbook implementation with lowercase `revamp.` wordmark, `re.` compact mark, #F15822 orange, #212121 charcoal, white, rounded geometry, and sans typography. |

## Technology

React 19, TypeScript, Vite 7, Tailwind CSS 4, Wouter, Radix UI/shadcn components, Lucide icons, and Sonner on the client. Express, Zod, and the official `@anthropic-ai/sdk` on the server. Listings persist to a JSON file (`server/data/listings.json`, created and seeded automatically); there is no external database to provision.

## Requirements

Use Node.js 22 or newer and pnpm 10 or newer.

```bash
node --version
pnpm --version
```

## Local Setup

```bash
pnpm install
cp .env.example .env   # then fill in ANTHROPIC_API_KEY to enable /plan
pnpm dev
```

`pnpm dev` runs two processes together (via `concurrently`): Vite (the client, with HMR) and the Express API (`server/index.ts` via `tsx watch`, on `API_PORT`, default `3001`). Vite proxies `/api/*` requests to it, so open the URL Vite prints — there's nothing to visit on the API's own port directly.

## Validation and Production Build

```bash
pnpm check
pnpm build
pnpm preview
```

`pnpm build` builds the client into `dist/public` and bundles the Express server into `dist/index.js`. `pnpm preview` (Vite's static preview) only serves the client — to run the real thing after building:

```bash
pnpm start
```

This single process serves the built SPA **and** the `/api/*` routes on one `PORT` (default `3000`).

## Project Structure

```text
client/
  index.html
  public/
    brand/revamp-mark.svg
    images/                 # self-hosted brand illustrations (see Assets below)
  src/
    components/
      ui/
      ArmeniaMap.tsx
      BrandMark.tsx
      ListingCard.tsx
      SearchBar.tsx
      SiteFooter.tsx
      SiteHeader.tsx
    contexts/
      ThemeContext.tsx
      ListingsContext.tsx   # live catalog: fetches /api/listings, exposes create/update/delete
    data/
      listings.ts           # thin compatibility barrel over shared/listings.ts
    lib/
      api.ts                 # fetch wrappers for the Express API
    pages/
      Explore.tsx
      Home.tsx
      ListingPage.tsx
      Manage.tsx             # add/edit/delete stays & tours
      MapPage.tsx
      Plan.tsx               # AI trip planner
      NotFound.tsx
    App.tsx
    index.css
    main.tsx
server/
  app.ts                     # the Express app (routes + JSON parsing), exported for reuse
  index.ts                   # Node entrypoint: imports app, adds static SPA serving + listen()
  routes.ts                  # /api/listings CRUD + /api/plan-trip, with Zod validation
  store.ts                   # persistence: JSON file locally, Netlify Blobs on Netlify (same contract)
  planner.ts                 # Anthropic API call + prompt/response handling for the trip planner
netlify/
  functions/
    api.ts                   # wraps server/app.ts with serverless-http (Netlify Function)
netlify.toml                 # build, functions dir, /api rewrite, SPA fallback
shared/
  listings.ts                # canonical Listing type, seed data, and constants (client + server)
  const.ts
CLAUDE.md
brandbook-implementation.md
marketplace-spec.md
ENVIRONMENT.md
```

## Product Routes

| URL | Purpose |
| --- | --- |
| `/` | Editorial home and unified search. |
| `/explore` | All listings with search and filters. |
| `/explore/stay` | Stay category. |
| `/explore/eat` | Restaurant category. |
| `/explore/tour` | Tour category. |
| `/map` | Full map-led discovery. |
| `/listing/:slug` | Individual listing detail. |
| `/plan` | AI trip planner. |
| `/manage` | Add, edit, and delete stay and tour listings. |

## Editing Inventory

Two ways, depending on what you're doing:

- **Day to day / for real users:** open `/manage` and use the form UI. Writes go through `POST`/`PUT`/`DELETE /api/listings/:id` (validated with Zod in `server/routes.ts`) and persist to `server/data/listings.json`. Every page reads the live catalog through `ListingsContext` (`client/src/contexts/ListingsContext.tsx`), so changes show up everywhere immediately — cards, filters, map markers, related content, and slug-based detail pages.
- **Seeding a fresh install:** `shared/listings.ts` is the one-time seed `server/store.ts` writes to `server/data/listings.json` the first time it runs. Editing it after that file already exists has no effect on a running deployment — delete `server/data/listings.json` (or use a fresh environment) to reseed. Restaurants (`type: "eat"`) are seed/editorial-only; the API refuses to create, edit, or delete them (`EDITABLE_LISTING_TYPES` in `shared/listings.ts` covers `stay` and `tour` only) so the curated table content can't be edited away by mistake.

Either way: keep coordinates within Armenia (lat 38–42, lng 43–47 — enforced server-side) and don't add invented customer ratings, reviews, testimonials, booking counts, or verification claims.

## Brand Guidance

Read `brandbook-implementation.md` before visual changes. The formal brand system is minimal and tightly controlled. Use the intact lowercase `revamp.` wordmark with its terminal period, the compact `re.` mark, orange #F15822, charcoal #212121, and white #FFFFFF. Circular Std is the specified brand family; the code uses Manrope as the licensed web-safe visual substitute unless Circular Std is available in the environment.

## Assets and Portability

Image URLs are defined in `shared/listings.ts`. This fork replaced the original Manus-managed `/manus-storage/...` paths — and the previous build's hardcoded `images.unsplash.com` photo IDs, which this environment had no way to verify were still live — with self-hosted brand illustrations under `client/public/images/` (plain SVG, no external requests). The marketplace now has **zero external image dependencies** and works fully offline/air-gapped for images. Swap in real photography whenever it's available: update the `assets` map at the top of `shared/listings.ts`, or set an `image` URL per listing through `/manage`.

## Environment

The **catalog and browsing experience need no secrets.** The **AI trip planner needs `ANTHROPIC_API_KEY`** (server-side only — it's never sent to the browser). See `ENVIRONMENT.md` for the full list of variables, including the optional `ANTHROPIC_MODEL` override and the dev-only `API_PORT`.

## Claude Code

Claude Code should read `CLAUDE.md` first. That file documents the architecture, non-negotiable content and brand constraints, route behavior, component conventions, asset model, quality gates, and common change recipes.

## Deployment

The server does real, deliberate backend work (see CLAUDE.md): it persists listings and calls the Anthropic API for trip planning. There's still no authentication, real reservations, payments, or private user accounts — adding those would be its own deliberate upgrade, the same way this one was.

### Option A — single Node process (VPS, container, etc.)

Build with `pnpm build`, then run `pnpm start` with `PORT` and `ANTHROPIC_API_KEY` set. This serves the built SPA **and** `/api/*` from one process and persists listings to a JSON file at `server/data/listings.json`, so the process needs a **writable, persistent filesystem**. Good for a single long-running instance.

### Option B — Netlify (serverless)

Netlify runs the API as a **serverless function**, not a persistent process, so the listings store switches from the JSON file to **Netlify Blobs** automatically (detected via `process.env.NETLIFY` in `server/store.ts`). Nothing else about the app changes — same routes, same Zod validation, same planner.

Moving parts:

- **`netlify.toml`** — build command `pnpm build` (client → `dist/public`), functions directory `netlify/functions`, an `/api/* → /.netlify/functions/api/:splat` rewrite, and a SPA fallback (`/* → /index.html`) for wouter's client-side routing.
- **`netlify/functions/api.ts`** — wraps the shared Express `app` (`server/app.ts`) with [`serverless-http`](https://github.com/dougmoscrop/serverless-http). Netlify's CDN serves the static SPA; the function serves only the API.
- **`server/app.ts`** — the Express `app` (routes + JSON parsing) exported on its own, so both the Node entrypoint (`server/index.ts`) and the Netlify function can import it. `server/index.ts` keeps the static-serving + `listen()` code that only the persistent process needs.
- **Storage** — `server/store.ts` keeps the file backend for local dev/`pnpm start` and uses a single Netlify Blobs store (`getStore("listings")`, one JSON blob) when running as a function. It seeds from `shared/listings.ts` on first read if the store is empty, mirroring the old fresh-file behavior. Blobs needs no extra credentials from inside a function.

Deploy with the [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli      # if not already installed
netlify login                   # if not already authenticated
netlify init                    # first time: create/link a site
netlify env:set ANTHROPIC_API_KEY <your-key>   # required for /plan
netlify deploy --build --prod   # build (runs pnpm build + bundles functions) and deploy
```

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) in the Netlify site environment — never commit it. If `/plan` returns a 503, confirm the key is set for the context you deployed to (production vs. deploy previews).
