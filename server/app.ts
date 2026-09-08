/**
 * The Express `app` itself — routes mounted, JSON body parsing configured —
 * separated from the "start listening" / static-file-serving concerns in
 * `server/index.ts`.
 *
 * Two consumers import this:
 *   1. `server/index.ts` — the long-running Node process (`pnpm dev:server`
 *      and `pnpm start`) that also serves the built SPA and calls `listen()`.
 *   2. `netlify/functions/api.ts` — wraps this same app with `serverless-http`
 *      so Netlify can run the API as a serverless function. Netlify serves the
 *      static SPA itself (from `dist/public`), so the function needs only the
 *      API surface, not the static-serving code.
 */
import express from "express";
import { registerApiRoutes } from "./routes.js";

export const app = express();

// Behind Netlify's proxy (and any reverse proxy in `pnpm start`), trust the
// X-Forwarded-* headers so req.protocol/req.get("host") reflect the real
// public https origin — robots.txt's Sitemap line, the sitemap <loc>s, and
// the prerenderer's canonical/OG/JSON-LD URLs all derive from that.
app.set("trust proxy", true);

app.use(express.json({ limit: "1mb" }));

// API routes only. Static/catch-all SPA serving lives in server/index.ts and
// is intentionally NOT here — on Netlify the CDN serves the SPA directly.
registerApiRoutes(app);

export default app;
