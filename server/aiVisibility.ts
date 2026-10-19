/**
 * AI assistants analytics (migration 0114) — server half. See shared/aiAgents.ts
 * for what is counted and why.
 *
 * Trust model:
 *  - Counts are written ONLY here, via the security-definer `bump_ai_visibility`
 *    (service role); admins read `ai_visibility_daily` under RLS. No IPs, user
 *    agents or anything personal is stored — just day / kind / assistant / path.
 *  - A bot's claim (its User-Agent) is checked against the company's published
 *    address list. On Netlify the bot's address is only known to the edge
 *    function, which forwards it to /api/prerender together with a token derived
 *    from the service-role key (`aiEdgeToken`) — a forwarded address without the
 *    token is ignored, so nobody can call /api/prerender directly and pose as
 *    a verified ChatGPT.
 *  - Address lists are cached per warm function for 6 hours; when a list can't be
 *    fetched the visit is `unverifiable`, never wrongly `failed`.
 *  - Every write is failure-tolerant: before 0114 (or on any DB error) nothing
 *    breaks, the visit is just not counted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiAgentFor, aiVisitPath, type AiAgent, type AiAssistant, type AiVerification, type AiVisitKind } from "../shared/aiAgents.js";
import { ARMENIA_UTC_OFFSET_HOURS } from "../shared/sessions.js";

// ── Address lists ────────────────────────────────────────────────────────────
type Net = { v6: boolean; base: bigint; bits: number };
const LIST_TTL_MS = 6 * 60 * 60_000;
const lists = new Map<string, { at: number; nets: Net[] }>();
const inflight = new Map<string, Promise<Net[] | null>>();

function ipToBig(ip: string): { v6: boolean; n: bigint } | null {
  let s = ip.trim().replace(/^\[|\]$/g, "");
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) s = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
    const parts = s.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v6: false, n: parts.reduce((acc, p) => (acc << BigInt(8)) + BigInt(p), BigInt(0)) };
  }
  if (!s.includes(":")) return null;
  const [head, tail = ""] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = s.includes("::") ? (tail ? tail.split(":") : []) : [];
  const missing = 8 - h.length - t.length;
  if (missing < 0 || (!s.includes("::") && h.length !== 8)) return null;
  const groups = [...h, ...Array(s.includes("::") ? missing : 0).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { v6: true, n: groups.reduce((acc, g) => (acc << BigInt(16)) + BigInt(parseInt(g, 16)), BigInt(0)) };
}

function parseNet(cidr: string): Net | null {
  const [addr, len] = cidr.split("/");
  const ip = ipToBig(addr);
  if (!ip) return null;
  const max = ip.v6 ? 128 : 32;
  const bits = len === undefined ? max : Number(len);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  return { v6: ip.v6, base: ip.n >> BigInt(max - bits), bits };
}

/** Is `ip` inside one of these networks? (exported for tests) */
export function ipInNets(ip: string, nets: Net[]): boolean {
  const a = ipToBig(ip);
  if (!a) return false;
  return nets.some((n) => n.v6 === a.v6 && a.n >> BigInt((a.v6 ? 128 : 32) - n.bits) === n.base);
}

/** Published list → networks. Shape (OpenAI, Anthropic, Perplexity): { prefixes: [{ ipv4Prefix | ipv6Prefix }] }. */
export function parseAddressList(json: unknown): Net[] {
  const prefixes = (json as { prefixes?: unknown })?.prefixes;
  if (!Array.isArray(prefixes)) return [];
  const out: Net[] = [];
  for (const p of prefixes) {
    const cidr = (p as { ipv4Prefix?: unknown; ipv6Prefix?: unknown })?.ipv4Prefix ?? (p as { ipv6Prefix?: unknown })?.ipv6Prefix;
    if (typeof cidr === "string") {
      const n = parseNet(cidr);
      if (n) out.push(n);
    }
  }
  return out;
}

async function addressList(url: string): Promise<Net[] | null> {
  const cached = lists.get(url);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.nets;
  let p = inflight.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { accept: "application/json", "user-agent": "RevampVacations/1.0 (+https://revampvacations.com)" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const nets = parseAddressList(await res.json());
        if (!nets.length) throw new Error("empty list");
        lists.set(url, { at: Date.now(), nets });
        return nets;
      } catch (e) {
        console.warn("[ai-visibility] address list unavailable", url, e instanceof Error ? e.message : e);
        return cached?.nets ?? null; // keep the last good copy if we had one
      } finally {
        inflight.delete(url);
      }
    })();
    inflight.set(url, p);
  }
  return p;
}

/** Did this request really come from the company behind `agent`? */
export async function verifyAgent(agent: AiAgent, ip: string | null | undefined): Promise<AiVerification> {
  if (!agent.ipList || !ip) return "unverifiable";
  const nets = await addressList(agent.ipList);
  if (!nets) return "unverifiable";
  return ipInNets(ip, nets) ? "verified" : "failed";
}

// ── Edge → API trust ─────────────────────────────────────────────────────────
let edgeToken: Promise<string | null> | null = null;
/** Shared secret the edge function sends with a forwarded bot address (derived — no extra env var). */
export function aiEdgeToken(): Promise<string | null> {
  edgeToken ??= (async () => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return null;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ai-visibility:${key}`));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  })();
  return edgeToken;
}

// ── Counting ─────────────────────────────────────────────────────────────────
/** Today in Armenia (the day boundaries the admin sees). */
export function armeniaDay(now = Date.now()): string {
  return new Date(now + ARMENIA_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

let warnedMissing = false;
export async function bumpAiVisibility(
  admin: SupabaseClient | null,
  v: { kind: AiVisitKind; assistant: AiAssistant; path: string; verification: AiVerification },
): Promise<void> {
  if (!admin) return;
  try {
    const { error } = await admin.rpc("bump_ai_visibility", { p_day: armeniaDay(), p_kind: v.kind, p_assistant: v.assistant, p_path: v.path, p_verification: v.verification });
    if (error && !warnedMissing) {
      warnedMissing = true;
      console.warn("[ai-visibility] not counted (run migration 0114?)", error.message);
    }
  } catch (e) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[ai-visibility] not counted", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * A page served to a bot by the prerenderer. Counts only AI agents; a 404 is
 * stored as "(not found)" so random URLs never become rows. Never throws, and
 * gives up after `budgetMs` so a slow address list can't delay the page much.
 */
export async function recordAiPageFetch(
  admin: SupabaseClient | null,
  opts: { userAgent: string | null | undefined; ip: string | null | undefined; path: string; status: number; budgetMs?: number },
): Promise<void> {
  const agent = aiAgentFor(opts.userAgent);
  if (!agent || !admin) return;
  const work = (async () => {
    const verification = await verifyAgent(agent, opts.ip);
    const path = opts.status === 404 ? "(not found)" : aiVisitPath(opts.path);
    await bumpAiVisibility(admin, { kind: agent.kind, assistant: agent.assistant, path, verification });
  })().catch(() => {});
  await Promise.race([work, new Promise((r) => setTimeout(r, opts.budgetMs ?? 2_500))]);
}

/**
 * An AI tool used the public MCP catalog: count tool calls (path = tool name)
 * and new connections ("(connect)"). The caller is named by its User-Agent when
 * it's a known AI agent (and checked like a page fetch), otherwise "other".
 */
export async function recordMcpUse(admin: SupabaseClient | null, body: unknown, userAgent: string | null | undefined, ip: string | null | undefined): Promise<void> {
  if (!admin || !body || typeof body !== "object") return;
  const messages = (Array.isArray(body) ? body : [body]) as { method?: unknown; params?: { name?: unknown } }[];
  const uses: string[] = [];
  for (const m of messages.slice(0, 20)) {
    if (m?.method === "initialize") uses.push("(connect)");
    else if (m?.method === "tools/call" && typeof m.params?.name === "string" && /^[a-z0-9_]{1,60}$/i.test(m.params.name)) uses.push(m.params.name.toLowerCase());
  }
  if (!uses.length) return;
  const agent = aiAgentFor(userAgent);
  const ua = (userAgent || "").toLowerCase();
  const assistant: AiAssistant = agent?.assistant ?? (ua.includes("claude") || ua.includes("anthropic") ? "claude" : ua.includes("openai") || ua.includes("chatgpt") ? "chatgpt" : "other");
  const verification: AiVerification = agent ? await verifyAgent(agent, ip) : "unverifiable";
  await Promise.all(uses.map((path) => bumpAiVisibility(admin, { kind: "mcp", assistant, path, verification })));
}
