/**
 * AI assistants — the ONE list behind "AI assistants" analytics (migration 0114).
 *
 * Three ways an AI assistant shows Revamp to someone, each counted separately:
 *  - `answer`   — the assistant opened one of our pages live because a person
 *                 asked it something (ChatGPT-User, Claude-User, Perplexity-User).
 *                 The closest measure of "Revamp came up in an answer".
 *  - `referral` — a person clicked through from an assistant to our site.
 *  - `mcp`      — an AI tool used our public catalog (/mcp).
 * Plus two background kinds: `search` (indexing for AI search) and `training`.
 *
 * Bots are recognised by User-Agent, which anyone can fake, so where the company
 * publishes its crawler addresses (`ipList`) the server checks the request came
 * from one of them (server/aiVisibility.ts): `verified`, `failed` (a fake —
 * never counted as real) or `unverifiable` (no published list / list unreachable).
 *
 * Google's Gemini and AI Overviews read pages as ordinary Googlebot, so they
 * can't be told apart from Google Search — they appear only as referrals.
 *
 * Keep the User-Agent tokens in sync with server/botDetect.ts and the BOT_TOKENS
 * array in netlify/edge-functions/prerender.ts (those decide which requests
 * reach the prerenderer, where AI fetches are counted).
 */

export const AI_ASSISTANTS = ["chatgpt", "claude", "perplexity", "gemini", "copilot", "deepseek", "grok", "meta", "mistral", "other"] as const;
export type AiAssistant = (typeof AI_ASSISTANTS)[number];

export const AI_ASSISTANT_LABEL: Record<AiAssistant, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  deepseek: "DeepSeek",
  grok: "Grok",
  meta: "Meta AI",
  mistral: "Mistral",
  other: "Other AI",
};

export type AiVisitKind = "answer" | "search" | "training" | "referral" | "mcp";
export type AiVerification = "verified" | "unverifiable" | "failed" | "n/a";

export interface AiAgent {
  /** Case-insensitive User-Agent substring. */
  token: string;
  assistant: AiAssistant;
  kind: "answer" | "search" | "training";
  /** The company's published list of the addresses this bot uses. */
  ipList?: string;
}

const OPENAI = "https://openai.com";
const PERPLEXITY = "https://www.perplexity.com";
const ANTHROPIC_LIST = "https://claude.com/crawling/bots.json"; // one list for all three Claude bots

export const AI_AGENTS: AiAgent[] = [
  { token: "ChatGPT-User", assistant: "chatgpt", kind: "answer", ipList: `${OPENAI}/chatgpt-user.json` },
  { token: "OAI-SearchBot", assistant: "chatgpt", kind: "search", ipList: `${OPENAI}/searchbot.json` },
  { token: "GPTBot", assistant: "chatgpt", kind: "training", ipList: `${OPENAI}/gptbot.json` },
  { token: "Claude-User", assistant: "claude", kind: "answer", ipList: ANTHROPIC_LIST },
  { token: "Claude-SearchBot", assistant: "claude", kind: "search", ipList: ANTHROPIC_LIST },
  { token: "ClaudeBot", assistant: "claude", kind: "training", ipList: ANTHROPIC_LIST },
  { token: "Perplexity-User", assistant: "perplexity", kind: "answer", ipList: `${PERPLEXITY}/perplexity-user.json` },
  { token: "PerplexityBot", assistant: "perplexity", kind: "search", ipList: `${PERPLEXITY}/perplexitybot.json` },
  { token: "meta-externalagent", assistant: "meta", kind: "training" },
];

/** The AI agent a User-Agent belongs to, or null (people, search engines, other bots). */
export function aiAgentFor(userAgent: string | null | undefined): AiAgent | null {
  const ua = (userAgent || "").toLowerCase();
  if (!ua) return null;
  return AI_AGENTS.find((a) => ua.includes(a.token.toLowerCase())) ?? null;
}

/** Sites a visitor can arrive from after asking an assistant (host, or a parent domain). */
const AI_REFERRER_HOSTS: [string, AiAssistant][] = [
  ["chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["openai.com", "chatgpt"],
  ["claude.ai", "claude"],
  ["perplexity.ai", "perplexity"],
  ["perplexity.com", "perplexity"],
  ["gemini.google.com", "gemini"],
  ["bard.google.com", "gemini"],
  ["copilot.microsoft.com", "copilot"],
  ["copilot.cloud.microsoft", "copilot"],
  ["chat.deepseek.com", "deepseek"],
  ["grok.com", "grok"],
  ["meta.ai", "meta"],
  ["chat.mistral.ai", "mistral"],
  // Android apps send "android-app://<package>/" as the referrer.
  ["com.openai.chatgpt", "chatgpt"],
  ["com.anthropic.claude", "claude"],
  ["ai.perplexity.app.android", "perplexity"],
  ["com.google.android.apps.bard", "gemini"],
  ["com.microsoft.copilot", "copilot"],
];

/** Assistant behind a referrer URL or a utm_source value (ChatGPT tags links utm_source=chatgpt.com). */
export function aiAssistantFromSource(source: string | null | undefined): AiAssistant | null {
  const raw = (source || "").trim().toLowerCase();
  if (!raw) return null;
  let host = raw;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    /* plain word like "chatgpt" */
  }
  host = host.replace(/^www\./, "");
  for (const [h, a] of AI_REFERRER_HOSTS) if (host === h || host.endsWith(`.${h}`)) return a;
  // utm_source words some assistants use
  const word = raw.replace(/\.(com|ai)$/, "");
  return (AI_ASSISTANTS as readonly string[]).includes(word) && word !== "other" ? (word as AiAssistant) : null;
}

export function isAiAssistant(v: unknown): v is AiAssistant {
  return typeof v === "string" && (AI_ASSISTANTS as readonly string[]).includes(v);
}

/**
 * A page path as stored: no query/hash, lower-case, no trailing slash, ≤ 120
 * characters of plain URL characters — anything else becomes "(other)", so a
 * bot hammering random URLs can't fill the table with junk rows.
 */
export function aiVisitPath(raw: string | null | undefined): string {
  let p = (raw || "/").split(/[?#]/)[0];
  try {
    p = decodeURI(p);
  } catch {
    return "(other)";
  }
  p = p.toLowerCase();
  if (p.length > 1) p = p.replace(/\/+$/, "");
  if (!p.startsWith("/") || p.length > 120 || !/^\/[a-z0-9/_\-.]*$/.test(p)) return "(other)";
  return p || "/";
}
