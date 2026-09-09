# Revamp Travel Marketplace

Revamp Travel is a two-sided Armenian travel marketplace. Travelers browse places to stay, restaurants, tours, and regional experiences through editorial content, search, and an interactive Armenia atlas. Operators sign up for their own account and build stay/tour listings — optionally starting from a link to an existing listing elsewhere for a quick prefill — which go through a short review before appearing anywhere else. An AI trip planner generates itineraries grounded in the live, published catalog.

## Current Status

The repository is a **full-stack application**: a React SPA talking directly to **Supabase** (Postgres + Auth + Row-Level Security) for accounts and listings, in front of a small Express API that does two jobs — the Anthropic-backed trip planner, and a link-import prefill assist for the operator dashboard. This is **Milestone A**: real accounts, real operator-owned listings, real RLS-enforced ownership, and a review/publish gate — but **no real payments yet**. Booking CTAs are honest about that: signed out shows "Sign in to book"; signed in shows a disabled "Payments coming soon" state. Displayed rates are real (`price_cents` on each listing) but nothing is charged yet — that's Milestone B (Stripe), scoped in `CLAUDE.md` but not built.

| Area | Included |
| --- | --- |
| Home discovery | Hero, unified search, category gateways, featured listings, regions, atlas preview, and closing CTA. |
| Marketplace catalog | Text search, category filters, region filter, empty state, responsive cards, and desktop/mobile map presentation. |
| Listings | Shared stay/restaurant detail template plus a dedicated GetYourGuide-style tour detail layout, both with gallery, facts, amenities, an auth-aware booking CTA, location atlas, and related records. |
| **Accounts (`/login`, `/signup`)** | Self-serve sign-up as a **traveler** or an **operator**, backed by Supabase Auth. |
| **Operator dashboard (`/dashboard`)** | **Add, edit, and delete your own stay and tour listings**, optionally starting from a pasted link (best-effort title/description/photo-reference prefill from that page's own public metadata — never a scrape, never an auto-saved third-party photo). New listings and resubmissions go into review before they're visible to anyone else; edits to an already-live listing save immediately. Writes go straight to Supabase, scoped to the signed-in operator by Row-Level Security — not by anything the client enforces. Restaurants stay editorial/seed-only. |
| **Review queue (`/admin`)** | **Approve or send back pending listings**, one admin account (self-promoted via SQL, no signup toggle). Approving publishes immediately; sending a listing back with a note lets the operator fix it and resubmit. |
| **AI Trip Planner (`/plan`)** | **A day-by-day itinerary generator** that calls the Anthropic API server-side, grounded in the site's *live, published* stay/tour/restaurant catalog. Requires `ANTHROPIC_API_KEY` (see Environment below). |
| Maps | Deterministic SVG-based Armenia atlas with price markers and synchronized selection. No external map key is required. |
| Brand | Revamp brandbook implementation with lowercase `revamp.` wordmark, `re.` compact mark, #F15822 orange, #212121 charcoal, white, rounded geometry, and sans typography. |

## Technology

React 19, TypeScript, Vite 7, Tailwind CSS 4, Wouter, Radix UI/shadcn components, Lucide icons, and Sonner on the client, talking directly to Supabase (`@supabase/supabase-js`) for auth and listings. Express, Zod, and the official `@anthropic-ai/sdk` remain server-side for the one route that needs a secret the browser can't hold — the AI trip planner. No JSON file or in-process store is used for listings anymore.

## Requirements

Use Node.js 22 or newer and pnpm 10 or newer, and a Supabase project (free tier is fine).

```bash
node --version
pnpm --version
```

## Local Setup

```bash
pnpm install
cp .env.example .env
# fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to run against real accounts + listings
# fill in ANTHROPIC_API_KEY to enable /plan
pnpm dev
```

Without the Supabase vars set, the app still runs and browses using the static `shared/listings.ts` seed as a read-only fallback (`ListingsContext` reports `offline: true`) — enough to look at the UI, but sign-up, sign-in, and any write will fail. See "Supabase Setup" below to get real data flowing.

`pnpm dev` runs two processes together (via `concurrently`): Vite (the client, with HMR) and the Express API (`server/index.ts` via `tsx watch`, on `API_PORT`, default `3001`) — the API process only serves `/api/plan-trip` now. Vite proxies `/api/*` requests to it, so open the URL Vite prints — there's nothing to visit on the API's own port directly.

## Supabase Setup

1. Create a project at supabase.com. From its API settings, copy the **Project URL** and **anon/public key** into `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in your `.env`.
2. Run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_review_gate_and_admin.sql`, once each and in order — paste them into the SQL Editor, or use `supabase db push`/`psql` with the CLI. Together they create `profiles`, `listings`, the review-gate trigger, and every Row-Level Security policy the app depends on.
3. Start the app (`pnpm dev`, or deploy it) and sign up for a real account at `/signup`, choosing **Operator**. This becomes the house "Revamp" account that will own the seed catalog.
4. Locally only, add `SUPABASE_SERVICE_ROLE_KEY` (from the same API settings page — keep this one secret), `SEED_OPERATOR_EMAIL`, and `SEED_OPERATOR_PASSWORD` (the account from step 3) to your `.env`, then run:

   ```bash
   pnpm seed:catalog
   ```

   This imports `shared/listings.ts`'s seed stays/tours/restaurants into the real `listings` table under that operator account, auto-approved so it's immediately live (a bulk import of already-vetted content shouldn't sit in the review queue). It's safe to re-run — existing rows are matched by slug and skipped. See `scripts/seed-catalog.ts`'s header comment for exactly why it needs the service-role key for restaurants specifically.
5. To review real submissions, sign up a **separate** account for yourself (not the house account) and promote it to admin — sign up normally at `/signup`, find your user id in the Supabase dashboard (Authentication → Users), then run in the SQL Editor:

   ```sql
   update public.profiles set role = 'admin' where id = '<your-user-id>';
   ```

   There's no self-serve admin signup by design. Sign in with that account and open `/admin` to approve or send back pending listings.

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

This single process serves the built SPA **and** the `/api/plan-trip` route on one `PORT` (default `3000`).

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
      BookingCta.tsx         # auth-aware booking CTA, shared by every listing detail layout
      BrandMark.tsx
      ListingCard.tsx
      RequireRole.tsx        # route guard for /dashboard
      SearchBar.tsx
      SiteFooter.tsx
      SiteHeader.tsx          # includes the auth-aware account menu
      TourCard.tsx
      TourDetail.tsx
    contexts/
      ThemeContext.tsx
      AuthContext.tsx         # Supabase Auth session/profile state (traveler | operator | admin)
      ListingsContext.tsx     # live catalog: reads/writes the Supabase `listings` table directly
    data/
      listings.ts             # thin compatibility barrel over shared/listings.ts
    lib/
      api.ts                   # fetch wrapper for /api/plan-trip and /api/import-listing
      supabase.ts               # browser Supabase client
      slug.ts                   # slugify() for new listing titles
      tourFacts.ts
    pages/
      Explore.tsx
      Home.tsx
      ListingPage.tsx
      Dashboard.tsx            # operator-only: add/edit/delete own stay & tour listings, link-prefill
      AdminReview.tsx           # admin-only: approve/reject pending listings
      Login.tsx
      Signup.tsx
      MapPage.tsx
      Plan.tsx                 # AI trip planner
      Tours.tsx
      NotFound.tsx
    App.tsx
    index.css
    main.tsx
server/
  index.ts                   # Express app: JSON body parsing, API routes, static SPA serving
  routes.ts                  # POST /api/plan-trip and POST /api/import-listing — listings CRUD is gone (Supabase + RLS replaced it)
  supabase.ts                 # anon-key server client: planner catalog digest + verifyUser() for import-listing auth
  urlPrefill.ts                # best-effort OpenGraph/meta-tag fetch for the link-prefill assist, with an SSRF guard
  planner.ts                  # Anthropic API call + prompt/response handling for the trip planner
supabase/
  migrations/
    0001_init.sql              # profiles + listings schema, triggers, and every RLS policy
    0002_review_gate_and_admin.sql  # pending/review-note columns, admin role, review-gate trigger
scripts/
  seed-catalog.ts              # one-time import of shared/listings.ts into the live `listings` table
shared/
  listings.ts                # canonical Listing type, seed data, and constants (client + server + scripts)
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
| `/explore/tour` | Tour category (dedicated GetYourGuide-style browser). |
| `/map` | Full map-led discovery. |
| `/listing/:slug` | Individual listing detail. |
| `/plan` | AI trip planner. |
| `/dashboard` | Operator-only: add, edit, and delete your own stay and tour listings. |
| `/admin` | Admin-only: review pending listings, approve or send them back with a note. |
| `/login` | Sign in. |
| `/signup` | Sign up as a traveler or an operator. |

## Editing Inventory

Two ways, depending on what you're doing:

- **Day to day / for real operators:** sign up at `/signup` as an operator, then open `/dashboard` and use the form UI — optionally starting from "Prefill from a link" to seed the title/description from a pasted URL's own public metadata. Writes go straight to the Supabase `listings` table and are scoped to your own account by Row-Level Security (`supabase/migrations/0001_init.sql`, `0002_review_gate_and_admin.sql`) — the client doesn't (and can't) enforce that on its own. A new or resubmitted listing lands as `pending` and isn't visible anywhere else until an admin approves it at `/admin`; editing an already-published listing saves and shows up immediately (cards, filters, map markers, related content, and slug-based detail pages, all read live through `ListingsContext` in `client/src/contexts/ListingsContext.tsx`) without another review pass.
- **Seeding a fresh install:** `shared/listings.ts` is the one-time source `pnpm seed:catalog` (`scripts/seed-catalog.ts`) imports into the Supabase `listings` table under a house "Revamp" operator account — see Supabase Setup above. Editing `shared/listings.ts` after that only affects a future `pnpm seed:catalog` run (it's safe to re-run; existing rows are matched by slug and skipped), never already-live rows. Restaurants (`type: "eat"`) are seed/editorial-only; RLS has no insert policy for `type = 'eat'` at all, so no operator — including the house account — can create, edit, or delete one through the normal app (`EDITABLE_LISTING_TYPES` in `shared/listings.ts` covers `stay` and `tour` only).

Either way: keep coordinates within Armenia (lat 38–42, lng 43–47 — enforced by a database check constraint) and don't add invented customer ratings, reviews, testimonials, booking counts, or verification claims.

## Brand Guidance

Read `brandbook-implementation.md` before visual changes. The formal brand system is minimal and tightly controlled. Use the intact lowercase `revamp.` wordmark with its terminal period, the compact `re.` mark, orange #F15822, charcoal #212121, and white #FFFFFF. Circular Std is the specified brand family; the code uses Manrope as the licensed web-safe visual substitute unless Circular Std is available in the environment.

## Assets and Portability

Image URLs are defined in `shared/listings.ts`. All shipped imagery is self-hosted brand illustration under `client/public/images/` (plain SVG, no external requests) — the marketplace has **zero external image dependencies** and works fully offline/air-gapped for images. Swap in real photography whenever it's available: update the `assets` map at the top of `shared/listings.ts` and re-seed, or set an `image` URL per listing through `/dashboard` (stay/tour only).

## Environment

The catalog and browsing experience work read-only without any secrets (using the static seed as a fallback), but **need `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` for accounts and real writes**. The **AI trip planner needs `ANTHROPIC_API_KEY`** (server-side only — it's never sent to the browser). The link-prefill assist (`POST /api/import-listing`) needs no new secret — it reuses the same anon-key Supabase client to verify the caller is signed in, then fetches the pasted URL directly. See `ENVIRONMENT.md` for the full list of variables, including the seed-script-only Supabase service-role key and the optional `ANTHROPIC_MODEL`/`API_PORT` overrides.

## Claude Code

Claude Code should read `CLAUDE.md` first. That file documents the architecture, non-negotiable content/brand/payment-honesty constraints, the Supabase data model and RLS design, route behavior, component conventions, asset model, quality gates, and common change recipes.

## Deployment Note

The server still does two deliberate jobs (see `CLAUDE.md`): it calls the Anthropic API for trip planning, and it fetches a pasted URL's public metadata for the link-prefill assist (behind a signed-in check and an SSRF guard). Everything else — accounts, listings, ownership, and the review/publish gate — is Supabase, protected by Row-Level Security and a database trigger instead of application code. There's still no real payment processing or reservation confirmation; that's Milestone B, a deliberate upgrade the same way this one was, not something to bolt onto `BookingCta.tsx` ad hoc. To deploy as a **single Node process**: run both Supabase migrations in order (`0001_init.sql`, then `0002_review_gate_and_admin.sql`) and the seed script once, promote your own account to `admin` (see Supabase Setup above), build with `pnpm build`, and run `pnpm start` with `PORT`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `ANTHROPIC_API_KEY` set.

### Netlify (serverless)

This repo is set up to deploy to Netlify, where the API runs as a serverless function rather than a persistent process:

- **`netlify.toml`** — build `pnpm build` → publish `dist/public`; functions dir `netlify/functions`; the `prerender` edge function on `/*`; an `/api/* → /.netlify/functions/api/:splat` rewrite; `/robots.txt` + `/sitemap.xml` rewrites to the function; a SPA fallback (`/* → /index.html`) for wouter; and `X-Robots-Tag: noindex` headers on `/dashboard`/`/admin`.
- **`netlify/functions/api.ts`** — wraps the shared Express `app` (`server/app.ts`) with [`serverless-http`](https://github.com/dougmoscrop/serverless-http). The API is `POST /api/plan-trip`, `POST /api/import-listing`, `POST /api/sync-ical`, the dynamic `robots.txt`/`sitemap.xml`, and `GET /api/prerender`; accounts, listings, and the review gate go straight from the browser to Supabase under RLS.
- **`netlify/edge-functions/prerender.ts`** — SEO/crawler discoverability. A Deno edge function that hands non-JS crawlers (Googlebot, GPTBot, ClaudeBot, PerplexityBot, Twitterbot, …) real server-rendered HTML from `server/prerender.ts` (via `/api/prerender`), while real visitors get the untouched SPA. Real per-page `<title>`/meta/OG/JSON-LD for browsers and JS crawlers comes from `client/src/hooks/useDocumentMeta.ts`. No new dependency and no new env var — the renderer is hand-written HTML, and robots/sitemap derive their origin from each request.
- **Environment variables** (Site configuration → Environment variables):
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — needed at **build time** (Vite inlines them into the client) *and* at function runtime (the planner reads the published catalog, and `/api/import-listing` verifies the caller's bearer token, with the anon key). Set them before the first build; the value must be the full `https://<project-ref>.supabase.co`, or the client falls back to the read-only `shared/listings.ts` seed. **Changing these requires a fresh build** (a redeploy), not just saving the variable.
  - `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) — runtime only, for `/api/plan-trip`.
  - Never set `SUPABASE_SERVICE_ROLE_KEY` on Netlify — it's for the local one-time `pnpm seed:catalog` only.
- Connecting the GitHub repo to Netlify gives continuous deploys on every push to `main`. The Supabase migrations (`0001`–`0005`, including `0005`'s `listing-photos` Storage bucket for operator photo uploads), `pnpm seed:catalog`, and the admin promotion are separate one-time steps (see Supabase Setup).
