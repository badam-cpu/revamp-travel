/**
 * Shown on every page while an admin is signed in as an operator (0093):
 * whose account this is, and the way back. Fixed to the top; it publishes its
 * height as --impersonation-bar so the sticky SiteHeader sits just below it.
 * Only renders when the signed-in user IS the operator in the marker — a stale
 * marker (e.g. the admin signed in some other way) is cleared.
 */
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { clearImpersonation, IMPERSONATION_EVENT, readImpersonation, returnToAdmin, type ImpersonationMarker } from "@/lib/impersonation";

const BAR_HEIGHT = 40;

export function ImpersonationBar() {
  const { user, loading } = useAuth();
  const [marker, setMarker] = useState<ImpersonationMarker | null>(() => readImpersonation());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const sync = () => setMarker(readImpersonation());
    window.addEventListener(IMPERSONATION_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(IMPERSONATION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const active = !!marker && !!user && user.id === marker.operatorId;

  // A marker for someone other than the signed-in user is stale.
  useEffect(() => {
    if (!loading && marker && user && user.id !== marker.operatorId) clearImpersonation();
  }, [loading, marker, user]);

  // Keep the page (and the sticky header) clear of the bar.
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.style.setProperty("--impersonation-bar", `${BAR_HEIGHT}px`);
    document.body.style.paddingTop = `${BAR_HEIGHT}px`;
    return () => {
      root.style.removeProperty("--impersonation-bar");
      document.body.style.paddingTop = "";
    };
  }, [active]);

  if (!active || !marker) return null;

  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[70] flex h-10 items-center justify-center gap-3 bg-basalt px-4 text-sm text-paper">
      <ShieldAlert className="h-4 w-4 shrink-0 text-apricot" aria-hidden="true" />
      <span className="truncate">
        You're signed in as <strong className="font-semibold">{marker.operatorName}</strong>
        <span className="hidden text-paper/60 sm:inline"> · admin access</span>
      </span>
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void returnToAdmin();
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-none bg-apricot px-3 py-1 text-xs font-semibold text-white hover:bg-apricot/90 disabled:opacity-70"
      >
        {leaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Return to admin
      </button>
    </div>
  );
}
