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

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Fails loudly at build/dev time rather than silently breaking auth and
  // listings everywhere — mirrors how the AI planner fails clearly when
  // ANTHROPIC_API_KEY is missing, instead of degrading quietly.
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project's values (see ENVIRONMENT.md).",
  );
}

// `createClient` throws at import time if the URL is missing ("supabaseUrl is
// required") OR malformed ("Invalid supabaseUrl: Must be a valid HTTP or HTTPS
// URL" — e.g. a value set without the https:// prefix). Either throw would
// crash the whole SPA to a blank page before React even mounts. So build the
// client defensively: try the real config, and on ANY failure fall back to a
// harmless placeholder client. With the placeholder the app still renders and
// every Supabase call simply fails and is caught — ListingsContext falls back
// to the static seed (`offline: true`) and Auth stays signed-out (the
// documented read-only fallback). A misconfigured env var thus degrades the
// site instead of taking it down; correct credentials make it live.
const PLACEHOLDER_URL = "https://placeholder.invalid";
const PLACEHOLDER_KEY = "placeholder-anon-key";

function makeClient() {
  if (isSupabaseConfigured) {
    try {
      return createClient(url as string, anonKey as string);
    } catch (err) {
      console.error(
        "Invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — falling back to the read-only seed. " +
          "The URL must be the full https://<project-ref>.supabase.co from Settings → API.",
        err,
      );
    }
  }
  return createClient(PLACEHOLDER_URL, PLACEHOLDER_KEY);
}

export const supabase = makeClient();
