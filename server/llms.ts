/**
 * Dynamic GET /llms.txt — the emerging convention (llmstxt.org) for giving AI
 * crawlers / answer engines a clean, curated map of the site: what Revamp is,
 * its key sections, and links to every published listing and blog post with a
 * one-line description. Built from the same published-catalog data as the
 * sitemap/prerender, so it never drifts. Plain markdown, origin-relative to
 * whatever domain this deployment runs under (no env var).
 */
import type { Request, Response } from "express";
import { getPublishedCatalog, getPublishedPosts } from "./supabase.js";

export async function llmsTxtHandler(req: Request, res: Response): Promise<void> {
  const origin = `${req.protocol}://${req.get("host")}`;
  const [catalog, posts] = await Promise.all([getPublishedCatalog(), getPublishedPosts().catch(() => [])]);

  const L: string[] = [];
  L.push("# Revamp Vacations");
  L.push("");
  L.push("> Armenia's travel marketplace — curated places to stay, Armenian tables, and local tours & experiences across the country, with an AI trip planner and direct online booking (prices in Armenian dram, AMD).");
  L.push("");
  L.push("Revamp Vacations (legal name: Revamp Hospitality LLC) helps travelers discover and book stays, restaurants, guided tours, and hands-on experiences throughout Armenia — Yerevan, Dilijan, Lake Sevan, Tatev, and beyond. Listings are created by local operators and reviewed before they go live. Contact: hello@revampvacations.com.");
  L.push("");
  L.push("## Key pages");
  L.push(`- [Home](${origin}/): overview of stays, tours, and experiences in Armenia`);
  L.push(`- [Stays](${origin}/explore/stay): apartments, guesthouses, hotels and cabins`);
  L.push(`- [Restaurants](${origin}/explore/eat): Armenian tables and cellars`);
  L.push(`- [Tours](${origin}/explore/tour): guided routes and day trips`);
  L.push(`- [Experiences](${origin}/explore/experience): classes, crafts and tastings`);
  L.push(`- [Map](${origin}/map): browse everything by location`);
  L.push(`- [AI trip planner](${origin}/plan): generates a day-by-day Armenia itinerary from the live catalog`);
  L.push(`- [Blog](${origin}/blog): guides and stories about traveling in Armenia`);
  L.push("");

  const byType = (t: string) => catalog.filter((l) => l.type === t);
  const line = (l: (typeof catalog)[number]) => {
    const price = l.price > 0 ? ` — ${l.priceLabel}/${l.priceUnit}` : "";
    return `- [${l.title}](${origin}/listing/${l.slug}): ${l.shortDescription} (${l.city}, ${l.region}${price})`;
  };

  for (const [type, heading] of [["stay", "Stays"], ["tour", "Tours"], ["experience", "Experiences"], ["eat", "Restaurants"]] as const) {
    const items = byType(type);
    if (!items.length) continue;
    L.push(`## ${heading}`);
    items.forEach((l) => L.push(line(l)));
    L.push("");
  }

  if (posts.length) {
    L.push("## Articles");
    posts.forEach((p) => L.push(`- [${p.title}](${origin}/blog/${p.slug})${p.excerpt ? `: ${p.excerpt}` : ""}`));
    L.push("");
  }

  res.type("text/plain; charset=utf-8").send(L.join("\n"));
}
