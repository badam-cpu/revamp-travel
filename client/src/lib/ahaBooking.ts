/**
 * Aha Voice Assistant → booking panel bridge. The voice agent's `fill_booking`
 * client tool (AhaVoiceCall) asks the page's booking panel to fill in dates,
 * guests and (tours/experiences) a start time; the panel answers with one
 * sentence Aha says back. Nothing is booked — the guest still taps Book.
 *
 * A window event keeps the call UI and the booking panels decoupled: whichever
 * panel is on the page for that listing (BookingPanel, or the hotel flow in
 * ListingPage) registers a handler with `useAhaFill`.
 */
import { useEffect, useRef } from "react";

export interface AhaFill {
  startDate: string;
  endDate?: string;
  guests?: number;
  /** Tours/experiences: a start time like "08:00" or "10am". */
  time?: string;
}

type Detail = { slug: string; fill: AhaFill; respond: (say: string) => void };
const EVENT = "aha:fill-booking";

/** Ask the page to fill its booking panel; resolves with what Aha should say. */
export function requestAhaFill(slug: string, fill: AhaFill): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const respond = (say: string) => {
      if (done) return;
      done = true;
      resolve(say);
    };
    window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { slug, fill, respond } }));
    setTimeout(() => respond("I can't fill in the booking form on this page — please choose the dates in the booking box."), 1500);
  });
}

/** Register the booking panel for this listing. The latest handler is always used. */
export function useAhaFill(slug: string, handler: (fill: AhaFill) => string, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (!d || d.slug !== slug) return;
      try {
        d.respond(ref.current(d.fill));
      } catch (err) {
        console.error("[aha-fill]", err);
        d.respond("Something went wrong filling in the form — please choose the dates in the booking box.");
      }
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [slug, enabled]);
}

/** "08:00", "8", "8am", "10:30 pm" → minutes after midnight, or null. */
export function parseTime(t?: string): number | null {
  if (!t) return null;
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Briefly draw attention to the booking box after Aha filled it. */
export function revealBookingBox(id = "book") {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("aha-filled");
  setTimeout(() => el.classList.remove("aha-filled"), 2600);
}
