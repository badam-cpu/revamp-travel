/**
 * PriceLabs Customer API client + price sync. The operator's API key is a SECRET
 * kept in operator_secrets (service-role only, migration 0048); it never reaches
 * a client. We pull recommended nightly rates and write them into a Revamp
 * listing's seasonal_rates (AMD cents), converting from the PriceLabs listing's
 * currency at the admin-set usd_to_amd_rate when needed.
 *
 * API (developers.pricelabs.co): header `X-API-Key`.
 *   GET  https://api.pricelabs.co/v1/listings         → { listings: [{id,name,pms,currency,...}] }
 *   POST https://api.pricelabs.co/v1/listing_prices   → [{id,pms,currency,data:[{date,price}]}]
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const BASE = "https://api.pricelabs.co/v1";

export interface PriceLabsListing {
  id: string;
  name: string;
  pms: string;
  currency: string | null;
}

/** GET /v1/listings — the account's listings. Throws on a bad key / API error. */
export async function pricelabsListings(apiKey: string): Promise<PriceLabsListing[]> {
  const res = await fetch(`${BASE}/listings?skip_hidden=true`, { headers: { "X-API-Key": apiKey } });
  if (res.status === 401 || res.status === 403) throw new Error("PriceLabs rejected the API key.");
  if (!res.ok) throw new Error(`PriceLabs listings error ${res.status}`);
  const json = (await res.json()) as { listings?: { id?: string; name?: string; pms?: string; currency?: string | null }[] };
  return (json.listings ?? [])
    .filter((l) => l.id && l.pms)
    .map((l) => ({ id: String(l.id), name: l.name ?? "Listing", pms: String(l.pms), currency: l.currency ?? null }));
}

interface PriceRow {
  date: string;
  price: number;
}

/** POST /v1/listing_prices — recommended prices for one PriceLabs listing. */
async function pricelabsPrices(apiKey: string, id: string, pms: string, dateFrom: string, dateTo: string): Promise<{ currency: string | null; rows: PriceRow[] }> {
  const res = await fetch(`${BASE}/listing_prices`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ listings: [{ id, pms, dateFrom, dateTo }] }),
  });
  if (!res.ok) throw new Error(`PriceLabs prices ${res.status}: ${(await res.text().catch(() => "")).slice(0, 140)}`);
  const json = (await res.json()) as { id?: string; pms?: string; currency?: string | null; data?: { date?: string; price?: number }[] }[];
  const entry = Array.isArray(json) ? json.find((e) => String(e.id) === id) ?? json[0] : undefined;
  const rows = (entry?.data ?? [])
    .filter((d): d is { date: string; price: number } => typeof d.date === "string" && typeof d.price === "number" && d.price > 0)
    .map((d) => ({ date: d.date, price: d.price }));
  return { currency: entry?.currency ?? null, rows };
}

/** Convert a PriceLabs price (in `currency`) to AMD cents. Returns null when we
 *  can't convert (unknown currency + no USD rate). */
function toAmdCents(price: number, currency: string | null, usdToAmd: number): number | null {
  const c = (currency || "AMD").toUpperCase();
  if (c === "AMD") return Math.round(price * 100);
  if (c === "USD" && usdToAmd > 0) return Math.round(price * usdToAmd * 100);
  return null; // can't safely convert
}

async function usdRate(admin: SupabaseClient): Promise<number> {
  try {
    const { data } = await admin.from("site_settings").select("usd_to_amd_rate").eq("id", 1).maybeSingle();
    return Number(data?.usd_to_amd_rate) || 0;
  } catch {
    return 0;
  }
}

export interface ListingSyncSummary {
  id: string;
  days: number; // dates with a price written
  minCents: number;
  maxCents: number;
  avgCents: number;
  firstDate: string;
  lastDate: string;
}

export interface SyncResult {
  synced: number; // listings updated
  dates: number; // total date-rates written
  skipped: string[]; // reasons
  perListing: ListingSyncSummary[]; // for validation (coverage + price range)
}

/**
 * Sync all of an operator's mapped listings (or one). Reads their key from
 * operator_secrets, pulls prices, and writes seasonal_rates (AMD cents) on each
 * mapped Revamp listing. Best-effort per listing. Service-role client required.
 */
export async function syncOperatorPrices(admin: SupabaseClient, operatorId: string, onlyListingId?: string): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, dates: 0, skipped: [], perListing: [] };

  const { data: secret } = await admin.from("operator_secrets").select("pricelabs_api_key").eq("operator_id", operatorId).maybeSingle();
  const apiKey = secret?.pricelabs_api_key as string | undefined;
  if (!apiKey) {
    result.skipped.push("not_connected");
    return result;
  }

  let mapQuery = admin.from("pricelabs_listing_map").select("revamp_listing_id, pricelabs_listing_id, pricelabs_pms").eq("operator_id", operatorId);
  if (onlyListingId) mapQuery = mapQuery.eq("revamp_listing_id", onlyListingId);
  const { data: maps } = await mapQuery;
  if (!maps || !maps.length) {
    result.skipped.push("no_mappings");
    return result;
  }

  const rate = await usdRate(admin);
  const today = new Date();
  const dateFrom = today.toISOString().slice(0, 10);
  const dateTo = new Date(today.getTime() + 365 * 86_400_000).toISOString().slice(0, 10);

  for (const m of maps as { revamp_listing_id: string; pricelabs_listing_id: string; pricelabs_pms: string }[]) {
    try {
      const { currency, rows } = await pricelabsPrices(apiKey, m.pricelabs_listing_id, m.pricelabs_pms, dateFrom, dateTo);
      const seasonal: { start: string; end: string; priceCents: number }[] = [];
      let unconvertible = false;
      for (const r of rows) {
        const cents = toAmdCents(r.price, currency, rate);
        if (cents == null) {
          unconvertible = true;
          break;
        }
        seasonal.push({ start: r.date, end: r.date, priceCents: cents });
      }
      if (unconvertible) {
        result.skipped.push(`${m.revamp_listing_id}:currency`);
        continue;
      }
      if (!seasonal.length) {
        result.skipped.push(`${m.revamp_listing_id}:no_prices`);
        continue;
      }
      await admin.from("listings").update({ seasonal_rates: seasonal }).eq("id", m.revamp_listing_id);
      await admin.from("pricelabs_listing_map").update({ currency, last_synced_at: new Date().toISOString() }).eq("revamp_listing_id", m.revamp_listing_id);
      result.synced++;
      result.dates += seasonal.length;
      const cents = seasonal.map((s) => s.priceCents);
      result.perListing.push({
        id: m.revamp_listing_id,
        days: cents.length,
        minCents: Math.min(...cents),
        maxCents: Math.max(...cents),
        avgCents: Math.round(cents.reduce((a, b) => a + b, 0) / cents.length),
        firstDate: seasonal[0].start,
        lastDate: seasonal[seasonal.length - 1].start,
      });
    } catch (err) {
      console.error("[pricelabs] sync listing failed", m.revamp_listing_id, err);
      result.skipped.push(err instanceof Error ? err.message : "error");
    }
  }
  return result;
}

/** Cron sweep: sync every operator that has a PriceLabs key + mappings. */
export async function syncAllPricelabs(admin: SupabaseClient): Promise<{ operators: number; synced: number }> {
  const { data } = await admin.from("operator_secrets").select("operator_id").not("pricelabs_api_key", "is", null).limit(500);
  let synced = 0;
  for (const row of (data ?? []) as { operator_id: string }[]) {
    try {
      const r = await syncOperatorPrices(admin, row.operator_id);
      synced += r.synced;
    } catch (err) {
      console.error("[pricelabs] cron sync failed", row.operator_id, err);
    }
  }
  return { operators: (data ?? []).length, synced };
}
