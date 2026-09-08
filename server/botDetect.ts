/**
 * Registry of known, non-JS-executing crawlers this app deliberately wants
 * to see real content — traditional search engines, AI training/crawl
 * bots, AI real-time answer/search bots, and social link-preview bots.
 * The user chose (via a plain conversation decision, not a config file)
 * to allow every one of these, training bots included — see CLAUDE.md's
 * "Bot prerendering" rule and `server/robots.ts`.
 *
 * This is the single source of truth for two different consumers:
 *  - `isCrawlerUserAgent()` below, used by the prerender middleware in
 *    `server/index.ts` to decide whether to hand back rendered HTML.
 *  - `server/robots.ts`, which lists every `name` here as its own
 *    `User-agent:` block, so the sniffed set and the published policy can
 *    never drift apart from each other.
 */

export interface KnownBot {
  /** Exact token as it appears (case-insensitively) in a real User-Agent header, and as the robots.txt User-agent name. */
  name: string;
}

export const KNOWN_BOTS: KnownBot[] = [
  // Traditional search engines
  { name: "Googlebot" },
  { name: "Bingbot" },
  { name: "DuckDuckBot" },
  { name: "Baiduspider" },
  { name: "YandexBot" },
  { name: "Applebot" },
  // AI training / bulk crawl bots
  { name: "GPTBot" },
  { name: "CCBot" },
  { name: "Google-Extended" },
  { name: "Bytespider" },
  { name: "Amazonbot" },
  { name: "Applebot-Extended" },
  { name: "meta-externalagent" },
  { name: "Diffbot" },
  // AI real-time answer / search-agent bots
  { name: "ChatGPT-User" },
  { name: "OAI-SearchBot" },
  { name: "ClaudeBot" },
  { name: "Claude-User" },
  { name: "Claude-SearchBot" },
  { name: "PerplexityBot" },
  { name: "Perplexity-User" },
  // Social link-preview bots
  { name: "facebookexternalhit" },
  { name: "Twitterbot" },
  { name: "LinkedInBot" },
  { name: "Slackbot" },
  { name: "TelegramBot" },
  { name: "WhatsApp" },
  { name: "Discordbot" },
  // Archival
  { name: "ia_archiver" },
];

const UA_REGEX = new RegExp(KNOWN_BOTS.map((bot) => escapeRegExp(bot.name)).join("|"), "i");

/** True if the given User-Agent header matches any bot in KNOWN_BOTS. */
export function isCrawlerUserAgent(ua: string | undefined | null): boolean {
  return !!ua && UA_REGEX.test(ua);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
