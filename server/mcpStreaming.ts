/**
 * Streaming (session-based) MCP transport — the connector-compatible path.
 *
 * The stateless handler in server/mcp.ts (InMemoryTransport + hand dispatch)
 * exists ONLY because the SDK's real Streamable-HTTP transport can't read
 * headers through serverless-http inside the Netlify Function, and because a
 * Netlify Function can't hold an open SSE stream. The claude.ai remote
 * connector REQUIRES that open server→client stream (a long-lived GET), so on
 * Netlify it registers then reports "Server not responding".
 *
 * This module is the fix for a PERSISTENT Node deployment (a container host,
 * `pnpm start`): it drives each session through the SDK's real
 * StreamableHTTPServerTransport in stateful mode — POST initialize opens a
 * session (Mcp-Session-Id), GET holds the notification stream open, DELETE
 * tears it down. Enabled by the `MCP_STREAMING` env flag so the same codebase
 * still runs the stateless path on Netlify. Wired in server/routes.ts.
 */
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPublicServer } from "./mcp.js";
import { createAdminServer } from "./mcpAdmin.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

export function mcpStreamingEnabled(): boolean {
  const v = (process.env.MCP_STREAMING || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** One live transport per session id, for the lifetime of this process. */
const SESSIONS = new Map<string, StreamableHTTPServerTransport>();

async function openSession(makeServer: () => McpServer): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      SESSIONS.set(sid, transport);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) SESSIONS.delete(transport.sessionId);
  };
  const server = makeServer();
  await server.connect(transport);
  return transport;
}

/**
 * Handle a POST/GET/DELETE for a session-based MCP endpoint. A POST carrying an
 * initialize request (and no session header) opens a new session; any other
 * request must carry a known Mcp-Session-Id. GET is the long-lived SSE stream
 * the connector subscribes to; DELETE ends the session.
 */
async function handle(req: Request, res: Response, makeServer: () => McpServer): Promise<void> {
  const sessionId = (req.get("mcp-session-id") || "").trim() || undefined;
  let transport = sessionId ? SESSIONS.get(sessionId) : undefined;

  if (!transport) {
    if (req.method === "POST" && !sessionId && isInitializeRequest(req.body)) {
      transport = await openSession(makeServer);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session. Send an initialize request first (and include its Mcp-Session-Id on later requests)." },
        id: null,
      });
      return;
    }
  }

  // The SDK transport reads method/headers/body off the raw Node req/res and
  // owns the response from here (JSON for POSTs, an open event-stream for GET).
  await transport.handleRequest(req, res, req.method === "POST" ? req.body : undefined);
}

/** Streaming public MCP (read-only, no auth). */
export async function handlePublicMcpStreaming(req: Request, res: Response): Promise<void> {
  await handle(req, res, () => createPublicServer());
}

/** Streaming admin MCP — same Bearer <MCP_ADMIN_KEY> gate as the stateless path. */
export async function handleAdminMcpStreaming(req: Request, res: Response): Promise<void> {
  const key = process.env.MCP_ADMIN_KEY;
  if (!key) {
    res.status(503).json({ jsonrpc: "2.0", error: { code: -32000, message: "Admin MCP not configured (MCP_ADMIN_KEY unset)." }, id: null });
    return;
  }
  // Only gate the initial (session-opening) POST; later GET/DELETE/POST on an
  // established session carry the Mcp-Session-Id instead of re-sending auth.
  const openingSession = req.method === "POST" && !req.get("mcp-session-id") && isInitializeRequest(req.body);
  if (openingSession) {
    const auth = req.get("authorization") || "";
    const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (provided !== key) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized: set the Authorization: Bearer <MCP_ADMIN_KEY> header." }, id: null });
      return;
    }
    const admin = supabaseAdmin();
    if (!admin) {
      res.status(503).json({ jsonrpc: "2.0", error: { code: -32000, message: "Service role not configured." }, id: null });
      return;
    }
    await handle(req, res, () => createAdminServer(admin));
    return;
  }
  await handle(req, res, () => {
    throw new Error("unreachable: admin session must be opened with auth");
  });
}
