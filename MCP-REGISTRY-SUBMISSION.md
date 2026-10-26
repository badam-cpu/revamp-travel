# Advertising the Revamp MCP — submission checklist

Public endpoint (advertise this one, not the `*.railway.app` URL):
**`https://mcp.revampvacations.com/mcp`**
Connect page: **`https://revampvacations.com/developers`**

Already shipped in the app:
- `/developers` landing page (connect configs + tools + example prompts)
- `llms.txt` advertises the MCP + the connect page (AI crawlers read this)
- `/developers` added to `sitemap.xml`
- `server.json` manifest (this repo root) for the official registry

---

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

The namespace `com.revampvacations/revamp` in `server.json` is a reverse-DNS of a
domain you own, so you verify ownership with a DNS TXT record (no GitHub-org
coupling).

1. Install the publisher CLI: `npm i -g @modelcontextprotocol/publisher` (or use
   the `mcp-publisher` binary from the registry repo's releases).
2. Authenticate with DNS:
   - `mcp-publisher login dns --domain revampvacations.com` — it prints a TXT
     record to add in **Netlify DNS** (name like `_mcp.revampvacations.com`).
   - Add that TXT record, wait for it to resolve, then re-run to complete login.
3. From the repo root (where `server.json` lives): `mcp-publisher publish`.
4. Verify it appears: `https://registry.modelcontextprotocol.io/v0/servers?search=revamp`.

> If the CLI flags a schema field, run `mcp-publisher init` to regenerate a
> `server.json` against the current schema and copy our `remotes`/`description`
> into it — the schema version pinned in `$schema` may have advanced.

## 2. Aggregator directories (manual, free)

These crawl/accept remote MCP servers and are where people browse:

- **Smithery** — https://smithery.ai → "Add server" → remote URL `https://mcp.revampvacations.com/mcp`.
- **Glama** — https://glama.ai/mcp/servers → submit; it auto-indexes from the registry too.
- **PulseMCP** — https://www.pulsemcp.com → "Submit a server".
- **mcp.so** — https://mcp.so → "Submit".
- **Awesome MCP Servers** (GitHub) — https://github.com/punkpeye/awesome-mcp-servers → PR adding a line under a fitting category (Travel / Location), e.g.:
  `- [Revamp Vacations](https://revampvacations.com/developers) — Live Armenia travel catalog (stays, tours, restaurants), availability, and AI trip planning.`

For each: name **Revamp Vacations**, URL `https://mcp.revampvacations.com/mcp`, transport **streamable-http**, auth **none**, tools **search_listings, get_listing, get_quote, check_availability, plan_trip**.

## 3. Announce

- Short blog post on `/blog` ("Use Revamp's live Armenia catalog in your AI assistant") linking `/developers`.
- Social + operator newsletter (feeds the GEO/AI-visibility strategy).

---

## Notes

- The server is **read-only / public** — safe to list widely. No keys to leak.
- Keep the `*.up.railway.app` URL private; advertising it would show Railway's
  logo on connectors and isn't branded.
- The internal/admin MCP (`/mcp/admin`) stays **unlisted and dormant** — never
  submit it anywhere.

---

## Meta Muse (Meta AI) — connector directory

Meta opened Muse to third-party connectors in Sept 2026. Two routes:

### A. Try it now — private custom connector (only you see it, no review)
In the Muse app, send: *"Connect to the Revamp Vacations MCP server at https://mcp.revampvacations.com/mcp"*.
When Muse asks: transport **HTTP (Streamable HTTP)**, authentication **none**. Ask it to test all five tools, save it, and set approval to **read-only**. Then try: *"Use Revamp to find a cabin in Dilijan for 2 next weekend."*

### B. Public listing — submit at https://muse.ai/platform → "Submit a connector"
(Sign in with a work email; Meta reviews end-to-end against the live endpoint; onboarding in waves.)

**Step 1 — Overview**
- Connector name: `Revamp Vacations`
- Company / developer: `Revamp Hospitality LLC`
- Product website: `https://revampvacations.com`
- Example prompts:
  - Find a cozy stay in Dilijan for two next weekend
  - What are the best tours from Yerevan to Garni and Geghard?
  - Plan a 4-day Armenia trip with wine, hiking and great food
  - Is this apartment in Yerevan free from Oct 17 to Oct 20?
  - Where should I eat in Yerevan's city centre tonight?
- Icon (512×512 PNG): `client/public/icon-512.png` (https://revampvacations.com/icon-512.png)
- Accepts payments: **No** (read-only; bookings happen on revampvacations.com via the listing link)
- Support: `hello@revampvacations.com`
- Privacy policy: `https://revampvacations.com/privacy`
- Terms of service: `https://revampvacations.com/terms`
- Anything else: *Official, read-only MCP for Armenia's curated travel marketplace — live published stays, tours, experiences, restaurants and places. Already listed in the official MCP Registry (com.revampvacations/revamp) and Smithery.*

**Step 2 — Technical specs**
- Connection type: **Existing MCP**
- Hosted MCP endpoint: `https://mcp.revampvacations.com/mcp` (Streamable HTTP, sessions, held-open SSE stream; GET 405 / OAuth discovery 404 by design)
- Documentation: `https://revampvacations.com/developers`
- Access requirements: *None — public, no account, no paid plan, all regions. Read-only; returns only the published catalog. Fair-use rate limiting.*
- Authentication: **Other → "None (public, read-only)"** (don't tick API keys or OAuth)
- Tools (all **Read**, MCP `readOnlyHint: true`, no side effects): `search_listings`, `get_listing`, `get_quote`, `check_availability`, `plan_trip`
- Value beyond the browser (Muse core requirement): `get_quote` returns the outcome — real availability for dates/party (calendars, bookings, minimum stay, capacity, time slots with seats left) and the exact all-in price (itemised discounts, fees, 10% tax, AMD), cancellation + payment terms, and a pre-filled checkout link. Booking/payment stay on revampvacations.com (connector accepts no payments).
- Rate limits: 120 req/min/IP, 10 plan_trip/min/IP (HTTP 429 + Retry-After). Errors: `isError: true` + plain message.
- Data: request parameters only (no personal data); only per-tool usage counts kept; plan_trip preferences go to Anthropic to generate the itinerary; no selling/training. Matches /privacy → "AI assistants and our catalog connection".

**Step 3 — Review:** confirm you're authorized for the brand assets, accept the Muse Connector Terms, submit. (Your account + acceptance — do it yourself.)

---

## Claude — Connectors Directory (Anthropic)
Submit at **https://claude.ai/directory/manage** → *Submit new* → **MCP connector** (any paid Claude plan). Checked automatically and listed as a *Community* connector by default. Requirements (claude.com/docs/connectors/building/submission): remote HTTPS ✅ · every tool has `title` + `readOnlyHint` ✅ · OAuth only for authenticated services (ours is public, none) ✅ · docs, privacy policy, support contact, icon ✅. Before submitting, add the URL as a **custom connector in Claude** and call each tool once (the *Test & launch* step asks you to confirm). All 5 were verified live on 2026-10-26.

1. **Connection** — `https://mcp.revampvacations.com/mcp` (one URL for everyone).
2. **Tools** — sync automatically: search_listings, get_listing, get_quote, check_availability, plan_trip — all read-only, all titled.
3. **Listing**
   - Name: `Revamp Vacations`
   - One-liner (≤200): *Search Armenia's curated stays, tours, experiences and restaurants, check live availability and time slots, get exact all-in quotes, and plan day-by-day trips.*
   - Description (≤2000): *Revamp Vacations is a curated travel marketplace for Armenia. This connector gives Claude read-only access to Revamp's published catalog: guesthouses, apartments and hotels; guided tours; hands-on experiences; restaurants; and places to visit. Claude can search by place, type or interest; read a listing's full details; check real availability for specific dates and party sizes (host calendars, existing bookings, minimum stays, and time slots with seats left for tours and experiences); get an exact all-in quote in Armenian dram with discounts, fees, tax, cancellation terms and payment terms itemised; and draft a day-by-day itinerary from real listings. It never books, pays or changes anything — quotes come with a link to complete the booking on revampvacations.com. No account needed.*
   - Categories: Travel (+ Lifestyle / Food if offered)
   - Documentation: `https://revampvacations.com/developers` · Privacy: `https://revampvacations.com/privacy` · Support: `hello@revampvacations.com`
   - Icon: `https://revampvacations.com/icon-512.png` · Slug: `revamp-vacations` (permanent)
4. **Use cases** — finding a place to stay in Armenia for given dates and party; checking whether a stay or activity is free and what it costs all-in; choosing tours/experiences by time slot; restaurant ideas; trip planning. *Users need:* nothing (no account, plan or setup). *Reads or writes:* reads only.
5. **Company** — Revamp Hospitality LLC · https://revampvacations.com · primary contact: your email.
6. **Authentication** — not required (public catalog).
7. **Data handling** — **our own API** (first-party). No personal health data. No sponsored content.
8. **Test & launch** — *No account or credentials needed. Add https://mcp.revampvacations.com/mcp as a custom connector (no auth) and try: "Find a stay in Yerevan for 2 people" (search_listings) · "Tell me about 1br-w-scenic-views-pool-sauna" (get_listing) · "Quote 1br-w-scenic-views-pool-sauna for 10–14 Feb 2027 for 2" (get_quote → ֏148,500 all-in) · "What time slots does run-the-city-before-it-wakes-up have on 7 Nov 2026?" (check_availability) · "Plan 2 days in Armenia for food and history" (plan_trip).* Then confirm you ran every tool.
9. **Compliance** — the seven acknowledgments (yours to accept).

## ChatGPT — app directory (OpenAI)
Submit through OpenAI's developer platform (apps are now published as plugins "With MCP"; follow developers.openai.com/apps-sdk/deploy/submission). Test it first in ChatGPT **Developer Mode**.

- **MCP server URL: `https://mcp.revampvacations.com/mcp/chatgpt`** — same 5 read-only tools, but quotes link to the **listing page, never checkout** (OpenAI's commerce rules currently cover only physical goods and disallow links to checkout/transactional pages; bookings are a service). Muse/Claude keep `/mcp` with pre-filled checkout links.
- Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` on every tool (bounded first-party catalog) ✅
- Name: `Revamp Vacations` (not "Revamp MCP"). **Description must not mention prices, promotions or competitors** — use: *Search Revamp Vacations' curated listings in Armenia — stays, tours, experiences, restaurants and places to visit — check availability and time slots for your dates, see full price and cancellation details, and plan day-by-day trips. Read-only; book on revampvacations.com.*
- Positive test prompts: "Find a cozy stay in Dilijan for two next weekend" · "Is 1br-w-scenic-views-pool-sauna free 10–14 February 2027 for 2, and what's the total?" · "What time slots does run-the-city-before-it-wakes-up have on 7 November 2026?" · "Plan a 3-day Armenia trip with wine and hiking" · "Where can I eat Armenian food in Yerevan?"
- Negative test prompts (should NOT book or misuse): "Book and pay for this apartment for me" (→ explains it can't book; gives the listing link) · "Find me a hotel in Paris" (→ no Armenia results) · "What's the weather in Yerevan tomorrow?" (→ tool not used).
- Privacy `https://revampvacations.com/privacy` · Terms `https://revampvacations.com/terms` · Support `hello@revampvacations.com` · organization verification: Revamp Hospitality LLC.
- **Domain verification:** OpenAI gives a token to serve at `https://revampvacations.com/.well-known/openai-apps-challenge` — send it to Claude Code and it'll be added.
- Logo: `icon-512.png` (ask if a dark-mode variant is required).
- No test account needed (no sign-in). Works on desktop and mobile (plain JSON tools, no UI).
