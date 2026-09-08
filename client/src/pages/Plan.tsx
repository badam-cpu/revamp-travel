/** Revamp brandbook: the planner reuses the marketplace's white/orange/charcoal system — no new colors, same rounded geometry. */
import { FormEvent, useState } from "react";
import { AlertTriangle, Compass, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { planTrip, ApiError, type Itinerary, type PlanTripParams } from "@/lib/api";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { cn } from "@/lib/utils";

const INTEREST_OPTIONS = ["History & monasteries", "Nature & hiking", "Food & wine", "Adventure", "Relaxation", "Photography"];

export default function Plan() {
  const [days, setDays] = useState(6);
  const [startCity, setStartCity] = useState("Yerevan");
  const [travelers, setTravelers] = useState(2);
  const [pace, setPace] = useState<PlanTripParams["pace"]>("balanced");
  const [budget, setBudget] = useState<PlanTripParams["budget"]>("mid-range");
  const [interests, setInterests] = useState<string[]>(["History & monasteries", "Nature & hiking"]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);

  useDocumentMeta({
    title: "AI Trip Planner | Revamp Travel",
    description: "Generate a day-by-day Armenia itinerary grounded in Revamp Travel's live, published catalog.",
    canonicalPath: "/plan",
  });

  const toggleInterest = (value: string) => {
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setItinerary(null);
    try {
      const result = await planTrip({ days, startCity, travelers, pace, budget, interests });
      setItinerary(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong generating that plan. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-apricot"><Sparkles className="h-3.5 w-3.5" /> AI trip planner</div>
        <h1 className="mt-3 max-w-2xl font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">An itinerary built from this catalog.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-basalt/60">
          Tell it how long you have and what you're after — it drafts a day-by-day plan, naming real stays, tables, and tours from the Revamp Travel marketplace where they fit.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <form onSubmit={submit} className="border border-basalt/12 bg-chalk p-6">
            <div className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="days">Trip length (days)</Label>
                <Input id="days" type="number" min={1} max={21} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="startCity">Starting from</Label>
                <Select value={startCity} onValueChange={setStartCity}>
                  <SelectTrigger id="startCity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yerevan">Yerevan</SelectItem>
                    <SelectItem value="Gyumri">Gyumri</SelectItem>
                    <SelectItem value="Dilijan">Dilijan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="travelers">Travelers</Label>
                <Input id="travelers" type="number" min={1} max={20} value={travelers} onChange={(e) => setTravelers(Number(e.target.value) || 1)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pace">Pace</Label>
                <Select value={pace} onValueChange={(v) => setPace(v as PlanTripParams["pace"])}>
                  <SelectTrigger id="pace"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relaxed">Relaxed</SelectItem>
                    <SelectItem value="balanced">Balanced</SelectItem>
                    <SelectItem value="packed">Packed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="budget">Budget level</Label>
                <Select value={budget} onValueChange={(v) => setBudget(v as PlanTripParams["budget"])}>
                  <SelectTrigger id="budget"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="budget">Budget</SelectItem>
                    <SelectItem value="mid-range">Mid-range</SelectItem>
                    <SelectItem value="comfort">Comfort</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Interests</Label>
                <div className="flex flex-wrap gap-2">
                  {INTEREST_OPTIONS.map((opt) => (
                    <button
                      type="button"
                      key={opt}
                      onClick={() => toggleInterest(opt)}
                      className={cn("filter-chip", interests.includes(opt) && "active")}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="submit" className="h-12 rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={loading}>
                {loading ? "Thinking…" : "Generate itinerary"}
              </Button>
              {loading && <p className="text-center text-xs text-basalt/45">This can take 20–60 seconds for a longer trip.</p>}
            </div>
          </form>

          <div className="min-h-[320px]">
            {!itinerary && !error && !loading && (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 border border-dashed border-basalt/20 bg-chalk px-6 py-16 text-center">
                <Compass className="h-8 w-8 text-basalt/30" />
                <p className="max-w-xs text-sm text-basalt/55">Fill in the form and generate a plan — real stays and tours from the catalog will show up in the days.</p>
              </div>
            )}

            {loading && (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 border border-basalt/12 bg-chalk px-6 py-16 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-basalt/20 border-t-apricot" />
                <p className="text-sm text-basalt/55">Drafting a {days}-day route from {startCity}…</p>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start gap-3 border border-tuff/40 bg-tuff/10 p-5 text-sm text-basalt">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-tuff" />
                <div>
                  <p className="font-semibold">Couldn't generate a plan</p>
                  <p className="mt-1 text-basalt/70">{error}</p>
                  {error.toLowerCase().includes("anthropic_api_key") || error.toLowerCase().includes("configured") ? (
                    <p className="mt-2 text-xs text-basalt/50">This is a server setup step, not something you can fix from the browser — see ENVIRONMENT.md.</p>
                  ) : null}
                </div>
              </div>
            )}

            {itinerary && !loading && (
              <div className="border border-basalt/12 bg-paper p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-basalt/10 pb-5">
                  <div>
                    <p className="eyebrow">{days}-day plan · {pace} · {budget}</p>
                    <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">{itinerary.tripTitle}</h2>
                    <p className="mt-2 max-w-lg text-sm text-basalt/60">{itinerary.summary}</p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4">
                  {itinerary.days.map((day) => (
                    <div key={day.day} className="border border-basalt/10 bg-chalk p-5">
                      <div className="flex items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-basalt text-xs font-bold text-paper">{day.day}</span>
                        <h3 className="font-display text-xl">{day.title}</h3>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-apricot">Morning</p><p className="mt-1 text-sm leading-6 text-basalt/75">{day.morning}</p></div>
                        <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-apricot">Afternoon</p><p className="mt-1 text-sm leading-6 text-basalt/75">{day.afternoon}</p></div>
                        <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-apricot">Evening</p><p className="mt-1 text-sm leading-6 text-basalt/75">{day.evening}</p></div>
                      </div>
                      {day.tip && <p className="mt-4 bg-paper px-3 py-2 text-xs text-basalt/60">💡 {day.tip}</p>}
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap justify-between gap-4 border-t border-basalt/10 pt-5 text-sm">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">Estimated budget</p><p className="mt-1 font-semibold">{itinerary.estimatedBudget}</p></div>
                  <div className="max-w-sm"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-basalt/40">Packing tip</p><p className="mt-1 text-basalt/70">{itinerary.packingTip}</p></div>
                </div>
                <p className="mt-5 text-[11px] text-basalt/40">Generated by AI — treat prices and timing as a starting point, not a booked reservation. <Link href="/explore" className="text-apricot hover:underline">See every listing mentioned</Link>.</p>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
