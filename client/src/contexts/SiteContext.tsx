/**
 * Which Revamp site this build is serving — decided ONCE from the hostname.
 *
 * Both domains serve the SAME build (Netlify domain alias); the app branches
 * on `useSite()` for brand, nav, home page, listing visibility, and the
 * listing-page booking/viewing panel. See REVAMPSTAY-ARCHITECTURE.md §4.
 *
 * ZERO-REGRESSION CONTRACT: the default is "vacations". Any hostname that is
 * not a revampstay.* host — revampvacations.com, localhost, Netlify deploy
 * previews, anything unknown — resolves to "vacations", and a tree that
 * forgot to mount <SiteProvider> also reads "vacations". So until the
 * revampstay.com domain actually exists, behaviour is byte-identical to today.
 */
import { createContext, useContext, type ReactNode } from "react";

export type Site = "vacations" | "stay";

/** Per-site brand facts used by the header/footer/meta. */
export const SITE_BRAND: Record<Site, { name: string; domain: string; crossDomain: string; crossLabel: string }> = {
  vacations: { name: "Revamp Vacations", domain: "revampvacations.com", crossDomain: "revampstay.com", crossLabel: "Staying longer, or buying? revampstay.com" },
  stay: { name: "Revamp Stay", domain: "revampstay.com", crossDomain: "revampvacations.com", crossLabel: "Here for a visit? revampvacations.com" },
};

/**
 * Resolve the site from a hostname. Matches `revampstay.com` and any of its
 * subdomains (www., mcp., …). In local development only, `?site=stay` on the
 * URL forces the stay site so it can be previewed without DNS — this override
 * is compiled out of production builds (`import.meta.env.DEV`).
 */
export function isStayHost(hostname?: string): boolean {
  const host = (hostname ?? (typeof window !== "undefined" ? window.location.hostname : "")).toLowerCase();
  return /(^|\.)revampstay\.(com|test|localhost)$/.test(host);
}

export function detectSite(hostname?: string, search?: string): Site {
  if (isStayHost(hostname)) return "stay";
  // `?site=stay` forces the stay site in ANY environment — a pre-launch preview
  // tool. On a non-revampstay host the stay pages set noindex (see StayHome),
  // and the bot prerenderer/sitemap stay host-based, so this preview is never
  // crawled or indexed. Persists for the SPA session (SiteProvider reads once).
  const qs = search ?? (typeof window !== "undefined" ? window.location.search : "");
  if (new URLSearchParams(qs).get("site") === "stay") return "stay";
  return "vacations";
}

const SiteContext = createContext<Site>("vacations");

export function SiteProvider({ children, site }: { children: ReactNode; site?: Site }) {
  return <SiteContext.Provider value={site ?? detectSite()}>{children}</SiteContext.Provider>;
}

/** The current site. Always "vacations" unless we're on a revampstay.* host. */
export function useSite(): Site {
  return useContext(SiteContext);
}
