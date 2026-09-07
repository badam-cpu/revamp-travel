/**
 * Best-effort "starting draft" for the operator dashboard's link-import
 * assist (Dashboard.tsx's "Prefill from a link" control). This is
 * deliberately NOT a scraper: it reads a page's own public OpenGraph/meta
 * tags — the same data a site already exposes for link-preview cards in
 * iMessage/Slack/etc — and returns whatever it finds. Sites that block
 * server-side fetches (Airbnb and most booking platforms actively resist
 * scraping, and a full clone would be against their ToS) just come back
 * with empty fields; the operator fills in the rest by hand on the same
 * form they'd use anyway. Never throws for "nothing found" — only for a
 * genuinely bad/unsafe URL or a network failure, both handled by the
 * caller (server/routes.ts) as clear error responses.
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
  sourceUrl: string;
}

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

  const title = extractMeta(html, "property", "og:title") || extractMeta(html, "name", "twitter:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const description = extractMeta(html, "property", "og:description") || extractMeta(html, "name", "description");
  const imageUrl = extractMeta(html, "property", "og:image") || extractMeta(html, "name", "twitter:image");

  return {
    title: title || undefined,
    description: description || undefined,
    imageUrl: imageUrl || undefined,
    sourceUrl: url.toString(),
  };
}
