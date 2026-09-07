/**
 * Small shared helper for reading a listing's loosely-typed `facts` array by
 * label. Manage lets hosts type any label they want for the (up to 3) quick
 * facts on a listing, so tours in the wild carry different label sets — the
 * seed data uses "Duration" / "Group" / "Level", a host-added tour might use
 * "Duration" / "Format" instead. Card and detail views both need to read
 * "whichever of these labels exists" without assuming a fixed shape.
 */
import { Listing } from "@/data/listings";

export function factValue(listing: Listing, ...labels: string[]) {
  for (const label of labels) {
    const match = listing.facts.find((fact) => fact.label.toLowerCase() === label.toLowerCase());
    if (match) return match.value;
  }
  return undefined;
}

/** The facts already surfaced by dedicated labels (duration/group/level/format/start), so detail views can show "everything else" separately without repeating them. */
export function otherFacts(listing: Listing) {
  const known = new Set(["duration", "group", "level", "format", "start"]);
  return listing.facts.filter((fact) => !known.has(fact.label.toLowerCase()));
}
