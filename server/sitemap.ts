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

const STATIC_ROUTES = ["/", "/explore", "/explore/stay", "/explore/eat", "/explore/tour", "/explore/experience", "/map", "/plan", "/faq", "/blog", "/login", "/signup", ...REGION_GUIDES.map((g) => `/region/${g.slug}`)];

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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...listingUrls, ...postUrls].join("\n")}
</urlset>`;

  res.type("application/xml").send(xml);
}
