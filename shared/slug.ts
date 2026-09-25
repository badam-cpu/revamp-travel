/**
 * Canonical slug rules, shared by the client (listing slugs, Eat landing-page
 * links) and the server (prerender + sitemap for those same pages). Keeping one
 * definition guarantees a link the browser builds and the URL a bot is served
 * resolve to the exact same page — a divergence here would 404 crawlers.
 */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing"
  );
}
