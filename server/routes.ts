import type { Express, Request, Response } from "express";
import { z } from "zod";
import * as store from "./store.js";
import { EDITABLE_LISTING_TYPES, placeholderImage, type ListingType } from "../shared/listings.js";
import { planTrip, PlannerError } from "./planner.js";

const factSchema = z.object({ label: z.string().min(1).max(60), value: z.string().min(1).max(120) });

// Cast preserves EDITABLE_LISTING_TYPES as the single source of truth while
// giving zod (and everything downstream) the literal `ListingType` union.
const editableTypeTuple = EDITABLE_LISTING_TYPES as unknown as [ListingType, ...ListingType[]];

const listingInputSchema = z.object({
  type: z.enum(editableTypeTuple),
  title: z.string().trim().min(2).max(120),
  eyebrow: z.string().trim().min(2).max(80),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(80),
  coordinates: z.object({ lat: z.number().gte(38).lte(42), lng: z.number().gte(43).lte(47) }),
  image: z.string().trim().max(2000).optional(),
  gallery: z.array(z.string().trim().max(2000)).max(8).optional(),
  shortDescription: z.string().trim().min(10).max(240),
  longDescription: z.string().trim().min(10).max(2000),
  price: z.number().finite().nonnegative(),
  priceLabel: z.string().trim().min(1).max(20),
  priceUnit: z.string().trim().min(1).max(30),
  tags: z.array(z.string().trim().min(1).max(30)).max(8),
  facts: z.array(factSchema).max(6),
  amenities: z.array(z.string().trim().min(1).max(60)).max(12),
  featured: z.boolean().optional(),
  accent: z.enum(["apricot", "sevan", "tuff"]),
});

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
  app.get("/api/listings", async (_req: Request, res: Response) => {
    const listings = await store.listAll();
    res.json({ listings });
  });

  app.post("/api/listings", async (req: Request, res: Response) => {
    const parsed = listingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    const input = parsed.data;
    const image = input.image?.trim() || placeholderImage;
    const listing = await store.create({
      ...input,
      image,
      gallery: input.gallery?.length ? input.gallery : [image],
    });
    res.status(201).json({ listing });
  });

  app.put("/api/listings/:id", async (req: Request, res: Response) => {
    const existing = await store.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Listing not found." });
    if (!EDITABLE_LISTING_TYPES.includes(existing.type)) {
      return res.status(403).json({ error: "This listing type can't be edited through the API." });
    }
    const parsed = listingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    const updated = await store.update(req.params.id, parsed.data);
    res.json({ listing: updated });
  });

  app.delete("/api/listings/:id", async (req: Request, res: Response) => {
    const existing = await store.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Listing not found." });
    if (!EDITABLE_LISTING_TYPES.includes(existing.type)) {
      return res.status(403).json({ error: "This listing type can't be deleted through the API." });
    }
    await store.remove(req.params.id);
    res.status(204).end();
  });

  app.post("/api/plan-trip", async (req: Request, res: Response) => {
    const parsed = planTripSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: issuesToMessage(parsed.error) });
    }
    try {
      const listings = await store.listAll();
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
