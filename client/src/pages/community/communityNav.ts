/** Small helpers shared by the revamp.community pages (kept out of CommunityApp to avoid an import cycle). */
import { useLocation } from "wouter";
import { isCommunityHost } from "@/contexts/SiteContext";

/** Pages are indexable only on revamp.community itself (never in a `?site=community` preview). */
export const communityNoindex = () => !isCommunityHost();

/** Go to a section of the home page from anywhere in the community site. */
export function useGoToSection(): (id: string) => void {
  const [location, navigate] = useLocation();
  return (id: string) => {
    const scroll = () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (location === "/") scroll();
    else {
      navigate("/");
      window.setTimeout(scroll, 350);
    }
  };
}
