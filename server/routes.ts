/**
 * Listings CRUD used to live here (see git history / the old
 * server/store.ts) — it's gone now. Listings are a Supabase table
 * (supabase/migrations/0001_init.sql) that the client reads and writes
 * directly, protected by Row-Level Security instead of hand-written route
 * checks. The only server route left is the AI trip planner, which still
 * needs to run server-side because it holds ANTHROPIC_API_KEY.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { listPublishedForPlanner } from "./supabase.js";
import { planTrip, PlannerError } from "./planner.js";

const planTripSchema = z.object({
  days: z.number().int().min(1).max(21),
  startCity: z.string().trim().min(1).max(60),
  travelers: z.number().int().min(1).max(20),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  budget: z.enum(["budget", "mid-range", "comfort"]),
  interests: z.array(z.string().trim().min(1).max(40)).max(8),
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
}
