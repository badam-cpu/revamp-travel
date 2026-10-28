/** Revamp brandbook: the planner reuses the marketplace's white/orange/charcoal system — no new colors, same rounded geometry. */
import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, Compass, MessageCircle, Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { openAha } from "@/lib/ahaPanel";
import { useVoiceAvailable } from "@/lib/voiceStatus";
import { Link, useLocation, useSearch } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { planTrip, ApiError, type PlanTripParams } from "@/lib/api";
import { readCurrentPlan, writeCurrentPlan } from "@/lib/tripPlans";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { cn } from "@/lib/utils";

const VOICE = !!import.meta.env.VITE_ELEVENLABS_AGENT_ID;
/** Opens the Aha AI panel; it isn't shown to signed-in operators/admins, so say so. */
const openOrNote = (mode: "talk" | "chat") => {
  if (!openAha(mode)) toast("Aha AI's chat and voice are for guests — sign out to try them.");
};

const INTEREST_OPTIONS = ["History & monasteries", "Nature & hiking", "Food & wine", "Adventure", "Relaxation", "Photography"];

type Pace = NonNullable<PlanTripParams["pace"]>;
type Budget = NonNullable<PlanTripParams["budget"]>;

/** One-tap starting points for the text box. */
const EXAMPLES = [
  "A long weekend in Dilijan — forest walks and good food",
  "7 days with two kids: nature, a little history, nothing rushed",
  "5 days for wine and food lovers, comfort budget",
];

export default function Plan() {
  // The guest's own words lead (2026-10-28); the form is "Fine-tune" underneath.
  // Coming back from the plan page ("Edit trip details") keeps their words.
  const [request, setRequest] = useState(() => readCurrentPlan()?.request ?? "");
  const [fineTune, setFineTune] = useState(false);
  const [days, setDays] = useState(6);
  const [startCity, setStartCity] = useState("Yerevan");
  const [travelers, setTravelers] = useState(2);
  const [pace, setPace] = useState<Pace>("balanced");
  const [budget, setBudget] = useState<Budget>("mid-range");
  const [interests, setInterests] = useState<string[]>(["History & monasteries", "Nature & hiking"]);

  const search = useSearch();
  const [, navigate] = useLocation();
  const voiceOk = useVoiceAvailable();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDocumentMeta({
    title: "Plan your Armenia trip with Aha AI | Revamp Vacations",
    description: "Describe your Armenia trip in your own words and Aha AI drafts a day-by-day itinerary with real stays, tables and tours you can book.",
    canonicalPath: "/plan",
  });

  const toggleInterest = (value: string) => {
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  // The plan opens on its own page (/plan/trip, 2026-10-28), kept in the tab's
  // session so it survives a reload or a visit to a listing and back.
  const run = async (params: PlanTripParams) => {
    setLoading(true);
    setError(null);
    try {
      const r = await planTrip(params);
      const n = r.itinerary.days.length;
      const meta = [`${n} day${n === 1 ? "" : "s"}`, params.travelers && `${params.travelers} traveller${params.travelers === 1 ? "" : "s"}`, params.pace, params.budget].filter(Boolean).join(" · ");
      writeCurrentPlan({ planJson: JSON.stringify(r.itinerary), token: r.token, request: params.request, meta });
      navigate("/plan/trip");
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("[plan]", err);
      setError(err instanceof ApiError ? err.message : "Aha AI couldn't build that plan just now. Please try again.");
      setLoading(false);
    }
  };
  const formParams = (): PlanTripParams => ({ days, startCity, travelers, pace, budget, interests });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = request.trim();
    // Words only → Aha AI reads everything from them; with Fine-tune open the
    // chosen details win over the text; no words → the form as before.
    run(text ? { request: text, ...(fineTune ? formParams() : {}) } : formParams());
  };

  // Aha (voice or chat) can open this page with the trip filled in —
  // ?q=5 days of wine and hiking&auto=1, or the fields:
  // ?days=4&from=Dilijan&travelers=2&pace=relaxed&budget=comfort&interests=food,hiking&auto=1 —
  // and `auto` builds the plan straight away.
  useEffect(() => {
    const q = new URLSearchParams(search);
    if (!q.toString()) return;
    const text = (q.get("q") ?? "").trim().slice(0, 600);
    if (text) {
      setRequest(text);
      if (q.get("auto") === "1") run({ request: text });
      return;
    }
    const n = (k: string, min: number, max: number) => {
      const v = Math.round(Number(q.get(k)));
      return Number.isFinite(v) && v >= min ? Math.min(v, max) : undefined;
    };
    const from = q.get("from") ?? "";
    const want = (q.get("interests") ?? "").toLowerCase().split(/[,;]+/).map((w) => w.trim()).filter(Boolean);
    const picked = INTEREST_OPTIONS.filter((opt) => want.some((w) => opt.toLowerCase().includes(w) || w.split(/\s+/).some((x) => x.length > 3 && opt.toLowerCase().includes(x))));
    const params = {
      days: n("days", 1, 21) ?? days,
      startCity: ["Yerevan", "Gyumri", "Dilijan"].find((c) => c.toLowerCase() === from.toLowerCase()) ?? startCity,
      travelers: n("travelers", 1, 20) ?? travelers,
      pace: (["relaxed", "balanced", "packed"] as const).find((p) => p === q.get("pace")) ?? pace,
      budget: (["budget", "mid-range", "comfort"] as const).find((b) => b === q.get("budget")) ?? budget,
      interests: picked.length ? picked : interests,
    };
    setDays(params.days);
    setStartCity(params.startCity);
    setTravelers(params.travelers);
    setPace(params.pace);
    setBudget(params.budget);
    setInterests(params.interests);
    setFineTune(true);
    if (q.get("auto") === "1") run(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const otherWays = [
    { icon: Mic, title: "Talk to Aha AI", text: "Say it out loud — Aha AI plans it and opens it here.", action: "Start talking", onClick: () => openOrNote("talk"), show: VOICE && voiceOk },
    { icon: MessageCircle, title: "Chat with Aha AI", text: "Ask about places, seasons, getting around or booking.", action: "Open chat", onClick: () => openOrNote("chat"), show: true },
    { icon: Compass, title: "In ChatGPT or Claude", text: "Connect Revamp to the assistant you already use.", action: "How it works", href: "/ai", show: true },
  ].filter((o) => o.show);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-10 lg:py-14">
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-apricot"><Sparkles className="h-3.5 w-3.5" /> Plan with Aha AI</div>
        <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[0.95] tracking-[-0.04em] [text-wrap:balance] sm:text-5xl">Plan your Armenia trip with Aha AI.</h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-basalt/60">
          Tell Aha AI about your trip in your own words. You'll get a day-by-day plan with real stays, tables and tours from Revamp that you can book.
        </p>

        <div id="plan-form" className="mt-8 max-w-2xl scroll-mt-24">
          <form onSubmit={submit} className="border border-basalt/12 bg-chalk p-5 sm:p-6">
            <Label htmlFor="trip-request" className="text-base font-semibold">Tell Aha AI about your trip</Label>
            <Textarea
              id="trip-request"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              maxLength={600}
              rows={5}
              placeholder="e.g. 5 days in May with my partner. We love wine, food and easy hikes. Starting in Yerevan, mid-range budget."
              className="mt-2 min-h-[132px] resize-none border-basalt/15 bg-paper text-base leading-6 focus-visible:border-apricot"
            />
            <p className="mt-1.5 text-xs text-basalt/50">Write in any language — Aha AI answers in yours.</p>

            <p className="mt-4 text-xs font-semibold text-basalt/50">Or start from one of these</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setRequest(ex)} className="min-h-10 rounded-full border border-basalt/15 bg-paper px-4 py-2 text-left text-sm leading-5 text-basalt/70 transition-colors hover:border-apricot hover:text-basalt">
                  {ex}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-expanded={fineTune}
              aria-controls="fine-tune"
              onClick={() => setFineTune((v) => !v)}
              className="mt-5 flex min-h-10 w-full items-center justify-between border-t border-basalt/10 pt-4 text-sm font-semibold"
            >
              <span>Fine-tune <span className="font-normal text-basalt/50">· days, travellers, pace, budget</span></span>
              <ChevronDown className={cn("h-4 w-4 text-basalt/50 transition-transform", fineTune && "rotate-180")} />
            </button>

            {fineTune && (
              <div id="fine-tune" className="mt-3 grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="days">Days</Label>
                    <Input id="days" type="number" min={1} max={21} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} className="h-12 rounded-none bg-paper text-base sm:h-10 sm:text-sm" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="travelers">Travellers</Label>
                    <Input id="travelers" type="number" min={1} max={20} value={travelers} onChange={(e) => setTravelers(Number(e.target.value) || 1)} className="h-12 rounded-none bg-paper text-base sm:h-10 sm:text-sm" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="startCity">Starting from</Label>
                    <Select value={startCity} onValueChange={setStartCity}>
                      <SelectTrigger id="startCity" className="h-12 rounded-none bg-paper text-base sm:h-10 sm:text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yerevan">Yerevan</SelectItem>
                        <SelectItem value="Gyumri">Gyumri</SelectItem>
                        <SelectItem value="Dilijan">Dilijan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pace">Pace</Label>
                    <Select value={pace} onValueChange={(v) => setPace(v as Pace)}>
                      <SelectTrigger id="pace" className="h-12 rounded-none bg-paper text-base sm:h-10 sm:text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="relaxed">Relaxed</SelectItem>
                        <SelectItem value="balanced">Balanced</SelectItem>
                        <SelectItem value="packed">Packed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 grid gap-1.5">
                    <Label htmlFor="budget">Budget</Label>
                    <Select value={budget} onValueChange={(v) => setBudget(v as Budget)}>
                      <SelectTrigger id="budget" className="h-12 rounded-none bg-paper text-base sm:h-10 sm:text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="budget">Budget</SelectItem>
                        <SelectItem value="mid-range">Mid-range</SelectItem>
                        <SelectItem value="comfort">Comfort</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block">Interests</Label>
                  <div className="flex flex-wrap gap-2">
                    {INTEREST_OPTIONS.map((opt) => (
                      <button type="button" key={opt} onClick={() => toggleInterest(opt)} className={cn("filter-chip", interests.includes(opt) && "active")}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <Button type="submit" className="mt-5 h-12 w-full rounded-none bg-apricot text-base text-white hover:bg-apricot/90" disabled={loading}>
              {loading ? "Thinking…" : <>Plan my trip <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
            {loading && <p className="mt-2 text-center text-xs text-basalt/45" aria-live="polite">Aha AI is drafting your route — this can take 20–60 seconds for a longer trip. Your plan opens on its own page.</p>}
            {error && !loading && (
              <p className="mt-3 flex items-start gap-2 border border-tuff/40 bg-tuff/10 p-3 text-sm text-basalt/80" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tuff" /> {error}
              </p>
            )}
          </form>
        </div>

        {/* The other ways to plan with Aha AI — Talk and Chat open the Aha AI panel (SupportWidget, via openAha). */}
        <div className="mt-12 border-t border-basalt/10 pt-8">
          <p className="text-sm font-semibold">Other ways to plan</p>
          <div className={cn("mt-4 grid gap-3", otherWays.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            {otherWays.map((o) => (
              <div key={o.title} className="flex gap-3 border border-basalt/12 bg-paper p-4">
                <o.icon className="mt-0.5 h-5 w-5 shrink-0 text-apricot" />
                <div className="flex flex-1 flex-col">
                  <p className="font-semibold">{o.title}</p>
                  <p className="mt-0.5 flex-1 text-sm leading-6 text-basalt/60">{o.text}</p>
                  {o.href ? (
                    <Link href={o.href} className="mt-2 inline-flex min-h-10 items-center gap-1.5 self-start text-sm font-semibold text-apricot hover:underline">{o.action} <ArrowRight className="h-4 w-4" /></Link>
                  ) : (
                    <button type="button" onClick={o.onClick} className="mt-2 inline-flex min-h-10 items-center gap-1.5 self-start text-sm font-semibold text-apricot hover:underline">{o.action} <ArrowRight className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
