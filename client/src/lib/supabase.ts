/**
 * Supabase client for the browser. Uses the anon key only — every table this
 * client touches (`profiles`, `listings`) is protected by Row-Level Security
 * (see supabase/migrations/0001_init.sql), so the anon key alone can never
 * read or write more than a given signed-in user is allowed to. The
 * privileged service-role key is never used here — only from
 * scripts/seed-catalog.mjs and (in Milestone B) server-side Netlify
 * Functions that need to bypass RLS for payment-verified writes.
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fails loudly at build/dev time rather than silently breaking auth and
  // listings everywhere — mirrors how the AI planner fails clearly when
  // ANTHROPIC_API_KEY is missing, instead of degrading quietly.
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project's values (see ENVIRONMENT.md).",
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "");
