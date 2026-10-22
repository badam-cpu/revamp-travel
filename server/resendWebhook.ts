/**
 * Campaign results (migration 0116): Resend → POST /api/resend-webhook.
 *
 * Resend delivers webhooks through Svix. Every request is verified before
 * anything is read: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw body}`
 * with the endpoint's signing secret (RESEND_WEBHOOK_SECRET, "whsec_…"), any of
 * the space-separated "v1,<sig>" values may match, and the timestamp must be
 * within 5 minutes. Without the secret configured, nothing is accepted.
 *
 * Events are matched to a campaign by Resend's own email id (saved at send
 * time in email_campaign_messages) — not by address. Recording goes through
 * the security-definer record_email_event(), once per email and kind
 * (duplicates/retries just bump a counter). A spam complaint also puts the
 * address on the unsubscribe list, so we never mail that person again.
 */
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const KINDS: Record<string, "delivered" | "opened" | "clicked" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export function resendWebhookConfigured(): boolean {
  return !!process.env.RESEND_WEBHOOK_SECRET;
}

/** Svix signature check (exported for tests). */
export function verifySvix(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, rawBody: string, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !rawBody) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 5 * 60) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((sig) => {
      const got = Buffer.from(sig, "base64");
      return got.length === expected.length && crypto.timingSafeEqual(got, expected);
    });
}

/** Record one verified event. Returns what happened (for logs/tests). */
export async function handleResendEvent(admin: SupabaseClient, payload: unknown): Promise<"recorded" | "ignored" | "unknown_email"> {
  const p = payload as { type?: string; data?: { email_id?: string; to?: string[] | string } };
  const kind = p?.type ? KINDS[p.type] : undefined;
  const emailId = p?.data?.email_id;
  if (!kind || !emailId || typeof emailId !== "string" || emailId.length > 100) return "ignored";
  const { data, error } = await admin.rpc("record_email_event", { p_email_id: emailId, p_kind: kind });
  if (error) {
    console.warn("[resend webhook] not recorded (run migration 0116?)", error.message);
    return "ignored";
  }
  if (!data) return "unknown_email"; // not a campaign email (e.g. a booking email) — nothing to count
  if (kind === "complained") {
    const to = Array.isArray(p.data?.to) ? p.data?.to[0] : p.data?.to;
    if (to && typeof to === "string") await admin.from("email_optouts").upsert({ email: to.trim().toLowerCase() }, { onConflict: "email" });
  }
  return "recorded";
}
