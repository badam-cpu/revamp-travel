/**
 * Listings CRUD used to live here (see git history / the old
 * server/store.ts) — it's gone now. Listings are a Supabase table
 * (supabase/migrations/0001_init.sql) that the client reads and writes
 * directly, protected by Row-Level Security instead of hand-written route
 * checks. Two server routes remain, both for jobs that genuinely need to
 * run server-side: the AI trip planner (holds ANTHROPIC_API_KEY) and the
 * dashboard's link-import prefill assist (fetches an arbitrary caller-
 * supplied URL, which the browser can't safely do itself — CORS aside,
 * this project's SSRF guard and size/timeout caps belong on the server).
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { listPublishedForPlanner, verifyUser, userClient } from "./supabase.js";
import { planTrip, PlannerError } from "./planner.js";
import { fetchPrefill, PrefillError } from "./urlPrefill.js";
import { fetchIcalBlockedRanges } from "./ical.js";
import { SafeFetchError } from "./safeFetch.js";
import { robotsTxtHandler } from "./robots.js";
import { sitemapHandler } from "./sitemap.js";
import { renderForBot } from "./prerender.js";

const planTripSchema = z.object({
  days: z.number().int().min(1).max(21),
  startCity: z.string().trim().min(1).max(60),
  travelers: z.number().int().min(1).max(20),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  budget: z.enum(["budget", "mid-range", "comfort"]),
  interests: z.array(z.string().trim().min(1).max(40)).max(8),
});

const importListingSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});

const syncIcalSchema = z.object({
  listingId: z.string().uuid(),
});

function issuesToMessage(err: z.ZodError): string {
  return err.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
}

export function registerApiRoutes(app: Express) {
  // Dynamic robots.txt / sitemap.xml. Registered at both the public path (for
  // the long-running server in server/index.ts, and local `pnpm start`) and
  // an /api-prefixed alias — on Netlify the CDN serves the SPA, so these are
  // reached only via the function, whose path normalizer forces everything
  // under /api (see netlify/functions/api.ts + the /robots.txt, /sitemap.xml
  // redirects in netlify.toml).
  app.get("/robots.txt", robotsTxtHandler);
  app.get("/api/robots.txt", robotsTxtHandler);
  app.get("/sitemap.xml", sitemapHandler);
  app.get("/api/sitemap.xml", sitemapHandler);

  // Bot-facing prerendered HTML for a given SPA route. Called by the Netlify
  // Edge Function (netlify/edge-functions/prerender.ts), which does the UA
  // sniffing at the edge and, for a known crawler, fetches this and returns
  // its HTML instead of the empty SPA shell. `path` is the SPA pathname to
  // render; `origin` is the real public origin (passed by the edge function
  // so canonical/OG/JSON-LD URLs are correct behind the proxy).
  app.get("/api/prerender", async (req: Request, res: Response) => {
    const rawPath = typeof req.query.path === "string" ? req.query.path : "/";
    const path = rawPath.startsWith("/") && rawPath.length <= 512 ? rawPath : "/";
    const origin =
      typeof req.query.origin === "string" && /^https?:\/\/[^\s/]+$/.test(req.query.origin)
        ? req.query.origin
        : `${req.protocol}://${req.get("host")}`;
    try {
      const { status, body } = await renderForBot(path, origin);
      res.status(status).set("Content-Type", "text/html; charset=utf-8").send(body);
    } catch (err) {
      console.error("prerender failed", err);
      // 500 (not 200) so the edge function knows to fall back to the SPA shell.
      res.status(500).set("Content-Type", "text/plain").send("prerender error");
    }
  });

  app.post("/api/plan-trip", async (req: Request, res: Response) => {
    const parsed = planTripSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    try {
      const listings = await listPublishedForPlanner();
      const itinerary = await planTrip(parsed.data, listings);
      res.json({ itinerary });
    } catch (err) {
      if (err instanceof PlannerError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("plan-trip failed", err);
      res.status(502).json({ error: "The trip planner is temporarily unavailable. Please try again." });
    }
  });

  app.post("/api/import-listing", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId) {
      return res.status(401).json({ error: "Sign in to use the link-import assist." });
    }

    const parsed = importListingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    try {
      const prefill = await fetchPrefill(parsed.data.url);
      res.json(prefill);
    } catch (err) {
      if (err instanceof PrefillError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("import-listing failed", err);
      res.status(502).json({ error: "Couldn't fetch that link — you can still fill the form in by hand." });
    }
  });

  // Refresh a listing's availability from its Airbnb (or any) iCal export URL.
  // Signed-in + scoped to the caller's own listing by RLS (userClient) — no
  // service-role privilege. One-way: reads the feed, caches blocked ranges.
  app.post("/api/sync-ical", async (req: Request, res: Response) => {
    const authHeader = req.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const userId = token ? await verifyUser(token) : null;
    if (!userId || !token) {
      return res.status(401).json({ error: "Sign in to sync a calendar." });
    }
    const parsed = syncIcalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    const supa = userClient(token);
    if (!supa) {
      return res.status(503).json({ error: "Calendar sync isn't configured on the server." });
    }
    const { listingId } = parsed.data;

    const { data: listing, error: readErr } = await supa.from("listings").select("id, ical_url").eq("id", listingId).maybeSingle();
    if (readErr || !listing) {
      return res.status(404).json({ error: "Listing not found." });
    }
    if (!listing.ical_url) {
      return res.status(400).json({ error: "Add an Airbnb calendar export URL to this listing first." });
    }

    try {
      const blockedRanges = await fetchIcalBlockedRanges(listing.ical_url);
      const syncedAt = new Date().toISOString();
      const { error: upErr } = await supa
        .from("listings")
        .update({ blocked_ranges: blockedRanges, ical_synced_at: syncedAt, ical_error: null })
        .eq("id", listingId);
      if (upErr) throw new Error(upErr.message);
      res.json({ count: blockedRanges.length, blockedRanges, syncedAt });
    } catch (err) {
      const message = err instanceof SafeFetchError ? err.message : "Couldn't read that calendar. Check it's the Airbnb calendar *export* URL (ends in .ics).";
      // Record the failure on the listing so the operator sees it, but don't wipe existing availability.
      await supa.from("listings").update({ ical_error: message, ical_synced_at: new Date().toISOString() }).eq("id", listingId);
      console.error("sync-ical failed", err);
      res.status(err instanceof SafeFetchError ? err.status : 502).json({ error: message });
    }
  });
}
