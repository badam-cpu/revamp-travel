/**
 * Canonical stay house-rules catalog — the single source of truth for both the
 * operator form's House rules checklist (Dashboard.tsx) and the highlighted
 * chips on the listing page (ListingPage.tsx). Stored on the listing as a
 * text[] of these exact `label` strings (see migration 0021), mirroring how
 * amenities are stored. `icon` is only used for display.
 */
import { Baby, Ban, Car, CalendarRange, Cigarette, CigaretteOff, KeyRound, Moon, PartyPopper, PawPrint, type LucideIcon } from "lucide-react";

export type HouseRule = { label: string; icon: LucideIcon };

export const HOUSE_RULES: HouseRule[] = [
  { label: "No smoking", icon: CigaretteOff },
  { label: "No pets", icon: PawPrint },
  { label: "No parties or events", icon: PartyPopper },
  { label: "Not suitable for children", icon: Baby },
  { label: "No unregistered guests", icon: Ban },
  { label: "Quiet hours", icon: Moon },
  { label: "Self check-in", icon: KeyRound },
  { label: "Pets allowed", icon: PawPrint },
  { label: "Smoking allowed", icon: Cigarette },
  { label: "Parking available", icon: Car },
  { label: "Long-term stays allowed", icon: CalendarRange },
];

const ICON_BY_LABEL = new Map(HOUSE_RULES.map((r) => [r.label, r.icon]));

/** Icon for a stored house-rule label, or a neutral fallback. */
export function houseRuleIcon(label: string): LucideIcon {
  return ICON_BY_LABEL.get(label) ?? Ban;
}
