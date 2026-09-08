import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { app } from "./app.js";
import { isCrawlerUserAgent } from "./botDetect.js";
import { renderForBot } from "./prerender.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This entrypoint is the long-running Node process used for local development
// (`pnpm dev:server`) and single-process production (`pnpm build && pnpm start`).
// It takes the shared Express `app` (routes + JSON parsing, from ./app.ts) and
// adds the two things a persistent server needs but a Netlify Function does not:
// static SPA serving and an actual listening socket.
async function startServer() {
  const server = createServer(app);

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  // Belt-and-suspenders noindex on the auth-gated routes — robots.txt's
  // Disallow alone doesn't de-index an already-linked page, so every response
  // under these paths also carries the header, regardless of user agent. (On
  // Netlify this is done with a [[headers]] block in netlify.toml instead,
  // since these routes are served by the CDN, not this process.)
  app.use(["/dashboard", "/admin"], (_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // Bot-prerender middleware for the long-running server (`pnpm start`,
  // self-hosted). Hands a known non-JS crawler real HTML from prerender.ts;
  // everything else (real browsers, /api/*, static assets, dashboard/admin)
  // falls through to express.static / the SPA catch-all. On Netlify this UA
  // sniffing is done by the edge function instead (this process only serves
  // /api/* there), but keeping it here makes `pnpm start` behave identically
  // and lets the verification curls run locally.
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (req.path === "/robots.txt" || req.path === "/sitemap.xml") return next();
    if (req.path === "/dashboard" || req.path.startsWith("/dashboard/") || req.path === "/admin" || req.path.startsWith("/admin/")) return next();
    const lastSegment = req.path.split("/").pop() || "";
    if (lastSegment.includes(".")) return next(); // hashed JS/CSS, images, favicon.ico, etc.
    if (!isCrawlerUserAgent(req.get("user-agent"))) return next();
    try {
      const origin = `${req.protocol}://${req.get("host")}`;
      const { status, body } = await renderForBot(req.path, origin);
      res.status(status).set("Content-Type", "text/html; charset=utf-8").send(body);
    } catch (err) {
      console.error("Bot prerender failed, falling back to the SPA shell:", err);
      next();
    }
  });

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all non-API routes
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticPath, "index.html"));
  });

  // In dev this process only serves /api/* (Vite's dev server, proxying
  // /api to this port, handles everything else) — use API_PORT so it
  // doesn't collide with Vite's own port. In production it serves both
  // the built SPA and the API on a single PORT.
  const port = process.env.NODE_ENV === "production" ? process.env.PORT || 3000 : process.env.API_PORT || 3001;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
