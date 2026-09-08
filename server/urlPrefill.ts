/**
 * Best-effort "starting draft" for the operator dashboard's link-import
 * assist (Dashboard.tsx's "Prefill from a link" control). This is
 * deliberately NOT a scraper: it reads a page's own public OpenGraph/meta
 * tags — the same data a site already exposes for link-preview cards in
 * iMessage/Slack/etc — plus, when a page embeds schema.org structured data
 * (`<script type="application/ld+json">`, published for its own search-engine
 * crawlers), its `amenityFeature` (→ amenities), `offers.price` (→ price),
 * and `address.addressLocality`/`addressRegion` (→ city/region). That's data
 * the page already publishes for machines, read from the one plain fetch
 * already being made — never a second request, never anything that renders JS
 * or defeats bot detection. Sites that block server-side fetches, or simply
 * don't embed structured data (Airbnb and most booking platforms actively
 * resist scraping, and a full clone would be against their ToS), just come
 * back with empty/partial fields; the operator reviews and fills in the rest
 * by hand on the same form they'd use anyway — every prefilled field here is a
 * starting draft, never written anywhere until they hit save. Never throws for
 * "nothing found" — only for a genuinely bad/unsafe URL or a network failure,
 * both handled by the caller (server/routes.ts) as clear error responses.
 *
 * Imported title/description are also run through stripRatings() so a listing
 * never inherits someone else's star score (CLAUDE.md content rule).
 */
import { lookup } from "dns/promises";

export class PrefillError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface PrefillResult {
  title?: string;
  description?: string;
  imageUrl?: string;
  /** From the source page's own JSON-LD `amenityFeature`, when present — a starting checklist, not exhaustive. */
  amenities?: string[];
  city?: string;
  region?: string;
  price?: number;
  sourceUrl: string;
}

const MAX_AMENITIES = 30;
const MAX_AMENITY_LENGTH = 60;

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — a listing page's <head> is tiny; this is a generous ceiling, not a target.

/** Rejects loopback/private/link-local ranges so this endpoint can't be used to probe internal services (basic SSRF guard). */
function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // malformed — treat as unsafe
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true;
    return false;
  }
  // IPv6: block loopback, link-local, and unique-local ranges.
  const lower = address.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PrefillError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PrefillError("Only http:// and https:// links are supported.");
  }
  if (url.hostname === "localhost") {
    throw new PrefillError("That URL isn't reachable.");
  }
  try {
    const { address, family } = await lookup(url.hostname);
    if (isPrivateAddress(address, family)) {
      throw new PrefillError("That URL isn't reachable.");
    }
  } catch (err) {
    if (err instanceof PrefillError) throw err;
    throw new PrefillError("Couldn't resolve that URL.");
  }
  return url;
}

function extractMeta(html: string, attr: "property" | "name", key: string): string | undefined {
  // Matches both attribute orderings: <meta property="og:title" content="...">
  // and <meta content="..." property="og:title">.
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return undefined;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Strip star ratings / review counts out of imported text. Revamp's content
 * rules forbid scraped or fabricated ratings (see CLAUDE.md), and many sites'
 * OG titles bake them in (Airbnb: "Condo in Yerevan · ★4.9 · 1 bedroom …").
 * We drop any "·"-delimited segment that's a rating, plus any stray star/rating
 * tokens, so a listing never inherits someone else's star score.
 */
function stripRatings(text: string): string {
  const isRatingSegment = (s: string) => /[★☆]/.test(s) || /\b\d+(\.\d+)?\s*(stars?|reviews?|ratings?)\b/i.test(s) || /^\(\s*\d+\s*(reviews?|ratings?)\s*\)$/i.test(s.trim());
  const parts = text
    .split(/\s*[·|•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Drop rating-only segments only when the title is genuinely segmented —
  // otherwise a single-segment title that merely ends in a rating (e.g.
  // "Cozy loft ★ 4.85") would be deleted entirely instead of trimmed.
  const kept = parts.length > 1 ? parts.filter((s) => !isRatingSegment(s)) : parts;
  return kept
    .join(" · ")
    .replace(/[★☆]\s*\d+(\.\d+)?/g, "") // "★4.9"
    .replace(/\d+(\.\d+)?\s*[★☆]/g, "") // "4.9★"
    .replace(/[★☆]/g, "")
    .replace(/\(\s*\d+[\d,]*\s*(reviews?|ratings?)\s*\)/gi, "")
    .replace(/\b\d+(\.\d+)?\s*(stars?|reviews?|ratings?)\b/gi, "") // "4.9 stars", "231 reviews"
    .replace(/\s{2,}/g, " ")
    .replace(/\s*·\s*$/, "")
    .replace(/^\s*·\s*/, "")
    .trim();
}

interface JsonLdBits {
  name?: string;
  description?: string;
  image?: string;
  amenities?: string[];
  city?: string;
  region?: string;
  price?: number;
  lat?: number;
  lng?: number;
}

/** Best-effort read of a page's own schema.org JSON-LD (the structured data it publishes for search engines). Missing/oddly-shaped data just yields nothing. */
function extractJsonLd(html: string): JsonLdBits {
  const out: JsonLdBits = {};
  const blocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const nodes: Record<string, unknown>[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object") {
          nodes.push(item as Record<string, unknown>);
          const graph = (item as Record<string, unknown>)["@graph"];
          if (Array.isArray(graph)) nodes.push(...(graph.filter((g) => g && typeof g === "object") as Record<string, unknown>[]));
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(/[^0-9.]/g, "")) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  for (const node of nodes) {
    out.name = out.name || str(node.name);
    out.description = out.description || str(node.description);
    if (!out.image) {
      const img = node.image as unknown;
      out.image = str(img) || (Array.isArray(img) ? str(img[0]) || str((img[0] as Record<string, unknown>)?.url) : str((img as Record<string, unknown>)?.url));
    }
    const address = node.address as Record<string, unknown> | undefined;
    if (address && typeof address === "object") {
      out.city = out.city || str(address.addressLocality);
      out.region = out.region || str(address.addressRegion);
    }
    const geo = node.geo as Record<string, unknown> | undefined;
    if (geo && typeof geo === "object") {
      out.lat = out.lat ?? num(geo.latitude);
      out.lng = out.lng ?? num(geo.longitude);
    }
    const offers = (Array.isArray(node.offers) ? node.offers[0] : node.offers) as Record<string, unknown> | undefined;
    if (offers && typeof offers === "object") {
      out.price = out.price ?? num(offers.price) ?? num(offers.lowPrice) ?? num((offers.priceSpecification as Record<string, unknown>)?.price);
    }
    // schema.org amenityFeature is usually LocationFeatureSpecification[]
    // ({name, value}) but some sites use plain strings — both accepted. An
    // explicit `value: false` (site says it does NOT have this) is excluded.
    if (!out.amenities) {
      const raw = node.amenityFeature;
      if (Array.isArray(raw) && raw.length > 0) {
        const names: string[] = [];
        for (const entry of raw) {
          let name: string | undefined;
          if (typeof entry === "string") {
            name = entry;
          } else if (entry && typeof entry === "object") {
            const e = entry as Record<string, unknown>;
            if (e.value === false) continue;
            if (typeof e.name === "string") name = e.name;
          }
          if (!name) continue;
          const cleaned = decodeHtmlEntities(name.trim()).slice(0, MAX_AMENITY_LENGTH);
          if (cleaned && !names.includes(cleaned)) names.push(cleaned);
          if (names.length >= MAX_AMENITIES) break;
        }
        if (names.length > 0) out.amenities = names;
      }
    }
  }
  return out;
}

export async function fetchPrefill(rawUrl: string): Promise<PrefillResult> {
  const url = await assertSafeUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html: string;
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A plain, honest UA — this is a link-preview-style fetch, not an
        // attempt to impersonate a browser to get past bot detection.
        "User-Agent": "RevampTravelListingImport/1.0 (+link preview fetch)",
        Accept: "text/html",
      },
    });
    if (!res.ok || !res.body) {
      throw new PrefillError(`That link returned an error (${res.status}) — you can still fill the form in by hand.`, 502);
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        controller.abort();
        break;
      }
      chunks.push(value);
    }
    html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
  } catch (err) {
    if (err instanceof PrefillError) throw err;
    throw new PrefillError("Couldn't fetch that link — you can still fill the form in by hand.", 502);
  } finally {
    clearTimeout(timeout);
  }

  const jsonLd = extractJsonLd(html);

  const rawTitle =
    extractMeta(html, "property", "og:title") ||
    extractMeta(html, "name", "twitter:title") ||
    jsonLd.name ||
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const rawDescription = extractMeta(html, "property", "og:description") || extractMeta(html, "name", "description") || jsonLd.description;
  const imageUrl = extractMeta(html, "property", "og:image") || extractMeta(html, "name", "twitter:image") || jsonLd.image;

  // Strip star ratings / review counts from imported title + description so a
  // listing never inherits someone else's rating (CLAUDE.md content rule).
  const title = rawTitle ? stripRatings(rawTitle) : undefined;
  const description = rawDescription ? stripRatings(rawDescription) : undefined;

  const metaPrice = extractMeta(html, "property", "og:price:amount") || extractMeta(html, "property", "product:price:amount");
  const price = jsonLd.price ?? (metaPrice ? parseFloat(metaPrice.replace(/[^0-9.]/g, "")) : undefined);

  return {
    title: title || undefined,
    description: description || undefined,
    imageUrl: imageUrl || undefined,
    amenities: jsonLd.amenities && jsonLd.amenities.length > 0 ? jsonLd.amenities : undefined,
    city: jsonLd.city || undefined,
    region: jsonLd.region || undefined,
    price: Number.isFinite(price) && (price as number) >= 0 ? price : undefined,
    sourceUrl: url.toString(),
  };
}
