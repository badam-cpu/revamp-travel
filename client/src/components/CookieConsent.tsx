/**
 * Cookie consent banner. Shows once, bottom-left, until the visitor chooses.
 * "Accept all" opts into analytics cookies (Google Analytics) and starts them
 * immediately; "Essential only" keeps just the necessary + anonymous first-party
 * usage. The choice is stored per browser (lib/consent.ts); GA never loads
 * without it (lib/analytics.ts). Renders nothing once a choice exists, or when GA
 * isn't configured at all (no tracker to consent to).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { getConsent, setConsent, type Consent } from "@/lib/consent";
import { analyticsEnabled, initAnalytics, trackPageView } from "@/lib/analytics";

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only prompt when there's actually an analytics tracker to consent to and
    // the visitor hasn't chosen yet.
    if (analyticsEnabled && getConsent() === null) setShow(true);
  }, []);

  if (!show) return null;

  const choose = (v: Consent) => {
    setConsent(v);
    if (v === "all") {
      initAnalytics();
      trackPageView(window.location.pathname + window.location.search);
    }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 sm:left-4 sm:right-auto sm:max-w-sm">
      <div className="brand-notch border border-basalt/15 bg-paper p-5 shadow-[0_20px_55px_rgba(35,35,33,0.18)]">
        <p className="text-sm font-semibold text-basalt">Cookies on Revamp</p>
        <p className="mt-2 text-sm leading-6 text-basalt/60">
          We use essential cookies to run the site and keep you signed in. With your OK, we also use{" "}
          <strong className="font-semibold text-basalt/80">Google Analytics</strong> to understand what's useful. No advertising trackers.{" "}
          <Link href="/privacy" className="font-semibold text-apricot hover:underline">Privacy Policy</Link>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => choose("all")}
            className="rounded-none bg-apricot px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-apricot/90"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={() => choose("essential")}
            className="rounded-none border border-basalt/20 bg-paper px-4 py-2.5 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
          >
            Essential only
          </button>
        </div>
      </div>
    </div>
  );
}
