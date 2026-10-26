/**
 * /ai — "Plan your Armenia trip in ChatGPT or Claude": the traveller-facing page
 * for Revamp's AI-assistant connector (server/mcp.ts). One copy deck shared by
 * the React page (client/src/pages/AiAssistants.tsx) and the crawler HTML
 * (server/prerender.ts `renderAiPage`), so the two never drift.
 *
 * Directory listings: set `listingUrl` once an app directory approves Revamp —
 * the page then shows "Add to ChatGPT" / "Add to Claude" instead of the manual
 * steps. Until then nothing links to a listing that doesn't exist yet.
 */

export const AI_PAGE_PATH = "/ai";

export const AI_PAGE = {
  title: "Plan your Armenia trip in ChatGPT or Claude",
  metaTitle: "Revamp in ChatGPT & Claude — plan your Armenia trip by chat",
  description:
    "Ask ChatGPT or Claude for a place to stay, a tour or an experience in Armenia. Revamp answers with real listings, live availability and the full price for your dates — then you book on Revamp.",
  intro:
    "Ask in your own words. Revamp answers inside the chat with real places, live availability and the full price for your dates — then you book on Revamp.",
} as const;

export const AI_BENEFITS = [
  {
    key: "availability",
    title: "Only what's available",
    body: "Your dates are checked against each host's calendars and bookings, so you only see places you can actually book.",
  },
  {
    key: "price",
    title: "The full price, up front",
    body: "The total for your stay with fees and 10% tax included, plus the cancellation terms — the same price you pay at checkout.",
  },
  {
    key: "photos",
    title: "The real photos",
    body: "Each result shows the listing's own photos, uploaded by the host — not pictures pulled from the web.",
  },
  {
    key: "book",
    title: "Book safely on Revamp",
    body: "Nothing is booked or paid inside the chat. Every result links to the listing on Revamp, where you book and pay.",
  },
] as const;

export const AI_PROMPTS = [
  "Find me a place to stay in Yerevan for 2 people next weekend",
  "What experiences are available in Yerevan next Saturday for 2?",
  "Is anything available in Dilijan for 4 people in two weeks? What's the total?",
  "Plan a 3-day trip in Armenia focused on food and history",
] as const;

export interface AiApp {
  key: "chatgpt" | "claude";
  name: string;
  /** Public directory listing — null until the app is approved there. */
  listingUrl: string | null;
  /** Status line shown while there's no listing yet. */
  pending: string;
  /** Connector address for adding it by hand. */
  connectorUrl: string;
  steps: string[];
}

export const AI_APPS: AiApp[] = [
  {
    key: "claude",
    name: "Claude",
    listingUrl: null,
    pending: "Works today as a custom connector.",
    connectorUrl: "https://mcp.revampvacations.com/mcp",
    steps: [
      "In Claude, open Settings → Connectors → Add custom connector.",
      "Name it Revamp Vacations and paste the address below.",
      "Leave sign-in off and add it.",
      "In a new chat, turn on Revamp Vacations and ask away.",
    ],
  },
  {
    key: "chatgpt",
    name: "ChatGPT",
    listingUrl: null,
    pending: "Coming soon to the ChatGPT app directory. Until then you can add it in Developer mode.",
    connectorUrl: "https://mcp.revampvacations.com/mcp/chatgpt",
    steps: [
      "In ChatGPT, open Settings → Apps → Advanced settings and turn on Developer mode.",
      "Back in Apps, choose Create and name it Revamp Vacations.",
      "Paste the address below and choose No authentication.",
      "In a new chat, pick Revamp Vacations from the + menu and ask away.",
    ],
  },
];
