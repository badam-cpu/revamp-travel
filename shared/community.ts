/**
 * revamp.community — the host community site (migration 0125). Shared by the
 * React pages (client/src/pages/community/*), the bot prerender
 * (server/communityPages.ts) and the news finder (server/communityNews.ts),
 * so labels and page copy are written once.
 */

export const COMMUNITY_ORIGIN = "https://revamp.community";

/**
 * The launch switch for revamp.community. OFF until the site is fully set up
 * (user, 2026-10-29: "no connection on prod until we set up this website
 * entirely"). While false: no "Host community" link in the revampvacations /
 * revampstay footers, and the twice-weekly AI news search doesn't run on its
 * own (Admin → Community → "Find news now" still works, to fill the site
 * before launch). Flip to true at launch.
 */
export const COMMUNITY_LIVE = true;
export const VACATIONS_ORIGIN = "https://revampvacations.com";

export type NewsCategory = "travel" | "rentals" | "booking_sites" | "rules";

export const NEWS_CATEGORIES: { key: NewsCategory; label: string; searchHint: string }[] = [
  { key: "travel", label: "Travel to Armenia", searchHint: "tourism to Armenia: flights to Yerevan, visas and entry rules, visitor numbers, big events, roads and border crossings" },
  { key: "rentals", label: "Short-term rentals", searchHint: "the short-term rental and holiday-home industry: guest trends, pricing, hosting practice, regulation in other countries that hosts follow" },
  { key: "booking_sites", label: "OTA news", searchHint: "changes on Airbnb, Booking.com, Expedia/Vrbo, GetYourGuide, Viator, Tripadvisor that affect hosts and tour operators: fees, policies, search ranking, payouts, new features" },
  { key: "rules", label: "Rules & taxes", searchHint: "rules, registration, licensing and tax for tourism, rentals and guest houses in Armenia" },
];

export function newsCategoryLabel(key: string): string {
  return NEWS_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export interface CommunityNewsItem {
  id: string;
  slug: string;
  category: NewsCategory;
  title: string;
  summary: string;
  forYou: string;
  /** 3–6 specific facts from the article (0127). */
  keyPoints: string[];
  sourceUrl: string;
  sourceName: string;
  /** Free-to-read reports of the same story the digest was also written from (paywalled original, 0128). */
  extraSources: { url: string; name: string }[];
  storyDate: string | null;
  /** When Aha AI last checked the text against the article (0127). */
  verifiedAt: string | null;
  checks: NewsChecks;
  status: "draft" | "published" | "rejected";
  origin: "ai" | "admin";
  publishedAt: string | null;
  createdAt: string;
}

/** What the check against the article found (community_news.checks, admin-facing). */
export interface NewsChecks {
  confirmed?: number;
  corrected?: string[];
  removed?: string[];
  /** Claims whose quoted evidence wasn't found word for word in the article. */
  unconfirmed?: string[];
  /** How the sources were used, e.g. "X's article is only partly free to read — also written from Y." */
  note?: string;
  /** Set when the article couldn't be read or checked; the text was left as it was. */
  failed?: string;
  checkedAt?: string;
}

export interface CommunityMeetup {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  venue: string;
  city: string;
  online: boolean;
  status: "draft" | "published" | "cancelled";
}

export interface CommunityGuide {
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  body: string;
  publishedAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapNewsRow(r: any): CommunityNewsItem {
  return {
    id: r.id,
    slug: r.slug,
    category: r.category,
    title: r.title,
    summary: r.summary ?? "",
    forYou: r.for_you ?? "",
    keyPoints: Array.isArray(r.key_points) ? r.key_points.filter((x: unknown) => typeof x === "string" && x.trim()) : [],
    sourceUrl: r.source_url,
    sourceName: r.source_name ?? "",
    extraSources: Array.isArray(r.extra_sources) ? r.extra_sources.filter((x: any) => x && typeof x.url === "string" && /^https:\/\//.test(x.url)).map((x: any) => ({ url: x.url, name: typeof x.name === "string" && x.name ? x.name : x.url })) : [],
    storyDate: r.story_date ?? null,
    verifiedAt: r.verified_at ?? null,
    checks: r.checks && typeof r.checks === "object" ? r.checks : {},
    status: r.status,
    origin: r.origin ?? "ai",
    publishedAt: r.published_at ?? null,
    createdAt: r.created_at,
  };
}
export function mapMeetupRow(r: any): CommunityMeetup {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    startsAt: r.starts_at,
    venue: r.venue ?? "",
    city: r.city ?? "Yerevan",
    online: !!r.online,
    status: r.status,
  };
}
export function mapGuideRow(r: any): CommunityGuide {
  return { slug: r.slug, category: r.category, title: r.title, excerpt: r.excerpt ?? "", body: r.body ?? "", publishedAt: r.published_at ?? null };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const NEWS_COLS = "id, slug, category, title, summary, for_you, key_points, source_url, source_name, extra_sources, story_date, verified_at, checks, status, origin, published_at, created_at";
export const MEETUP_COLS = "id, title, description, starts_at, venue, city, online, status";
export const GUIDE_COLS = "slug, category, title, excerpt, body, published_at";

/** Partner Hub category labels (hub_articles.category), for public guides. */
export const GUIDE_CATEGORY_LABELS: Record<string, string> = {
  listing_quality: "Listing quality",
  reviews: "Reviews",
  hosting_standards: "Hosting standards",
  local_news: "Local news",
};

/** "12 Nov 2026" (dates are calendar days — read as UTC so they never shift). */
export function formatNewsDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Meetup time in Armenia: "Thu 12 Nov · 19:00". */
export function formatMeetupWhen(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Yerevan" }),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Yerevan" }),
  };
}

export function meetupPlace(m: Pick<CommunityMeetup, "venue" | "city" | "online">): string {
  const where = [m.venue, m.city].filter(Boolean).join(", ");
  if (where && m.online) return `${where} · also online`;
  return where || (m.online ? "Online" : "");
}

/** The source's site name for display when none was given: "skift.com". */
export function sourceLabel(item: Pick<CommunityNewsItem, "sourceName" | "sourceUrl">): string {
  if (item.sourceName.trim()) return item.sourceName.trim();
  try {
    return new URL(item.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

export const COMMUNITY_TITLE = "revamp community — hosts helping hosts in Armenia";
export const COMMUNITY_DESCRIPTION =
  "News for hosts, practical guides, meetups in Yerevan and a place to ask other hosts. For people who host stays, tours and experiences in Armenia.";

export const COMMUNITY_OFFERS: { key: string; title: string; body: string; href: string; cta: string }[] = [
  { key: "news", title: "News for hosts", body: "What changed in travel, rentals and on the OTAs, in plain words, with what it means for you.", href: "/news", cta: "Read the news" },
  { key: "guides", title: "Guides", body: "Short, practical articles: photos that get clicked, answering reviews, hosting standards.", href: "/guides", cta: "Read the guides" },
  { key: "meetups", title: "Meetups", body: "Evenings in Yerevan, and online, to compare notes on pricing, seasons and guests.", href: "/#meetups", cta: "See the dates" },
  { key: "refer", title: "Refer a host", body: "Know someone who hosts? When they get their first confirmed booking on Revamp, you get ֏15,000 in credit.", href: `${VACATIONS_ORIGIN}/dashboard?section=referrals`, cta: "Get my referral link" },
];

export const COMMUNITY_STANDARDS: { title: string; body: string }[] = [
  { title: "Describe your place as it is", body: "Real photos, real sizes, nothing borrowed." },
  { title: "Answer guests quickly", body: "A short reply today beats a perfect one tomorrow." },
  { title: "Respect neighbours", body: "House rules on noise, rubbish and shared spaces." },
  { title: "Help the next host", body: "Share what worked. No selling in the group." },
];

export const COMMUNITY_REVAMP_TOOLS: { title: string; body: string }[] = [
  { title: "Aha AI answers guests", body: "From your listing details, when you haven't replied yet." },
  { title: "Approve from Telegram", body: "New bookings, requests and a morning summary on your phone." },
  { title: "Get paid to your own PayLink", body: "Guests pay you directly; one monthly statement for our commission." },
  { title: "Calendars that stay in sync", body: "Airbnb and Booking.com dates checked every hour." },
  { title: "Virtual tours from your photos", body: "Aha AI sorts them into rooms; you check and publish." },
];

export const COMMUNITY_FAQ: { q: string; a: string }[] = [
  { q: "Do I need to list on Revamp to join?", a: "No. News, guides and meetups are open to anyone who hosts stays, tours or experiences in Armenia, or is thinking about it. The booking tools need a Revamp host account." },
  { q: "Does it cost anything?", a: "No, joining is free." },
  { q: "What will you send me?", a: "Meetup invitations and new guides, a few times a month at most. Every email has an unsubscribe link." },
  { q: "How does the referral credit work?", a: "Share your link from your Revamp dashboard. When the host you invited gets their first confirmed booking, ֏15,000 in credit is added to your account." },
];

export const HOSTS_OPTIONS: { key: "stays" | "tours" | "experiences" | "not_yet"; label: string }[] = [
  { key: "stays", label: "Stays" },
  { key: "tours", label: "Tours" },
  { key: "experiences", label: "Experiences" },
  { key: "not_yet", label: "Not yet, I'm thinking about it" },
];

/** URL-safe slug from a headline + a short unique tail. */
export function newsSlug(title: string, tail: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  const t = tail.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  return `${base || "news"}-${t || "x"}`;
}
