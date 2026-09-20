/**
 * Google Analytics 4 integration, gated by VITE_GA_MEASUREMENT_ID. Loads
 * nothing unless that env var is set (so dev/previews stay clean and there's no
 * hardcoded ID). Because this is a single-page app, GA's automatic page_view
 * only fires on the first load — we disable it and send one manually on every
 * client-side route change (see AnalyticsTracker in App.tsx).
 *
 * To enable: create a GA4 property at analytics.google.com, copy its
 * Measurement ID (G-XXXXXXXXXX), and set VITE_GA_MEASUREMENT_ID in the Netlify
 * build environment. No code change needed.
 */
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

export const analyticsEnabled = Boolean(GA_ID);

let started = false;

export function initAnalytics(): void {
  if (started || !GA_ID || typeof window === "undefined") return;
  started = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  // Official gtag stub pushes the `arguments` object verbatim; cast the type so
  // callers can pass args while the body keeps that exact behavior.
  const gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer.push(arguments);
  } as (...args: unknown[]) => void;
  w.gtag = gtag;
  gtag("js", new Date());
  // SPA: we send page_view ourselves on route change.
  gtag("config", GA_ID, { send_page_view: false });
}

export function trackPageView(path: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!GA_ID || typeof window === "undefined" || typeof w.gtag !== "function") return;
  w.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

/**
 * Fire a custom GA4 event. No-op when analytics is disabled or gtag hasn't
 * loaded, so call sites don't need to guard. Used for the booking funnel:
 * view_item → book_click → begin_checkout → purchase.
 */
export function trackEvent(name: string, params: Record<string, unknown> = {}): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (!GA_ID || typeof window === "undefined" || typeof w.gtag !== "function") return;
  w.gtag("event", name, params);
}
