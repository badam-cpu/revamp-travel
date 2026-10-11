/**
 * Whose PayLink account takes a payment (migration 0094).
 *
 * An operator who connected their own PayLink (Dashboard → Integrations) and is
 * `active` gets paid directly; everyone else — and any operator who is paused
 * (overdue commission statement), disconnected, or whose credentials are
 * missing — falls back to Revamp's account, exactly as before. Every failure
 * here (e.g. 0094 not run yet) also falls back to Revamp, so nothing that works
 * today can break.
 *
 * Credentials live only in operator_secrets (service-role, never returned to a
 * client, never logged), and the API key is ENCRYPTED there (server/secretBox.ts,
 * key in env only) — a database leak alone exposes nothing usable.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaylinkClient, revampPaylink, type PaylinkClient } from "./paylink.js";
import { openSecret, sealSecret, secretsKeyConfigured } from "./secretBox.js";

export interface PaymentAccount {
  /** Operator whose account takes the money, or null for Revamp's account. */
  owner: string | null;
  client: PaylinkClient;
}

const REVAMP: PaymentAccount = { owner: null, client: revampPaylink };

async function loadCreds(admin: SupabaseClient, operatorId: string): Promise<{ partnerId: string; partnerKey: string } | null> {
  const { data, error } = await admin
    .from("operator_secrets")
    .select("paylink_partner_id, paylink_partner_key")
    .eq("operator_id", operatorId)
    .maybeSingle();
  if (error || !data?.paylink_partner_id || !data?.paylink_partner_key) return null;
  const partnerKey = openSecret(data.paylink_partner_key as string, operatorId);
  if (!partnerKey) {
    console.error("[payment-accounts] stored PayLink key can't be decrypted (OPERATOR_SECRETS_KEY missing or changed)", operatorId);
    return null;
  }
  return { partnerId: data.paylink_partner_id as string, partnerKey };
}

let accountsTableKnown: boolean | null = null;
/**
 * Patch for a booking row that's being (re)charged: sets which account issued
 * the charge — including clearing it back to Revamp's (null) — but only once
 * migration 0094 exists, so pre-0094 databases never see an unknown column.
 */
export async function accountOwnerPatch(admin: SupabaseClient | null, account: PaymentAccount): Promise<Record<string, string | null>> {
  if (account.owner) return { paylink_account_owner: account.owner };
  if (!admin) return {};
  if (accountsTableKnown === null) {
    const { error } = await admin.from("operator_payment_accounts").select("operator_id", { head: true, count: "exact" }).limit(1);
    accountsTableKnown = !error;
  }
  return accountsTableKnown ? { paylink_account_owner: null } : {};
}

/** The account a NEW charge for this operator's listing should go to. */
export async function resolvePaymentAccount(admin: SupabaseClient | null, operatorId: string | null | undefined): Promise<PaymentAccount> {
  if (!admin || !operatorId) return REVAMP;
  try {
    const { data, error } = await admin.from("operator_payment_accounts").select("status").eq("operator_id", operatorId).maybeSingle();
    if (error || data?.status !== "active") return REVAMP;
    const creds = await loadCreds(admin, operatorId);
    if (!creds) return REVAMP;
    return { owner: operatorId, client: createPaylinkClient(creds) };
  } catch (err) {
    console.error("[payment-accounts] resolve failed — using Revamp's account", err);
    return REVAMP;
  }
}

/**
 * The client to VERIFY an existing charge with — the account that issued it,
 * regardless of the operator's current status (a paused/disconnected operator's
 * pending charges still live in their account). Null when the issuing
 * account's credentials are gone (caller leaves the row pending).
 */
export async function clientForOwner(admin: SupabaseClient | null, owner: string | null | undefined): Promise<PaylinkClient | null> {
  if (!owner) return revampPaylink;
  if (!admin) return null;
  try {
    const creds = await loadCreds(admin, owner);
    return creds ? createPaylinkClient(creds) : null;
  } catch {
    return null;
  }
}

/** "•••• 4821" — enough for the operator/admin to recognise the account. */
export function maskPartnerId(partnerId: string): string {
  const tail = partnerId.replace(/\s+/g, "").slice(-4);
  return `•••• ${tail}`;
}

export interface PaymentAccountStatus {
  connected: boolean;
  /** False until the server's encryption key is configured (connect is refused). */
  available?: boolean;
  status?: "active" | "paused" | "disconnected";
  accountHint?: string | null;
  connectedAt?: string | null;
  pausedAt?: string | null;
  pausedReason?: string | null;
}

export async function getPaymentAccountStatus(admin: SupabaseClient, operatorId: string): Promise<PaymentAccountStatus> {
  const { data, error } = await admin
    .from("operator_payment_accounts")
    .select("status, account_hint, connected_at, paused_at, paused_reason")
    .eq("operator_id", operatorId)
    .maybeSingle();
  if (error) throw error;
  const available = secretsKeyConfigured();
  if (!data || data.status === "disconnected") return { connected: false, available, status: data?.status as PaymentAccountStatus["status"] };
  return {
    connected: true,
    available,
    status: data.status as PaymentAccountStatus["status"],
    accountHint: data.account_hint as string | null,
    connectedAt: data.connected_at as string | null,
    pausedAt: data.paused_at as string | null,
    pausedReason: data.paused_reason as string | null,
  };
}

/** Verify with PayLink, then store + activate. Never returns or logs the key. */
export async function connectPaymentAccount(
  admin: SupabaseClient,
  operatorId: string,
  creds: { partnerId: string; partnerKey: string },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const partnerId = creds.partnerId.trim();
  const partnerKey = creds.partnerKey.trim();
  if (!partnerId || !partnerKey) return { ok: false, status: 400, error: "Enter both your PayLink partner ID and key." };
  // Never store a key we can't encrypt.
  if (!secretsKeyConfigured()) return { ok: false, status: 503, error: "Direct payments aren't switched on yet — please try again later." };
  const valid = await createPaylinkClient({ partnerId, partnerKey }).verifyCredentials();
  if (!valid) {
    return {
      ok: false,
      status: 400,
      error: "PayLink didn't accept those credentials. Use the API partner ID and key PayLink issued for your account (not your login email/password).",
    };
  }
  const { error: secretErr } = await admin
    .from("operator_secrets")
    .upsert({ operator_id: operatorId, paylink_partner_id: partnerId, paylink_partner_key: sealSecret(partnerKey, operatorId) }, { onConflict: "operator_id" });
  if (secretErr) throw secretErr;
  // A paused account (overdue statement) stays paused until the statement is paid.
  const { data: existing } = await admin.from("operator_payment_accounts").select("status, paused_reason").eq("operator_id", operatorId).maybeSingle();
  const stayPaused = existing?.status === "paused";
  const { error: accErr } = await admin.from("operator_payment_accounts").upsert(
    {
      operator_id: operatorId,
      provider: "paylink",
      status: stayPaused ? "paused" : "active",
      account_hint: maskPartnerId(partnerId),
      connected_at: new Date().toISOString(),
      ...(stayPaused ? {} : { paused_at: null, paused_reason: null }),
    },
    { onConflict: "operator_id" },
  );
  if (accErr) throw accErr;
  return { ok: true };
}

/**
 * Soft disconnect: new charges go to Revamp's account immediately, but the
 * credentials are kept while any pending charge still lives in the operator's
 * account (so it can still be verified); purgeDisconnectedCredentials() drops
 * them once nothing is pending.
 */
export async function disconnectPaymentAccount(admin: SupabaseClient, operatorId: string): Promise<void> {
  const { error } = await admin.from("operator_payment_accounts").update({ status: "disconnected" }).eq("operator_id", operatorId);
  if (error) throw error;
  await purgeDisconnectedCredentials(admin, operatorId);
}

/** Drop PayLink creds of disconnected operators with nothing left to verify. */
export async function purgeDisconnectedCredentials(admin: SupabaseClient, onlyOperatorId?: string): Promise<number> {
  let q = admin.from("operator_payment_accounts").select("operator_id").eq("status", "disconnected");
  if (onlyOperatorId) q = q.eq("operator_id", onlyOperatorId);
  const { data, error } = await q;
  if (error || !data?.length) return 0;
  let purged = 0;
  for (const { operator_id } of data as { operator_id: string }[]) {
    const [{ count: bookingsPending }, { count: qrPending }] = await Promise.all([
      admin.from("bookings").select("id", { count: "exact", head: true }).eq("paylink_account_owner", operator_id).in("status", ["pending_payment", "awaiting_payment"]),
      admin.from("qr_payments").select("id", { count: "exact", head: true }).eq("paylink_account_owner", operator_id).eq("status", "pending_payment"),
    ]);
    if ((bookingsPending ?? 0) > 0 || (qrPending ?? 0) > 0) continue;
    const { error: upErr } = await admin
      .from("operator_secrets")
      .update({ paylink_partner_id: null, paylink_partner_key: null })
      .eq("operator_id", operator_id);
    if (!upErr) purged++;
  }
  return purged;
}

/** Admin / statement-overdue pause; resume re-activates (if still connected). */
export async function setPaymentAccountPaused(admin: SupabaseClient, operatorId: string, paused: boolean, reason?: string): Promise<boolean> {
  const { data } = await admin.from("operator_payment_accounts").select("status").eq("operator_id", operatorId).maybeSingle();
  if (!data || data.status === "disconnected") return false;
  const patch = paused
    ? { status: "paused", paused_at: new Date().toISOString(), paused_reason: reason ?? "Paused by Revamp" }
    : { status: "active", paused_at: null, paused_reason: null };
  const { error } = await admin.from("operator_payment_accounts").update(patch).eq("operator_id", operatorId);
  if (error) throw error;
  return true;
}
