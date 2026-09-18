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
 * follow that pattern. `stay` uses the full property-facilities taxonomy
 * operators expect from a PMS/channel-manager onboarding (12 categories);
 * `tour`/`experience` are scaled to what those listings actually offer.
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
 *
 * Incoming values are matched against the curated list loosely (case- and
 * punctuation-insensitive — "wifi"/"Wi Fi"/"WI-FI" all match "Wi-Fi") and,
 * on a match, rewritten to the curated item's exact spelling. This matters
 * for two real sources of messy casing: legacy free-text amenities typed
 * before this component existed, and amenities pulled in by the "prefill
 * from a link" import (server/urlPrefill.ts's JSON-LD reading) — a source
 * page's own wording rarely matches this catalog's casing exactly, and
 * without this, most imported amenities would land as "custom" chips
 * instead of pre-checking the matching box.
 */
import { forwardRef, useImperativeHandle, useState, type KeyboardEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ListingType } from "@shared/listings";

export type AmenityGroup = { category: string; items: string[] };

// Full stay-facilities taxonomy (operator-provided). "Floor" and "Size" are
// omitted deliberately — they're numeric value fields in the source, not
// on/off amenities. Kept as a categorized checklist so the values double as
// filters and JSON-LD facts (see the file header + shared/seo.ts).
const STAY_GROUPS: AmenityGroup[] = [
  {
    category: "Amenities",
    items: [
      "Air Conditioning", "Air Conditioning Central", "Air Conditioning Portable", "Air Conditioning Window",
      "Breakfast included", "Elevator", "Family Friendly", "Fan", "Fire Pit", "Fireplace", "Fitness Room",
      "Floor Carpet", "Floor Hardwood or parquet", "Floor Tile/marble", "Front Desk", "Front Desk 24/7",
      "Game Room", "Heating", "Internet / Wi-Fi", "Iron", "Iron Board", "Living Room", "Meal Delivery",
      "Mosquito net", "No Parking", "Parking", "Parking Garage", "Parking Indoor", "Parking Paid", "Safe",
      "Sitting Area", "Sofa", "Wood Stove",
    ],
  },
  {
    category: "Entertainment",
    items: [
      "Books", "Books and reading material", "Cable TV", "Games", "Laptop friendly space", "Satellite TV",
      "Smart TV", "Streaming Apple TV", "Streaming Chromecast", "Streaming HBO Max", "Streaming Hulu",
      "Streaming Netflix", "Television", "Video Games", "Workspace/Desk",
    ],
  },
  {
    category: "Kitchen",
    items: [
      "Blender", "Coffee Machine Espresso", "Coffee Machine Keurig", "Coffee Machine Nespresso", "Coffee Maker",
      "Dining Room", "Dining Table", "Dining area", "Dishwasher", "Electric kettle", "High Chair",
      "Hot Water Kettle", "Kitchen", "Kitchen Island", "Kitchenette", "Kitchenware", "Microwave", "Mini fridge",
      "Mixer", "Oven", "Refrigerator", "Spices", "Stove", "Toaster", "Wine Glasses", "Wine Opener",
    ],
  },
  {
    category: "Sleeping",
    items: [
      "Closet Racks", "Closet Walk-in", "Crib", "Crib by Request", "Extra Pillow and Blanket", "Linens",
      "Pack and Play", "Pack and Play by Request", "Room-darkening shades", "Towels", "Wardrobe",
    ],
  },
  {
    category: "Outdoor",
    items: [
      "Balcony", "Balcony Shared", "Children's Playground", "Courtyard", "Deck Patio", "Detached", "Garden",
      "Grill/BBQ", "Kayak Canoe", "Lanai Gazebo Covered", "Outdoor Dining area", "Outdoor Kitchen",
      "Outdoor furniture", "Semi-Detached", "Terrace", "Veranda",
    ],
  },
  {
    category: "Location type",
    items: [
      "Beach", "Beach Front", "Downtown", "Forest/Woods", "Golf Course Front", "Gulf Oriented", "Lake",
      "Lake Front", "Mountain", "Near Ocean", "Ocean Front", "Resort", "River", "Rural", "Ski In", "Ski Out",
      "Town", "Village", "Waterfront",
    ],
  },
  {
    // Note: smoking/pets/parties/children *policies* live in the dedicated
    // House rules field (client/src/lib/houseRules.ts), not here.
    category: "Suitability",
    items: [
      "0-2 years", "3-12 years", "13-17 years", "Accessibility Ask", "Business Center", "EV Charger",
      "Must climb stairs", "Private Condo in the Building", "Private entrance", "Single level home",
      "Wheelchair Accessible", "Wheelchair Inaccessible",
    ],
  },
  {
    category: "Pool & beach",
    items: [
      "Beach Chairs", "Beach Essentials", "Beach access", "Community Pool", "Hot Tub Shared", "Indoor Pool",
      "Kid's Pool", "Lazy River", "Massage", "Outdoor Pool (Heated) Shared", "Outdoor Pool (Private)",
      "Outdoor Pool (Unheated) Shared", "Pool Towels", "Private Hot Tub", "Spa Private Pool", "Spa Sauna",
    ],
  },
  {
    category: "Cleaning & safety",
    items: [
      "Carbon monoxide detector", "Cleaning Disinfection", "Cleaning Products", "Daily Housekeeping (free)",
      "Daily Housekeeping (paid)", "Enhanced Cleaning Practices", "Fire Extinguisher", "First Aid Kit",
      "Guest Gap Period 24 Hours", "Guest Gap Period 48 Hours", "Guest Gap Period 72 Hours",
      "Laundromat Coin-based", "Laundromat free of charge", "Luggage drop off Paid", "Luggage drop off FREE",
      "Safety Fireplace guards", "Safety Outlet covers", "Safety Window guards",
      "Security cameras/noise detecting devices", "Self Check-in/Check-out", "Smoke Detector",
    ],
  },
  {
    category: "View",
    items: [
      "Bay View", "Beach View", "Canal View", "City Skyline View", "City View", "Courtyard View", "Desert View",
      "Garden View", "Golf Course View", "Lagoon View", "Lake View", "Marina View", "Monument View",
      "Mountain View", "Ocean View", "Park View", "Partial Ocean View", "Pool View", "River View", "Sea View",
      "Water View",
    ],
  },
  {
    category: "Adventure activities",
    items: [
      "Basketball", "Bicycle", "Bicycles Rental", "Boat", "Bowling", "Casino Nearby", "Foosball", "Golf",
      "Horse Riding/Rental", "Karaoke Nearby", "Mountain Climbing Nearby", "Petanque", "Ping-Pong Table",
      "Pool Table", "Skiing Nearby", "Snow Sports Gear", "Tennis", "Volleyball", "Water Sport Gear",
    ],
  },
  {
    category: "Bathroom amenities",
    items: [
      "Accessible Bathroom", "Bathtub", "Bidet", "Dryer", "Hair dryer", "Hot Water", "Private Bathroom",
      "Private Toilet", "Shampoo", "Shower", "Soap", "Toilet Paper", "Washer",
    ],
  },
];

const TOUR_GROUPS: AmenityGroup[] = [
  { category: "Guiding & hosting", items: ["Local guide", "Driver-guide", "Local host", "Route notes"] },
  { category: "Transport & tickets", items: ["Yerevan transfer", "All transfers", "Tramway ticket", "Water refill"] },
  { category: "Food along the way", items: ["Village lunch", "Family lunch", "Two breakfasts", "Tea stop", "Wine tasting"] },
  { category: "Gear & experience", items: ["Walking poles", "Entrance fees", "Guesthouse night", "Studio visits", "Materials demo"] },
];

const EXPERIENCE_GROUPS: AmenityGroup[] = [
  { category: "Instruction & hosting", items: ["Local instructor", "Local weaver", "Local host", "Small groups"] },
  { category: "Materials & tastings", items: ["All ingredients", "Materials included", "Wine tasting", "Tea & pastries"] },
  { category: "Take-home", items: ["Apron & recipe card", "Take-home spice jar", "Take-home wool sample", "Certificate"] },
  { category: "Logistics", items: ["Hotel pickup", "Yerevan transfer", "Entrance fees"] },
];

const CATALOGS: Partial<Record<ListingType, AmenityGroup[]>> = {
  stay: STAY_GROUPS,
  tour: TOUR_GROUPS,
  experience: EXPERIENCE_GROUPS,
};

export type AmenityPickerHandle = { getValue: () => string[] };

/** Case/punctuation-insensitive key for loose matching against the curated list — "Wi-Fi" and "wifi" both normalize to "wifi". */
function normalizeAmenity(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Groups a listing's selected amenities by the curated catalog categories, for
 * display on the listing page (the "all amenities" modal). Anything not in the
 * catalog falls into a trailing "More" group, so nothing is dropped. Preserves
 * the catalog's category order.
 */
export function groupAmenitiesForDisplay(type: ListingType, values: string[]): AmenityGroup[] {
  const groups = CATALOGS[type] ?? [];
  const catByItem = new Map<string, string>();
  for (const g of groups) for (const it of g.items) catByItem.set(normalizeAmenity(it), g.category);
  const buckets = new Map<string, string[]>();
  for (const v of values) {
    const cat = catByItem.get(normalizeAmenity(v)) ?? "More";
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(v);
  }
  const result: AmenityGroup[] = [];
  for (const g of groups) if (buckets.has(g.category)) result.push({ category: g.category, items: buckets.get(g.category)! });
  if (buckets.has("More")) result.push({ category: "More", items: buckets.get("More")! });
  return result;
}

export const AmenityPicker = forwardRef<AmenityPickerHandle, { type: ListingType; defaultValue: string[] }>(
  function AmenityPicker({ type, defaultValue }, ref) {
    const groups = CATALOGS[type] ?? [];
    const curatedItems = groups.flatMap((g) => g.items);
    const curatedSet = new Set(curatedItems);
    const curatedByNorm = new Map<string, string>();
    for (const item of curatedItems) curatedByNorm.set(normalizeAmenity(item), item);
    /** Rewrites a loose match to the curated item's exact spelling; leaves anything else untouched. */
    const canonicalize = (raw: string) => curatedByNorm.get(normalizeAmenity(raw)) ?? raw;

    const [value, setValue] = useState<string[]>(() => defaultValue.map(canonicalize));
    const [customText, setCustomText] = useState("");
    // The stay catalog is long (12 categories) — show the first few and tuck the
    // rest behind a toggle so the form doesn't become a wall of checkboxes.
    const [expanded, setExpanded] = useState(false);
    const COLLAPSE_AFTER = 4;
    const shownGroups = expanded ? groups : groups.slice(0, COLLAPSE_AFTER);
    const hiddenCount = groups.length - shownGroups.length;

    useImperativeHandle(ref, () => ({ getValue: () => value }), [value]);

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
        .filter(Boolean)
        .map(canonicalize);
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
        {shownGroups.map((group) => (
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

        {groups.length > COLLAPSE_AFTER && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-apricot hover:underline"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            {expanded ? "Show fewer categories" : `Show ${hiddenCount} more ${hiddenCount === 1 ? "category" : "categories"}`}
          </button>
        )}

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
