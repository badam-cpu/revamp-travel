/**
 * /plan/trip — an Aha AI trip plan on its own page (user, 2026-10-28: the plan
 * should open in a new page; and prompt guests to sign up and save it).
 *
 * The plan on screen comes from sessionStorage (just planned on /plan, so it
 * survives a reload or a visit to a listing and back) or, with ?id=, from the
 * account's saved plans (trip_plans, 0122). Full width for the plan; a side
 * column with Save, Change anything and Email me the full itinerary.
 *
 * Save while signed out: the plan is parked (lib/tripPlans setPendingSave) and
 * the guest goes to sign-up / sign-in with ?redirect=/plan/trip; the
 * <PendingTripSaver /> in App saves it as soon as they're signed in.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, Compass, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ChangePlanForm, EmailPlanForm, TripPlanView } from "@/components/TripPlanView";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { ApiError, emailItinerary, planTrip, type Itinerary } from "@/lib/api";
import { getTripPlan, parsePlan, readCurrentPlan, saveTripPlan, setPendingSave, writeCurrentPlan, type CurrentPlan } from "@/lib/tripPlans";
import { cn } from "@/lib/utils";

export default function TripPlan() {
  const { user, loading: authLoading } = useAuth();
  const signedIn = !!user && !((user as { is_anonymous?: boolean }).is_anonymous === true || !user.email);
  const search = useSearch();
  const [, navigate] = useLocation();
  const savedId = new URLSearchParams(search).get("id");

  const [plan, setPlan] = useState<CurrentPlan | null>(() => (savedId ? null : readCurrentPlan()));
  const [loadState, setLoadState] = useState<"ready" | "loading" | "missing" | "signin">(savedId ? "loading" : "ready");
  const [revising, setRevising] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askSignup, setAskSignup] = useState(false);

  useDocumentMeta({
    title: "Your trip plan | Revamp Vacations",
    description: "Your day-by-day Armenia plan from Aha AI, with stays, tables and tours you can book.",
    canonicalPath: "/plan/trip",
    noindex: true,
  });

  // A saved plan (?id=) — owner-only, so it needs the account.
  useEffect(() => {
    if (!savedId) return;
    if (authLoading) return;
    if (!signedIn) {
      setLoadState("signin");
      return;
    }
    let live = true;
    setLoadState("loading");
    getTripPlan(savedId)
      .then((p) => {
        if (!live) return;
        if (!p) return setLoadState("missing");
        const current = readCurrentPlan();
        // Keep the meta line / unsaved edits if this is the plan already on screen.
        const next = current?.id === p.id ? { ...p, ...current } : p;
        setPlan(next);
        writeCurrentPlan(next);
        setLoadState("ready");
      })
      .catch((err) => {
        console.error("[trip-plan] load", err);
        if (live) setLoadState("missing");
      });
    return () => {
      live = false;
    };
  }, [savedId, signedIn, authLoading]);

  const itinerary: Itinerary | null = useMemo(() => {
    if (!plan) return null;
    try {
      return parsePlan(plan);
    } catch {
      return null;
    }
  }, [plan]);

  const update = (next: CurrentPlan) => {
    setPlan(next);
    writeCurrentPlan(next);
  };

  const revise = async (change: string): Promise<boolean> => {
    if (!plan || !itinerary) return false;
    setRevising(true);
    try {
      const lean = {
        tripTitle: itinerary.tripTitle,
        summary: itinerary.summary,
        route: itinerary.route,
        days: itinerary.days.map(({ day, title, area, base, drive, stops, tip, morning, afternoon, evening }) => (stops?.length ? { day, title, area, base, drive, stops, tip } : { day, title, morning, afternoon, evening, tip })),
        budgetPerPersonAmd: itinerary.budgetPerPersonAmd,
        packingTip: itinerary.packingTip,
      };
      const r = await planTrip({ revise: { plan: JSON.stringify(lean).slice(0, 16000), change } });
      const days = r.itinerary.days.length;
      update({ ...plan, planJson: JSON.stringify(r.itinerary), token: r.token, meta: `${days} day${days === 1 ? "" : "s"}`, dirty: !!plan.id });
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("[trip-plan] revise", err);
      toast(err instanceof ApiError ? err.message : "Aha AI couldn't update the plan just now. Please try again.");
      return false;
    } finally {
      setRevising(false);
    }
  };

  const sendByEmail = async (email: string): Promise<boolean> => {
    if (!plan?.token || !itinerary) return false;
    try {
      await emailItinerary(email, itinerary, plan.token);
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("[trip-plan] email", err);
      toast(err instanceof ApiError ? err.message : "We couldn't send the email just now. Please try again.");
      return false;
    }
  };

  const save = async () => {
    if (!plan) return;
    if (!signedIn || !user) {
      // Parked until they have an account — PendingTripSaver finishes the job.
      setPendingSave(plan);
      setAskSignup(true);
      // On phones the side column sits under the plan — bring the prompt up.
      if (window.innerWidth < 1024) setTimeout(() => document.getElementById("plan-aside")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      return;
    }
    setSaving(true);
    try {
      const id = await saveTripPlan(user.id, plan);
      update({ ...plan, id, dirty: false });
      if (!savedId) navigate(`/plan/trip?id=${id}`, { replace: true });
      toast.success(plan.id ? "Changes saved." : "Saved to your account — find it under Saved.");
    } catch (err) {
      console.error("[trip-plan] save", err);
      toast("Your plan didn't save just now. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const saved = !!plan?.id && !plan.dirty;
  const back = "/plan";

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-6 lg:py-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link href={back} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-basalt/70 hover:text-basalt">
            <ArrowLeft className="h-4 w-4" /> Edit trip details
          </Link>
          {itinerary && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || saved}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors lg:hidden",
                saved ? "border-basalt/15 text-basalt/60" : "border-apricot text-apricot hover:bg-apricot hover:text-white",
              )}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
              {saved ? "Saved" : plan?.dirty ? "Save changes" : "Save trip"}
            </button>
          )}
        </div>

        {loadState === "loading" && (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-basalt/55"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening your plan…</div>
        )}

        {loadState === "signin" && (
          <Empty title="Sign in to see this saved plan" text="Saved trip plans are kept in your account.">
            <Link href={`/login?redirect=${encodeURIComponent(`/plan/trip?id=${savedId}`)}`} className="inline-flex h-11 items-center rounded-full bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90">Sign in</Link>
          </Empty>
        )}

        {(loadState === "missing" || (loadState === "ready" && !itinerary)) && (
          <Empty title="No trip plan here yet" text="Tell Aha AI about your trip and your day-by-day plan will open on this page.">
            <Link href="/plan" className="inline-flex h-11 items-center rounded-full bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90">Plan a trip</Link>
          </Empty>
        )}

        {loadState === "ready" && itinerary && plan && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <TripPlanView itinerary={itinerary} meta={plan.meta || `${itinerary.days.length} day${itinerary.days.length === 1 ? "" : "s"}`} revising={revising} />

            <aside id="plan-aside" className="grid scroll-mt-20 gap-3 lg:sticky lg:top-24">
              {/* Save this trip */}
              <div className="border border-basalt/12 bg-paper p-4">
                {askSignup && !signedIn ? (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold"><Bookmark className="h-4 w-4 text-apricot" aria-hidden /> Keep this plan</p>
                    <p className="mt-1 text-sm leading-6 text-basalt/60">Create an account and we'll save this trip to it, ready to reopen and book from any device.</p>
                    <div className="mt-3 grid gap-2">
                      <Link href={`/signup?redirect=${encodeURIComponent("/plan/trip")}`} className="inline-flex h-11 items-center justify-center rounded-full bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90">Create an account</Link>
                      <Link href={`/login?redirect=${encodeURIComponent("/plan/trip")}`} className="inline-flex h-11 items-center justify-center rounded-full border border-basalt/20 px-5 text-sm font-semibold hover:border-basalt/40">I have an account — sign in</Link>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {saved ? <BookmarkCheck className="h-4 w-4 text-apricot" aria-hidden /> : <Bookmark className="h-4 w-4 text-apricot" aria-hidden />}
                      {saved ? "Saved to your account" : "Save this trip"}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-basalt/60">
                      {saved ? (
                        <>Find it any time under <Link href="/account?tab=saved" className="font-semibold text-apricot hover:underline">Saved</Link>.</>
                      ) : signedIn ? (
                        "Keep it in your account to reopen and book from any device."
                      ) : (
                        "Sign up or sign in to keep it, ready to reopen and book from any device."
                      )}
                    </p>
                    {!saved && (
                      <button type="button" onClick={() => void save()} disabled={saving || revising} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
                        {plan.dirty ? "Save changes" : "Save trip"}
                      </button>
                    )}
                  </>
                )}
              </div>

              <ChangePlanForm revising={revising} onRevise={revise} />
              {plan.token && <EmailPlanForm onEmail={sendByEmail} disabled={revising} defaultEmail={signedIn ? user?.email ?? "" : ""} />}
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function Empty({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-3 text-center">
      <Compass className="h-8 w-8 text-basalt/30" aria-hidden />
      <h1 className="font-display text-2xl">{title}</h1>
      <p className="text-sm leading-6 text-basalt/60">{text}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
