/**
 * Aha Voice Assistant → booking panel bridge. The voice agent's `fill_booking`
 * client tool (AhaVoiceCall) asks the page's booking panel to fill in dates,
 * guests and (tours/experiences) a start time; the panel answers with one
 * sentence Aha says back. Nothing is booked — the guest still taps Book.
 *
 * A window event keeps the call UI and the booking panels decoupled: whichever
 * panel is on the page for that listing (BookingPanel, or the hotel flow in
 * ListingPage) registers a handler with `useAhaFill`.
 *
 * The same bridge carries `show_photo` ("show me the bathroom"): the agent picks
 * photo N from the numbered list in its context and the page opens it
 * (`useAhaPhoto` — stays: the full-screen viewer; tours: the main image).
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

const PHOTO_EVENT = "aha:show-photo";
type PhotoDetail = { slug: string; index: number; respond: (say: string) => void };

/** Ask the page to show photo `index` (0-based); resolves with what Aha should say. */
export function requestAhaPhoto(slug: string, index: number): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const respond = (say: string) => {
      if (done) return;
      done = true;
      resolve(say);
    };
    window.dispatchEvent(new CustomEvent<PhotoDetail>(PHOTO_EVENT, { detail: { slug, index, respond } }));
    setTimeout(() => respond("I can't open photos on this page — the photos are at the top."), 1500);
  });
}

/** Register the page's photo viewer for this listing. */
export function useAhaPhoto(slug: string, handler: (index: number) => string, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<PhotoDetail>).detail;
      if (!d || d.slug !== slug) return;
      try {
        d.respond(ref.current(d.index));
      } catch (err) {
        console.error("[aha-photo]", err);
        d.respond("I couldn't open that photo — the photos are at the top of the page.");
      }
    };
    window.addEventListener(PHOTO_EVENT, on);
    return () => window.removeEventListener(PHOTO_EVENT, on);
  }, [slug, enabled]);
}

/** A date from a voice tool as YYYY-MM-DD ("2026-11-20", "2026-11-20T00:00", "20.11.2026"), else undefined. */
export function isoDay(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  const pad = (n: string) => n.padStart(2, "0");
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return undefined;
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
