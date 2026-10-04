/**
 * Cookie-consent state (stored per browser). Analytics (Google Analytics 4) only
 * loads once the visitor has accepted — see lib/analytics.ts `initAnalytics()`,
 * which refuses to run without `analyticsAllowed()`. Essential + anonymous
 * first-party usage (sign-in, currency choice, /api/track) runs regardless.
 * Everything is wrapped in try/catch so a blocked localStorage never breaks render.
 */
const KEY = "revamp:cookie-consent";
export const CONSENT_EVENT = "revamp:consent";

export type Consent = "all" | "essential";

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(v: Consent): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: v }));
  } catch {
    /* ignore */
  }
}

/** True once the visitor has opted into analytics cookies. */
export function analyticsAllowed(): boolean {
  return getConsent() === "all";
}
