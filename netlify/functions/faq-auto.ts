/**
 * Automatic guest FAQ (0118): every 20 minutes, Haiku writes (or rewrites, when a
 * listing's posted details changed) the FAQ for a few published listings the
 * host hasn't taken over — fact-checked, then live. See server/listingFaqAuto.ts.
 * Small batches keep each run well inside the scheduled-function time limit; a
 * full catalog backfill finishes within hours. Loosely typed, outside tsconfig.
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { runAutoFaq } from "../../server/listingFaqAuto.js";
import { recordCronRun } from "../../server/alerts.js";

const JOB = "faq-auto";

export default async (): Promise<Response> => {
  if (!adminConfigured()) return Response.json({ skipped: "not_configured" });
  const admin = supabaseAdmin();
  if (!admin) return Response.json({ skipped: "no_client" });
  const result = await runAutoFaq(admin, 3);
  await recordCronRun(admin, JOB, result.failed === 0, `pending ${result.pending} · updated ${result.updated} · empty ${result.empty} · failed ${result.failed}`);
  return Response.json(result);
};

export const config = { schedule: "*/20 * * * *" };
