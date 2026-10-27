# Environment Guide

Browsing, search, filtering, and the SVG atlas work with no secrets at all (they fall back to the static seed catalog). Real accounts and real listing writes need Supabase configured. The AI trip planner needs the Anthropic key. A one-time local script needs two more variables that the running app itself never touches.

## Variables

| Variable | Purpose | Required | Default |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project's API URL. Read by the browser client (`client/src/lib/supabase.ts`) and the server clients (`server/supabase.ts`). Safe to expose — it's just an endpoint. | Only to enable real accounts/listings — without it the app runs read-only against the static seed (`ListingsContext`'s `offline` fallback), and sign-up/sign-in fail. | none |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase project's anon/public API key. Ships to the browser by design — Row-Level Security plus the `enforce_listing_review_gate` trigger (`supabase/migrations/0001_init.sql`, `0002_review_gate_and_admin.sql`), not this key, is what limits what it can do. Also used server-side by `server/supabase.ts`'s `verifyUser()` to check the bearer token on `POST /api/import-listing` — no separate key needed for that. | Same as above. | none |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses Row-Level Security entirely — **server-side only, never `VITE_`-prefixed, never in the client bundle.** Two server uses: (1) `scripts/seed-catalog.ts`, run locally, for restaurant rows and auto-approving seed rows; (2) the PayLink booking confirm/reconcile code (`server/supabaseAdmin.ts`) — **set it in Netlify** so `POST /api/confirm-checkout` and the reconcile/iCal crons can flip a booking to `confirmed`, a write RLS can't authorize. | Locally for `pnpm seed:catalog`; in Netlify for the booking loop. | none |
| `SEED_OPERATOR_EMAIL` / `SEED_OPERATOR_PASSWORD` | Credentials for the house "Revamp" operator account (created by hand at `/signup` first) that `pnpm seed:catalog` signs in as to import the seed catalog. Local/one-time use only. | Only to run `pnpm seed:catalog`. | none |
| `ANTHROPIC_API_KEY` | Server-side key used by `server/planner.ts` to call the Anthropic Messages API for `/plan` (`POST /api/plan-trip`). Never sent to the browser. | Only to use `/plan` — the rest of the site works without it, and the endpoint returns a clear 503 instead of crashing if it's missing. | none |
| `ANTHROPIC_MODEL` | Overrides the model used for trip planning. | No | `claude-sonnet-4-5` |
| `EVENTS_MODEL` | Model for the weekly upcoming-events web search (server/events.ts). Falls back to `ANTHROPIC_MODEL`. Requires web search to be enabled for the org in the Anthropic Console. | No | `ANTHROPIC_MODEL` |
| `EVENTS_SEARCHES_PER_AREA` | Max web searches for each of the 4 discovery areas (performances, festivals, sports, business) per events run. | No | `10` |
| `API_PORT` | Port the Express API listens on **in development**, proxied to by Vite. Not used in production (see `PORT`). | No | `3001` |
| `PORT` | Port the single Express process listens on **in production** (`pnpm start`), serving both the built SPA and `/api/plan-trip`. | No | `3000` |
| `PAYLINK_PARTNER_ID` / `PAYLINK_PARTNER_KEY` | PayLink.am partner credentials (server-side only) for the booking checkout (`server/paylink.ts`). Without them `POST /api/start-checkout` returns 503 and the rest of the site is unaffected. Production has no sandbox — a completed payment is a real charge. | To take bookings. | none |
| `PAYLINK_BASE_URL` | PayLink API base, e.g. `https://api.paylink.am` (production) — the code auto-detects the integration vs. production route scheme from the host. | With the PayLink credentials. | none |
| `PAYLINK_REQUEST_TYPE` | `requestType` string on Request/Register. | No | `"1"` |
| `PAYLINK_CURRENCY` | Charge currency. AMD-primary marketplace, so `AMD`. | No | `AMD` |
| `PAYLINK_LANGUAGE` | PayLink hosted checkout page language: `en` / `hy` / `ru` / `fr`. | No | `en` |
| `RESEND_API_KEY` / `EMAIL_FROM` | Enable booking emails (confirmation to both sides, cancellation notice) via Resend (`server/email.ts`). `EMAIL_FROM` must be a sender on a domain verified in Resend, e.g. `Revamp Travel <bookings@yourdomain.com>`. **Without both, email is a silent no-op** — bookings still work. | No (recommended for production). | none |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` | Enable the **free, opt-in Telegram** notification channel (`server/telegram.ts`). Create a bot with @BotFather → the token + its `@username` (without `@`). Customers link their Telegram once via **Account → Connect Telegram** (a `t.me` deep link → the `/api/telegram-webhook` captures their chat); after that, their booking confirmations are delivered on Telegram for free, independent of the SMS opt-in (connecting *is* the consent). After deploy, an **admin** calls `POST /api/telegram/set-webhook` once to register the webhook. `TELEGRAM_WEBHOOK_SECRET` is optional but recommended (validates incoming updates). Reaches signed-in travelers only (guests have no account to link). | No (optional free channel). | none |
| `INFOBIP_BASE_URL` / `INFOBIP_API_KEY` / `INFOBIP_SMS_FROM` / `INFOBIP_WHATSAPP_FROM` / `INFOBIP_VIBER_FROM` | Enable **SMS + WhatsApp + Viber** booking notifications to the customer on top of email (`server/sms.ts`, dispatched via `server/notify.ts`). Infobip is used instead of Twilio because it onboards in Armenia and covers **Viber** (a primary channel there). `INFOBIP_BASE_URL` is account-specific (e.g. `https://xxxxx.api.infobip.com`); the API key is sent as `Authorization: App <key>`. The `*_FROM` values are your registered senders per channel (Armenia **requires Sender-ID registration**, ~3–4 weeks). **Without them, SMS/WhatsApp/Viber silently no-op** — email + the unified-inbox mirror still work. Each channel is independent, so set only the `*_FROM`s you've enabled. **WhatsApp caveat:** business-initiated messages outside the 24-hour window require a **pre-approved template** (`sendWhatsApp(..., { templateName, placeholders })`); the plain body only delivers inside that window. | No (recommended for production). | none |

| `VITE_ELEVENLABS_AGENT_ID` | Public agent id of the Revamp voice agent in ElevenLabs — shows "Talk to Aha" on stay/tour/experience pages (`AhaVoiceButton`). Not a secret (an agent id is public by design; restrict it to revampvacations.com in the agent's security settings). Setup in `docs/aha-voice-setup.md`. | Only for the voice assistant — without it the button doesn't render. | none |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps Platform key, read by `client/src/lib/googleMaps.ts` to power the dashboard listing form's address-autocomplete field (`client/src/components/PlaceAutocomplete.tsx`). Ships to the browser by design — see the setup note below for why that's safe here. | Only for that one autofill convenience — without it, `PlaceAutocomplete` renders nothing and the form's city/region/lat/lng inputs work exactly as plain manual fields. | none |

**Setting up `VITE_GOOGLE_MAPS_API_KEY` (address autocomplete):** unlike Supabase's anon key, nothing like Row-Level Security limits what this key can do once it's public, so the restrictions you put on it *in Google Cloud Console* are what keep it safe, not secrecy:
1. Enable **"Places API (New)"** specifically (not the older, unsuffixed "Places API" — deprecated).
2. Create an API key under Keys & Credentials, and enable billing on the project.
3. Restrict it two ways before using it anywhere real: **Application restrictions → Websites (HTTP referrers)** set to your actual domain(s); **API restrictions → Restrict key** to only "Places API (New)". Leaving either unrestricted means anyone who finds the key in your page source can use it elsewhere. If suggestions never appear, try `v=beta` in `client/src/lib/googleMaps.ts`'s script URL (Google sometimes ships the web component on the beta channel first).

**Setting up booking emails (`RESEND_API_KEY` / `EMAIL_FROM`):** email is optional — the booking loop works without it (`server/email.ts` no-ops silently). To turn it on:
1. Create an account at [resend.com] and make an **API key** → that's `RESEND_API_KEY`.
2. `EMAIL_FROM` must be a sender on a domain **verified in Resend**. You verify a domain by adding the SPF/DKIM DNS records Resend gives you at your domain registrar. You **cannot** verify a `*.netlify.app` subdomain (you don't control its DNS), so real emails to travelers/operators need a custom domain you own — set `EMAIL_FROM="Revamp Travel <bookings@yourdomain.com>"`.
3. **No custom domain yet?** Resend's test sender `onboarding@resend.dev` works with just the API key, but only delivers to the email address on your own Resend account — fine for verifying the wiring, not for real customers. Set `EMAIL_FROM="Revamp Travel <onboarding@resend.dev>"` to test, then switch to your domain sender for production.
4. Set both in Netlify and redeploy (env changes only reach the Functions on a rebuild).

`POST /api/import-listing` — the link-prefill assist on `/dashboard` (`server/urlPrefill.ts`) — needs **no new environment variable at all**. It reuses `VITE_SUPABASE_ANON_KEY`/`VITE_SUPABASE_URL` (already required for accounts) to verify the caller is signed in, then fetches the operator-pasted URL directly with no external API key involved.

The SEO/crawler layer — dynamic `robots.txt`/`sitemap.xml`, per-page metadata, and the bot prerenderer (`server/prerender.ts` + the `netlify/edge-functions/prerender.ts` edge function) — also needs **no new environment variable**. The prerenderer/sitemap read the published catalog with the same anon `VITE_SUPABASE_*` key (published listings are publicly readable under RLS), and every public URL is derived from the incoming request's own host, so nothing has to be told the deployment's domain.

Promoting an account to `admin` (so it can review pending listings at `/admin`) is a one-time SQL statement run by hand in the Supabase dashboard, not an environment variable — see `README.md`'s Supabase Setup, step 5.

**Google sign-in ("Continue with Google") — no environment variable, dashboard config only.** The code is already wired: `AuthContext.signInWithGoogle` → `supabase.auth.signInWithOAuth({ provider: "google" })`, the `GoogleSignInButton` on `/login` and `/signup`, and `handle_new_user` (migration `0012`) which fills a new Google user's `display_name` from their Google name and defaults them to `traveler`. Until the provider is turned on in the two dashboards below, the button renders but the redirect errors. Nothing is read from `.env` for this — the client ID/secret live in Supabase, not in this repo.

1. **Google Cloud Console** → *APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.*
   - **Authorized JavaScript origins:** your site origin(s) — `https://revampvacations.com` (and `http://localhost:3000` for local dev).
   - **Authorized redirect URI:** your Supabase project's callback, exactly — `https://<project-ref>.supabase.co/auth/v1/callback` (copy it from Supabase's Google provider screen). This is Supabase's URL, *not* your app's.
   - You may need to fill the OAuth consent screen first (app name, support email, logo); a public app that requests only email/profile needs no Google verification review.
   - Copy the generated **Client ID** and **Client secret**.
2. **Supabase dashboard** → *Authentication → Providers → Google* → enable, paste the Client ID + Client secret, save.
3. **Supabase dashboard** → *Authentication → URL Configuration* → set **Site URL** to `https://revampvacations.com` and add **Redirect URLs**. The app returns the user to wherever they started (e.g. `/login?redirect=/listing/x` after a booking click), so allow-list a wildcard per environment: `https://revampvacations.com/**` and, for local dev, `http://localhost:3000/**`. Without the wildcard, sign-in still works but always lands on the Site URL instead of the page they were on.

Notes: Google sign-in currently creates a **traveler** account (operators still sign up with email + a business name, since the OAuth flow carries no role/business fields). Anonymous sign-in used by the support widget is a *separate* toggle (*Authentication → Providers → Anonymous*), also dashboard-only.

Copy `.env.example` to `.env` and fill in what you need:

```bash
cp .env.example .env
```

Do not commit `.env` or any real key — `SUPABASE_SERVICE_ROLE_KEY` especially, since it bypasses every RLS policy in the database. Never place a secret value in a `VITE_`-prefixed variable — Vite exposes those to client code; that's exactly why `VITE_SUPABASE_ANON_KEY` is the *only* Supabase key that's meant to be `VITE_`-prefixed, and why `ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` deliberately are not.

## Data Storage

Accounts and listings live in Supabase Postgres (`supabase/migrations/0001_init.sql`, `0002_review_gate_and_admin.sql`), not in this repository or its runtime filesystem — there is no `server/data/` directory or JSON file anymore. Row-Level Security policies and the review-gate trigger defined in those migrations are what actually enforce who can read or write which rows, and when a status change is allowed to stick; the app's own code never re-implements those checks. To reset a project's data, use the Supabase dashboard (or `truncate`/drop-and-re-run-the-migrations) rather than deleting a local file — there isn't one.

## Asset Hosting

All site imagery is self-hosted SVG under `client/public/images/` and `client/public/brand/` — there are no external image hosts to configure. To use real photography, host it yourself and point the `assets` map in `shared/listings.ts` (or a listing's `image`/`gallery` fields via `/dashboard`) at your own URLs.

## Future Secrets

Milestone B (real Stripe-backed bookings — scoped in `CLAUDE.md`, not yet built) will add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, both server/Netlify-Function-only, following the same pattern as `ANTHROPIC_API_KEY`: kept off the client, exposed only through purpose-built endpoints.

## OPERATOR_SECRETS_KEY (server-only, required for direct PayLink payments)

Encrypts operators' PayLink API keys before they're stored (migration 0094, `server/secretBox.ts`). 32 random bytes, base64 — generate with `openssl rand -base64 32` and set it in Netlify → Site configuration → Environment variables (Functions scope), then redeploy. Never commit it, never prefix it with `VITE_`, and keep a copy in a password manager: if it's lost or changed, stored keys can't be decrypted — those operators fall back to Revamp's account until they reconnect. Without it, operators can't connect a PayLink account (nothing is ever stored in plain text).

## Customer Journey (optional)

| Variable | Purpose |
| --- | --- |
| `INFOBIP_WHATSAPP_JOURNEY_TEMPLATE` | Name of a Meta-approved WhatsApp template (placeholders: guest first name, listing, trip link) used for journey texts. Without it, WhatsApp journey texts only reach guests inside WhatsApp's 24-hour window; email, inbox, SMS, Viber and Telegram are unaffected. |

## Campaign sender (optional)

| Variable | Example | Purpose |
| --- | --- | --- |
| `CAMPAIGN_EMAIL_FROM` | `Revamp Vacations <hello@news.revampvacations.com>` | Sender for admin email campaigns only — a separate subdomain verified in Resend, so marketing complaints never affect the main domain booking emails use. Falls back to `EMAIL_FROM`. |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` | Signing secret of the Resend webhook pointing at `https://revampvacations.com/api/resend-webhook` (events: email.delivered, email.opened, email.clicked, email.bounced, email.complained). Enables per-campaign opens/clicks in Admin → Campaigns → Sent (migration 0116). Without it the webhook accepts nothing. Open/click tracking must also be switched on for the sending domain in Resend. |
| `CAMPAIGN_REPLY_TO` | `hello@revampvacations.com` | Where replies to campaigns go. |
