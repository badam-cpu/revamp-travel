/**
 * Aha automatic inbox answers (0119): every 5 minutes, for hosts who switched
 * them on, a guest message unanswered for the host's delay gets an answer from
 * the listing's own details + FAQ — or is left for the host. Only calls the
 * model when something is waiting. See server/inboxAi.ts. Loosely typed.
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { runInboxAutoReplies } from "../../server/inboxAi.js";
import { recordCronRun } from "../../server/alerts.js";

const JOB = "inbox-ai";

export default async (): Promise<Response> => {
  if (!adminConfigured()) return Response.json({ skipped: "not_configured" });
  const admin = supabaseAdmin();
  if (!admin) return Response.json({ skipped: "no_client" });
  const r = await runInboxAutoReplies(admin, 4);
  await recordCronRun(admin, JOB, r.failed === 0, `checked ${r.checked} · answered ${r.answered} · left for host ${r.handedOff} · failed ${r.failed}`);
  return Response.json(r);
};

export const config = { schedule: "*/5 * * * *" };
