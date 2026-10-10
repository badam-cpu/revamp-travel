# revampstay.com — architecture plan

**Status:** draft for decision (2026-10-10). Positioning, name, and the long-term/relocation
lean are agreed (see the mockup). This doc turns that into a buildable design covering
**short-term rent, long-term rent, and property sales**, served from the same platform as
revampvacations.com.

---

## 1. Goals and non-negotiables

| Goal | Why |
|---|---|
| **One catalog, one operator account** | A landlord lists a property once and can offer it nightly, monthly, and/or for sale. No double entry, no two half-populated sites. |
| **Zero regression on revampvacations** | Nightly stays, bookings, PayLink, iCal, MCP all keep working untouched. Everything here is *additive*. |
| **A real second site, not a filter** | revampstay.com has its own brand, nav, home, SEO surface, and audience (nomads / relocators / diaspora / buyers). |
| **RU (and HY) as first-class, indexable languages** | Russian-speaking relocators are a core audience. A JS toggle is not SEO — we need per-language URLs + `hreflang`. |
| **Sales = lead-gen, never a checkout** | Nobody buys an apartment through a pay button. The "transaction" is an inquiry → viewing → offline deal. |

Inherited constraints: trust is enforced by **RLS + the review-gate trigger**, never client checks; no fabricated reviews/ratings anywhere incl. JSON-LD; AMD-primary money (`*_cents` = drams × 100).

---

## 2. The core decision: property vs. offer

Today a stay row *is* its price: `listings.price_cents` + `price_unit` ("night"). That works for one product. With three ways to monetise the same four walls, we separate the two ideas:

- **The property** (what exists): address, rooms, photos, amenities, description → the existing `listings` row (`type = 'stay'`).
- **The offers** (how it's sold): nightly / monthly / sale, each with its own price and terms.

### Recommended for MVP: additive columns on `listings` (not a new table yet)

This codebase grows by adding columns + extending `mapListingRow` (cleaning fee, extra-guest fee, seasonal rates, videos all went this way). We follow that pattern because it's **non-breaking** and ships fastest. Keep `price_cents`/`price_unit` exactly as the **nightly offer** so nothing on revampvacations changes.

```sql
-- migration 00XX_revampstay_offers.sql (additive, all nullable / defaulted)
alter table public.listings
  -- which offers this property carries; drives which site shows it
  add column offer_types text[] not null default '{nightly}'
    check (offer_types <@ array['nightly','monthly','sale']::text[] and cardinality(offer_types) > 0),

  -- long-term rent
  add column monthly_rent_cents  integer check (monthly_rent_cents >= 0),
  add column deposit_cents       integer check (deposit_cents >= 0),
  add column min_lease_months    smallint check (min_lease_months between 1 and 36),
  add column furnished           text check (furnished in ('furnished','semi','unfurnished')),
  add column utilities_included  boolean,
  add column available_from      date,

  -- sale
  add column sale_price_cents    integer check (sale_price_cents >= 0),
  add column area_m2             numeric(8,1) check (area_m2 > 0),
  add column floor               smallint,
  add column total_floors        smallint,
  add column year_built          smallint,
  add column ownership_type      text,            -- e.g. 'private', 'new build', 'cooperative'
  add column sale_status         text default 'available'
    check (sale_status in ('available','under_offer','sold'));

create index listings_offer_types_gin on public.listings using gin (offer_types);
```

**Site visibility rule (the important one):**

| Site | Shows a `stay` row when |
|---|---|
| revampvacations.com | `'nightly' = any(offer_types)` — *exactly today's behaviour* |
| revampstay.com | `offer_types` contains any of `nightly`, `monthly`, `sale` |

So a **sale-only** or **monthly-only** property never appears on revampvacations (no bogus "Rate on request" nightly card), and everything appears on revampstay with the right badge.

**Invariants to enforce (DB check + form):** `'monthly' ∈ offer_types ⇒ monthly_rent_cents not null`; `'sale' ∈ offer_types ⇒ sale_price_cents not null`; `'nightly' ∈ offer_types ⇒ price_cents > 0`.

> **When to refactor to a `listing_offers` table:** if a property ever needs *multiple* offers of the same kind (e.g. two sale variants, or seasonal monthly rates). Not needed for MVP. The column model above migrates cleanly into it later.

---

## 3. Three offers, three transaction models

This is where "add sales" stops being a checkbox. Each mode has a different buyer journey and a different revenue model.

| | **Nightly (short-term)** | **Monthly (long-term)** | **Sale** |
|---|---|---|---|
| Buyer journey | Pick dates → pay → confirmed | Inquire / book a viewing → apply → lease → move in | Inquire → viewing → negotiate → offline deal |
| Transaction | **Instant booking via PayLink** (exists) | Deposit + first month via PayLink; then recurring rent | **None online.** Lead only. |
| Platform revenue | 12.5% commission (exists) | First-month commission, or a flat placement fee; optional recurring-rent fee | **Lead fee / featured placement / agent referral.** No % of sale price unless licensed. |
| Availability | iCal + calendar (exists) | `available_from` + lease term | `sale_status` |
| Reuses today | Everything | `AskHostButton`/inquiry (0038 conversations) + a new `viewing_requests` flow; PayLink **Subscription API** (already built for operator billing) is a strong fit for recurring rent later | Inquiry/conversations + `viewing_requests` |

**New shared primitive — `viewing_requests`** (serves monthly *and* sale): `{listing_id, requester (user or guest email), preferred_times[], mode: 'in_person'|'video', status: requested/confirmed/done/cancelled}`. Lives on the existing conversation so the host replies in the unified inbox. This is the single most reused piece of the whole plan.

**Deliberately phased out of MVP:** digital lease signing, deposit escrow, recurring rent collection. They're real products with legal weight — Phase 3.

---

## 4. One codebase, two sites (host-switched frontend)

**Do not fork the app.** Both domains serve the **same build**; the app reads the hostname once and branches.

```ts
// client/src/contexts/SiteContext.tsx
type Site = "vacations" | "stay";
const site: Site = /(^|\.)revampstay\./.test(window.location.hostname) ? "stay" : "vacations";
```

What `useSite()` controls:

| Concern | vacations | stay |
|---|---|---|
| Wordmark / brand | `revamp.` | `revampstay.` (apricot "stay.") |
| Home page | current editorial home | the mockup: hero + Long/Short/Buy search, audiences, neighborhoods, concierge |
| Header nav | stays, eat, tours, experiences, plan | Rent (long/short), Buy, Neighborhoods, Move to Armenia, List your place |
| Listing filter | `nightly ∈ offer_types` | any offer; filter tabs: **Rent monthly / Rent nightly / Buy** |
| Listing page | booking panel (dates → PayLink) | mode-aware panel: nightly = booking; monthly = "Request a viewing" + apply; sale = "Request a viewing" + price/m² facts |
| Footer | current | Rent · Move to Armenia · Revamp (mockup footer) |
| Cross-link | → "Looking to stay longer / buy?" | → "Here for a visit?" |
| Off-site routes | — | `/explore/tour`, `/explore/eat` etc. **redirect** to revampvacations.com |

**Netlify:** add `revampstay.com` as a domain alias on the *same* site. The Express layer is already host-aware (`server/sitemap.ts`, `robots.ts`, `llms.ts`, `prerender.ts` all build URLs from `req.get("host")`), so each domain gets its own `sitemap.xml`, `robots.txt`, `llms.txt`, and bot-prerendered pages — we just add the same `offer_types` filter server-side so the vacations sitemap never lists sale-only rows and vice versa.

**Canonical / duplicate-content guard:** a listing that's on *both* sites gets `rel=canonical` to **one** home (rule: nightly-primary → vacations; otherwise → stay). Set in `useDocumentMeta` + prerender. Without this, Google treats the two sites as duplicates.

---

## 5. Languages: EN / RU (+ HY) as real pages

The mockup's JS toggle is for demos only. Production needs **indexable per-language URLs**.

- **Routing:** locale prefix — `/ru/...`, `/hy/...`; bare path = `en`. Wouter route wrapper strips the prefix; `useLocale()` exposes it.
- **UI chrome:** a small dictionary layer (`shared/i18n/{en,ru,hy}.ts`) for nav, buttons, labels, section copy — the same key→string approach the mockup proved.
- **Listing content:** two sources, in priority order:
  1. **Operator-entered** `title_ru` / `description_ru` (optional fields in the form — many landlords are Russian-speaking and will write it natively).
  2. **AI-translate fallback** via the existing `server/translate.ts` (Google Cloud Translation, cached), shown with a small "auto-translated" note.
- **`hreflang`:** emitted in `useDocumentMeta` and `server/prerender.ts` for every page that has siblings (`en` / `ru` / `hy` / `x-default`).
- **Sitemap:** one `<url>` per locale (`<xhtml:link rel="alternate" hreflang=…>`).
- **Scope first:** revampstay gets RU at launch (core audience). Roll the same layer to revampvacations later — RU-speaking tourists are a real segment there too.

---

## 6. Operator onboarding: "How do you want to offer it?"

This is the natural home for the **listing-form revamp** already on the backlog. One property form, one new step:

```
Step: Offer
 [✓] Nightly stays      → nightly rate, cleaning fee, min nights   (existing fields)
 [✓] Monthly rental     → monthly rent, deposit, min lease, furnished, utilities, available from
 [ ] For sale           → asking price, area m², floor/total, year built, ownership
```

Multi-select. Mode-specific fields appear only when ticked. Everything still lands `status: 'pending'` and goes through the admin review gate — **sales listings get stricter review** (ownership/legal basis before publishing; see §7). Use **✨ Aha** to draft EN + RU titles/descriptions.

---

## 7. Trust, legal, and the sales posture

- **Platform = marketplace / lead-gen, not a broker.** Revamp lists and connects; it does not represent either party in a sale. This keeps us out of real-estate brokerage licensing. **Action: confirm with counsel before taking any % of a sale price.** Lead fees and featured placement are the safe revenue lines.
- **Sales listings need provenance.** Require the seller to attest ownership (and ideally a cadastre reference) in the form; admin verifies before publishing. Add a visible **"Ownership verified"** badge only when actually verified.
- **Long-term rent:** provide a clear lease *template* (EN/RU) and record deposit terms; don't hold deposits in escrow until Phase 3 and a legal review.
- **No fabricated signals, ever** — price/m² and "from ֏X/mo" are computed from real listings; no invented demand, "X people viewing," or ratings.
- **Guest inquiries** reuse the anonymous-session + optional-email pattern from the pre-booking inquiry, so a buyer abroad can request a viewing without an account.

---

## 8. Monetization matrix

| Offer | Core | Upsell |
|---|---|---|
| Nightly | 12.5% commission (today) | — |
| Monthly | First-month commission or flat placement fee | Recurring-rent collection fee (PayLink Subscriptions), lease/deposit tooling |
| Sale | Lead fee per qualified viewing, or featured/premium placement | Agent referral partnerships |
| Cross-cutting | — | **Relocation concierge** (SIM, bank, residency, pickup) — partner referral or markup; **corporate housing** (B2B, invoiced) |

---

## 9. Discoverability (reusing what's already built)

- **MCP:** add `offer_type` (`nightly | monthly | sale`) to `search_listings` + a `get_listing` that returns rent/sale facts. One MCP, both sites. Update `/developers`.
- **`llms.txt`** per host (already host-aware) — the stay version advertises long-term + sales + the neighborhood/cost-of-living guides.
- **Content pillars** (the SEO engine from the mockup): neighborhood guides, cost of living, "Move to Armenia" (residency / nomad visa / bank / schools), repatriation guide — all EN + RU.

---

## 10. Phased roadmap

| Phase | Scope | Migrations | Rough effort |
|---|---|---|---|
| **1 — Rent, both terms** | `offer_types` + monthly columns; `useSite()` host switch; revampstay home/nav/footer/listing-page (monthly mode); offer step in the listing form; `viewing_requests`; per-host sitemap/robots/llms/prerender filters; canonical rule; Netlify alias | 1 | ~2–3 weeks |
| **2 — Sales (lead-gen)** | sale columns + `sale_status`; Buy tab + sale listing page (price/m², facts); stricter review + ownership attestation; lead-fee / featured placement; MCP `offer_type` | 1 | ~1–2 weeks |
| **3 — Long-stay tooling** | lease template (EN/RU), deposit via PayLink, recurring rent via PayLink Subscriptions, relocation concierge add-ons, corporate housing | 1–2 | ~3–4 weeks |
| **i18n (parallel to 1)** | `/ru` routing, dictionaries, `title_ru/description_ru`, AI-translate fallback, `hreflang`, locale sitemap; HY after RU | 1 (content cols) | ~1–2 weeks |

Phase 1 is independently valuable (the whole long-term/relocation play) and ships before any sales work. Sales slots in cleanly because the property/offer split was designed for it on day one.

---

## 11. Decisions needed from you

1. **Sales revenue model** — lead fee per viewing vs. featured placement only (counsel question re: % of sale).
2. **Lease/deposit in Phase 3 or earlier?** Depends on how much landlords ask for it in Phase 1.
3. **HY timing** — RU at launch is set; is Armenian a launch requirement or a fast-follow?
4. **Canonical home for dual-listed properties** — nightly-primary → vacations (my default), or always → stay?
5. **Go-to-market** — launch revampstay with existing stays flipped to `offer_types` (instant inventory), then recruit long-term landlords and sellers.
