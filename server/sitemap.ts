/**
 * Dynamic GET /sitemap.xml — static public routes plus one <url> per
 * published listing, sourced from the same getPublishedCatalog() cache
 * server/prerender.ts uses (so a burst of crawler/sitemap-fetcher traffic
 * costs at most one Supabase round trip per 5-minute window). Origin is
 * derived from the incoming request, same as server/robots.ts — no env
 * var to configure, correct under any domain.
 */
import type { Request, Response } from "express";
import { getPublishedCatalog, getPublishedPosts } from "./supabase.js";
import { REGION_GUIDES } from "../shared/regionGuides.js";
import { slugify } from "../shared/slug.js";

const STATIC_ROUTES = ["/", "/explore", "/explore/stay", "/explore/eat", "/explore/tour", "/explore/experience", "/map", "/plan", "/faq", "/partners", "/gift-cards", "/blog", "/login", "/signup", ...REGION_GUIDES.map((g) => `/region/${g.slug}`)];

const normalizeRegionName = (r: string) => r.trim().replace(/\s+(province|marz)$/i, "").trim();

export async function sitemapHandler(req: Request, res: Response): Promise<void> {
  const origin = `${req.protocol}://${req.get("host")}`;
  const [catalog, posts] = await Promise.all([getPublishedCatalog(), getPublishedPosts()]);

  const staticUrls = STATIC_ROUTES.map((path) => `<url><loc>${origin}${path}</loc></url>`);
  const listingUrls = catalog.map((listing) => {
    const lastmod = listing.updatedAt ? listing.updatedAt.slice(0, 10) : undefined;
    return `<url><loc>${origin}/listing/${listing.slug}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  });
  const postUrls = posts.map((post) => {
    const lastmod = post.updatedAt ? post.updatedAt.slice(0, 10) : undefined;
    return `<url><loc>${origin}/blog/${post.slug}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  });

  // Eat landing pages — one per region and per cuisine that actually has picks
  // (mirrors the /eat/:region and /eat/cuisine/:cuisine routes; empty ones are
  // omitted so we never list thin pages).
  const eats = catalog.filter((l) => l.type === "eat");
  const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
  const eatRegionSlugs = uniq(eats.map((l) => slugify(normalizeRegionName(l.region || ""))));
  const eatCuisineSlugs = uniq(eats.map((l) => slugify((l.cuisine || "").trim())));
  const eatUrls = [
    ...eatRegionSlugs.map((s) => `<url><loc>${origin}/eat/${s}</loc></url>`),
    ...eatCuisineSlugs.map((s) => `<url><loc>${origin}/eat/cuisine/${s}</loc></url>`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...listingUrls, ...postUrls, ...eatUrls].join("\n")}
</urlset>`;

  res.type("application/xml").send(xml);
}
