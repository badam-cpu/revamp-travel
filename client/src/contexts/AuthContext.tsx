/**
 * Session + profile state for the two-sided marketplace. Mirrors the
 * loading/state pattern already used by ListingsContext.tsx, but backed by
 * Supabase Auth instead of a fetch call. `profile.role` ("traveler" |
 * "operator") is what RequireRole and the header/account menu branch on —
 * it's set once at signup (see Signup.tsx) and created server-side by the
 * `handle_new_user` trigger in supabase/migrations/0001_init.sql, so it's
 * never something the client can forge.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// "admin" has no self-serve signup path (Signup.tsx only offers traveler/
// operator) — it's granted by hand via SQL, see
// supabase/migrations/0002_review_gate_and_admin.sql's header comment.
export type UserRole = "traveler" | "operator" | "admin";

export interface Profile {
  id: string;
  role: UserRole;
  displayName: string;
  businessName?: string | null;
  bio?: string | null;
}

interface SignUpParams {
  email: string;
  password: string;
  role: UserRole;
  displayName: string;
  businessName?: string;
}

interface ProfilePatch {
  displayName?: string;
  businessName?: string | null;
  bio?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (params: SignUpParams) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Starts the Google OAuth flow; returns to `redirectPath` (or home) after. */
  signInWithGoogle: (redirectPath?: string | null) => Promise<void>;
  /** Creates a throwaway guest session (Supabase anonymous auth) — used so a
   *  shopper can chat with support without signing up. Requires anonymous
   *  sign-ins to be enabled in the Supabase project. */
  signInAnonymously: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Emails a password-reset link that returns the user to /reset-password. */
  resetPassword: (email: string) => Promise<void>;
  /** Sets a new password for the currently-authenticated (incl. recovery) session. */
  updatePassword: (password: string) => Promise<void>;
  /** Updates the signed-in user's own profile row (display name, business name, bio). */
  updateProfile: (patch: ProfilePatch) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapProfile(row: {
  id: string;
  role: string;
  display_name: string;
  business_name: string | null;
  bio: string | null;
}): Profile {
  return {
    id: row.id,
    role: row.role === "operator" ? "operator" : row.role === "admin" ? "admin" : "traveler",
    displayName: row.display_name,
    businessName: row.business_name,
    bio: row.bio,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from("profiles").select("id, role, display_name, business_name, bio").eq("id", userId).maybeSingle();
    if (error) {
      console.error("Failed to load profile", error);
      setProfile(null);
      return;
    }
    setProfile(data ? mapProfile(data) : null);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (nextSession?.user) {
        await loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signUp = useCallback(async ({ email, password, role, displayName, businessName }: SignUpParams) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role,
          display_name: displayName,
          business_name: businessName || undefined,
        },
      },
    });
    if (error) throw error;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async (redirectPath?: string | null) => {
    // OAuth is a full-page redirect: Google → back to `redirectTo` (which must
    // be in Supabase's allowed Redirect URLs). A brand-new Google account has
    // no role/business_name from a form, so `handle_new_user` defaults it to a
    // traveler (see supabase/migrations/0012_oauth_profile_names.sql).
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const target = redirectPath && redirectPath.startsWith("/") ? redirectPath : "/";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${origin}${target}` },
    });
    if (error) throw error;
  }, []);

  const signInAnonymously = useCallback(async () => {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      const userId = session?.user?.id;
      if (!userId) throw new Error("You need to be signed in.");
      const row: Record<string, unknown> = {};
      if (patch.displayName !== undefined) row.display_name = patch.displayName;
      if (patch.businessName !== undefined) row.business_name = patch.businessName;
      if (patch.bio !== undefined) row.bio = patch.bio;
      const { error } = await supabase.from("profiles").update(row).eq("id", userId);
      if (error) throw error;
      await loadProfile(userId);
    },
    [session?.user?.id, loadProfile],
  );

  return (
    <AuthContext.Provider
      value={{ user: session?.user ?? null, session, profile, loading, signUp, signIn, signInWithGoogle, signInAnonymously, signOut, resetPassword, updatePassword, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
