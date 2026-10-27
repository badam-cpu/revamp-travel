/**
 * Public Revamp MCP server (Model Context Protocol) — lets AI assistants that
 * speak MCP discover and use the LIVE, published Revamp catalog: search stays /
 * tours / experiences / restaurants / places, fetch a listing's details, check a
 * stay's availability, and generate a trip plan grounded in real inventory.
 *
 * READ-ONLY and public: it exposes only the same published data the website
 * already shows (no auth, no secrets, no writes/bookings). Every tool is
 * annotated readOnlyHint (Meta Muse classifies them all as "Read"). get_quote /
 * check_availability give the outcome — exact all-in price, real dates and time
 * slots, cancellation terms (server/mcpQuote.ts) — not just a link. Errors are
 * calm, never internal details (isError: true). Rate-limited in server/routes.ts. Served over the MCP
 * Streamable HTTP transport in STATELESS mode (a fresh server + transport per
 * request, JSON responses) so it works inside the Netlify Function. Wired at
 * POST /mcp (and /api/mcp) in server/routes.ts.
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Request, Response } from "express";
import { getPublishedCatalog, listPublishedForPlanner, type PublicListing } from "./supabase.js";
import { planTrip } from "./planner.js";
import { isDiscoverable, photoCaption } from "../shared/listings.js";
import { listingPhotos, quoteListing } from "./mcpQuote.js";
import { cardsToolMeta, registerCardsResource } from "./mcpCards.js";
import { publicClient } from "./supabase.js";

const SITE = () => (process.env.URL || "https://revampvacations.com").replace(/\/+$/, "");

function listingUrl(slug: string): string {
  return `${SITE()}/listing/${slug}`;
}


/** Compact, AI-friendly summary of a listing (used by search). */
function summarize(l: PublicListing) {
  return {
    slug: l.slug,
    type: l.type,
    title: l.title,
    // "Yerevan, Yerevan" → "Yerevan" (city and region are the same for the capital).
    location: Array.from(new Set([l.city, l.region].filter(Boolean))).join(", "),
    price: l.price > 0 ? `${l.priceLabel} / ${l.priceUnit}` : l.priceLabel,
    description: l.shortDescription,
    tags: l.tags?.slice(0, 6),
    cuisine: l.cuisine,
    venueType: l.venueType,
    // The listing's own cover photo — use it when showing this result.
    image: listingPhotos(l)[0],
    // Google's rating of the business (restaurants/places) — labelled as such, never a Revamp rating.
    googleRating: typeof l.googleRating === "number" ? l.googleRating : undefined,
    url: listingUrl(l.slug),
  };
}

/** Fuller detail for a single listing (used by get_listing). */
function detail(l: PublicListing) {
  return {
    ...summarize(l),
    longDescription: l.longDescription || undefined,
    amenities: l.amenities?.length ? l.amenities : undefined,
    highlights: l.highlights?.length ? l.highlights : undefined,
    facts: Array.isArray(l.facts) && l.facts.length ? l.facts : undefined,
    maxGuests: l.maxGuests,
    branches: l.branches?.map((b) => ({ label: b.label, address: b.address })),
    // The host's approved answers to common guest questions (0118) — answer from these.
    faq: l.faq?.length ? l.faq : undefined,
    // The listing's own photos (up to 6) with the host's captions where set.
    photos: listingPhotos(l)
      .slice(0, 6)
      .map((url) => ({ url, caption: photoCaption(l, url) || undefined })),
  };
}

const TEXT = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
/** Text for the model + the same data as structuredContent for our result cards (server/mcpCards.ts). */
// Hosts (ChatGPT) like to decorate an answer with images from a web search — those show
// other properties. Say so in the result itself, next to the data the model reads.
const CARD_NOTE =
  "The user already sees this as Revamp cards with each listing's own photo, price and link. Keep your reply short and don't add images from the web — they show other properties, not these listings.";
// The model gets the facts it needs to answer (title, place, price, availability, link) but
// not the marketing copy — with descriptions it wrote its own illustrated list under our cards,
// with web photos of other properties. The cards get everything via `_meta` (widget-only).
function forModel(data: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(data.results)) return data;
  return {
    ...data,
    results: (data.results as Record<string, unknown>[]).map(({ description: _d, tags: _t, ...rest }) => rest),
  };
}
const CARDS = (data: Record<string, unknown>) => {
  const slim = forModel(data);
  return {
    content: [{ type: "text" as const, text: CARD_NOTE }, ...TEXT(slim).content],
    structuredContent: slim,
    _meta: { "revamp/cards": data },
  };
};
const PHOTO_NOTE =
  "If you show pictures, use only the URLs in `photos` — images found on the web show other properties, not this listing.";
/** A tool-level error the assistant can relay — plain words, no internals. */
const ERROR = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] });
/** Every public tool only reads published data (MCP tool annotations). */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Run fn over items with at most `n` in flight (keeps a dated search to a few DB calls at a time). */
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * `links: "listing"` = the ChatGPT variant (/mcp/chatgpt): identical tools, but
 * quotes link to the listing page, never a checkout page (OpenAI's directory
 * rules don't allow links to checkout/transactional pages). Muse, Claude and
 * others use /mcp with pre-filled checkout links.
 */
export interface PublicServerOptions {
  links?: "checkout" | "listing";
}

export function createPublicServer(opts: PublicServerOptions = {}): McpServer {
  const links = opts.links ?? "checkout";
  const server = new McpServer({ name: "revamp-vacations", version: "1.0.0" });
  // Our own result cards — so hosts show the listing's real photo, not a web image search's.
  registerCardsResource(server);

  server.registerTool(
    "search_listings",
    {
      title: "Search Revamp listings",
      description:
        "Search Revamp Vacations' published listings in Armenia: places to stay, tours, experiences, restaurants (eat) and places to visit. Returns each match's slug, type, location, headline price in AMD, short description, page link, and the listing's own cover photo (image) — use that photo when showing the result. When the user gives dates, pass startDate (and endDate for stays) and guests: the search then returns only listings that are actually available for those dates, each with its exact all-in total (fees and tax included), cheapest first. For one listing's full price breakdown and terms, use get_quote.",
      annotations: READ_ONLY,
      _meta: cardsToolMeta("Searching Revamp…", "Revamp listings"),
      inputSchema: {
        type: z.enum(["stay", "tour", "experience", "eat", "place"]).optional().describe("Limit to one listing type."),
        region: z.string().optional().describe("Armenian region or city, e.g. 'Yerevan', 'Tavush', 'Dilijan'."),
        query: z.string().optional().describe("Free-text match on title, description, tags, cuisine, city."),
        cuisine: z.string().optional().describe("For restaurants: a cuisine/venue type, e.g. 'Armenian', 'Fast food'."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
        startDate: DATE.optional().describe("Optional. Check-in date for stays, or the activity date, YYYY-MM-DD — returns only listings available then, with totals."),
        endDate: DATE.optional().describe("Stays: check-out date, YYYY-MM-DD (with startDate)."),
        guests: z.number().int().min(1).max(30).optional().describe("Party size (default 2) — used with dates."),
      },
    },
    async ({ type, region, query, cuisine, limit, startDate, endDate, guests }) => {
      const catalog = await getPublishedCatalog();
      const q = (query || "").trim().toLowerCase();
      const reg = (region || "").trim().toLowerCase();
      const cui = (cuisine || "").trim().toLowerCase();
      const matches = catalog
        .filter((l) => {
          if (!isDiscoverable(l)) return false; // paused by the host (0101)
          if (type && l.type !== type) return false;
          if (reg && ![l.region, l.city].some((v) => (v || "").toLowerCase().includes(reg))) return false;
          if (cui && ![l.cuisine, l.venueType].some((v) => (v || "").toLowerCase().includes(cui))) return false;
          if (q) {
            const hay = [l.title, l.city, l.region, l.shortDescription, l.cuisine, l.venueType, ...(l.tags || [])].join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        ;
      if (!startDate) {
        const results = matches.slice(0, limit ?? 10).map(summarize);
        return CARDS({ kind: "listings", count: results.length, results });
      }
      // With dates: quote the matching bookable listings (same logic as get_quote)
      // and keep only the ones that are free, cheapest all-in total first. Hotels
      // (rooms chosen on the page) come after, clearly marked.
      const bookable = matches.filter((l) => (l.type === "stay" ? !!endDate : l.type === "tour" || l.type === "experience")).slice(0, 24);
      const quotes = await mapLimit(bookable, 6, async (l) => {
        try {
          const q = await quoteListing(publicClient(), { slug: l.slug, startDate, endDate, guests }, links);
          return "error" in q ? null : { l, q };
        } catch (err) {
          console.error("[mcp] search quote", l.slug, err);
          return null;
        }
      });
      const free = quotes.filter((x): x is NonNullable<typeof x> => !!x && x.q.available !== false);
      free.sort((a, b) => Number(a.q.available !== true) - Number(b.q.available !== true) || (a.q.price?.total ?? Infinity) - (b.q.price?.total ?? Infinity));
      const results = free.slice(0, limit ?? 10).map(({ l, q }) => ({
        ...summarize(l),
        available: q.available,
        reason: q.available === true ? undefined : q.reason,
        nights: q.nights,
        total: q.price?.total,
        totalFormatted: q.price?.totalFormatted,
        slots: q.slots?.map((s) => s.localTime),
        room: q.room,
        rooms: q.available !== true && q.rooms?.length ? q.rooms.map((r) => r.name) : undefined,
        bookUrl: q.bookUrl,
      }));
      return CARDS({
        kind: "listings",
        startDate,
        endDate: endDate ?? undefined,
        guests: guests ?? 2,
        checked: bookable.length,
        count: results.length,
        results,
        note: results.length ? undefined : "Nothing matching is available for those dates on Revamp. Try other dates or a nearby area.",
      });
    },
  );

  server.registerTool(
    "get_listing",
    {
      title: "Get a Revamp listing",
      description: "Fetch full details for one listing by its slug (from search_listings): description, amenities, highlights, facts, capacity, the host's answers to common guest questions (faq — use them to answer questions about this listing), the page link, and the listing's own photos (with captions) — use these photos when showing it.",
      annotations: READ_ONLY,
      inputSchema: { slug: z.string().describe("The listing slug, e.g. 'forest-house-dilijan'.") },
    },
    async ({ slug }) => {
      const catalog = await getPublishedCatalog();
      const l = catalog.find((x) => x.slug === slug);
      if (!l) return ERROR("No published listing with that slug.");
      return { content: [{ type: "text" as const, text: PHOTO_NOTE }, ...TEXT(detail(l)).content] };
    },
  );

  server.registerTool(
    "get_quote",
    {
      title: "Get an exact quote",
      description:
        `Exact availability and all-in price for one stay, tour or experience. Stays: checks the dates against the host's calendars, existing bookings, minimum stay and capacity, and returns the itemised total (accommodation, discounts, fees, tax) in AMD. Tours and experiences: returns the open time slots with seats left for that date and the total for the party. Also returns the cancellation terms, how payment works, and ${links === "checkout" ? "a link to book" : "a link to the listing page, where it can be booked"}. Hotels list their room types (rooms are chosen on the listing page). Read-only: nothing is held or booked.`,
      annotations: READ_ONLY,
      _meta: cardsToolMeta("Checking dates and price…", "Revamp quote"),
      inputSchema: {
        slug: z.string().describe("The listing slug (from search_listings)."),
        startDate: DATE.describe("Check-in date for stays, or the activity date; YYYY-MM-DD."),
        endDate: DATE.optional().describe("Stays only: check-out date, YYYY-MM-DD (the night before is the last night)."),
        guests: z.number().int().min(1).max(30).optional().describe("Party size (default 2)."),
      },
    },
    async ({ slug, startDate, endDate, guests }) => {
      try {
        const q = await quoteListing(publicClient(), { slug, startDate, endDate, guests }, links);
        return "error" in q ? ERROR(q.error) : CARDS({ kind: "quote", ...q });
      } catch (err) {
        console.error("[mcp] get_quote", err);
        return ERROR("Couldn't get a quote right now. Please try again shortly.");
      }
    },
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check availability",
      description:
        "Check whether a stay is available for a date range, or which time slots a tour or experience has on a date. Dates are YYYY-MM-DD; for stays endDate is the check-out day. Returns available (true/false, or null with a reason when it can't be confirmed here, e.g. hotels where a room type is chosen on the page). Use get_quote for the price.",
      annotations: READ_ONLY,
      inputSchema: {
        slug: z.string().describe("The listing slug."),
        startDate: DATE.describe("Check-in (stays) or activity date, YYYY-MM-DD."),
        endDate: DATE.optional().describe("Stays: check-out, YYYY-MM-DD."),
        guests: z.number().int().min(1).max(30).optional().describe("Party size (default 2)."),
      },
    },
    async ({ slug, startDate, endDate, guests }) => {
      try {
        const q = await quoteListing(publicClient(), { slug, startDate, endDate, guests }, links);
        if ("error" in q) return ERROR(q.error);
        return TEXT({ slug: q.slug, title: q.title, type: q.type, startDate: q.startDate, endDate: q.endDate, guests: q.guests, available: q.available, reason: q.reason, slots: q.slots, room: q.room, rooms: q.rooms, bookUrl: q.bookUrl });
      } catch (err) {
        console.error("[mcp] check_availability", err);
        return ERROR("Couldn't check availability right now. Please try again shortly.");
      }
    },
  );

  server.registerTool(
    "plan_trip",
    {
      title: "Plan an Armenia trip",
      description: "Generate a suggested day-by-day Armenia itinerary using Revamp's published listings (stays, tours, experiences, restaurants). Returns a structured plan with listing links; it doesn't check dates or book anything — use get_quote for that.",
      annotations: { ...READ_ONLY, idempotentHint: false },
      inputSchema: {
        days: z.number().int().min(1).max(14).describe("Trip length in days."),
        startCity: z.string().optional().describe("Base city (default 'Yerevan')."),
        travelers: z.number().int().min(1).max(20).optional().describe("Number of travelers (default 2)."),
        pace: z.enum(["relaxed", "balanced", "packed"]).optional().describe("Default 'balanced'."),
        budget: z.enum(["budget", "mid-range", "comfort"]).optional().describe("Default 'mid-range'."),
        interests: z.array(z.string()).optional().describe("e.g. ['hiking','wine','history','food']."),
      },
    },
    async ({ days, startCity, travelers, pace, budget, interests }) => {
      try {
        const catalog = await listPublishedForPlanner();
        const itinerary = await planTrip(
          {
            days,
            startCity: startCity || "Yerevan",
            travelers: travelers ?? 2,
            pace: pace ?? "balanced",
            budget: budget ?? "mid-range",
            interests: interests ?? [],
          },
          catalog,
        );
        return TEXT(itinerary);
      } catch (err) {
        console.error("[mcp] plan_trip", err);
        return ERROR("The trip planner is unavailable right now. Please try again shortly.");
      }
    },
  );

  return server;
}

/**
 * Dispatch an MCP request to a (fresh) McpServer and write the JSON response.
 * Stateless: driven through an IN-MEMORY transport, not the SDK's Node HTTP
 * Streamable transport — that transport reads headers via @hono/node-server's
 * Web Request, which doesn't see Content-Type under serverless-http inside the
 * Netlify Function (works in raw Express, 415s deployed). Express has already
 * parsed the JSON body, so we pass the JSON-RPC message(s) straight to the
 * server and return the response(s). Shared by the public + admin endpoints.
 */
export async function dispatchMcp(server: McpServer, req: Request, res: Response): Promise<void> {
  const body = req.body as unknown;
  if (!body || typeof body !== "object") {
    await server.close().catch(() => {});
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: expected a JSON-RPC message" }, id: null });
    return;
  }
  const messages = (Array.isArray(body) ? body : [body]) as JSONRPCMessage[];
  const expected = messages.filter((m) => m && typeof m === "object" && "method" in m && "id" in m && (m as { id?: unknown }).id != null).length;

  // Issue a session id on initialize. We run statelessly (a fresh server per
  // request), so we never actually track sessions — but some MCP clients (the
  // claude.ai remote connector among them) treat the absence of Mcp-Session-Id
  // as a half-open connection and report "Server not responding" after the
  // handshake. Handing back an id satisfies them; we accept (and ignore) it on
  // every later request. The id is exposed via CORS in the route's mcpCors().
  const isInitialize = messages.some((m) => m && typeof m === "object" && (m as { method?: string }).method === "initialize");
  if (isInitialize && !res.headersSent) res.setHeader("Mcp-Session-Id", randomUUID());

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const responses: JSONRPCMessage[] = [];
  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      clientSide.onmessage = (msg) => {
        responses.push(msg);
        if (responses.length >= expected) finish();
      };
      clientSide.onclose = finish;
      setTimeout(finish, 28_000);
      void clientSide
        .start()
        .then(async () => {
          for (const m of messages) await clientSide.send(m);
          if (expected === 0) finish();
        })
        .catch(finish);
    });
    if (expected === 0 || responses.length === 0) {
      res.status(202).end();
      return;
    }
    // Reply the way the reference Streamable-HTTP transport does: if the client
    // accepts text/event-stream, frame the response(s) as SSE (what some MCP
    // clients require); otherwise plain JSON. One buffered write either way —
    // fine for a single request/response under the Netlify Function.
    const accept = (req.get("accept") || "").toLowerCase();
    if (accept.includes("text/event-stream")) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      for (const r of responses) res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
      res.end();
    } else {
      res.json(Array.isArray(body) ? responses : responses[0]);
    }
  } finally {
    await server.close().catch(() => {});
    await clientSide.close().catch(() => {});
  }
}

/** Express handler for the public MCP endpoint (read-only, no auth). */
export async function handlePublicMcp(req: Request, res: Response, opts: PublicServerOptions = {}): Promise<void> {
  await dispatchMcp(createPublicServer(opts), req, res);
}

/** Human/discovery info for a GET on the MCP endpoint (clients use POST). */
export function mcpInfo() {
  return {
    name: "Revamp Vacations MCP",
    description: "Read-only MCP server for the live Revamp Vacations catalog (Armenia): search stays, tours, experiences, restaurants and places; check availability; plan a trip.",
    transport: "streamable-http",
    endpoint: `${SITE()}/mcp`,
    tools: ["search_listings", "get_listing", "get_quote", "check_availability", "plan_trip"],
    docs: `${SITE()}/developers`,
  };
}
