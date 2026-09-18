/**
 * Admin-editable site content (home hero image/headline/subcopy, featured
 * listing slugs, and the announcement banner), read from the single-row
 * `site_settings` table (supabase/migrations/0008_site_settings.sql) with the
 * anon key. Publicly readable; only an admin can write it (RLS), which the
 * admin editor on /admin does directly.
 *
 * Every field falls back to the app's hardcoded default when empty, and the
 * whole thing degrades to defaults if Supabase is offline OR the table doesn't
 * exist yet (so deploying this before the migration is run is safe — the site
 * just uses its built-in content until the row is populated).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/** Per-card editorial override for the home "choose the route" section. */
export interface HomeCategoryContent {
  title?: string;
  label?: string;
}
/** Per-region editorial override (keyed by the region's `query` slug). */
export interface HomeRegionContent {
  name?: string;
  label?: string;
}
/** A fully admin-managed region card (name, label, image, and search link). */
export interface HomeRegionCard {
  name: string;
  label: string;
  image?: string;
  query?: string;
}
/** Admin-editable home editorial copy (see migration 0023). All optional —
 * blank fields fall back to the app's built-in defaults in Home.tsx. */
export interface HomeContent {
  categoriesEyebrow?: string;
  categoriesTitle?: string;
  categoriesIntro?: string;
  categories?: Record<string, HomeCategoryContent>;
  editEyebrow?: string;
  editTitle?: string;
  regionsEyebrow?: string;
  regionsTitle?: string;
  regionsIntro?: string;
  regions?: Record<string, HomeRegionContent>;
  regionCards?: HomeRegionCard[];
  mapEyebrow?: string;
  mapTitle?: string;
  mapIntro?: string;
  footerTagline?: string;
  footerSubcopy?: string;
}

export interface SiteSettings {
  heroImage: string;
  heroImages: string[];
  heroHeadline: string;
  heroSubcopy: string;
  featuredSlugs: string[];
  announcementEnabled: boolean;
  announcementMessage: string;
  announcementHref: string;
  /** AMD per 1 USD, admin-set. 0 = AMD display disabled (USD only). */
  usdToAmdRate: number;
  /** Admin-editable home editorial copy (empty {} = all defaults). */
  homeContent: HomeContent;
}

export const EMPTY_SITE_SETTINGS: SiteSettings = {
  heroImage: "",
  heroImages: [],
  heroHeadline: "",
  heroSubcopy: "",
  featuredSlugs: [],
  announcementEnabled: false,
  announcementMessage: "",
  announcementHref: "",
  usdToAmdRate: 0,
  homeContent: {},
};

export const SITE_SETTINGS_COLUMNS =
  "hero_image, hero_images, hero_headline, hero_subcopy, featured_slugs, announcement_enabled, announcement_message, announcement_href, usd_to_amd_rate, home_content";

interface SiteSettingsRow {
  hero_image: string | null;
  hero_images: string[] | null;
  hero_headline: string | null;
  hero_subcopy: string | null;
  featured_slugs: string[] | null;
  announcement_enabled: boolean | null;
  announcement_message: string | null;
  announcement_href: string | null;
  usd_to_amd_rate: number | null;
  home_content: HomeContent | null;
}

export function mapSiteSettingsRow(row: SiteSettingsRow): SiteSettings {
  return {
    heroImage: row.hero_image ?? "",
    heroImages: Array.isArray(row.hero_images) ? row.hero_images.filter(Boolean) : [],
    heroHeadline: row.hero_headline ?? "",
    heroSubcopy: row.hero_subcopy ?? "",
    featuredSlugs: Array.isArray(row.featured_slugs) ? row.featured_slugs : [],
    announcementEnabled: row.announcement_enabled ?? false,
    announcementMessage: row.announcement_message ?? "",
    announcementHref: row.announcement_href ?? "",
    usdToAmdRate: Number(row.usd_to_amd_rate) || 0,
    homeContent: row.home_content && typeof row.home_content === "object" ? row.home_content : {},
  };
}

interface SiteSettingsContextValue {
  settings: SiteSettings;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  settings: EMPTY_SITE_SETTINGS,
  loading: true,
  refresh: async () => {},
});

export const useSiteSettings = () => useContext(SiteSettingsContext);

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(EMPTY_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase.from("site_settings").select(SITE_SETTINGS_COLUMNS).eq("id", 1).maybeSingle();
      if (!error && data) setSettings(mapSiteSettingsRow(data as SiteSettingsRow));
    } catch {
      // Table missing / offline — keep defaults.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <SiteSettingsContext.Provider value={{ settings, loading, refresh }}>{children}</SiteSettingsContext.Provider>;
}
