/**
 * Netlify Function that runs the whole Express API.
 *
 * `serverless-http` adapts the shared Express `app` (from server/app.ts) to the
 * Lambda-style (event, context) handler Netlify Functions expect. The static
 * SPA is served by Netlify's CDN from `dist/public`, so this function carries
 * only the API — no static-file serving.
 *
 * Routing: `netlify.toml` rewrites `/api/*` to `/.netlify/functions/api/:splat`
 * (status 200). The Express routes are all declared under `/api/*`, so the path
 * Express sees must start with `/api`. Depending on the Netlify runtime, the
 * event path can arrive as the original request path (`/api/listings`), the
 * rewritten function path (`/.netlify/functions/api/listings`), or just the
 * splat (`/listings`). We normalize all three back to `/api/...` before handing
 * the event to Express so route matching is deterministic.
 */
import serverless from "serverless-http";
import { connectLambda } from "@netlify/blobs";
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
  // This is a classic Lambda-signature function (serverless-http). Netlify's
  // automatic Blobs configuration only applies to v2 functions, so classic
  // functions must hand the Blobs runtime context from the event to
  // @netlify/blobs explicitly. Without this, getStore() in server/store.ts
  // throws MissingBlobsEnvironmentError. This shares module state with the
  // dynamic import in store.ts (same bundled @netlify/blobs instance).
  connectLambda(event);

  const normalized = normalizeApiPath(event?.path);
  event.path = normalized;
  if (typeof event?.rawPath === "string") event.rawPath = normalized;
  return serverlessHandler(event, context);
};

export default handler;
