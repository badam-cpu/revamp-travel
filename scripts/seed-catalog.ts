/**
 * One-time catalog migration: imports shared/listings.ts's seed rows into
 * the Supabase `listings` table, all attributed to a single house "Revamp"
 * operator account — this is decision #4 from the marketplace plan
 * ("assign the existing catalog to a house Revamp operator account"),
 * which is what keeps every seed stay/tour/restaurant visible and bookable
 * once the app stops reading shared/listings.ts at runtime.
 *
 * Prerequisites (do these first — this script does not do them for you):
 *   1. Run supabase/migrations/0001_init.sql against your Supabase project
 *      (SQL Editor, or `supabase db push`/psql with the CLI).
 *   2. Deploy the app (or run it locally with VITE_SUPABASE_URL /
 *      VITE_SUPABASE_ANON_KEY set) and sign up for a real account through
 *      /signup, choosing "Operator". That email + password becomes the
 *      house "Revamp" account — every seed listing will be owned by it,
 *      and it's the account you sign in as later to edit them.
 *
 * Why this needs two different Supabase keys, not one:
 *   - stay/tour rows are inserted by signing in as that operator with the
 *     ANON key and going through supabase-js exactly like Dashboard.tsx
 *     does — the same "operators can create their own stay/tour listings"
 *     Row-Level Security policy every real operator's inserts go through
 *     (supabase/migrations/0001_init.sql), so this exercises the real path
 *     rather than a privileged shortcut. Since 0002_review_gate_and_admin.sql,
 *     that policy requires every new row to start status='pending' — so
 *     each stay/tour insert here is immediately followed by one
 *     service-role update setting it to 'published'. That's a deliberate,
 *     narrow bypass of the review gate: this is a one-time bulk import of
 *     already-vetted content, not something that should sit in the admin's
 *     review queue the same way a stranger's new submission should.
 *   - eat (restaurant) rows are different: RLS deliberately has NO insert
 *     policy for type='eat' at all — restaurants are editorial-only, not
 *     operator-authored (EDITABLE_LISTING_TYPES in shared/listings.ts,
 *     and CLAUDE.md's "restaurants must stay creation/edit/delete-proof at
 *     the API layer" rule). No operator session, house account included,
 *     can insert one — that block is the point. A one-time editorial seed
 *     is exactly the kind of admin operation RLS exists to keep everyone
 *     else out of, so this one narrow case uses the SERVICE ROLE key to
 *     bypass RLS. That key is read from your local .env, is never
 *     committed (.env is gitignored), and is not used anywhere else in
 *     this app — server/supabase.ts, the only other server-side Supabase
 *     client, deliberately only ever holds the anon key. Restaurants
 *     remain un-writable by any operator, including this one, after this
 *     script finishes: only the insert bypasses RLS, not update/delete.
 *
 * Safe to re-run: existing rows are matched by slug and skipped, so this
 * won't create duplicates if you run it again (e.g. after adding a new
 * seed listing to shared/listings.ts).
 *
 * Usage:
 *   cp .env.example .env   # if you haven't already
 *   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 *   # SUPABASE_SERVICE_ROLE_KEY, SEED_OPERATOR_EMAIL, SEED_OPERATOR_PASSWORD
 *   pnpm seed:catalog
 */
import { createClient } from "@supabase/supabase-js";
import { seedListings } from "../shared/listings.js";
import type { Listing } from "../shared/listings.js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const operatorEmail = process.env.SEED_OPERATOR_EMAIL;
const operatorPassword = process.env.SEED_OPERATOR_PASSWORD;

function requireEnv() {
  const missing = [
    !url && "VITE_SUPABASE_URL",
    !anonKey && "VITE_SUPABASE_ANON_KEY",
    !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    !operatorEmail && "SEED_OPERATOR_EMAIL",
    !operatorPassword && "SEED_OPERATOR_PASSWORD",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
    console.error("See scripts/seed-catalog.ts's header comment and .env.example for what each one is.");
    process.exit(1);
  }
}

function toRow(listing: Listing) {
  return {
    type: listing.type,
    slug: listing.slug,
    title: listing.title,
    eyebrow: listing.eyebrow,
    city: listing.city,
    region: listing.region,
    lat: listing.coordinates.lat,
    lng: listing.coordinates.lng,
    image: listing.image,
    gallery: listing.gallery,
    short_description: listing.shortDescription,
    long_description: listing.longDescription,
    price_cents: Math.round(listing.price * 100),
    price_unit: listing.priceUnit,
    tags: listing.tags,
    amenities: listing.amenities,
    facts: listing.facts,
    featured: listing.featured ?? false,
    accent: listing.accent,
  };
}

async function main() {
  requireEnv();

  // Anon-key client, signed in as the operator: used for stay/tour rows so
  // the seed genuinely exercises the same RLS insert policy real operators
  // use, rather than a privileged shortcut.
  const anonClient = createClient(url!, anonKey!);
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email: operatorEmail!,
    password: operatorPassword!,
  });
  if (signInError || !signInData.session) {
    console.error(`Couldn't sign in as ${operatorEmail}: ${signInError?.message ?? "no session returned"}`);
    console.error("Make sure you've already signed up for this account through /signup, choosing \"Operator\".");
    process.exit(1);
  }
  const operatorId = signInData.session.user.id;

  const { data: profile, error: profileError } = await anonClient.from("profiles").select("role, display_name").eq("id", operatorId).single();
  if (profileError || profile?.role !== "operator") {
    console.error(`${operatorEmail} isn't an operator account (role: ${profile?.role ?? "unknown"}).`);
    console.error("Sign up a fresh account at /signup choosing \"Operator\", or use SEED_OPERATOR_EMAIL/SEED_OPERATOR_PASSWORD for one that already is.");
    process.exit(1);
  }
  console.log(`Signed in as ${profile.display_name} (${operatorEmail}, operator, id ${operatorId}).`);

  // Service-role client: bypasses RLS. Used ONLY for the eat/restaurant
  // rows below, whose insert RLS deliberately blocks — see the file header.
  const serviceClient = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const listing of seedListings) {
    const { data: existing, error: existingError } = await anonClient.from("listings").select("id").eq("slug", listing.slug).maybeSingle();
    if (existingError) {
      console.error(`  ✗ ${listing.slug}: couldn't check for an existing row (${existingError.message})`);
      failed++;
      continue;
    }
    if (existing) {
      console.log(`  · ${listing.slug}: already in the catalog, skipping.`);
      skipped++;
      continue;
    }

    const isEat = listing.type === "eat";
    const client = isEat ? serviceClient : anonClient;
    // eat rows publish straight away (service-role insert, no review-gate
    // policy applies to them at all); stay/tour rows must start 'pending'
    // to satisfy the operator insert policy, then get auto-approved below.
    const { error } = await client.from("listings").insert({ ...toRow(listing), operator_id: operatorId, status: isEat ? "published" : "pending" });
    if (error) {
      console.error(`  ✗ ${listing.slug}: ${error.message}`);
      failed++;
      continue;
    }

    if (!isEat) {
      const { error: approveError } = await serviceClient
        .from("listings")
        .update({ status: "published", reviewed_at: new Date().toISOString() })
        .eq("slug", listing.slug);
      if (approveError) {
        console.error(`  ✗ ${listing.slug}: inserted but couldn't auto-approve (${approveError.message})`);
        failed++;
        continue;
      }
    }

    console.log(`  ✓ ${listing.slug} (${listing.type})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped (already present), ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Seed script crashed:", err);
  process.exit(1);
});
