# Deploying the streaming MCP server

The website runs on Netlify. Netlify Functions serve the site **and** a working
MCP endpoint for non-connector clients (Cursor, Cline, SDK, `mcp-remote`), but
they can't hold an open SSE stream — which the **claude.ai remote connector**
requires. So to let anyone add Revamp with the standard "Add connector" flow,
the MCP also needs to run on an **always-on host**.

This repo ships that: the same Express app, run as a persistent container with
the streaming transport on (`MCP_STREAMING=1`, already set in the `Dockerfile`).
You point a subdomain at it and advertise that. **Nothing about the website
changes** — only `/mcp` gets a better home.

Final URL to advertise: **`https://mcp.revampvacations.com/mcp`**

---

## What you need

- A container host account (pick one below).
- These values, copied from your **Netlify → Site settings → Environment
  variables** (same values the site already uses):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `ANTHROPIC_API_KEY`  (powers the `plan_trip` tool)
  - *(optional, only for the private team MCP at `/mcp/admin`)*
    `SUPABASE_SERVICE_ROLE_KEY` and `MCP_ADMIN_KEY`
- `MCP_STREAMING=1` is baked into the Dockerfile; no need to set it, but setting
  it explicitly doesn't hurt.

---

## Option A — Railway (easiest, ~$5/mo, no sleep) ← recommended

1. Go to railway.app → **New Project → Deploy from GitHub repo** → pick
   `badam-cpu/revamp-travel`. It auto-detects the `Dockerfile`.
2. **Variables** tab → add the env values above.
3. It builds and deploys. Under **Settings → Networking → Generate Domain** you
   get a `*.up.railway.app` URL. Test it first (see "Verify" below) using that
   URL with `/mcp`.
4. **Custom domain:** Settings → Networking → **Custom Domain** →
   `mcp.revampvacations.com`. Railway shows a CNAME target
   (e.g. `abcd.up.railway.app`).
5. In **Netlify → Domains → DNS** for `revampvacations.com`, add a **CNAME**:
   `mcp` → the Railway target. Wait for it to verify + issue TLS.

## Option B — Fly.io (free allowance, keeps one machine warm)

1. Install flyctl, `fly auth login`.
2. In the repo: `fly launch --no-deploy` (it detects the Dockerfile; pick a name
   like `revamp-mcp`, don't add a DB).
3. Set secrets:
   `fly secrets set VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… ANTHROPIC_API_KEY=…`
4. In `fly.toml` set `[http_service] min_machines_running = 1` so it never cold-
   sleeps (a cold start can make the connector time out).
5. `fly deploy`. Then `fly certs add mcp.revampvacations.com` and add the CNAME
   it prints in Netlify DNS (as in A5).

> Avoid Render's **free** tier here — it sleeps after 15 min idle, and the cold
> start makes the connector report "server not responding". Render's paid tier
> is fine.

---

## Verify (any host)

Against the host URL (railway/fly domain first, then the custom domain):

```bash
# initialize must return 200 with an mcp-session-id header
curl -s -D - -o /dev/null -X POST https://mcp.revampvacations.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}' \
  | grep -iE '^HTTP|^mcp-session-id'
```

Then add it in Claude: **Settings → Connectors → Add custom connector →**
`https://mcp.revampvacations.com/mcp`, **No sign-in**. It should connect and
show 4 tools — and stay connected.

---

## After it's live

- Update `server/llms.ts` and the `/mcp` landing page to advertise
  `https://mcp.revampvacations.com/mcp` as the connector URL.
- The old `https://revampvacations.com/mcp` keeps working for non-connector
  clients; you can also 301 it to the subdomain if you prefer one URL.
