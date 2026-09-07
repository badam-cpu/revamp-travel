/** Revamp brandbook: same white/orange/charcoal form surfaces as Manage.tsx and Plan.tsx. */
import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      const redirect = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("redirect") : null;
      navigate(redirect && redirect.startsWith("/") ? redirect : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container flex min-h-[70vh] items-center justify-center py-16">
        <div className="w-full max-w-sm">
          <p className="eyebrow">Welcome back</p>
          <h1 className="mt-3 font-display text-4xl tracking-[-0.03em]">Sign in.</h1>

          <form onSubmit={submit} className="mt-8 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && (
              <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <Button type="submit" className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-basalt/55">
            New here?{" "}
            <Link href="/signup" className="font-semibold text-apricot hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
