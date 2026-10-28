/**
 * An Aha AI trip plan, laid out to scan and book (user, 2026-10-28: the old
 * three-paragraph days weren't user friendly). A summary (route, budget, how
 * many places can be booked) + day tabs; each day is a short list of stops,
 * where a stop tied to a real listing shows its card (photo, live price, View /
 * Book). Day 1 is open, the rest fold to one line. "Change anything" sends the
 * plan back to Aha AI with the guest's change.
 *
 * Plans from before stops existed (morning/afternoon/evening text only) still
 * render — each part becomes a stop without a card.
 */
import { FormEvent, useState } from "react";
import { ArrowRight, BedDouble, ChevronDown, Lightbulb, Loader2, Mail, MailCheck, MapPin, Route as RouteIcon, Sparkles, Ticket, Utensils, Wallet } from "lucide-react";
import { Link } from "wouter";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import type { Itinerary, ItineraryDay, ItineraryStop, PlannedPlace, StopTime } from "@/lib/api";

const TIME_LABEL: Record<StopTime, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const TYPE_LABEL: Record<PlannedPlace["type"], string> = { stay: "Stay", eat: "Restaurant", tour: "Tour", experience: "Experience", place: "Place to visit" };
const TYPE_ICON = { stay: BedDouble, eat: Utensils, tour: RouteIcon, experience: Ticket, place: MapPin } as const;

/** A day's stops, or its old morning/afternoon/evening text as stops. */
function stopsOf(day: ItineraryDay): ItineraryStop[] {
  if (day.stops?.length) return day.stops;
  return (["morning", "afternoon", "evening"] as const).filter((t) => day[t]).map((t) => ({ time: t, text: day[t] }));
}

function PlaceCard({ place }: { place: PlannedPlace }) {
  const { format } = useCurrency();
  const Icon = TYPE_ICON[place.type] ?? MapPin;
  const bookable = place.type === "stay" || place.type === "tour" || place.type === "experience";
  const price =
    place.type === "eat" ? place.priceBand :
    place.priceCents && place.priceCents > 0 ? `${format(place.priceCents)} / ${place.priceUnit}` :
    undefined;
  return (
    <Link
      href={`/listing/${place.slug}`}
      className="group flex items-center gap-3 rounded-[14px] border border-basalt/12 bg-paper p-2 pr-3 transition-colors hover:border-basalt/30"
    >
      <span className="relative h-14 w-16 shrink-0 overflow-hidden rounded-[10px] bg-chalk">
        {place.image ? (
          <img src={place.image} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Icon className="absolute inset-0 m-auto h-5 w-5 text-basalt/30" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-5">{place.title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-basalt/55">
          {TYPE_LABEL[place.type]} · {place.city}{price ? ` · ${price}` : ""}
        </span>
      </span>
      <span
        className={cn(
          "inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors",
          bookable ? "border-apricot text-apricot group-hover:bg-apricot group-hover:text-white" : "border-basalt/20 text-basalt/70 group-hover:border-basalt/40",
        )}
      >
        {bookable ? "Book" : "View"}
      </span>
    </Link>
  );
}

function DayCard({ day, places, open, onToggle }: { day: ItineraryDay; places: Record<string, PlannedPlace>; open: boolean; onToggle: () => void }) {
  const stops = stopsOf(day);
  const facts = [`${stops.length} stop${stops.length === 1 ? "" : "s"}`, day.drive, day.base && `sleep in ${day.base}`].filter(Boolean).join(" · ");
  return (
    <section id={`plan-day-${day.day}`} className="scroll-mt-24 border border-basalt/12 bg-paper">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left sm:p-5">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold", open ? "bg-apricot text-white" : "bg-basalt text-paper")}>{day.day}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg leading-tight sm:text-xl">{day.title}</span>
          <span className="mt-0.5 block text-xs text-basalt/55">{facts}</span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-basalt/40 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="border-t border-basalt/10 px-4 pb-5 pt-4 sm:px-5">
          <ol className="grid gap-4">
            {stops.map((s, i) => {
              const place = s.listing ? places[s.listing] : undefined;
              const firstOfTime = i === 0 || stops[i - 1].time !== s.time;
              return (
                <li key={i} className="grid gap-1.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-3">
                  <span className={cn("pt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-apricot", !firstOfTime && "sm:invisible max-sm:hidden")}>{TIME_LABEL[s.time]}</span>
                  <div className="grid gap-2">
                    <p className="text-[15px] leading-6 text-basalt/85">{s.text}</p>
                    {place && <PlaceCard place={place} />}
                    {s.move && i < stops.length - 1 && <p className="text-xs text-basalt/45">↓ {s.move}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {day.tip && (
            <p className="mt-4 flex gap-2 rounded-[10px] bg-chalk px-3 py-2.5 text-[13px] leading-5 text-basalt/65">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-apricot" aria-hidden /> {day.tip}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function TripPlanView({
  itinerary,
  meta,
  revising,
  onRevise,
  onEmail,
}: {
  itinerary: Itinerary;
  /** Small line above the title, e.g. "4 days · balanced · mid-range". */
  meta: string;
  revising: boolean;
  /** Resolves true when the new plan is in (the box then clears). */
  onRevise: (change: string) => Promise<boolean>;
  /** "Email me the full itinerary" — absent when the server can't email plans. */
  onEmail?: (email: string) => Promise<boolean>;
}) {
  const places = itinerary.places ?? {};
  const [open, setOpen] = useState<Set<number>>(() => new Set([itinerary.days[0]?.day ?? 1]));
  const [change, setChange] = useState("");
  // Stays, tours and experiences can be booked; restaurants and places to visit are only shown.
  const bookable = Object.values(places).filter((p) => p.type === "stay" || p.type === "tour" || p.type === "experience").length;
  const route = (itinerary.route ?? []).filter((t, i, a) => i === 0 || t !== a[i - 1]);

  const toggle = (d: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    return next;
  });
  const jumpTo = (d: number) => {
    setOpen((prev) => new Set(prev).add(d));
    requestAnimationFrame(() => document.getElementById(`plan-day-${d}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = change.trim();
    if (!text || revising) return;
    if (await onRevise(text)) setChange("");
  };
  const [email, setEmail] = useState("");
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent">("idle");
  const [sentTo, setSentTo] = useState("");
  const sendEmail = async (e: FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!onEmail || !to || emailState === "sending") return;
    setEmailState("sending");
    const ok = await onEmail(to);
    setEmailState(ok ? "sent" : "idle");
    if (ok) setSentTo(to);
  };

  return (
    <div className={cn("grid gap-3 transition-opacity", revising && "pointer-events-none opacity-50")} aria-busy={revising}>
      {/* Summary */}
      <div className="border border-basalt/12 bg-paper p-5 sm:p-6">
        <p className="text-xs font-semibold text-basalt/50">{meta}</p>
        <h2 className="mt-1.5 font-display text-2xl leading-tight tracking-[-0.02em] sm:text-3xl">{itinerary.tripTitle}</h2>
        {itinerary.summary && <p className="mt-2 max-w-xl text-sm leading-6 text-basalt/60">{itinerary.summary}</p>}
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-basalt/70">
          {route.length > 1 && <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-basalt/15 px-3"><RouteIcon className="h-3.5 w-3.5 text-apricot" aria-hidden /> {route.join(" → ")}</span>}
          {itinerary.estimatedBudget && itinerary.estimatedBudget !== "—" && <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-basalt/15 px-3"><Wallet className="h-3.5 w-3.5 text-apricot" aria-hidden /> {itinerary.estimatedBudget}</span>}
          {bookable > 0 && <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-basalt/15 px-3"><Ticket className="h-3.5 w-3.5 text-apricot" aria-hidden /> {bookable} to book on Revamp</span>}
        </div>
        {itinerary.days.length > 1 && (
          <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Days">
            {itinerary.days.map((d) => (
              <button
                key={d.day}
                type="button"
                onClick={() => jumpTo(d.day)}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors",
                  open.has(d.day) ? "border-apricot bg-apricot text-white" : "border-basalt/15 text-basalt/70 hover:border-basalt/35",
                )}
              >
                Day {d.day}{d.area || d.base ? ` · ${d.area || d.base}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {itinerary.days.map((d) => (
        <DayCard key={d.day} day={d} places={places} open={open.has(d.day)} onToggle={() => toggle(d.day)} />
      ))}

      {itinerary.packingTip && (
        <p className="flex gap-2 px-1 text-[13px] leading-5 text-basalt/60"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-apricot" aria-hidden /> {itinerary.packingTip}</p>
      )}

      {/* Change anything */}
      <form onSubmit={submit} className="border border-basalt/12 bg-chalk p-4 sm:p-5">
        <label htmlFor="plan-change" className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-apricot" aria-hidden /> Change anything</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="plan-change"
            value={change}
            onChange={(e) => setChange(e.target.value)}
            maxLength={300}
            placeholder="Make day 3 slower, add a wine tasting, swap to a hotel…"
            className="h-12 min-w-0 flex-1 rounded-[14px] border border-basalt/15 bg-paper px-4 text-base outline-none focus:border-apricot sm:h-11 sm:text-sm"
          />
          <button type="submit" disabled={revising} className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-full bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90 sm:h-11">
            {revising ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</> : <>Update plan <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </form>

      {/* Email me the full itinerary */}
      {onEmail && (
        <div className="border border-basalt/12 bg-paper p-4 sm:p-5">
          {emailState === "sent" ? (
            <p className="flex items-center gap-2 text-sm"><MailCheck className="h-4 w-4 shrink-0 text-apricot" aria-hidden /> Sent to <span className="font-semibold">{sentTo}</span> — check your inbox. <button type="button" onClick={() => setEmailState("idle")} className="ml-auto min-h-10 shrink-0 text-xs font-semibold text-apricot hover:underline">Send again</button></p>
          ) : (
            <form onSubmit={sendEmail}>
              <label htmlFor="plan-email" className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="h-4 w-4 text-apricot" aria-hidden /> Email me the full itinerary</label>
              <p className="mt-0.5 text-xs text-basalt/50">Every day, with links to book. We won't add you to any mailing list.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="plan-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-12 min-w-0 flex-1 rounded-[14px] border border-basalt/15 bg-paper px-4 text-base outline-none focus:border-apricot sm:h-11 sm:text-sm"
                />
                <button type="submit" disabled={emailState === "sending" || revising} className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-full bg-basalt px-5 text-sm font-semibold text-paper hover:bg-basalt/85 sm:h-11">
                  {emailState === "sending" ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : "Send"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <p className="px-1 text-[11px] text-basalt/40">
        Drafted by Aha AI — prices on the cards are live; timing and the budget are a starting point, not a reservation.
      </p>
    </div>
  );
}
