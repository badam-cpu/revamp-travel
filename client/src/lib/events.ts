/**
 * Upcoming events in Armenia (0102) — read side. Rows are written automatically
 * by server/events.ts (holidays + AI web search, each verified against its
 * source); RLS only returns verified, visible ones to non-admins. A missing
 * table (pre-migration) or any error reads as "no events" — never breaks a page.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type EventImpact = "low" | "medium" | "high";
export interface MarketEvent {
  id: string;
  kind: "holiday" | "event";
  title: string;
  category: string;
  city: string | null;
  region: string | null;
  venue: string | null;
  start: string;
  end: string; // inclusive
  impact: EventImpact;
  expectedAttendance: number | null;
  summary: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  verified: boolean;
  hidden: boolean;
}

type Row = {
  id: string; kind: "holiday" | "event"; title: string; category: string; city: string | null; region: string | null; venue: string | null;
  start_date: string; end_date: string; impact: EventImpact; expected_attendance: number | null; summary: string | null;
  source_url: string | null; source_name: string | null; verified: boolean; hidden: boolean;
};
const map = (r: Row): MarketEvent => ({
  id: r.id, kind: r.kind, title: r.title, category: r.category, city: r.city, region: r.region, venue: r.venue,
  start: r.start_date, end: r.end_date, impact: r.impact, expectedAttendance: r.expected_attendance, summary: r.summary,
  sourceUrl: r.source_url, sourceName: r.source_name, verified: r.verified, hidden: r.hidden,
});

/** Events overlapping [from, to] (inclusive ISO days), soonest first. */
export async function fetchEvents(from: string, to: string): Promise<MarketEvent[]> {
  const { data, error } = await supabase.from("events").select("*").lte("start_date", to).gte("end_date", from).order("start_date").limit(500);
  if (error) {
    console.error("[events] load failed", error.message);
    return [];
  }
  return ((data ?? []) as Row[]).map(map);
}

export function useEvents(from: string, to: string): MarketEvent[] {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  useEffect(() => {
    let live = true;
    fetchEvents(from, to).then((e) => live && setEvents(e));
    return () => {
      live = false;
    };
  }, [from, to]);
  return events;
}

/** Events on one day, for calendar markers. */
export function eventsOn(events: MarketEvent[], day: string): MarketEvent[] {
  return events.filter((e) => e.start <= day && day <= e.end);
}

/** Does this event matter for a listing in `city`? Nationwide (no city) events and same-city ones do. */
export function eventAffects(e: MarketEvent, city: string, region?: string): boolean {
  if (!e.city) return true;
  const c = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return c(e.city) === c(city) || (!!region && c(e.region) === c(region));
}

export const IMPACT_LABEL: Record<EventImpact, string> = { high: "Big demand", medium: "Some demand", low: "Minor" };
