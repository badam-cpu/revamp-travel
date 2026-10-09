# Persistent-host container for the Revamp MCP server.
#
# Netlify Functions serve the website + the STATELESS MCP path, but can't hold
# an open SSE stream, which the claude.ai remote connector requires. This image
# runs the SAME Express app (server/index.ts) as a long-lived process with the
# streaming MCP transport enabled (MCP_STREAMING=1), so the connector's held-
# open GET stream works. Deploy it to any always-on container host (Railway,
# Fly.io, Render, a VPS) and point mcp.revampvacations.com at it. See
# DEPLOY-MCP.md. The website stays on Netlify; only /mcp needs this host.
FROM node:22-slim

WORKDIR /app
RUN corepack enable

# Install deps first (cached layer) — needs the full dep set to build.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the client + the server bundle (dist/index.js, dist/public).
COPY . .
RUN pnpm build

ENV NODE_ENV=production
ENV MCP_STREAMING=1
# Hosts inject PORT; the server reads process.env.PORT (default 3000).
EXPOSE 3000

CMD ["node", "dist/index.js"]
