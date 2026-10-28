/**
 * Account → Saved → "Trip plans" (2026-10-28): the guest's saved Aha AI plans
 * (trip_plans, 0122). Open one on /plan/trip?id=…, or remove it (second tap
 * confirms). Renders nothing until there's at least one plan, so the Saved tab
 * looks the same for guests who never planned a trip.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Map as MapIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { deleteTripPlan, listTripPlans, type SavedTripPlan } from "@/lib/tripPlans";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function TripPlansList() {
  const [plans, setPlans] = useState<SavedTripPlan[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    listTripPlans()
      .then(setPlans)
      .catch((err) => {
        // Before migration 0122 runs the table is missing — just show nothing.
        console.error("[trip-plans] list", err);
        setPlans([]);
      });
  }, []);

  const remove = async (id: string) => {
    if (confirm !== id) return setConfirm(id);
    try {
      await deleteTripPlan(id);
      setPlans((p) => p?.filter((x) => x.id !== id) ?? null);
      toast.success("Trip plan removed.");
    } catch (err) {
      console.error("[trip-plans] delete", err);
      toast("That plan didn't remove just now. Please try again.");
    } finally {
      setConfirm(null);
    }
  };

  if (!plans?.length) return null;

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Trip plans</h2>
        <Link href="/plan" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-apricot hover:underline">Plan another <ArrowRight className="h-4 w-4" /></Link>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {plans.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border border-basalt/12 bg-paper p-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot/10 text-apricot"><MapIcon className="h-5 w-5" aria-hidden /></span>
            <Link href={`/plan/trip?id=${p.id}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold hover:text-apricot">{p.title}</span>
              <span className="block text-xs text-basalt/55">{p.days ? `${p.days} day${p.days === 1 ? "" : "s"} · ` : ""}saved {when(p.updated_at)}</span>
            </Link>
            <button
              type="button"
              onClick={() => void remove(p.id)}
              onBlur={() => setConfirm((c) => (c === p.id ? null : c))}
              className={confirm === p.id ? "min-h-10 shrink-0 px-2 text-xs font-semibold text-destructive" : "grid h-10 w-10 shrink-0 place-items-center text-basalt/40 hover:text-destructive"}
              aria-label={confirm === p.id ? "Tap again to remove" : `Remove ${p.title}`}
            >
              {confirm === p.id ? "Remove?" : <Trash2 className="h-4 w-4" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
