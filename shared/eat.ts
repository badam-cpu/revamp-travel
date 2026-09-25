/**
 * Shared ordering for the Eat guide + landing pages, so the client and the bot
 * prerenderer sort restaurants identically. Curation order:
 *   1. featured (admin pin) first
 *   2. editor_rank ascending (lower = earlier; unranked sinks to the end)
 *   3. best external rating (Google/Tripadvisor) descending
 *   4. name (stable tiebreak)
 */
export interface EatSortable {
  featured?: boolean;
  editorRank?: number | null;
  googleRating?: number;
  tripadvisorRating?: number;
  title: string;
}

export function bestEatRating(l: EatSortable): number {
  return Math.max(l.googleRating ?? 0, l.tripadvisorRating ?? 0);
}

export function compareEatListings(a: EatSortable, b: EatSortable): number {
  if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
  const ra = a.editorRank ?? null;
  const rb = b.editorRank ?? null;
  if (ra !== rb) {
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  }
  const byRating = bestEatRating(b) - bestEatRating(a);
  if (byRating !== 0) return byRating;
  return (a.title || "").localeCompare(b.title || "");
}
