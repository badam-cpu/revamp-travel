/**
 * Home page showcase rows — "Our picks" + one swipeable row per type.
 *
 * Our picks = the admin's pinned slugs (Admin → Site content, in that order),
 * then listings flagged `featured`, then a daily rotation of everything else
 * to fill the row. Type rows (Stays · Tours & experiences · Places to eat) are
 * a daily rotation of that type. Rotation is seeded by the Armenia date, so
 * everyone sees the same lineup on a given day and every listing gets its turn
 * as the catalog grows. Places to visit (free venues) aren't in these rows.
 */
import type { LiveListing } from "@/contexts/ListingsContext";

export const PICKS_MAX = 10;
export const ROW_MAX = 12;
const ROW_MIN = 3;

/** Today in Armenia (UTC+4), e.g. "2026-10-26". */
export function armeniaDay(now = new Date()): string {
  return new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

/** Deterministic shuffle (mulberry32 seeded from a string). */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface HomeRow {
  key: string;
  title: string;
  href: string;
  linkLabel: string;
  items: LiveListing[];
}

const TYPE_ROWS: { key: string; title: string; href: string; linkLabel: string; types: string[] }[] = [
  { key: "stays", title: "Stays", href: "/explore/stay", linkLabel: "See all stays", types: ["stay"] },
  { key: "do", title: "Tours and experiences", href: "/explore/tour", linkLabel: "See all tours", types: ["tour", "experience"] },
  { key: "eat", title: "Places to eat", href: "/explore/eat", linkLabel: "See the Eat guide", types: ["eat"] },
];

export function buildHomeRows(listings: LiveListing[], pinnedSlugs: string[], day = armeniaDay()): { picks: LiveListing[]; rows: HomeRow[] } {
  const showcase = listings.filter((l) => l.type !== "place");
  const pinned = pinnedSlugs.map((s) => showcase.find((l) => l.slug === s)).filter((l): l is LiveListing => Boolean(l));
  const taken = new Set(pinned.map((l) => l.id));
  const flagged = showcase.filter((l) => l.featured && !taken.has(l.id));
  flagged.forEach((l) => taken.add(l.id));
  const rest = seededShuffle(showcase.filter((l) => !taken.has(l.id)), `picks:${day}`);
  const picks = [...pinned, ...flagged, ...rest].slice(0, PICKS_MAX);

  const rows = TYPE_ROWS.map((r) => ({
    key: r.key,
    title: r.title,
    href: r.href,
    linkLabel: r.linkLabel,
    items: seededShuffle(showcase.filter((l) => r.types.includes(l.type)), `${r.key}:${day}`).slice(0, ROW_MAX),
  })).filter((r) => r.items.length >= ROW_MIN);

  return { picks, rows };
}
