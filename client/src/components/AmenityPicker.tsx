/**
 * Type-aware amenity/inclusion selector for the operator dashboard.
 *
 * Replaces the old free-text "Amenities (comma separated)" input. Research
 * into hospitality SaaS UX (Airbnb's host amenity editor, Booking.com's
 * facilities picker) consistently uses a curated, categorized checklist
 * rather than asking hosts to type — it's faster, it keeps spelling/casing
 * consistent (which matters since amenities double as filters and JSON-LD
 * facts, see shared/seo.ts), and it surfaces options a host might not think
 * to type. Airbnb also groups amenities by category (Essentials, Bathroom,
 * Kitchen and dining, etc.) rather than one flat list — the categories below
 * follow that pattern, scaled down and reworded to match what this catalog's
 * `stay` and `tour` listings actually offer (see shared/listings.ts's seed
 * data, which every curated option here is drawn from).
 *
 * "eat" listings aren't editable from this dashboard at all (they're seeded
 * directly — see ENVIRONMENT.md's SUPABASE_SERVICE_ROLE_KEY note and
 * shared/listings.ts's EDITABLE_LISTING_TYPES), so there's no curated
 * catalog for that type here. If that ever changes, add an "eat" entry to
 * CATALOGS below — until then it correctly falls back to an empty curated
 * list (custom entries still work).
 *
 * Two things this component is careful never to do:
 *  - Silently drop data: a listing's existing `amenities` values that don't
 *    match any curated option (legacy free-text entries, or anything typed
 *    as "custom" here) still show up, as removable chips, so editing an old
 *    listing never loses what an operator already wrote.
 *  - Force the curated list to be exhaustive: the "Add a custom one" field
 *    stays available for anything genuinely specific to one listing.
 *
 * Uncontrolled by design, same as every other field in ListingFormDialog:
 * it owns its own selection state (seeded from `defaultValue`) and exposes
 * the current value imperatively via `ref.getValue()`, read once at submit
 * time — see Dashboard.tsx's `toInputPayload`.
 */
import { forwardRef, useImperativeHandle, useMemo, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ListingType } from "@shared/listings";

type AmenityGroup = { category: string; items: string[] };

const STAY_GROUPS: AmenityGroup[] = [
  { category: "Essentials", items: ["Wi-Fi", "Breakfast", "Breakfast basket", "Kitchenette", "Parking", "Laundry"] },
  {
    category: "Comfort & setting",
    items: ["Wood stove", "Outdoor hearth", "Garden terrace", "Roof terrace", "Shared sauna", "Work tables", "Concierge notes"],
  },
  { category: "Getting around", items: ["Airport transfer", "Local transfers", "Bike hire", "Trail maps", "Lake access"] },
];

const TOUR_GROUPS: AmenityGroup[] = [
  { category: "Guiding & hosting", items: ["Local guide", "Driver-guide", "Local host", "Route notes"] },
  { category: "Transport & tickets", items: ["Yerevan transfer", "All transfers", "Tramway ticket", "Water refill"] },
  { category: "Food along the way", items: ["Village lunch", "Family lunch", "Two breakfasts", "Tea stop", "Wine tasting"] },
  { category: "Gear & experience", items: ["Walking poles", "Entrance fees", "Guesthouse night", "Studio visits", "Materials demo"] },
];

const CATALOGS: Partial<Record<ListingType, AmenityGroup[]>> = {
  stay: STAY_GROUPS,
  tour: TOUR_GROUPS,
};

export type AmenityPickerHandle = { getValue: () => string[] };

export const AmenityPicker = forwardRef<AmenityPickerHandle, { type: ListingType; defaultValue: string[] }>(
  function AmenityPicker({ type, defaultValue }, ref) {
    const [value, setValue] = useState<string[]>(defaultValue);
    const [customText, setCustomText] = useState("");

    useImperativeHandle(ref, () => ({ getValue: () => value }), [value]);

    const groups = CATALOGS[type] ?? [];
    const curatedSet = useMemo(() => new Set(groups.flatMap((g) => g.items)), [groups]);
    const legacy = value.filter((v) => !curatedSet.has(v));

    const toggle = (item: string, checked: boolean) => {
      setValue((prev) => (checked ? [...prev, item] : prev.filter((v) => v !== item)));
    };

    const removeLegacy = (item: string) => {
      setValue((prev) => prev.filter((v) => v !== item));
    };

    const addCustom = () => {
      const additions = customText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (additions.length === 0) return;
      setValue((prev) => {
        const next = [...prev];
        for (const a of additions) if (!next.includes(a)) next.push(a);
        return next;
      });
      setCustomText("");
    };

    const handleCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addCustom();
      }
    };

    return (
      <div className="grid gap-4">
        <Label>{type === "stay" ? "Amenities" : "What's included"}</Label>
        {groups.map((group) => (
          <div key={group.category}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-basalt/45">{group.category}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {group.items.map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm text-basalt">
                  <Checkbox
                    checked={value.includes(item)}
                    onCheckedChange={(checked) => toggle(item, checked === true)}
                    className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
                  />
                  {item}
                </label>
              ))}
            </div>
          </div>
        ))}

        {legacy.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-basalt/45">
              Custom {groups.length > 0 && "(not in the list above)"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {legacy.map((item) => (
                <Badge key={item} variant="outline" className="gap-1 rounded-none border-basalt/20 bg-chalk px-2 py-1 text-basalt/70">
                  {item}
                  <button
                    type="button"
                    onClick={() => removeLegacy(item)}
                    aria-label={`Remove ${item}`}
                    className="text-basalt/40 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={handleCustomKeyDown}
            placeholder={type === "stay" ? "Add a custom amenity" : "Add a custom inclusion"}
            className="h-9 rounded-none text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustom}
            disabled={!customText.trim()}
            className="h-9 shrink-0 rounded-none border-basalt/15 text-xs"
          >
            Add
          </Button>
        </div>
      </div>
    );
  }
);
