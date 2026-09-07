/**
 * Revamp brandbook: same white/orange/charcoal form surfaces as Manage.tsx and Plan.tsx.
 * The traveler/operator choice here is what `handle_new_user` (see
 * supabase/migrations/0001_init.sql) writes into `profiles.role` — it's the
 * one thing this form can't let the user change their mind about silently,
 * so it's presented as two explicit cards rather than a buried dropdown.
 */
import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, Compass, Store } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, UserRole } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export default function Signup() {
  const { signUp } = useAuth();
  const [, navigate] = useLocation();
  const [role, setRole] = useState<UserRole>("traveler");
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signUp({ email, password, role, displayName, businessName: role === "operator" ? businessName : undefined });
      // Supabase projects with "confirm email" on don't return an active
      // session from signUp — only a pending user. Check for a real session
      // before assuming the person is signed in.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate(role === "operator" ? "/dashboard" : "/");
      } else {
        setCheckEmail(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (checkEmail) {
    return (
      <div className="min-h-screen bg-paper text-basalt">
        <SiteHeader />
        <main className="container flex min-h-[70vh] items-center justify-center py-16 text-center">
          <div className="max-w-sm">
            <p className="eyebrow">Almost there</p>
            <h1 className="mt-3 font-display text-4xl tracking-[-0.03em]">Check your email.</h1>
            <p className="mt-4 text-sm leading-6 text-basalt/60">We sent a confirmation link to {email}. Follow it, then come back and sign in.</p>
            <Button asChild className="mt-7 rounded-none bg-apricot text-white">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container flex min-h-[70vh] items-center justify-center py-16">
        <div className="w-full max-w-md">
          <p className="eyebrow">Join Revamp</p>
          <h1 className="mt-3 font-display text-4xl tracking-[-0.03em]">Create an account.</h1>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole("traveler")}
              className={cn(
                "flex flex-col items-start gap-2 border p-4 text-left transition-colors",
                role === "traveler" ? "border-apricot bg-apricot/5" : "border-basalt/15 hover:border-basalt/30",
              )}
            >
              <Compass className={cn("h-5 w-5", role === "traveler" ? "text-apricot" : "text-basalt/50")} />
              <span className="text-sm font-bold">I'm a traveler</span>
              <span className="text-xs text-basalt/50">Book stays &amp; tours</span>
            </button>
            <button
              type="button"
              onClick={() => setRole("operator")}
              className={cn(
                "flex flex-col items-start gap-2 border p-4 text-left transition-colors",
                role === "operator" ? "border-apricot bg-apricot/5" : "border-basalt/15 hover:border-basalt/30",
              )}
            >
              <Store className={cn("h-5 w-5", role === "operator" ? "text-apricot" : "text-basalt/50")} />
              <span className="text-sm font-bold">I'm an operator</span>
              <span className="text-xs text-basalt/50">List &amp; manage offers</span>
            </button>
          </div>

          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="displayName">Your name</Label>
              <Input id="displayName" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            {role === "operator" && (
              <div className="grid gap-1.5">
                <Label htmlFor="businessName">Business name</Label>
                <Input id="businessName" placeholder="e.g. Forest House Dilijan" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {error && (
              <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            <Button type="submit" className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={loading}>
              {loading ? "Creating account…" : role === "operator" ? "Create operator account" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-basalt/55">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-apricot hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
