# Environment Guide

Browsing, search, filtering, and the SVG atlas work with no secrets at all (they fall back to the static seed catalog). Real accounts and real listing writes need Supabase configured. The AI trip planner needs the Anthropic key. A one-time local script needs two more variables that the running app itself never touches.

## Variables

| Variable | Purpose | Required | Default |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project's API URL. Read by the browser client (`client/src/lib/supabase.ts`) and the read-only server client (`server/supabase.ts`). Safe to expose — it's just an endpoint. | Only to enable real accounts/listings — without it the app runs read-only against the static seed (`ListingsContext`'s `offline` fallback), and sign-up/sign-in fail. | none |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase project's anon/public API key. Ships to the browser by design — Row-Level Security (`supabase/migrations/0001_init.sql`), not this key, is what limits what it can do. | Same as above. | none |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses Row-Level Security entirely. Used **only** by `scripts/seed-catalog.ts`, run locally by hand, for the one case RLS deliberately blocks every operator from doing themselves (seeding `type: "eat"` restaurant rows — see that script's header comment). Never read by any app code, client or server, and never deployed anywhere. | Only to run `pnpm seed:catalog`. | none |
| `SEED_OPERATOR_EMAIL` / `SEED_OPERATOR_PASSWORD` | Credentials for the house "Revamp" operator account (created by hand at `/signup` first) that `pnpm seed:catalog` signs in as to import the seed catalog. Local/one-time use only. | Only to run `pnpm seed:catalog`. | none |
| `ANTHROPIC_API_KEY` | Server-side key used by `server/planner.ts` to call the Anthropic Messages API for `/plan` (`POST /api/plan-trip`). Never sent to the browser. | Only to use `/plan` — the rest of the site works without it, and the endpoint returns a clear 503 instead of crashing if it's missing. | none |
| `ANTHROPIC_MODEL` | Overrides the model used for trip planning. | No | `claude-sonnet-4-5` |
| `API_PORT` | Port the Express API listens on **in development**, proxied to by Vite. Not used in production (see `PORT`). | No | `3001` |
| `PORT` | Port the single Express process listens on **in production** (`pnpm start`), serving both the built SPA and `/api/plan-trip`. | No | `3000` |

Copy `.env.example` to `.env` and fill in what you need:

```bash
cp .env.example .env
```

Do not commit `.env` or any real key — `SUPABASE_SERVICE_ROLE_KEY` especially, since it bypasses every RLS policy in the database. Never place a secret value in a `VITE_`-prefixed variable — Vite exposes those to client code; that's exactly why `VITE_SUPABASE_ANON_KEY` is the *only* Supabase key that's meant to be `VITE_`-prefixed, and why `ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` deliberately are not.

## Data Storage

Accounts and listings live in Supabase Postgres (`supabase/migrations/0001_init.sql`), not in this repository or its runtime filesystem — there is no `server/data/` directory or JSON file anymore. Row-Level Security policies defined in that migration are what actually enforce who can read or write which rows; the app's own code never re-implements those checks. To reset a project's data, use the Supabase dashboard (or `truncate`/drop-and-re-run-the-migration) rather than deleting a local file — there isn't one.

## Asset Hosting

All site imagery is self-hosted SVG under `client/public/images/` and `client/public/brand/` — there are no external image hosts to configure. To use real photography, host it yourself and point the `assets` map in `shared/listings.ts` (or a listing's `image`/`gallery` fields via `/dashboard`) at your own URLs.

## Future Secrets

Milestone B (real Stripe-backed bookings — scoped in `CLAUDE.md`, not yet built) will add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, both server/Netlify-Function-only, following the same pattern as `ANTHROPIC_API_KEY`: kept off the client, exposed only through purpose-built endpoints.
