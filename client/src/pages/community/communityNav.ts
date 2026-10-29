/** Small helpers shared by the revamp.community pages (kept out of CommunityApp to avoid an import cycle). */
import { useLocation } from "wouter";
import { isCommunityHost } from "@/contexts/SiteContext";

/** Pages are indexable only on revamp.community itself (never in a `?site=community` preview). */
export const communityNoindex = () => !isCommunityHost();

/** Go to a section of the home page from anywhere in the community site. */
export function useGoToSection(): (id: string) => void {
  const [location, navigate] = useLocation();
  return (id: string) => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const scroll = (el: HTMLElement) => el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const now = document.getElementById(id);
    if (location === "/" && now) return scroll(now);
    if (location !== "/") navigate("/");
    // The home page loads lazily — wait for the section to exist (up to ~4 s on a slow phone).
    const started = Date.now();
    const tick = () => {
      const el = document.getElementById(id);
      if (el) scroll(el);
      else if (Date.now() - started < 4000) window.setTimeout(tick, 80);
    };
    window.setTimeout(tick, 0);
  };
}
