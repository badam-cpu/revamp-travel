# Aha Voice Assistant — ElevenLabs setup (about 15 minutes)

The website side is built: a **Talk to Aha** button on stay / tour / experience pages
(`client/src/components/AhaVoiceButton.tsx`), the listing knowledge it hands to the
agent (`GET /api/voice/context`) and a date checker the agent can call
(`POST /api/voice/quote`). You only create the agent in ElevenLabs and paste one value
into Netlify.

## 1. Create the agent
ElevenLabs → **Agents** → **Create agent** → **Blank template**. Name: `Aha — Revamp listing assistant`.

### Agent tab
- **Agent language:** English. **Additional languages:** add **Russian**.
- **First message:** `Hi, I'm Aha, Revamp's assistant. What would you like to know?`
  (the website replaces it per language — see Security below).
- **System prompt:** paste everything between the lines.

---
You are Aha, the voice assistant of Revamp Vacations, a travel marketplace in Armenia. A guest is on the page of one listing and is talking to you through their browser. Today is {{today}}.

The listing you're helping with: {{listing_title}}

Everything you know about it is below. Answer ONLY from this information. Never invent amenities, times, distances, prices, availability, rules or promises. If the information doesn't answer a question, say you don't have that detail and suggest the guest tap "Ask the host a question" on the page — the host will reply in their messages.

{{listing_context}}

How to help:
- Keep answers short and natural for speech: one to three sentences. No lists, no markdown, no links, no emoji.
- Reply in the language the guest speaks (English or Russian).
- For availability or price on specific dates, call the check_dates tool with the dates in YYYY-MM-DD and the number of guests, then say what it returns. Ask for any missing date first. Stays need a check-in and check-out date; tours and experiences need one date.
- Prices are in Armenian dram and include fees and 10% tax; say "drams".
- You can't book, hold dates, take payments, change or cancel bookings, or give refunds. Say that booking happens on this page, and that the host handles changes and special requests through "Ask the host a question".
- Never ask for or repeat payment details, passwords or ID numbers. Never share the host's phone, email or messenger — guests contact hosts through Revamp.
- If asked about other places, say you can help with this listing and the guest can browse others on revampvacations.com.
---

- **LLM:** Claude **Haiku 5.5** (fast and cheap; Sonnet if you want richer answers).
- **Voice:** a natural voice that speaks Russian too (e.g. one from the multilingual library). Model: **Flash v2.5** (low latency, supports English + Russian).

### Tools → Add tool → Webhook
- **Name:** `check_dates`
- **Description:** `Check whether this listing is available on given dates and get the all-in total. Use when the guest asks about availability or price for specific dates.`
- **Method:** POST — **URL:** `https://revampvacations.com/api/voice/quote`
- **Body parameters:**
  | Name | Type | Value |
  |---|---|---|
  | `slug` | string | **Dynamic variable** → `listing_slug` |
  | `startDate` | string | LLM prompt: `Check-in date (stays) or the activity date, YYYY-MM-DD` — required |
  | `endDate` | string | LLM prompt, **required**: `Check-out date (YYYY-MM-DD). For stays: the departure day. For tours and experiences: the same date as startDate.` |
  | `guests` | number | LLM prompt: `Number of guests; 2 if not said` |
- Add each one as its own **property** (+ Add property). Text in the tool's top Description box is NOT a parameter — ElevenLabs only sends real properties (that's how `endDate` went missing on 2026-10-27).
- The website also accepts `start`/`end`, form fields and query strings, but the names above are the reference.
- No auth header needed (the endpoint is public and read-only, like the listing page).
- The response has a `say` field — the sentence to tell the guest.

### Tools → Add tool → Client (fills the booking box)
- **Name:** `fill_booking`
- **Description:** `Fill in the booking box on the page with the guest's dates, number of guests and (tours) start time, after check_dates says they're available. The guest then taps Book to finish and pay.`
- **Wait for response:** ON (Aha says what the page answers, e.g. "Done — check-in Nov 20, check-out Nov 22, 2 guests are filled in").
- **Parameters** — add each as its own property:
  | Identifier | Type | Required | Description |
  |---|---|---|---|
  | `startDate` | String | ✓ | `Check-in date (stays) or the activity date, YYYY-MM-DD` |
  | `endDate` | String | ✓ | `Check-out date (YYYY-MM-DD). For tours and experiences: the same date as startDate.` |
  | `guests` | Number | ✓ | `Number of guests` |
  | `time` | String | – | `Tours/experiences: the start time the guest chose, e.g. 08:00` |
- Nothing is booked: the website only fills in the form (same checks as a guest's own clicks) and the guest taps Book.

### Tools → Add tool → Client (shows photos, 2026-10-27)
- **Name:** `show_photo`
- **Description:** `Open one of the listing's photos on the guest's screen. Use the number from the PHOTOS list in the listing details, e.g. when the guest says "show me the bathroom".`
- **Wait for response:** ON
- **Parameters:** `number` · Number · required · `The photo's number from the PHOTOS list`

### Tools → Add tool → Client (homepage voice search, 2026-10-27)
- **Name:** `search_places`
- **Description:** `Search Revamp for stays, tours or experiences. The results show as cards on the visitor's screen; say what the tool returns.`
- **Wait for response:** ON
- **Parameters** (all optional, each its own property):
  | Identifier | Type | Description |
  |---|---|---|
  | `type` | String | `stay, tour or experience` |
  | `where` | String | `Town or region in Armenia in English, e.g. Dilijan` |
  | `startDate` | String | `Check-in date or activity date, YYYY-MM-DD` |
  | `endDate` | String | `Check-out date for stays, YYYY-MM-DD` |
  | `guests` | Number | `Number of people` |
  | `maxPrice` | Number | `Highest price per night in Armenian drams` |
  | `keywords` | String | `Short words like pool, wine, hiking, view` |
- The homepage sends its own instructions (the prompt override below), so the agent's
  main prompt stays the listing one.

### Security tab
- **Overrides:** turn on **First message**, **Language** and **System prompt** (the site sends the greeting, the English/Russian choice and — on the homepage only — the search instructions).
- **Allowlist / origins:** add `revampvacations.com` and `www.revampvacations.com` so the agent only works on our site.
- **Authentication:** leave off (public agent) — or ask Claude Code to switch to signed URLs later.

### Advanced tab
- **Max conversation duration:** `240` seconds (the website also hangs up at 4 minutes).

### Budget (2026-10-27 — keep voice under about $20 a month on top of the plan)
- Every call is counted by the website first (migration `0121`, `claim_voice_call`):
  at most **90 calls a month** and **8 a day** (Netlify env `VOICE_MONTHLY_CALLS` /
  `VOICE_DAILY_CALLS` change them) and 6 per visitor per hour. With 4-minute calls the
  worst case is ~360 minutes a month.
- Optional, stronger: Agent → Security → **Enable authentication**, and put an
  ElevenLabs API key in Netlify as `ELEVENLABS_API_KEY` (a secret). The website then
  hands out a one-time signed link per counted call, and nobody can start a call
  around the counter. Do both together — authentication without the key stops all calls.
- ElevenLabs → Subscription: leave **usage-based billing** off (or set its limit) as the
  last backstop.

### Privacy / data
- Set **conversation retention** to a short period (e.g. 30 days) — our privacy policy says recordings are kept only for a limited period.

### Usage limits
- Set a **monthly character / minute cap** on your plan so a spike can't surprise you.

## 2. Turn it on
1. Copy the **Agent ID** (Agent → top of the page).
2. Netlify → Site configuration → Environment variables → add `VITE_ELEVENLABS_AGENT_ID` = that id.
3. Redeploy (or tell Claude Code "push" after the next change). The **Talk to Aha** button then appears under "Ask the host a question" on stays, tours and experiences.

## 3. Test
Open a listing → Talk to Aha → English → Start talking. Ask: "Is there parking?", then "Is it free from the 20th to the 22nd of November for two?" — it should call `check_dates` and say the total. Try Русский too.
