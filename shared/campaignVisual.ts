/**
 * Email campaign visuals (0107) — the layout + optional image, shared by the
 * admin composer's live preview and the server's email builder so the
 * preview always matches what lands in the inbox.
 */

export type CampaignLayout = "title_body" | "title_image_body" | "image_title_body" | "body";

export const CAMPAIGN_LAYOUTS: { value: CampaignLayout; label: string }[] = [
  { value: "title_body", label: "Title · Body" },
  { value: "title_image_body", label: "Title · Image · Body" },
  { value: "image_title_body", label: "Image · Title · Body" },
  { value: "body", label: "Body only" },
];

export interface CampaignVisual {
  layout: CampaignLayout;
  /** Public https image URL (JPEG/PNG — from the campaign image library). */
  imageUrl?: string | null;
  /** Where a click on the image goes (optional). */
  imageLink?: string | null;
  /** Alt text — shown when images are blocked. */
  imageAlt?: string | null;
}

export const layoutHasImage = (l: CampaignLayout) => l === "title_image_body" || l === "image_title_body";
export const layoutHasTitle = (l: CampaignLayout) => l !== "body";

/** The order blocks appear in, top to bottom. */
export function layoutBlocks(l: CampaignLayout): ("title" | "image" | "body")[] {
  switch (l) {
    case "title_image_body":
      return ["title", "image", "body"];
    case "image_title_body":
      return ["image", "title", "body"];
    case "body":
      return ["body"];
    default:
      return ["title", "body"];
  }
}

/** Only https URLs are allowed in an email (image or link). */
export function httpsUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
}
