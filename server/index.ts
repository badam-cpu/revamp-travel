import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { app } from "./app.js";

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
