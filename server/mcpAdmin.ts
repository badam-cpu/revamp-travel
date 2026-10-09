/**
 * Internal (team-facing) Revamp MCP server — Phase 2. Same Streamable-HTTP /
 * in-memory dispatch as the public server (server/mcp.ts), but gated by a static
 * API key (MCP_ADMIN_KEY) and exposing PRIVATE business data via the
 * service-role client: a business snapshot, recent bookings, top listings,
 * operator lookup, and full system health.
 *
 * Auth: the MCP client sends `Authorization: Bearer <MCP_ADMIN_KEY>` as a
 * request header (configured once in the connector). No key set → 503; wrong
 * key → 401. Served at POST /mcp/admin (see server/routes.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { collectHealth } from "./health.js";
import { dispatchMcp } from "./mcp.js";

const amd = (cents: number) => `֏${Math.round((cents || 0) / 100).toLocaleString("en-US")}`;
const sum = (rows: { [k: string]: unknown }[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const TEXT = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

type Prof = { display_name: string | null; business_name: string | null };
const opName = (p: Prof | null) => (p?.business_name || p?.display_name || "Operator").trim();

export function createAdminServer(admin: SupabaseClient): McpServer {
  const server = new McpServer({ name: "revamp-vacations-admin", version: "1.0.0" });

  server.registerTool(
    "business_snapshot",
    {
      title: "Business snapshot",
      description: "Headline numbers: confirmed bookings + gross revenue, unconfirmed (stuck) payments, and money owed to operators (payouts, QR earnings, referral credit).",
      inputSchema: {},
    },
    async () => {
      const [{ data: confirmed }, pendingPay, awaitingPay, { data: payouts }, { data: qr }, { data: refs }] = await Promise.all([
        admin.from("bookings").select("amount_cents").eq("status", "confirmed"),
        admin.from("bookings").select("id", { count: "exact", head: true }).eq("status", "pending_payment"),
        admin.from("bookings").select("id", { count: "exact", head: true }).eq("status", "awaiting_payment"),
        admin.from("payouts").select("net_cents").eq("status", "pending"),
        admin.from("qr_payments").select("net_cents").eq("status", "paid").is("settled_at", null),
        admin.from("referrals").select("reward_cents").eq("status", "qualified"),
      ]);
      const revenueCents = sum(confirmed ?? [], "amount_cents");
      return TEXT({
        confirmedBookings: (confirmed ?? []).length,
        grossRevenue: amd(revenueCents),
        unconfirmedPayments: { pendingPayment: pendingPay.count ?? 0, awaitingPayment: awaitingPay.count ?? 0 },
        owedToOperators: {
          bookingPayouts: amd(sum(payouts ?? [], "net_cents")),
          qrEarnings: amd(sum(qr ?? [], "net_cents")),
          referralCredit: amd(sum(refs ?? [], "reward_cents")),
        },
        note: "Amounts are AMD. Revenue is the gross charged on confirmed bookings.",
      });
    },
  );

  server.registerTool(
    "recent_bookings",
    {
      title: "Recent bookings",
      description: "The most recent bookings with status, dates, amount, and listing.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Default 10.") },
    },
    async ({ limit }) => {
      const { data } = await admin
        .from("bookings")
        .select("id,status,start_date,end_date,amount_cents,currency,created_at,guest_name,listings:listing_id(title,type)")
        .order("created_at", { ascending: false })
        .limit(limit ?? 10);
      const rows = (data ?? []).map((b: Record<string, unknown>) => {
        const l = one(b.listings as { title?: string; type?: string } | { title?: string; type?: string }[]);
        return {
          status: b.status,
          listing: l?.title ?? "—",
          type: l?.type,
          dates: `${b.start_date} → ${b.end_date}`,
          amount: amd(Number(b.amount_cents) || 0),
          guest: (b.guest_name as string) || undefined,
          createdAt: b.created_at,
        };
      });
      return TEXT({ count: rows.length, bookings: rows });
    },
  );

  server.registerTool(
    "top_listings",
    {
      title: "Top listings by bookings",
      description: "Listings ranked by number of confirmed bookings.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Default 10.") },
    },
    async ({ limit }) => {
      const { data } = await admin.from("bookings").select("listing_id,listings:listing_id(title,type)").eq("status", "confirmed");
      const tally = new Map<string, { title: string; type: string; count: number }>();
      for (const b of (data ?? []) as Record<string, unknown>[]) {
        const id = b.listing_id as string;
        const l = one(b.listings as { title?: string; type?: string } | { title?: string; type?: string }[]);
        const cur = tally.get(id) ?? { title: l?.title ?? "—", type: l?.type ?? "", count: 0 };
        cur.count += 1;
        tally.set(id, cur);
      }
      const ranked = Array.from(tally.values()).sort((a, b) => b.count - a.count).slice(0, limit ?? 10);
      return TEXT({ count: ranked.length, listings: ranked });
    },
  );

  server.registerTool(
    "operator_lookup",
    {
      title: "Look up an operator",
      description: "Find operators by name or business name; returns their published listing count and booking-payout owed.",
      inputSchema: { query: z.string().min(1).describe("Name or business name (partial match).") },
    },
    async ({ query }) => {
      const q = query.replace(/[%,]/g, "").trim();
      const { data: ops } = await admin
        .from("profiles")
        .select("id,display_name,business_name")
        .eq("role", "operator")
        .or(`display_name.ilike.%${q}%,business_name.ilike.%${q}%`)
        .limit(8);
      const results = await Promise.all(
        ((ops ?? []) as (Prof & { id: string })[]).map(async (op) => {
          const [{ count }, { data: payouts }] = await Promise.all([
            admin.from("listings").select("id", { count: "exact", head: true }).eq("operator_id", op.id),
            admin.from("payouts").select("net_cents").eq("operator_id", op.id).eq("status", "pending"),
          ]);
          return { name: opName(op), listings: count ?? 0, payoutOwed: amd(sum(payouts ?? [], "net_cents")) };
        }),
      );
      return TEXT({ count: results.length, operators: results });
    },
  );

  server.registerTool(
    "system_health",
    {
      title: "System health",
      description: "Operational status: scheduled jobs (crons) last run/success, per-listing calendar (iCal) freshness, stuck payments, and which integrations are configured.",
      inputSchema: {},
    },
    async () => TEXT(await collectHealth(admin)),
  );

  return server;
}

/** Express handler for the internal MCP endpoint (API-key gated). */
export async function handleAdminMcp(req: Request, res: Response): Promise<void> {
  const key = process.env.MCP_ADMIN_KEY;
  if (!key) {
    res.status(503).json({ jsonrpc: "2.0", error: { code: -32000, message: "Admin MCP not configured (MCP_ADMIN_KEY unset)." }, id: null });
    return;
  }
  const auth = req.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (provided !== key) {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized: set the Authorization: Bearer <MCP_ADMIN_KEY> header." }, id: null });
    return;
  }
  const admin = supabaseAdmin();
  if (!admin) {
    res.status(503).json({ jsonrpc: "2.0", error: { code: -32000, message: "Service role not configured." }, id: null });
    return;
  }
  await dispatchMcp(createAdminServer(admin), req, res);
}
