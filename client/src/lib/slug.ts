/** Same slug rules the old file-backed store used server-side (server/store.ts, now removed) -- ported to the client since listing writes go straight to Supabase now. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing"
  );
}
