/**
 * Server-side fetch of a caller-supplied URL with a basic SSRF guard — same
 * protections the link-import assist uses (server/urlPrefill.ts): only
 * http/https, reject loopback/private/link-local addresses, a timeout, and a
 * byte cap. Used by the iCal availability sync (server/ical.ts).
 */
import { lookup } from "dns/promises";

export class SafeFetchError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function isPrivateAddress(address: string, family: number): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const lower = address.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("Only http:// and https:// links are supported.");
  }
  if (url.hostname === "localhost") throw new SafeFetchError("That URL isn't reachable.");
  try {
    const { address, family } = await lookup(url.hostname);
    if (isPrivateAddress(address, family)) throw new SafeFetchError("That URL isn't reachable.");
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    throw new SafeFetchError("Couldn't resolve that URL.");
  }
  return url;
}

export async function safeFetchText(rawUrl: string, opts: { timeoutMs?: number; maxBytes?: number; accept?: string } = {}): Promise<string> {
  const url = await assertSafeUrl(rawUrl);
  const { timeoutMs = 8000, maxBytes = 2 * 1024 * 1024, accept = "text/calendar, text/plain, */*" } = opts;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "RevampTravelCalendarSync/1.0 (+availability import)", Accept: accept },
    });
    if (!res.ok || !res.body) {
      throw new SafeFetchError(`That link returned an error (${res.status}).`, 502);
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    throw new SafeFetchError("Couldn't fetch that link.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
