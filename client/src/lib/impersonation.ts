/**
 * Admin "Log in as operator" (migration 0093) — the browser half.
 *
 * Start: keep the admin's own session tokens, ask the server for a one-time
 * sign-in token for the operator, exchange it (`verifyOtp`) → this browser is
 * now signed in as the operator, so every page and write runs under THEIR RLS.
 * A marker in localStorage remembers whose account this is (for the
 * "Return to admin" bar) and the admin's tokens to come back with.
 *
 * Return: revoke only this browser's operator session (`signOut` scope
 * "local" — the real operator stays signed in on their own devices), restore
 * the admin's session, and log the end time.
 */
import { supabase } from "@/lib/supabase";
import { adminImpersonate, adminImpersonateEnd, ApiError } from "@/lib/api";

const KEY = "revamp:impersonation";
/** Fired on this tab when the marker changes (other tabs get the `storage` event). */
export const IMPERSONATION_EVENT = "revamp:impersonation";

export interface ImpersonationMarker {
  auditId: string;
  operatorId: string;
  operatorName: string;
  startedAt: string;
  adminAccessToken: string;
  adminRefreshToken: string;
}

export function readImpersonation(): ImpersonationMarker | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ImpersonationMarker) : null;
  } catch {
    return null;
  }
}

function writeMarker(m: ImpersonationMarker | null) {
  try {
    if (m) localStorage.setItem(KEY, JSON.stringify(m));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — the bar just won't show */
  }
  window.dispatchEvent(new Event(IMPERSONATION_EVENT));
}

export function clearImpersonation() {
  writeMarker(null);
}

/** Sign this browser in as the operator. Throws an ApiError with a calm message on failure. */
export async function startImpersonation(operatorId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const own = data.session;
  if (!own) throw new ApiError("Sign in first.");

  const grant = await adminImpersonate(operatorId, own.access_token);
  const { data: verified, error } = await supabase.auth.verifyOtp({ token_hash: grant.tokenHash, type: "magiclink" });
  if (error || !verified.session) {
    console.error("[impersonation] verify failed", error?.message);
    // Put the admin back exactly as they were.
    await supabase.auth.setSession({ access_token: own.access_token, refresh_token: own.refresh_token });
    throw new ApiError("Couldn't open this account. Please try again.");
  }
  writeMarker({
    auditId: grant.auditId,
    operatorId,
    operatorName: grant.operatorName,
    startedAt: new Date().toISOString(),
    adminAccessToken: own.access_token,
    adminRefreshToken: own.refresh_token,
  });
}

/**
 * Leave the operator's account and restore the admin. Returns "admin" when the
 * admin session is back, "login" when it couldn't be restored (sign in again).
 */
export async function endImpersonation(): Promise<"admin" | "login"> {
  const marker = readImpersonation();
  clearImpersonation();
  // Revoke only this browser's copy of the operator's session.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  if (!marker) return "login";
  const { data, error } = await supabase.auth.setSession({ access_token: marker.adminAccessToken, refresh_token: marker.adminRefreshToken });
  if (error || !data.session) {
    console.error("[impersonation] admin session restore failed", error?.message);
    return "login";
  }
  await adminImpersonateEnd(marker.auditId, data.session.access_token).catch((e) => console.error("[impersonation] end log failed", e));
  return "admin";
}

/** Leave and go to the right place (admin Users, or sign-in if the admin session expired). */
export async function returnToAdmin(): Promise<void> {
  const where = await endImpersonation();
  window.location.assign(where === "admin" ? "/admin?section=users" : "/login?redirect=%2Fadmin");
}
