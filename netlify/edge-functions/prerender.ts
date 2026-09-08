/**
 * Netlify Edge Function (Deno) — the production half of this app's SEO story.
 *
 * The app is a client-rendered SPA served straight off Netlify's CDN, and most
 * AI/search crawlers don't execute JavaScript, so they'd otherwise see an empty
 * `<div id="root">` shell. This function runs at the edge on every page route,
 * sniffs the User-Agent, and for a KNOWN crawler fetches real prerendered HTML
 * from the API function (`/api/prerender`, backed by server/prerender.ts) and
 * returns it in place of the shell. Real visitors (and anything that isn't a
 * recognized bot) get `return` — the request falls through to the static SPA
 * completely unchanged, so humans are never affected.
 *
 * Why an edge function and not the Express middleware in server/index.ts: on
 * Netlify that process only ever runs as the `/api/*` serverless function; it
 * never sees `/`, `/explore`, `/listing/:slug`, so the UA sniffing has to live
 * at the edge. The heavy rendering still lives once in server/prerender.ts —
 * this file only routes to it. (`pnpm start` / self-hosting uses the Express
 * middleware instead; same renderer, same output.)
 *
 * The bot list is intentionally duplicated from server/botDetect.ts's
 * KNOWN_BOTS: this file runs in Deno at the edge and can't import the Node
 * server module. Keep the two lists in sync — server/botDetect.ts's header
 * comment is the source-of-truth note for both.
 */

const BOT_TOKENS = [
  // Traditional search engines
  "Googlebot", "Bingbot", "DuckDuckBot", "Baiduspider", "YandexBot", "Applebot",
  // AI training / bulk crawl bots
  "GPTBot", "CCBot", "Google-Extended", "Bytespider", "Amazonbot", "Applebot-Extended", "meta-externalagent", "Diffbot",
  // AI real-time answer / search-agent bots
  "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User",
  // Social link-preview bots
  "facebookexternalhit", "Twitterbot", "LinkedInBot", "Slackbot", "TelegramBot", "WhatsApp", "Discordbot",
  // Archival
  "ia_archiver",
];

const UA_REGEX = new RegExp(BOT_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

export default async (request: Request): Promise<Response | undefined> => {
  const url = new URL(request.url);
  const path = url.pathname;

  // These are handled elsewhere (their own function routes / SPA) — never prerender them.
  if (path.startsWith("/api/")) return;
  if (path === "/robots.txt" || path === "/sitemap.xml") return;
  if (path === "/dashboard" || path.startsWith("/dashboard/") || path === "/admin" || path.startsWith("/admin/")) return;
  const lastSegment = path.split("/").pop() || "";
  if (lastSegment.includes(".")) return; // hashed JS/CSS, images, favicon.ico, etc.

  const ua = request.headers.get("user-agent") || "";
  if (!UA_REGEX.test(ua)) return; // real users → untouched SPA shell

  // Known crawler → ask the API function for real HTML for this route.
  const target = new URL("/api/prerender", url.origin);
  target.searchParams.set("path", path);
  target.searchParams.set("origin", url.origin);

  try {
    const res = await fetch(target.toString(), { headers: { "user-agent": ua } });
    // 404 is a legitimate prerender result (unknown/unpublished listing) and
    // should be served as-is; any other non-OK status means the renderer
    // failed, so fall back to the SPA shell rather than surfacing an error.
    if (!res.ok && res.status !== 404) return;
    const html = await res.text();
    return new Response(html, {
      status: res.status,
      headers: { "content-type": "text/html; charset=utf-8", "x-revamp-prerender": "1" },
    });
  } catch {
    return; // network/subrequest failure → SPA shell
  }
};
