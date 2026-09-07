/**
 * Landing page for the password-reset link Supabase emails (see
 * AuthContext.resetPassword). Opening that link establishes a short-lived
 * recovery session in the browser; this page lets the user set a new password
 * on it via AuthContext.updatePassword, then sends them to sign in.
 *
 * Requires the Supabase project's Site URL / redirect allowlist to include
 * this deployment's /reset-password (see README → Supabase Setup / Netlify).
 */
import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { useAuth } from "@/contexts/AuthContext";

export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't update your password.";
      // The most common cause is an expired/already-used link (no recovery session).
      setError(/session/i.test(message) ? "This reset link has expired or was already used. Request a new one from the sign-in page." : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container flex min-h-[70vh] items-center justify-center py-16">
        <div className="w-full max-w-sm">
          {done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-apricot" />
              <h1 className="mt-4 font-display text-4xl tracking-[-0.03em]">Password updated.</h1>
              <p className="mt-4 text-sm leading-6 text-basalt/60">You can now sign in with your new password.</p>
              <Button className="mt-7 rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={() => navigate("/login")}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <>
              <p className="eyebrow">Reset password</p>
              <h1 className="mt-3 font-display text-4xl tracking-[-0.03em]">Set a new password.</h1>

              <form onSubmit={submit} className="mt-8 grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="password">New password</Label>
                  <PasswordInput id="password" autoComplete="new-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <PasswordInput id="confirm" autoComplete="new-password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>

                {error && (
                  <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                  </div>
                )}

                <Button type="submit" className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={loading}>
                  {loading ? "Updating…" : "Update password"}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-basalt/55">
                Remembered it?{" "}
                <Link href="/login" className="font-semibold text-apricot hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
