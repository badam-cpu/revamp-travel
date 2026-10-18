/**
 * "Forgot password?" — its own page (/forgot-password) instead of an action on
 * the sign-in form. The guest enters their email (pre-filled from the sign-in
 * form via sessionStorage, never the URL), we ask Supabase to email the reset
 * link (AuthContext.resetPassword → /reset-password), and show a clear "check
 * your inbox" state with a resend after a minute. The same message shows
 * whether or not an account exists (no account probing). Errors are calm and
 * plain — details go to the console only.
 */
import { FormEvent, useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, MailCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

/** Sign-in form → this page: the email typed there, without putting it in the URL. */
export const RESET_EMAIL_KEY = "revamp.resetEmail";
const RESEND_AFTER_S = 60; // Supabase's minimum interval between emails to one person

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  useDocumentMeta({ title: "Reset your password | Revamp Vacations", description: "Get a link to choose a new password for your Revamp account.", canonicalPath: "/forgot-password", noindex: true });

  const [email, setEmail] = useState(() => {
    try {
      const v = sessionStorage.getItem(RESET_EMAIL_KEY) ?? "";
      sessionStorage.removeItem(RESET_EMAIL_KEY);
      return v;
    } catch {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const address = email.trim();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter the email address you use for Revamp.");
      return;
    }
    setSending(true);
    try {
      await resetPassword(address);
      setSentTo(address);
      setWait(RESEND_AFTER_S);
    } catch (err) {
      console.error("[forgot-password]", err);
      const msg = err instanceof Error ? err.message : "";
      setError(
        /rate|too many|security purposes|seconds/i.test(msg)
          ? "You just asked for a link — please wait a minute, then try again."
          : "We couldn't send the link right now. Please try again in a moment.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container flex min-h-[70vh] items-center justify-center py-16">
        <div className="w-full max-w-sm">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-basalt/55 hover:text-apricot">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to sign in
          </Link>

          {sentTo ? (
            <div className="mt-8">
              <MailCheck className="h-8 w-8 text-apricot" aria-hidden />
              <h1 className="mt-4 font-display text-4xl tracking-[-0.03em]">Check your inbox.</h1>
              <p className="mt-4 text-sm leading-6 text-basalt/70">
                If there's a Revamp account for <strong className="text-basalt">{sentTo}</strong>, we've sent a link to choose a new password. It works once and expires after a while.
              </p>
              <p className="mt-3 text-sm leading-6 text-basalt/55">Nothing there after a few minutes? Check your spam or promotions folder.</p>
              {error && (
                <p className="mt-4 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
                </p>
              )}
              <div className="mt-6 grid gap-3">
                <Button type="button" variant="outline" onClick={() => void send()} disabled={sending || wait > 0} className="h-11 rounded-none border-basalt/20">
                  {sending ? "Sending…" : wait > 0 ? `Send again in ${wait}s` : "Send the link again"}
                </Button>
                <button type="button" onClick={() => { setSentTo(null); setError(null); }} className="text-sm font-semibold text-basalt/55 hover:text-apricot">
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="eyebrow mt-8">Forgot your password?</p>
              <h1 className="mt-3 font-display text-4xl tracking-[-0.03em]">Reset it.</h1>
              <p className="mt-3 text-sm leading-6 text-basalt/60">Enter the email you use for Revamp and we'll send you a link to choose a new password.</p>
              <form onSubmit={send} className="mt-8 grid gap-4" noValidate>
                <div className="grid gap-1.5">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {error && (
                  <p className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
                  </p>
                )}
                <Button type="submit" className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={sending}>
                  {sending ? "Sending…" : "Send reset link"}
                </Button>
              </form>
              {/* Google sign-ups have no password — let them sign in right here. */}
              <div className="mt-8">
                <div className="mb-5 flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-basalt/40">
                  <span className="h-px flex-1 bg-basalt/10" /> or <span className="h-px flex-1 bg-basalt/10" />
                </div>
                <GoogleSignInButton redirect={null} />
                <p className="mt-2 text-center text-xs text-basalt/50">Signed up with Google? You don't need a password.</p>
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
