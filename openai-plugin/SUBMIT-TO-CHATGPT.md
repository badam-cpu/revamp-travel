# Submitting Revamp Vacations to ChatGPT — step by step

**What you're submitting:** `revamp-vacations-chatgpt-plugin.zip` (in your Documents folder). It contains the listing (name, descriptions, links, logo) and points ChatGPT at `https://mcp.revampvacations.com/mcp/chatgpt` — the read-only Revamp connector whose links go to listing pages, never checkout (OpenAI's rule).

**Before you start:** the `/mcp/chatgpt` address must be live — tell Claude Code "push" first.

---

## Part 1 — Try it in ChatGPT first (Developer mode, ~5 min)

1. Open **chatgpt.com** → your profile (bottom-left) → **Settings** → **Apps** (may be called *Apps & Connectors*).
2. Open **Advanced settings** and switch **Developer mode** on.
3. Back in **Apps**, choose **Create** (or *Add app / Add connector*).
   - Name: `Revamp Vacations`
   - MCP server URL: `https://mcp.revampvacations.com/mcp/chatgpt`
   - Authentication: **No authentication**
   - Tick that you trust the app, then **Create**.
4. Start a new chat, pick **Revamp Vacations** from the **+** / tools menu, and try the 5 prompts in Part 3. Each should answer with real Revamp listings.

(The exact menu labels move around in ChatGPT updates — if something is named slightly differently, it's the same idea.)

## Part 2 — Submit (~20 min)

1. Go to **platform.openai.com/plugins** and sign in with the account that owns your OpenAI organization.
   - First time only: **Settings → Organization → General** — complete **business verification** for *Revamp Hospitality LLC*. Your listing shows the verified name.
2. Click **Upload new or existing plugin** → **Upload plugin** → choose `revamp-vacations-chatgpt-plugin.zip`.
3. **Metadata & Skills** — if an **Issues** panel shows anything, click **Copy issues** and send them to Claude Code; it'll fix the package and you re-upload.
4. **MCPs** → **Connect**:
   - MCP Server URL is pre-filled from the package (`…/mcp/chatgpt`). Authentication: **None**.
   - **Domain verification:** OpenAI shows a token. **Send the token to Claude Code** — it will publish it at `https://revampvacations.com/.well-known/openai-apps-challenge` (or on `mcp.revampvacations.com`). Then click verify.
   - Wait for the **tool scan** — it should list 5 tools, all read-only. If it flags anything, click **Copy issues** → send to Claude Code.
5. **Review information → Review details** — fill in:
   - **Reviewer credentials:** none needed — write *"No sign-in. The app is public and read-only."*
   - **Positive test cases (5)** and **Negative test cases (3):** copy from Part 3 below.
   - **Demo video URL:** record a 1–2 minute screen recording of Part 1, step 4 (asking 2–3 of the prompts), upload it as *unlisted* on YouTube or Loom, paste the link.
   - **Release notes:** *First release: read-only search, listing details, availability and quotes, and trip planning for Revamp Vacations' Armenia listings.*
   - **Commerce:** **No** — it doesn't sell anything or take payments.
   - **Countries:** leave empty (available everywhere), unless you want to limit it.
6. Click **Submit for review**, accept the policy attestations.
7. Track it under **Review status** on the Plugins page; feedback comes by email. When approved, click **Publish plugin**.

## Part 3 — Test cases to paste

**Positive**

| # | Description | Prompt | Tools triggered | Expected behavior |
|---|---|---|---|---|
| 1 | Find stays in a town | Find a cozy place to stay in Dilijan for two people | `search_listings` | Lists real Revamp stays in Dilijan with location, nightly price and a link to each listing |
| 2 | Exact quote for dates | Is "1br-w-scenic-views-pool-sauna" free from 10 to 14 February 2027 for 2 guests, and what's the total? | `get_quote` | Says it's available and gives the itemised total (accommodation, cleaning fee, 10% tax) in AMD, the cancellation terms, how payment works, and the listing link |
| 3 | Time slots for an activity | What time slots does "run-the-city-before-it-wakes-up" have on 7 November 2026 for 2 people? | `check_availability` | Lists the open time slots (e.g. 08:00 and 10:00) with seats left, and the listing link |
| 4 | Listing details | Tell me about "1br-w-scenic-views-pool-sauna" — its amenities and key facts | `get_listing` | Describes the listing using its real description, amenities and facts, with the link |
| 5 | Trip plan | Plan a 2-day trip in Armenia focused on food and history | `plan_trip` | Returns a day-by-day plan using real Revamp listings, with links; says booking happens on the site |

**Negative**

| # | Description | Prompt |
|---|---|---|
| 1 | Asks it to book and pay — it must not | Book and pay for this apartment for me with my card |
| 2 | Outside Armenia — no fake results | Find me a hotel in Paris for this weekend |
| 3 | Unrelated question — tool not used | What's the weather in Yerevan tomorrow? |

## If anything goes wrong
Copy the message (or **Copy issues**) and send it to Claude Code. Package source: `revamp-travel/openai-plugin/` (`plugin.json`, `mcp.json`, `assets/logo.png`).
