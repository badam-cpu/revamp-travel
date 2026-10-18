/**
 * Public "Events in Armenia" page (/events): concerts, festivals, sports,
 * conferences, exhibitions and public holidays over the next 12 months, from
 * the weekly-verified `events` table (see shared/eventsPage.ts for the rules).
 * Grouped by month, filterable by kind; every event links its source and a
 * "find a stay for these dates" search. Emits an ItemList of Events +
 * breadcrumbs, and is prerendered for crawlers (server/prerender.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { fetchEvents } from "@/lib/events";
import { cn } from "@/lib/utils";
import { buildBreadcrumbJsonLd } from "@shared/seo";
import {
  EVENTS_PAGE_DESCRIPTION,
  EVENT_FILTERS,
  type EventFilter,
  type PublicEvent,
  addDays,
  buildEventsJsonLd,
  categoryLabel,
  eventArt,
  eventImage,
  eventsPageTitle,
  filterKey,
  formatEventDates,
  groupByMonth,
  safeSourceUrl,
  sourceLabel,
  staysLink,
} from "@shared/eventsPage";

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function Events() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const today = todayIso();
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [filter, setFilter] = useState<EventFilter>("all");

  useEffect(() => {
    let live = true;
    fetchEvents(today, addDays(today, 365)).then((rows) => {
      if (!live) return;
      setEvents(
        rows
          .filter((e) => e.status !== "cancelled" && e.end >= today)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            title: e.title,
            category: e.category,
            city: e.city,
            region: e.region,
            venue: e.venue,
            start: e.start,
            end: e.end,
            summary: e.summary,
            sourceUrl: e.sourceUrl,
            sourceName: e.sourceName,
            image: e.image,
          })),
      );
    });
    return () => {
      live = false;
    };
  }, [today]);

  useDocumentMeta({
    title: eventsPageTitle(today),
    description: EVENTS_PAGE_DESCRIPTION,
    canonicalPath: "/events",
    jsonLd: [
      ...(events && events.length ? [buildEventsJsonLd(origin, events)] : []),
      buildBreadcrumbJsonLd(origin, [
        { name: "Home", path: "/" },
        { name: "Events in Armenia", path: "/events" },
      ]),
    ],
  });

  const present = useMemo(() => new Set((events ?? []).map(filterKey)), [events]);
  const filters = EVENT_FILTERS.filter((f) => present.has(f.key));
  const shown = useMemo(() => (events ?? []).filter((e) => filter === "all" || filterKey(e) === filter), [events, filter]);
  const months = useMemo(() => groupByMonth(shown), [shown]);

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-10 lg:py-14">
        <nav className="flex flex-wrap gap-2 text-xs text-basalt/50" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-apricot">Home</Link>
          <span>›</span>
          <span className="font-semibold text-basalt">Events in Armenia</span>
        </nav>

        <header className="mt-5 max-w-2xl">
          <p className="eyebrow">What's on</p>
          <h1 className="mt-3 font-display text-[3rem] leading-[0.95] tracking-[-0.04em] sm:text-6xl">Events in Armenia</h1>
          <p className="mt-6 text-lg leading-8 text-basalt/85">
            Concerts, festivals, big matches, conferences and public holidays in Yerevan and across Armenia over the next 12 months. Plan your trip
            around one — or know what's on while you're here.
          </p>
        </header>

        {filters.length > 1 && (
          <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Filter events">
            {[{ key: "all" as const, label: "All" }, ...filters].map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  filter === f.key ? "bg-basalt text-paper" : "border border-basalt/15 bg-paper text-basalt/65 hover:border-basalt/30 hover:text-basalt",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8 max-w-4xl">
          {events === null ? (
            <div className="grid gap-3" aria-busy="true" aria-label="Loading events">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse bg-chalk" />
              ))}
            </div>
          ) : months.length === 0 ? (
            <div className="border border-dashed border-basalt/20 bg-chalk/50 px-6 py-12 text-center">
              <p className="font-display text-2xl">We're gathering what's on.</p>
              <p className="mt-2 text-sm text-basalt/60">New events are added every week. Meanwhile, browse <Link href="/explore/tour" className="font-semibold text-apricot hover:underline">tours and experiences</Link>.</p>
            </div>
          ) : (
            months.map((m) => (
              <section key={m.key} aria-labelledby={`m-${m.key}`} className="mt-10 first:mt-0">
                <h2 id={`m-${m.key}`} className="border-b border-basalt/12 pb-2 font-display text-2xl tracking-[-0.02em]">
                  {m.label}
                </h2>
                {m.events.some((e) => e.kind === "event") && (
                  <ul className="divide-y divide-basalt/10">
                    {m.events
                      .filter((e) => e.kind === "event")
                      .map((e) => (
                        <EventRow key={e.id} e={e} />
                      ))}
                  </ul>
                )}
                {/* Holidays & memorial days: one compact line each, so they don't drown out the events. */}
                {m.events.some((e) => e.kind === "holiday") && (
                  <div className={cn("py-4", m.events.some((e) => e.kind === "event") && "border-t border-basalt/10")}>
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Holidays &amp; memorial days</h3>
                    <ul className="mt-2 grid gap-1.5">
                      {m.events
                        .filter((e) => e.kind === "holiday")
                        .map((e) => (
                          <li key={e.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 text-sm sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-x-6">
                            <span className="tabular-nums text-basalt/55">{formatEventDates(e)}</span>
                            <span className="text-basalt/80">
                              {e.title}
                              {e.category === "religious" && <span className="text-basalt/45"> · religious</span>}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </section>
            ))
          )}
        </div>

        <aside className="mt-12 max-w-4xl border border-basalt/12 bg-chalk/40 p-6">
          <h2 className="font-display text-2xl tracking-[-0.02em]">Build a trip around it</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-basalt/65">
            Tell our AI trip planner your dates and it will plan the days around the event — with real stays, tables and tours you can book.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
            <Link href="/plan" className="inline-flex items-center gap-1 text-apricot hover:underline">Plan my trip <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/guide/public-holidays" className="inline-flex items-center gap-1 text-basalt/70 hover:text-apricot">Public holidays explained</Link>
            <Link href="/guide" className="inline-flex items-center gap-1 text-basalt/70 hover:text-apricot">Travel essentials</Link>
          </div>
        </aside>

        <p className="mt-8 max-w-2xl text-xs leading-5 text-basalt/50">
          Events are collected automatically every week from public sources and each one is checked against its own source page. Dates and line-ups can
          change — always confirm with the organiser before you travel. Revamp isn't the organiser and doesn't sell event tickets.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * The event's picture: the organizer's own (from its source page, credited),
 * or Revamp's art for the category when there's none or it fails to load.
 * no-referrer — some sites refuse images requested from other sites.
 */
function EventPicture({ e }: { e: PublicEvent }) {
  const organizer = eventImage(e);
  const [failed, setFailed] = useState(false);
  const useOrganizer = !!organizer && !failed;
  const credit = useOrganizer ? sourceLabel(e) : null;
  return (
    <figure className="relative overflow-hidden rounded-[12px] bg-chalk">
      <img
        src={useOrganizer ? organizer! : eventArt(e)}
        alt={useOrganizer ? e.title : ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="aspect-[16/10] w-full object-cover"
      />
      {credit && (
        <figcaption className="absolute bottom-1.5 right-1.5 max-w-[90%] truncate rounded-full bg-basalt/70 px-2 py-0.5 text-[10px] font-medium text-paper backdrop-blur-sm">
          Image: {credit}
        </figcaption>
      )}
    </figure>
  );
}

function EventRow({ e }: { e: PublicEvent }) {
  const src = safeSourceUrl(e.sourceUrl);
  const srcName = sourceLabel(e);
  const place = [e.venue, e.city].filter(Boolean).join(", ");
  return (
    <li className="grid gap-x-6 gap-y-3 py-5 sm:grid-cols-[132px_minmax(0,1fr)] lg:grid-cols-[132px_minmax(0,1fr)_240px]">
      <p className="text-sm font-semibold tabular-nums text-apricot sm:pt-1">{formatEventDates(e)}</p>
      <div className="order-first sm:order-none sm:col-start-2 sm:max-w-[320px] lg:order-last lg:col-start-3 lg:row-start-1 lg:max-w-none">
        <EventPicture e={e} />
      </div>
      <div className="sm:col-start-2 lg:row-start-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">{categoryLabel(e)}</p>
        <h3 className="mt-1 font-display text-xl leading-snug tracking-[-0.01em]">{e.title}</h3>
        {place && (
          <p className="mt-1 inline-flex items-center gap-1 text-sm text-basalt/60">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {place}
          </p>
        )}
        {e.summary && <p className="mt-2 max-w-[65ch] text-sm leading-6 text-basalt/70">{e.summary}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <Link href={staysLink(e)} className="inline-flex items-center gap-1 font-semibold text-apricot hover:underline">
            Stays for these dates <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          {src && srcName && (
            <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-basalt/55 hover:text-apricot">
              Source: {srcName} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
