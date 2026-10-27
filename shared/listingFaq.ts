/**
 * Guest FAQ per listing (migration 0118): the host's approved questions and
 * answers. Shown on the listing page, in the crawler HTML + FAQPage JSON-LD, and
 * returned by the AI connector — the knowledge base AI replies build on.
 * Only what the host approved; never anything private (door codes, Wi-Fi).
 */
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_MAX_ITEMS = 12;
export const FAQ_Q_MAX = 140;
export const FAQ_A_MAX = 700;

/** Trimmed, length-capped, non-empty items (at most FAQ_MAX_ITEMS); anything else is dropped. */
export function cleanFaq(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];
  const out: FaqItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const q = typeof (raw as FaqItem).q === "string" ? (raw as FaqItem).q.replace(/\s+/g, " ").trim().slice(0, FAQ_Q_MAX) : "";
    const a = typeof (raw as FaqItem).a === "string" ? (raw as FaqItem).a.trim().slice(0, FAQ_A_MAX) : "";
    if (q && a) out.push({ q, a });
    if (out.length >= FAQ_MAX_ITEMS) break;
  }
  return out;
}
