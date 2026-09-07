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
