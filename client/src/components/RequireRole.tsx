/**
 * Route guard for role-specific pages (the operator dashboard, and later
 * the traveler trips page). Signed-out visitors are sent to /login; signed
 * in but wrong-role visitors are sent home with a toast — the role itself
 * is never trusted from anything client-side, it's read from `profiles`
 * (see AuthContext.tsx), which only the `handle_new_user` trigger can set.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth, UserRole } from "@/contexts/AuthContext";

export function RequireRole({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/login");
      return;
    }
    if (profile && profile.role !== role) {
      toast(`That page is for ${role === "operator" ? "operators" : "travelers"}.`);
      navigate("/");
    }
  }, [loading, user, profile, role, navigate]);

  if (loading || !user || !profile || profile.role !== role) {
    return (
      <div className="container py-24 text-center">
        <p className="eyebrow">Checking access</p>
        <h1 className="mt-4 font-display text-4xl">One moment.</h1>
      </div>
    );
  }

  return <>{children}</>;
}
