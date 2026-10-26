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
