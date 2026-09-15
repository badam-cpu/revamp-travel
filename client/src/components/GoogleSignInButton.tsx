/**
 * "Continue with Google" — starts Supabase's Google OAuth flow (see
 * AuthContext.signInWithGoogle). A full-page redirect, so there's no success
 * state to render here; on failure we surface a toast. Shared by /login and
 * /signup. Requires the Google provider to be enabled in the Supabase project
 * (Auth → Providers → Google) with an OAuth client — until then the button
 * still renders but the redirect errors.
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function GoogleSignInButton({ redirect = null, label = "Continue with Google" }: { redirect?: string | null; label?: string }) {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      await signInWithGoogle(redirect);
      // On success the browser navigates away to Google; no further UI here.
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start Google sign-in. Try again.");
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={start}
      disabled={loading}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-none border border-basalt/20 bg-paper text-sm font-semibold text-basalt transition-colors hover:bg-chalk disabled:opacity-60"
    >
      <GoogleIcon />
      {loading ? "Redirecting…" : label}
    </button>
  );
}
