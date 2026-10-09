/**
 * Public Revamp MCP server (Model Context Protocol) — lets AI assistants that
 * speak MCP discover and use the LIVE, published Revamp catalog: search stays /
 * tours / experiences / restaurants / places, fetch a listing's details, check a
 * stay's availability, and generate a trip plan grounded in real inventory.
 *
 * READ-ONLY and public: it exposes only the same published data the website
 * already shows (no auth, no secrets, no writes/bookings). Served over the MCP
 * Streamable HTTP transport in STATELESS mode (a fresh server + transport per
 * request, JSON responses) so it works inside the Netlify Function. Wired at
 * POST /mcp (and /api/mcp) in server/routes.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Request, Response } from "express";
import { getPublishedCatalog, listPublishedForPlanner, getListingBusyRangesBySlug, type PublicListing } from "./supabase.js";
import { planTrip } from "./planner.js";

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
    location: [l.city, l.region].filter(Boolean).join(", "),
    price: l.price > 0 ? `${l.priceLabel} / ${l.priceUnit}` : l.priceLabel,
    description: l.shortDescription,
    tags: l.tags?.slice(0, 6),
    cuisine: l.cuisine,
    venueType: l.venueType,
    rating: typeof l.googleRating === "number" ? l.googleRating : undefined,
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
  };
}

const TEXT = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

function createPublicServer(): McpServer {
  const server = new McpServer({ name: "revamp-vacations", version: "1.0.0" });

  server.registerTool(
    "search_listings",
    {
      title: "Search Revamp listings",
      description:
        "Search the live, published Revamp Vacations catalog across Armenia: places to stay, tours, experiences, restaurants (eat), and places to visit. Returns matching listings with a link to each. All data is real and current.",
      inputSchema: {
        type: z.enum(["stay", "tour", "experience", "eat", "place"]).optional().describe("Limit to one listing type."),
        region: z.string().optional().describe("Armenian region or city, e.g. 'Yerevan', 'Tavush', 'Dilijan'."),
        query: z.string().optional().describe("Free-text match on title, description, tags, cuisine, city."),
        cuisine: z.string().optional().describe("For restaurants: a cuisine/venue type, e.g. 'Armenian', 'Fast food'."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
      },
    },
    async ({ type, region, query, cuisine, limit }) => {
      const catalog = await getPublishedCatalog();
      const q = (query || "").trim().toLowerCase();
      const reg = (region || "").trim().toLowerCase();
      const cui = (cuisine || "").trim().toLowerCase();
      const results = catalog
        .filter((l) => {
          if (type && l.type !== type) return false;
          if (reg && ![l.region, l.city].some((v) => (v || "").toLowerCase().includes(reg))) return false;
          if (cui && ![l.cuisine, l.venueType].some((v) => (v || "").toLowerCase().includes(cui))) return false;
          if (q) {
            const hay = [l.title, l.city, l.region, l.shortDescription, l.cuisine, l.venueType, ...(l.tags || [])].join(" ").toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .slice(0, limit ?? 10)
        .map(summarize);
      return TEXT({ count: results.length, results });
    },
  );

  server.registerTool(
    "get_listing",
    {
      title: "Get a Revamp listing",
      description: "Fetch full details for one listing by its slug (from search_listings), including description, amenities, highlights, and the booking link.",
      inputSchema: { slug: z.string().describe("The listing slug, e.g. 'forest-house-dilijan'.") },
    },
    async ({ slug }) => {
      const catalog = await getPublishedCatalog();
      const l = catalog.find((x) => x.slug === slug);
      if (!l) return TEXT({ error: "No published listing with that slug." });
      return TEXT(detail(l));
    },
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check a stay's availability",
      description: "Check whether a stay is available for a date range. Dates are YYYY-MM-DD; end date is the check-out day (exclusive). Returns whether the range is free plus the listing's busy ranges.",
      inputSchema: {
        slug: z.string().describe("The stay's slug."),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-in, YYYY-MM-DD."),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Check-out, YYYY-MM-DD (exclusive)."),
      },
    },
    async ({ slug, startDate, endDate }) => {
      if (endDate <= startDate) return TEXT({ error: "endDate must be after startDate." });
      const busy = await getListingBusyRangesBySlug(slug);
      if (!busy) return TEXT({ error: "No published listing with that slug." });
      // Overlap test against [start, end) ranges (iCal/booked ranges are exclusive-end).
      const overlaps = busy.ranges.some((r) => startDate < r.end && endDate > r.start);
      return TEXT({ slug, title: busy.title, requested: { startDate, endDate }, available: !overlaps, busyRanges: busy.ranges });
    },
  );

  server.registerTool(
    "plan_trip",
    {
      title: "Plan an Armenia trip",
      description: "Generate a day-by-day Armenia itinerary grounded in Revamp's live catalog (real stays, tours, experiences, restaurants). Returns a structured plan.",
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
        return TEXT({ error: err instanceof Error ? err.message : "The trip planner is unavailable right now." });
      }
    },
  );

  return server;
}

/**
 * Express handler for the public MCP endpoint. Stateless: a fresh McpServer per
 * request, driven through an IN-MEMORY transport (not the HTTP Streamable
 * transport) and dispatched to JSON ourselves. This deliberately avoids the
 * SDK's Node HTTP transport, whose header parsing (via @hono/node-server) mises
 * the Content-Type when running under serverless-http inside the Netlify
 * Function (it works in raw Express, 415s in the Function). Express has already
 * parsed the JSON body, so we just pass the JSON-RPC message(s) to the server
 * and return the response(s). CORS is set by the caller (server/routes.ts).
 */
export async function handlePublicMcp(req: Request, res: Response): Promise<void> {
  const body = req.body as unknown;
  if (!body || typeof body !== "object") {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: expected a JSON-RPC message" }, id: null });
    return;
  }
  const messages = (Array.isArray(body) ? body : [body]) as JSONRPCMessage[];
  // Count request messages (have a method + a non-null id) — notifications get no response.
  const expected = messages.filter((m) => m && typeof m === "object" && "method" in m && "id" in m && (m as { id?: unknown }).id != null).length;

  const server = createPublicServer();
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
      setTimeout(finish, 28_000); // safety net under the function timeout
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
    res.json(Array.isArray(body) ? responses : responses[0]);
  } finally {
    await server.close().catch(() => {});
    await clientSide.close().catch(() => {});
  }
}

/** Human/discovery info for a GET on the MCP endpoint (clients use POST). */
export function mcpInfo() {
  return {
    name: "Revamp Vacations MCP",
    description: "Read-only MCP server for the live Revamp Vacations catalog (Armenia): search stays, tours, experiences, restaurants and places; check availability; plan a trip.",
    transport: "streamable-http",
    endpoint: `${SITE()}/mcp`,
    tools: ["search_listings", "get_listing", "check_availability", "plan_trip"],
    docs: `${SITE()}/`,
  };
}
