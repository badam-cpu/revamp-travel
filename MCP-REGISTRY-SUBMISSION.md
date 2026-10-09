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

For each: name **Revamp Vacations**, URL `https://mcp.revampvacations.com/mcp`, transport **streamable-http**, auth **none**, tools **search_listings, get_listing, check_availability, plan_trip**.

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
