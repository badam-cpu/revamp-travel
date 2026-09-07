# Environment Guide

Browsing, search, filtering, and the SVG atlas need no secrets. The server does two deliberate things that do need configuration: persisting stay/tour listings to disk, and calling the Anthropic API for the AI trip planner.

## Variables

| Variable | Purpose | Required | Default |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Server-side key used by `server/planner.ts` to call the Anthropic Messages API for `/plan` (`POST /api/plan-trip`). Never sent to the browser. | Only to use `/plan` — the rest of the site works without it, and the endpoint returns a clear 503 instead of crashing if it's missing. | none |
| `ANTHROPIC_MODEL` | Overrides the model used for trip planning. | No | `claude-sonnet-4-5` |
| `API_PORT` | Port the Express API listens on **in development**, proxied to by Vite. Not used in production (see `PORT`). | No | `3001` |
| `PORT` | Port the single Express process listens on **in production** (`pnpm start`), serving both the built SPA and `/api/*`. | No | `3000` |

Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` to exercise the trip planner locally:

```bash
cp .env.example .env
```

Do not commit `.env` or real API keys. Never place secret values in `VITE_`-prefixed variables — Vite exposes those to client code; `ANTHROPIC_API_KEY` must only ever be read server-side (`server/planner.ts`).

## Data Storage

Listings persist to `server/data/listings.json`, created and seeded automatically from `shared/listings.ts` the first time the server runs. This path is gitignored — it's runtime state, not source. Delete it (or deploy to a fresh environment) to reseed from `shared/listings.ts`. There is no external database to provision; if you need multiple server instances or don't want a local filesystem dependency, swap `server/store.ts` for a real database as its own deliberate upgrade.

## Asset Hosting

All site imagery is self-hosted SVG under `client/public/images/` and `client/public/brand/` — there are no external image hosts to configure. To use real photography, host it yourself and point the `assets` map in `shared/listings.ts` (or a listing's `image`/`gallery` fields via `/manage`) at your own URLs.

## Future Secrets

If the product later adds authentication, payments, live availability, or other external APIs, keep those credentials on the server and expose only safe, purpose-built endpoints to the browser, following the same pattern as `ANTHROPIC_API_KEY`.
