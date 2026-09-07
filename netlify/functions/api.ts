/**
 * Netlify Function that runs the whole Express API.
 *
 * `serverless-http` adapts the shared Express `app` (from server/app.ts) to the
 * Lambda-style (event, context) handler Netlify Functions expect. The static
 * SPA is served by Netlify's CDN from `dist/public`, so this function carries
 * only the API — no static-file serving.
 *
 * Since Milestone A the Express API serves exactly one route, `POST
 * /api/plan-trip` (the AI planner); accounts and listings go straight from the
 * browser to Supabase under RLS, not through this function.
 *
 * Routing: `netlify.toml` rewrites `/api/*` to `/.netlify/functions/api/:splat`
 * (status 200). The Express routes are declared under `/api/*`, so the path
 * Express sees must start with `/api`. Depending on the Netlify runtime, the
 * event path can arrive as the original request path (`/api/plan-trip`), the
 * rewritten function path (`/.netlify/functions/api/plan-trip`), or just the
 * splat (`/plan-trip`). We normalize all three back to `/api/...` before handing
 * the event to Express so route matching is deterministic.
 */
import serverless from "serverless-http";
import { app } from "../../server/app.js";

const FUNCTION_PREFIX = "/.netlify/functions/api";

const serverlessHandler = serverless(app);

function normalizeApiPath(rawPath: string | undefined): string {
  let path = rawPath || "/";
  // Strip a query string if one rode along on the path.
  const queryIndex = path.indexOf("?");
  if (queryIndex !== -1) path = path.slice(0, queryIndex);

  // 1) Rewritten function path -> original API path.
  if (path.startsWith(FUNCTION_PREFIX)) {
    path = path.slice(FUNCTION_PREFIX.length) || "/";
  }
  // 2) Ensure it lives under /api (covers the bare-splat case, e.g. /listings).
  if (path === "/" || path === "") {
    path = "/api";
  } else if (!path.startsWith("/api")) {
    path = "/api" + (path.startsWith("/") ? path : `/${path}`);
  }
  return path;
}

// Loosely typed: this file is bundled by Netlify's esbuild and is intentionally
// outside tsconfig's `include`, so it isn't part of `pnpm check`.
export const handler = async (event: any, context: any) => {
  const normalized = normalizeApiPath(event?.path);
  event.path = normalized;
  if (typeof event?.rawPath === "string") event.rawPath = normalized;
  return serverlessHandler(event, context);
};

export default handler;
