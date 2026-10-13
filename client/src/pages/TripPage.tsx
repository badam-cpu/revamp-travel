/**
 * The guest's private trip page — /trip/:token (Customer Journey, migration
 * 0098). Linked from every journey email and text. No sign-in: the token in the
 * link is the credential (server/journey.ts resolves it, service-role). Shows the
 * operator's messages that have actually been sent (check-in / meeting point /
 * checkout…), the address + host phone once the first message is out, and the
 * mid-stay / thank-you survey. Every respondent sees the host's Google /
 * Tripadvisor review links (no review gating); a 1–3 score also gets a
 * "we'd like to make it right" note and the host is alerted.
 * Mobile-first, minimal chrome, never indexed.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, MapPin, Phone, Star, Users } from "lucide-react";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { getTripPage, submitTripSurvey, type TripPageData } from "@/lib/api";
import { RichText } from "@/components/RichText";
import { imgAttrs } from "@/lib/responsiveImg";
import { cn } from "@/lib/utils";

const fmtDay = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-chalk text-basalt">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between">
          <a href="/" className="font-display text-xl font-bold tracking-[-0.03em]">revamp.</a>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-basalt/45">Your trip</span>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="mt-10 text-center text-[11px] text-basalt/40">
          This page is private to you — please don't share the link. · <a href="/" className="font-semibold text-basalt/55 hover:text-apricot">Revamp Vacations</a>
        </footer>
      </div>
    </div>
  );
}

export default function TripPage({ token }: { token: string }) {
  useDocumentMeta({ title: "Your trip | Revamp", description: "Your trip details", canonicalPath: "/trip", noindex: true });
  const [data, setData] = useState<TripPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getTripPage(token)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        console.error("[trip] load", e);
        setError(e instanceof Error ? e.message : "We couldn't open this trip page.");
      });
  }, [token]);
  useEffect(load, [load]);

  if (error) {
    return (
      <Shell>
        <div className="rounded-[14px] border border-basalt/10 bg-paper p-8 text-center">
          <h1 className="font-display text-2xl tracking-[-0.02em]">We couldn't open this page</h1>
          <p className="mt-2 text-sm leading-6 text-basalt/60">{error}</p>
          <p className="mt-4 text-sm text-basalt/60">Your booking itself is safe — you'll find it in your confirmation email.</p>
        </div>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <p className="inline-flex items-center gap-2 text-sm text-basalt/55"><Loader2 className="h-4 w-4 animate-spin" /> Loading your trip…</p>
      </Shell>
    );
  }

  const isStay = data.listing.type === "stay";
  const newestFirst = [...data.messages].reverse();
  const openSurveys = data.surveys;

  return (
    <Shell>
      {/* Header card */}
      <section className="overflow-hidden rounded-[14px] border border-basalt/10 bg-paper">
        {data.listing.image && (
          <img {...imgAttrs(data.listing.image, "(min-width:640px) 576px, 100vw")} alt="" className="aspect-[16/9] w-full object-cover" />
        )}
        <div className="p-5 sm:p-6">
          <p className="text-sm text-basalt/55">Hi {data.guestFirstName},</p>
          <h1 className="mt-1 font-display text-[1.75rem] leading-tight tracking-[-0.03em] [text-wrap:balance]">{data.listing.title}</h1>
          <ul className="mt-4 grid gap-2 text-sm text-basalt/75">
            <li className="flex items-center gap-2.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-apricot" />
              {isStay ? `${fmtDay(data.booking.startDate)} → ${fmtDay(data.booking.endDate)}` : `${fmtDay(data.booking.startDate)}${data.booking.startTime ? ` · ${data.booking.startTime}` : ""}`}
            </li>
            <li className="flex items-center gap-2.5">
              <Users className="h-4 w-4 shrink-0 text-apricot" />
              {data.booking.guests} {data.booking.guests === 1 ? "guest" : "guests"}
              {data.booking.room ? ` · ${data.booking.room}` : ""}
            </li>
          </ul>
          {(data.mapUrl || data.hostPhone) && (
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {data.mapUrl && (
                <a href={data.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[0.875rem] border border-basalt/15 px-4 text-sm font-semibold hover:border-apricot hover:text-apricot">
                  <MapPin className="h-4 w-4" /> Open in Maps
                </a>
              )}
              {data.hostPhone && (
                <a href={`tel:${data.hostPhone.replace(/\s+/g, "")}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[0.875rem] border border-basalt/15 px-4 text-sm font-semibold hover:border-apricot hover:text-apricot">
                  <Phone className="h-4 w-4" /> Call {data.hostName || "your host"}
                </a>
              )}
            </div>
          )}
          {data.address && <p className="mt-3 text-xs text-basalt/50">{data.address}</p>}
        </div>
      </section>

      {/* Surveys first — they're the thing to act on. */}
      {openSurveys.map((s) => (
        <SurveyCard key={s.step} token={token} step={s.step} answered={s.rating} isStay={isStay} hostName={data.hostName} links={data.reviewLinks} onDone={load} />
      ))}

      {/* Messages, newest first */}
      {newestFirst.length === 0 ? (
        <section className="mt-4 rounded-[14px] border border-dashed border-basalt/15 bg-paper/60 p-6 text-sm text-basalt/60">
          Your host's arrival details will appear here before your {isStay ? "check-in" : "experience"}.
        </section>
      ) : (
        newestFirst.map((m) => (
          <article key={m.step} className="mt-4 rounded-[14px] border border-basalt/10 bg-paper p-5 sm:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-apricot">{m.label}</p>
            <h2 className="mt-1.5 font-display text-xl leading-snug tracking-[-0.02em] [text-wrap:balance]">{m.subject}</h2>
            <RichText text={m.body} className="mt-3 whitespace-pre-line text-[15px] leading-7 text-basalt/85" />
          </article>
        ))
      )}
    </Shell>
  );
}

function SurveyCard({
  token,
  step,
  answered,
  isStay,
  hostName,
  links,
  onDone,
}: {
  token: string;
  step: string;
  answered: number | null;
  isStay: boolean;
  hostName: string;
  links: TripPageData["reviewLinks"];
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(answered);
  const [err, setErr] = useState<string | null>(null);
  const mid = step === "midstay";

  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await submitTripSurvey(token, step, rating, comment);
      setResult(r.rating);
      onDone();
    } catch (e) {
      console.error("[trip] survey", e);
      setErr(e instanceof Error ? e.message : "We couldn't save that right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const reviewButtons = [
    ...links.buttons.map((b) => ({ href: b.url, label: `Review on ${b.label}` })),
    ...(links.revamp ? [{ href: links.revamp, label: "Review on Revamp" }] : []),
  ];

  if (result != null) {
    const low = result <= 3;
    return (
      <section className="mt-4 rounded-[14px] border border-basalt/10 bg-paper p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-apricot">Thank you</p>
        <h2 className="mt-1.5 font-display text-xl tracking-[-0.02em]">{low ? "Sorry it wasn't better" : "We're so glad"}</h2>
        <p className="mt-2 text-sm leading-6 text-basalt/70">
          {low
            ? `We've passed your note to ${hostName || "your host"} right away so they can make it right. You can also call them any time.`
            : `Thanks for letting ${hostName || "your host"} know.`}
        </p>
        {reviewButtons.length > 0 && (
          <>
            <p className="mt-4 text-sm text-basalt/70">{mid ? "When your stay is over, you can also share it publicly:" : "Would you share your experience? It helps other travellers a lot."}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {reviewButtons.map((b) => (
                <a key={b.href} href={b.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center rounded-[0.875rem] bg-apricot px-4 text-sm font-semibold text-white hover:bg-apricot/90">
                  {b.label}
                </a>
              ))}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-[14px] border-2 border-apricot/30 bg-paper p-5 sm:p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-apricot">{mid ? "Quick check-in" : "How was it?"}</p>
      <h2 className="mt-1.5 font-display text-xl tracking-[-0.02em]">{mid ? `How's your ${isStay ? "stay" : "time"} going?` : `How was your ${isStay ? "stay" : "experience"}?`}</h2>
      <div className="mt-4 flex gap-1.5" role="radiogroup" aria-label="Your rating, 1 to 5 stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setRating(n)}
            className="grid h-12 w-12 place-items-center rounded-[0.875rem] border border-basalt/12 transition-colors hover:border-apricot focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
          >
            <Star className={cn("h-6 w-6", n <= rating ? "fill-apricot text-apricot" : "text-basalt/30")} />
          </button>
        ))}
      </div>
      <label htmlFor={`survey-${step}`} className="mt-4 block text-sm font-semibold">
        Anything we should know? <span className="font-normal text-basalt/45">(optional)</span>
      </label>
      <textarea
        id={`survey-${step}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={3}
        className="mt-1.5 w-full rounded-[0.875rem] border border-basalt/15 bg-paper px-3 py-2.5 text-base outline-none focus:border-apricot"
        placeholder={mid ? "E.g. the hot water, a late checkout, a restaurant tip…" : "What did you love? What could be better?"}
      />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!rating || busy}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-[0.875rem] bg-apricot px-5 text-sm font-semibold text-white hover:bg-apricot/90 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send"}
      </button>
      <p className="mt-2 text-center text-[11px] text-basalt/45">Only {hostName || "your host"} and Revamp see this.</p>
    </section>
  );
}
