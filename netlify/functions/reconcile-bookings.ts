/**
 * Daily reconcile cron for the PayLink booking loop. PayLink has no webhook, so
 * a payment where the traveler paid but never returned to the redirect would
 * otherwise sit `pending_payment` forever. This scheduled function sweeps all
 * stale pending bookings once a day: confirms any PayLink now reports approved,
 * and expires holds that were never paid so they stop blocking soft
 * availability. The same server-verified, idempotent logic as
 * POST /api/confirm-checkout — just run globally instead of per-user.
 *
 * Runs with the service-role key (SUPABASE_SERVICE_ROLE_KEY, server-only, no
 * VITE_ prefix). Netlify detects the `config.schedule` export and registers the
 * cron automatically — nothing to add to netlify.toml.
 *
 * Loosely typed like netlify/functions/api.ts: bundled by Netlify's esbuild and
 * intentionally outside tsconfig's include, so it isn't part of `pnpm check`.
 */
import { supabaseAdmin, adminConfigured } from "../../server/supabaseAdmin.js";
import { reconcileAllPendingBookings, requestReviewsForCompleted } from "../../server/bookings.js";
import { reconcileAllPendingGiftCards, expireOverdueGiftCards } from "../../server/giftcards.js";
import { reconcileAllSubscriptions, reconcilePerListingAmounts } from "../../server/subscriptions.js";

export const handler = async () => {
  if (!adminConfigured()) {
    console.error("[reconcile-bookings] service role not configured — skipping");
    return { statusCode: 200, body: JSON.stringify({ skipped: "not_configured" }) };
  }
  const admin = supabaseAdmin();
  if (!admin) return { statusCode: 200, body: JSON.stringify({ skipped: "no_client" }) };
  try {
    const result = await reconcileAllPendingBookings(admin, { limit: 200 });
    // Also email travelers whose trip has ended, asking for a review (once each).
    const reviews = await requestReviewsForCompleted(admin, { limit: 200 });
    // Activate paid gift cards whose buyer never returned; expire stale holds.
    const gifts = await reconcileAllPendingGiftCards(admin, { limit: 200 });
    const giftExpiry = await expireOverdueGiftCards(admin, { limit: 200 });
    // Activate operator subscriptions that were paid but never confirmed on return.
    const subs = await reconcileAllSubscriptions(admin, { limit: 200 });
    // Apply per-listing amount changes (next-cycle) for operators whose count changed.
    const subAmounts = await reconcilePerListingAmounts(admin, { limit: 500 });
    console.log("[reconcile-bookings]", { ...result, reviewEmails: reviews.sent, gifts, giftExpiry, subs, subAmounts });
    return { statusCode: 200, body: JSON.stringify({ ...result, reviewEmails: reviews.sent, gifts, giftExpiry, subs, subAmounts }) };
  } catch (err) {
    console.error("[reconcile-bookings] failed", err);
    return { statusCode: 500, body: JSON.stringify({ error: String(err).slice(0, 200) }) };
  }
};

// Every hour. Hourly (not daily) so an unpaid "awaiting payment" hold is
// released within ~1h of its 24h expiry window, and paid bookings whose
// confirm-checkout never fired get confirmed promptly. Netlify reads this
// export to schedule the function.
// Every 10 minutes: PayLink production has no auto-redirect back to the site, so
// confirm-on-return often doesn't fire — this sweep is the primary path that
// flips paid holds to confirmed (and sends the emails), so it needs to be
// prompt, not hourly. Cheap: it only polls bookings still in pending_payment.
export const config = { schedule: "*/10 * * * *" };

export default handler;
