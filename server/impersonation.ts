/**
 * Admin "Log in as operator" (migration 0093). An admin opens an operator's
 * account to apply changes on their behalf. The server issues a one-time
 * sign-in token for the operator (Supabase `generateLink` — it only GENERATES
 * the link; no email is sent, the password is untouched) and records the visit
 * in `admin_impersonations`. The browser exchanges the token for a session
 * (`verifyOtp`), so from then on every write runs under the operator's own RLS,
 * exactly as if they had made it.
 *
 * Rails: the caller must be an admin (checked by the route); the target must be
 * an OPERATOR — never an admin or traveler, never the caller — with an email
 * sign-in and not suspended. Service role only; never import from client/.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Fail = { ok: false; status: number; error: string };
export type StartResult = { ok: true; auditId: string; tokenHash: string; operatorName: string } | Fail;

export async function startImpersonation(
  admin: SupabaseClient,
  opts: { adminId: string; operatorId: string; ip?: string; userAgent?: string },
): Promise<StartResult> {
  const { adminId, operatorId } = opts;
  if (operatorId === adminId) return { ok: false, status: 400, error: "You can't log in as yourself." };

  const { data: profile } = await admin.from("profiles").select("role, display_name, business_name").eq("id", operatorId).maybeSingle();
  if (!profile) return { ok: false, status: 404, error: "Account not found." };
  if (profile.role !== "operator") return { ok: false, status: 400, error: "Only operator accounts can be opened this way." };

  const { data: auth, error: authErr } = await admin.auth.admin.getUserById(operatorId);
  const user = auth?.user;
  if (authErr || !user) return { ok: false, status: 404, error: "Account not found." };
  if (!user.email || user.is_anonymous) return { ok: false, status: 400, error: "This account has no email sign-in, so it can't be opened this way." };
  const bannedUntil = (user as { banned_until?: string | null }).banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) return { ok: false, status: 400, error: "This account is suspended." };

  const { data: audit, error: auditErr } = await admin
    .from("admin_impersonations")
    .insert({ admin_id: adminId, operator_id: operatorId, ip: opts.ip?.slice(0, 100) ?? null, user_agent: opts.userAgent?.slice(0, 300) ?? null })
    .select("id")
    .single();
  if (auditErr || !audit) {
    // Most likely migration 0093 hasn't run — refuse rather than open an unlogged session.
    console.error("[impersonation] audit insert failed", auditErr?.message);
    return { ok: false, status: 503, error: "Log in as isn't available right now." };
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error("[impersonation] generateLink failed", linkErr?.message);
    await admin.from("admin_impersonations").update({ ended_at: new Date().toISOString() }).eq("id", audit.id);
    return { ok: false, status: 502, error: "Couldn't open this account. Please try again." };
  }

  const operatorName = (profile.business_name as string | null)?.trim() || (profile.display_name as string | null)?.trim() || user.email;
  return { ok: true, auditId: audit.id as string, tokenHash, operatorName };
}

/** Close an admin's visit (sets ended_at once). Only the admin who started it can close it. */
export async function endImpersonation(admin: SupabaseClient, opts: { adminId: string; auditId: string }): Promise<void> {
  const { error } = await admin
    .from("admin_impersonations")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", opts.auditId)
    .eq("admin_id", opts.adminId)
    .is("ended_at", null);
  if (error) console.error("[impersonation] end failed", error.message);
}
