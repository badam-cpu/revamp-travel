/**
 * Finishes "Save this trip" after sign-up / sign-in (2026-10-28): a guest who
 * tapped Save while signed out has the plan parked in localStorage
 * (lib/tripPlans setPendingSave); once a real account is signed in — on
 * whatever page they land — it's saved to trip_plans and they get a toast
 * linking to it. Renders nothing.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { hasPendingSave, readCurrentPlan, saveTripPlan, takePendingSave, writeCurrentPlan } from "@/lib/tripPlans";

export function PendingTripSaver() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();
  const busy = useRef(false);
  const signedIn = !!user && !((user as { is_anonymous?: boolean }).is_anonymous === true || !user.email);

  useEffect(() => {
    if (!signedIn || !user || busy.current || !hasPendingSave()) return;
    const pending = takePendingSave();
    if (!pending) return;
    busy.current = true;
    saveTripPlan(user.id, { ...pending, id: undefined })
      .then((id) => {
        const current = readCurrentPlan();
        if (!current || current.planJson === pending.planJson) writeCurrentPlan({ ...pending, id, dirty: false });
        if (location.startsWith("/plan/trip")) navigate(`/plan/trip?id=${id}`, { replace: true });
        toast.success("Your trip plan is saved.", location.startsWith("/plan/trip") ? undefined : { action: { label: "Open", onClick: () => navigate(`/plan/trip?id=${id}`) } });
      })
      .catch((err) => {
        console.error("[trip-plan] pending save", err);
        toast("We couldn't save your trip plan just now — open it again and tap Save.");
      })
      .finally(() => {
        busy.current = false;
      });
  }, [signedIn, user, location, navigate]);

  return null;
}
