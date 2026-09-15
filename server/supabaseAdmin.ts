/**
 * SERVER-ONLY service-role Supabase client. This is the single elevated-
 * privilege escape hatch in the app, and it exists for exactly one reason:
 * confirming a PayLink payment and flipping a booking to `confirmed` is a
 * write RLS cannot authorize (only PayLink knows a payment succeeded, and only
 * the server can ask it — a traveler must never be able to self-confirm). See
 * server/bookings.ts.
 *
 * SECURITY: the key is read from SUPABASE_SERVICE_ROLE_KEY, which has NO VITE_
 * prefix — so Vite never inlines it into the client bundle. It is set only in
 * the Netlify Function runtime env. This module must never be imported from
 * anything under client/ (it would fail at build time anyway — the key isn't
 * defined there — but keep the boundary explicit). Every other server path
 * (reads, iCal sync) uses the anon key or a per-user RLS-scoped client; use
 * those unless the operation genuinely cannot be authorized by RLS.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;

/** True when the service-role client can be built (payments confirmable). */
export function adminConfigured(): boolean {
  return !!(url && serviceRoleKey);
}

/**
 * The service-role client, or null if unconfigured (so callers degrade to
 * "can't confirm right now" instead of crashing). Bypasses RLS entirely —
 * only the payment confirm/reconcile code may use it.
 */
export function supabaseAdmin(): SupabaseClient | null {
  if (!url || !serviceRoleKey) return null;
  if (!cached) {
    cached = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
