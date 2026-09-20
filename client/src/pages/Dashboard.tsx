/**
 * Operator dashboard — replaces the old open, unauthenticated /manage panel.
 * Same add/edit/delete listing UX as before (ListingFormDialog/ManageSection
 * carried over from the old Manage.tsx), but now every operator only ever
 * sees and edits their own listings: Row-Level Security enforces this at the
 * database layer (supabase/migrations/0001_init.sql), the `.filter()` below
 * is just what makes the UI show the right subset, not what makes it safe.
 *
 * New listings go through review before they're publicly visible
 * (supabase/migrations/0002_review_gate_and_admin.sql — see AdminReview.tsx
 * for the approve/reject side). An operator can optionally paste a link to
 * an existing listing (Airbnb or otherwise) to pre-fill the form's title
 * and description from that page's own public OpenGraph tags — a starting
 * draft, not a scrape, and it never auto-fills the image field (see the
 * reference-photo note in ListingFormDialog below).
 *
 * The add/edit form is a full-screen, one-section-per-step onboarding flow
 * (ListingFormDialog) modeled on standardized host-onboarding UIs — a takeover
 * surface with big type, a progress bar, and one focused section per screen,
 * rather than a cramped modal. It's still a single uncontrolled <form>: every
 * step stays mounted (just `hidden`), so FormData at submit reads them all;
 * step gating is handled by validateStep(), and the server still Zod-validates.
 */
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarCheck, CalendarClock, Check, ChevronDown, Copy, Home, LayoutDashboard, Link2, List, Pencil, Plus, Settings, Sparkles, Trash2, Wallet, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RequireRole } from "@/components/RequireRole";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListings, LiveListing } from "@/contexts/ListingsContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ListingInput, ListingType } from "@shared/listings";
import { LISTING_LIMITS } from "@shared/listings";
import { ApiError, importListingPrefill, syncIcal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PlaceAutocomplete } from "@/components/PlaceAutocomplete";
import { geocodeQuery } from "@/lib/googleMaps";
import { AmenityPicker, AmenityPickerHandle } from "@/components/AmenityPicker";
import { HouseRulesPicker, HouseRulesPickerHandle } from "@/components/HouseRulesPicker";
import { RoomsEditor, RoomsEditorHandle } from "@/components/RoomsEditor";
import { RatesEditor, RatesEditorHandle } from "@/components/RatesEditor";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { PhotoUploader, PhotoUploaderHandle } from "@/components/PhotoUploader";
import { SearchableMultiSelect, SearchableMultiSelectHandle } from "@/components/SearchableMultiSelect";
import { ListEditor } from "@/components/ListEditor";
import { OperatorBookings } from "@/components/OperatorBookings";
import { PricingCalendar } from "@/components/PricingCalendar";
import { OperatorBookingsTimeline } from "@/components/OperatorBookingsTimeline";
import { OperatorPayouts } from "@/components/OperatorPayouts";
import { OperatorAnalytics } from "@/components/OperatorAnalytics";
import { ProfileTab, SecurityTab } from "@/pages/Account";
import { EXPERIENCE_PREFILL_STORAGE_KEY } from "@/pages/ExperienceOnboarding";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { toast } from "sonner";

// `prefillImageUrl` is display-only — it's carried on the draft purely so
// ListingFormDialog can show a reference thumbnail; toInputPayload() never
// reads it, so it's never written to the listing itself.
type DraftListing = Partial<LiveListing> & { type: ListingType; prefillImageUrl?: string };

function emptyDraft(type: ListingType): DraftListing {
  return {
    type,
    title: "",
    eyebrow: "",
    city: "",
    region: "",
    coordinates: { lat: 40.18, lng: 44.51 },
    shortDescription: "",
    longDescription: "",
    price: 0,
    tags: [],
    facts: [],
    amenities: [],
    accent: type === "tour" ? "apricot" : "sevan",
    image: "",
  };
}

interface RefLists {
  amenities: string[];
  photos: string[];
  itinerary: string[];
  notIncluded: string[];
  whatToBring: string[];
  notSuitableFor: string[];
  houseRules: string[];
  rooms: import("@shared/listings").ListingRoom[];
  seasonalRates: import("@shared/listings").SeasonalRate[];
}

function toInputPayload(draft: DraftListing, form: HTMLFormElement, lists: RefLists): ListingInput {
  const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  const price = Number(get("price")) || 0;
  const tags = get("tags").split(",").map((t) => t.trim()).filter(Boolean);
  // amenities/photos and the searchable lists (notIncluded/whatToBring/
  // notSuitableFor) come from their ref-based pickers, passed in via `lists`.
  // Highlights stays a free-text field; importantInfo a free-text note.
  const { amenities, photos, notIncluded, whatToBring, notSuitableFor, houseRules, rooms, seasonalRates } = lists;
  // Itinerary/highlights come from the ListEditor (ordered) via lists; fall back
  // to the legacy comma-separated field if present.
  const highlights = lists.itinerary.length ? lists.itinerary : get("highlights").split(",").map((t) => t.trim()).filter(Boolean);
  const importantInfo = get("importantInfo").trim();
  // Dedicated tour fields (Duration / Languages) map into the loosely-typed
  // facts array the detail view already reads by label; they take precedence
  // over any same-label quick fact.
  const minStayN = parseInt(get("fact_minstay"), 10);
  const dedicatedFacts = [
    { label: "Property type", value: get("fact_propertytype").trim() },
    { label: "Duration", value: get("tourDuration").trim() },
    { label: "Languages", value: get("tourLanguages").trim() },
    { label: "Starting point", value: get("fact_startpoint").trim() },
    { label: "Check-in", value: get("fact_checkin").trim() },
    { label: "Checkout", value: get("fact_checkout").trim() },
    // Only store a minimum stay of 2+ nights (1 is the default no-op).
    { label: "Minimum stay", value: Number.isFinite(minStayN) && minStayN >= 2 ? `${minStayN} nights` : "" },
  ].filter((f) => f.value);
  const quickFacts = [1, 2, 3, 4, 5, 6]
    .map((n) => ({ label: get(`fact${n}Label`).trim(), value: get(`fact${n}Value`).trim() }))
    .filter((f) => f.label && f.value);
  const facts = [...dedicatedFacts, ...quickFacts.filter((q) => !dedicatedFacts.some((d) => d.label.toLowerCase() === q.label.toLowerCase()))];

  return {
    type: draft.type,
    title: get("title").trim(),
    eyebrow: get("eyebrow").trim(),
    city: get("city").trim(),
    region: get("region").trim(),
    coordinates: { lat: Number(get("lat")) || 0, lng: Number(get("lng")) || 0 },
    // No photos → leave undefined so toRow() falls back to a brand illustration.
    image: photos[0] || undefined,
    gallery: photos.length ? photos : undefined,
    shortDescription: get("shortDescription").trim(),
    longDescription: get("longDescription").trim(),
    price,
    priceLabel: `֏${Math.round(price).toLocaleString()}`,
    priceUnit: get("priceUnit").trim() || (draft.type === "stay" ? "night" : "person"),
    tags,
    facts,
    amenities,
    highlights,
    notIncluded,
    whatToBring,
    importantInfo,
    notSuitableFor,
    featured: (form.elements.namedItem("featured") as HTMLInputElement | null)?.checked || false,
    accent: (get("accent") as ListingInput["accent"]) || "apricot",
    maxGuests: Number(get("maxGuests")) > 0 ? Number(get("maxGuests")) : undefined,
    cancellationPolicy: get("cancellationPolicy") === "non_refundable" ? "non_refundable" : "flexible",
    freeCancelDays: Number(get("freeCancelDays")) >= 0 && get("freeCancelDays") !== "" ? Number(get("freeCancelDays")) : 7,
    nonrefundableDiscountPercent: Number(get("nonrefundableDiscountPercent")) >= 0 && get("nonrefundableDiscountPercent") !== "" ? Number(get("nonrefundableDiscountPercent")) : 5,
    cleaningFeeCents: Number(get("cleaningFee")) > 0 ? Math.round(Number(get("cleaningFee")) * 100) : 0,
    ...(() => {
      const t = get("discountType");
      const type = t === "percent" || t === "amount" ? t : null;
      const raw = Number(get("discountValue")) || 0;
      const value = type === "amount" ? Math.round(raw * 100) : Math.round(raw);
      const start = get("discountStart").trim();
      const end = get("discountEnd").trim();
      const on = !!(type && value > 0 && start && end);
      return {
        discountType: on ? type : null,
        discountValue: on ? value : 0,
        discountStart: on ? start : undefined,
        discountEnd: on ? end : undefined,
      };
    })(),
    houseRules,
    rooms,
    seasonalRates,
    neighborhood: get("neighborhood").trim() || undefined,
  };
}

/** Photos an operator actually uploaded/added — the brand-illustration fallbacks (self-hosted /images or /brand SVGs) don't count, so editing a listing that never had real photos starts the uploader empty. */
function realPhotos(draft: DraftListing): string[] {
  const source = draft.gallery?.length ? draft.gallery : draft.image ? [draft.image] : [];
  return source.filter((u) => u && !u.startsWith("/images/") && !u.startsWith("/brand/"));
}

/** What saving this draft will actually do — differs by whether it's new, awaiting review, or already live. */
function saveOutcome(draft: DraftListing, isEdit: boolean): string {
  if (!isEdit) return "Submit sends it for review; Save as draft keeps it private until you're ready.";
  if (draft.status === "draft" && draft.reviewNote) return "An admin sent this back with feedback — Submit for review resubmits it, or keep editing as a draft.";
  if (draft.status === "draft") return "This is a draft — Submit for review to send it to an admin, or Save as draft to keep working.";
  if (draft.status === "pending") return "Still awaiting review — your changes save as part of that submission (or move it back to a draft).";
  return "This listing is already live — changes save immediately, no re-review needed.";
}

// One focused section per screen. Every field still lives inside the single
// form; steps only control what's visible and the required-field gating.
const STEPS = [
  { title: "The basics", blurb: (t: ListingType) => `Give your ${t} a name and a short label travelers will recognize.` },
  { title: "Where it is", blurb: () => "Pin it on the map of Armenia so travelers can find it." },
  { title: "Describe it", blurb: () => "Tell travelers what makes it worth the trip." },
  { title: "Amenities & pricing", blurb: () => "What's included, the rate, and a few quick facts." },
];
const LAST_STEP = STEPS.length - 1;

/** Roomy, brand-radius field sizing shared across the onboarding inputs. */
const FIELD = "h-12 rounded-none text-base";

// Stay property types offered in the listing form (stored in facts as
// "Property type"; shown in place of the generic "Stay" on the listing page).
const PROPERTY_TYPES = [
  "Apartment", "Condo", "House", "Villa", "Guesthouse", "Cottage", "Cabin",
  "Studio", "Loft", "Hotel", "Boutique hotel", "Bed & breakfast", "Hostel",
  "Private room", "Chalet", "Farm stay", "Townhouse",
];

/**
 * Per-type example [label, value] pairs for the Quick facts placeholders, so
 * the hints match the listing type (a tour/experience shows Duration/Group
 * size/Meeting point, not a stay's "Sleeps / 2 guests"). Placeholders only —
 * operators still type whatever free-form facts they want.
 */
/** Curated options for the searchable multi-select fields on tour/experience listings. Operators can still add their own via the picker's "add" row. */
const NOT_INCLUDED_OPTIONS = [
  "Hotel pickup", "Hotel drop-off", "Gratuities", "Food and drinks", "Alcoholic beverages", "Entrance fees",
  "Transport to the meeting point", "Travel insurance", "Personal expenses", "Additional materials", "Souvenirs",
];
const WHAT_TO_BRING_OPTIONS = [
  "Comfortable walking shoes", "Comfortable clothing", "Weather-appropriate clothing", "Sun protection", "Hat", "Sunglasses",
  "Water bottle", "Camera", "Cash for extras", "Passport or ID", "Light jacket", "Snacks",
];
const NOT_SUITABLE_FOR_OPTIONS = [
  "People with mobility impairments", "Wheelchair users", "People with heart conditions", "People with altitude sickness",
  "Pregnant women", "Babies under 1 year", "Children under 10 years", "People over 70 years", "People with back problems",
];

const FACT_EXAMPLES: Record<ListingType, [string, string][]> = {
  stay: [["Sleeps", "2 guests"], ["Setting", "Forest edge"], ["Best for", "Slow weekends"], ["Check-in", "3 PM"], ["Parking", "On site"], ["Breakfast", "Included"]],
  tour: [["Duration", "6 hours"], ["Group", "Up to 8"], ["Level", "Easy"], ["Starts", "Yerevan"], ["Season", "May–Oct"], ["Languages", "EN / RU"]],
  experience: [["Duration", "3 hours"], ["Group size", "Up to 8"], ["Meeting point", "Republic Square"], ["Languages", "EN / RU / HY"], ["Skill level", "Beginner"], ["Ages", "12+"]],
  eat: [["Cuisine", "Modern Armenian"], ["Service", "Lunch & dinner"], ["Setting", "Garden courtyard"], ["Seats", "40"], ["Booking", "Recommended"], ["Signature", "Lamb khorovats"]],
};

function ListingFormDialog({
  draft,
  open,
  onOpenChange,
  onSaved,
}: {
  draft: DraftListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { createListing, updateListing } = useListings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const amenitiesRef = useRef<AmenityPickerHandle>(null);
  const houseRulesRef = useRef<HouseRulesPickerHandle>(null);
  const roomsRef = useRef<RoomsEditorHandle>(null);
  const ratesRef = useRef<RatesEditorHandle>(null);
  const { settings: siteSettings } = useSiteSettings();
  const photosRef = useRef<PhotoUploaderHandle>(null);
  const notIncludedRef = useRef<SearchableMultiSelectHandle>(null);
  const whatToBringRef = useRef<SearchableMultiSelectHandle>(null);
  const notSuitableForRef = useRef<SearchableMultiSelectHandle>(null);
  // Ordered tour/experience itinerary (stored in `highlights`).
  const [itinerary, setItinerary] = useState<string[]>(draft?.highlights ?? []);
  const draftId = draft?.id;
  // Reset to the first step whenever the dialog (re)opens or a different draft loads.
  useEffect(() => {
    setStep(0);
    setStepError(null);
    setError(null);
    setItinerary(draft?.highlights ?? []);
  }, [open, draftId]);
  if (!draft) return null;
  const isEdit = Boolean(draft.id);
  const isLast = step === LAST_STEP;
  // A published listing stays published on edit (no draft/submit toggle).
  const isPublished = draft.status === "published";

  // Google Places autocomplete fills the uncontrolled fields imperatively.
  const setField = (name: string, value: string) => {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
    if (el) el.value = value;
  };

  const fieldValue = (name: string) =>
    ((formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "").trim();
  const fail = (message: string): boolean => {
    setStepError(message);
    return false;
  };

  // Per-step required checks (native validation is off — hidden steps can't be
  // focused, so we gate progression ourselves; the server still Zod-validates).
  const validateStep = (s: number): boolean => {
    if (s === 0 && (!fieldValue("title") || !fieldValue("eyebrow"))) return fail("Add a title and an eyebrow label to continue.");
    if (s === 1) {
      if (!fieldValue("city") || !fieldValue("region")) return fail("Add the city and region.");
      const lat = Number(fieldValue("lat"));
      const lng = Number(fieldValue("lng"));
      if (!fieldValue("lat") || !fieldValue("lng") || Number.isNaN(lat) || Number.isNaN(lng)) return fail("Add the latitude and longitude.");
      if (lat < 38 || lat > 42 || lng < 43 || lng > 47) return fail("Coordinates must be inside Armenia (lat 38–42, lng 43–47).");
    }
    if (s === 2 && (!fieldValue("shortDescription") || !fieldValue("longDescription"))) return fail("Add a short and a full description.");
    if (s === 3 && !(Number(fieldValue("price")) > 0)) return fail("Set a price greater than ֏0.");
    setStepError(null);
    return true;
  };

  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateStep(step)) return;
    if (!isLast) {
      setStepError(null);
      setStep((s) => s + 1);
      return;
    }
    persist(true);
  };

  // Persist the listing. submitForReview=true → "pending" (into the review
  // queue); false → "draft" (saved privately, not submitted). Both need a
  // complete, valid form because the listing columns are NOT NULL / checked —
  // a draft is "finished but not submitted", not a half-filled row.
  const persist = async (submitForReview: boolean) => {
    const form = formRef.current;
    if (!form || !validateStep(step)) return;
    setSaving(true);
    setError(null);
    try {
      const payload = toInputPayload(draft, form, {
        amenities: amenitiesRef.current?.getValue() ?? [],
        photos: photosRef.current?.getValue() ?? [],
        itinerary,
        notIncluded: notIncludedRef.current?.getValue() ?? [],
        whatToBring: whatToBringRef.current?.getValue() ?? [],
        notSuitableFor: notSuitableForRef.current?.getValue() ?? [],
        houseRules: houseRulesRef.current?.getValue() ?? [],
        rooms: roomsRef.current?.getValue() ?? [],
        seasonalRates: ratesRef.current?.getValue() ?? [],
      });

      // Keep the map pin (and the nearby-sights it drives) in sync with the
      // address: if the operator changed the city/region text but didn't move
      // the pin (no autocomplete pick / manual coordinate edit), geocode the new
      // location and use that instead. Autocomplete/manual coord changes are
      // trusted as-is (they're more precise than a city-level geocode).
      const cityRegionChanged = payload.city !== (draft.city ?? "") || payload.region !== (draft.region ?? "");
      const coordsChanged = payload.coordinates.lat !== draft.coordinates?.lat || payload.coordinates.lng !== draft.coordinates?.lng;
      if (cityRegionChanged && !coordsChanged && payload.city && payload.region) {
        const geo = await geocodeQuery(`${payload.city}, ${payload.region}, Armenia`);
        if (geo) payload.coordinates = geo;
      }
      if (isEdit && draft.id) {
        await updateListing(draft.id, payload, submitForReview);
        toast(submitForReview ? `${payload.title} submitted for review.` : `${payload.title} saved as a draft.`);
      } else {
        await createListing(payload, submitForReview);
        toast(submitForReview ? `${payload.title} submitted for review.` : `${payload.title} saved as a draft.`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't save this listing. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const meta = STEPS[step];
  const pct = ((step + 1) / STEPS.length) * 100;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-basalt/25 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-paper text-basalt outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2"
          aria-describedby={undefined}
        >
          {/* Top bar — brand + save & exit */}
          <header className="flex items-center justify-between border-b border-basalt/10 px-4 py-3.5 sm:px-8">
            <BrandMark />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-2 rounded-none border border-basalt/15 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/65 transition-colors hover:border-apricot hover:text-apricot"
            >
              Exit <X className="h-3.5 w-3.5" />
            </button>
          </header>

          {/* Scrollable middle — one section per screen */}
          <div className="flex-1 overflow-y-auto">
            <form ref={formRef} noValidate onSubmit={submit} id="listing-onboarding" className="mx-auto w-full max-w-2xl px-5 py-10 sm:px-8 sm:py-16">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-apricot">
                {isEdit ? `Editing ${draft.type}` : `New ${draft.type}`} · Step {step + 1} of {STEPS.length}
              </p>
              <DialogPrimitive.Title asChild>
                <h2 className="mt-3 font-display text-4xl leading-[1.02] tracking-[-0.03em] sm:text-5xl">{meta.title}</h2>
              </DialogPrimitive.Title>
              <p className="mt-3 max-w-md text-base leading-7 text-basalt/55">{meta.blurb(draft.type)}</p>

              {/* Step 1 — the basics */}
              <div hidden={step !== 0} className="mt-10 grid gap-6">
                {draft.prefillImageUrl && (
                  <div className="flex items-start gap-3 border border-basalt/10 bg-chalk p-3">
                    <img src={draft.prefillImageUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                    <p className="text-xs leading-5 text-basalt/55">
                      Reference photo from the link you pasted — shown for reference only, it won't be saved. Add your own hosted photo URL on the last step (or leave it blank for a brand illustration).
                    </p>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="title" className="text-sm font-semibold">Title</Label>
                  <Input id="title" name="title" maxLength={LISTING_LIMITS.title} placeholder="e.g. Forest House Dilijan" defaultValue={draft.title} className={FIELD} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="eyebrow" className="text-sm font-semibold">Eyebrow label</Label>
                  <Input id="eyebrow" name="eyebrow" maxLength={LISTING_LIMITS.eyebrow} placeholder="e.g. Timber hideaway" defaultValue={draft.eyebrow} className={FIELD} />
                  <p className="text-xs text-basalt/45">A short kicker (max {LISTING_LIMITS.eyebrow} characters) shown above the title on cards — not a full sentence.</p>
                </div>
                <div className="grid gap-2 sm:max-w-[16rem]">
                  <Label htmlFor="accent" className="text-sm font-semibold">Map marker color</Label>
                  <Select name="accent" defaultValue={draft.accent}>
                    <SelectTrigger id="accent" className="h-12 rounded-none text-base"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apricot">Apricot</SelectItem>
                      <SelectItem value="sevan">Charcoal</SelectItem>
                      <SelectItem value="tuff">Tuff</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-basalt/45">The color of this listing's pin on the atlas.</p>
                </div>
              </div>

              {/* Step 2 — where it is */}
              <div hidden={step !== 1} className="mt-10 grid gap-6">
                {/* Optional Google Places autofill — self-gates: renders nothing
                    unless VITE_GOOGLE_MAPS_API_KEY is set. Only ever sets the
                    fields below; the operator can still edit each by hand. */}
                <PlaceAutocomplete
                  onSelect={(place) => {
                    if (place.city) setField("city", place.city);
                    if (place.region) setField("region", place.region);
                    if (typeof place.lat === "number") setField("lat", String(place.lat));
                    if (typeof place.lng === "number") setField("lng", String(place.lng));
                  }}
                />
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="city" className="text-sm font-semibold">City</Label>
                    <Input id="city" name="city" placeholder="e.g. Yerevan" defaultValue={draft.city} className={FIELD} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="region" className="text-sm font-semibold">Region</Label>
                    <Input id="region" name="region" placeholder="e.g. Kotayk" defaultValue={draft.region} className={FIELD} />
                  </div>
                </div>
                {/* Coordinates are technical, so they live here as a quiet,
                    auto-filled sub-section rather than two prominent inputs:
                    picking an address above fills them in; an operator only
                    touches them to nudge the pin. */}
                <div className="grid gap-3 border border-basalt/10 bg-chalk/60 p-4">
                  <div>
                    <p className="text-sm font-semibold">Map coordinates</p>
                    <p className="mt-1 text-xs leading-5 text-basalt/50">
                      Filled in automatically when you pick an address above — they drop your listing's pin on the Armenia atlas. You only need to adjust these if the pin looks slightly off. Must fall inside Armenia (latitude 38–42, longitude 43–47).
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="lat" className="text-xs font-semibold text-basalt/60">Latitude</Label>
                      <Input id="lat" name="lat" type="number" step="0.0001" min={38} max={42} defaultValue={draft.coordinates?.lat} className="h-11 rounded-none" />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="lng" className="text-xs font-semibold text-basalt/60">Longitude</Label>
                      <Input id="lng" name="lng" type="number" step="0.0001" min={43} max={47} defaultValue={draft.coordinates?.lng} className="h-11 rounded-none" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 — describe it */}
              <div hidden={step !== 2} className="mt-10 grid gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="shortDescription" className="text-sm font-semibold">Short description</Label>
                  <Textarea id="shortDescription" name="shortDescription" maxLength={LISTING_LIMITS.shortDescription} rows={2} placeholder="One or two lines shown on cards." defaultValue={draft.shortDescription} className="rounded-none text-base" />
                  <p className="text-xs text-basalt/45">Max {LISTING_LIMITS.shortDescription} characters — a tight one or two lines for cards.</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="longDescription" className="text-sm font-semibold">Full description</Label>
                  <Textarea id="longDescription" name="longDescription" rows={5} placeholder="The full write-up shown on the listing page." defaultValue={draft.longDescription} className="rounded-none text-base" />
                </div>
                {draft.type === "stay" && (
                  <div className="grid gap-2">
                    <Label htmlFor="neighborhood" className="text-sm font-semibold">Describe the neighborhood <span className="font-normal text-basalt/45">(optional)</span></Label>
                    <Textarea id="neighborhood" name="neighborhood" rows={3} placeholder="What's the area like — the street, the vibe, what's within a short walk?" defaultValue={draft.neighborhood} className="rounded-none text-base" />
                    <p className="text-xs text-basalt/45">Nearby major sights are shown automatically on your listing based on its location.</p>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="tags" className="text-sm font-semibold">Tags <span className="font-normal text-basalt/45">(comma separated)</span></Label>
                  <Input id="tags" name="tags" placeholder="Forest, Breakfast, Design stay" defaultValue={draft.tags?.join(", ")} className={FIELD} />
                </div>
              </div>

              {/* Step 4 — amenities & pricing */}
              <div hidden={step !== 3} className="mt-10 grid gap-8">
                <AmenityPicker ref={amenitiesRef} type={draft.type} defaultValue={draft.amenities ?? []} />

                {/* Stay-only sleeping arrangement, seasonal rates + house rules. */}
                {draft.type === "stay" && (
                  <div className="grid gap-2 sm:max-w-xs">
                    <Label htmlFor="fact_propertytype" className="text-sm font-semibold">Property type</Label>
                    <select
                      id="fact_propertytype"
                      name="fact_propertytype"
                      defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "property type")?.value ?? ""}
                      className="h-12 rounded-none border border-basalt/15 bg-paper px-3 text-base focus:border-apricot focus:outline-none"
                    >
                      <option value="">Select a type…</option>
                      {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                {draft.type === "stay" && <RoomsEditor ref={roomsRef} defaultValue={draft.rooms ?? []} />}
                {draft.type === "stay" && <RatesEditor ref={ratesRef} defaultValue={draft.seasonalRates ?? []} rate={siteSettings.usdToAmdRate} />}
                {draft.type === "stay" && (
                  <div className="grid gap-3">
                    <div>
                      <p className="text-sm font-semibold">Check-in & checkout times <span className="font-normal text-basalt/45">(optional)</span></p>
                      <p className="mt-0.5 text-xs text-basalt/45">Shown on your listing and in the guest's confirmation email.</p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="grid gap-2">
                        <Label htmlFor="fact_checkin" className="text-sm font-semibold">Check-in from</Label>
                        <Input id="fact_checkin" name="fact_checkin" placeholder="e.g. 3:00 PM" defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "check-in")?.value ?? ""} className={FIELD} />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="fact_checkout" className="text-sm font-semibold">Checkout by</Label>
                        <Input id="fact_checkout" name="fact_checkout" placeholder="e.g. 11:00 AM" defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "checkout")?.value ?? ""} className={FIELD} />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="fact_minstay" className="text-sm font-semibold">Minimum stay <span className="font-normal text-basalt/45">(nights)</span></Label>
                        <Input id="fact_minstay" name="fact_minstay" type="number" min={1} max={365} placeholder="e.g. 2" defaultValue={parseInt(draft.facts?.find((f) => f.label.toLowerCase() === "minimum stay")?.value ?? "", 10) || ""} className={FIELD} />
                      </div>
                    </div>
                  </div>
                )}
                {draft.type === "stay" && <HouseRulesPicker ref={houseRulesRef} defaultValue={draft.houseRules ?? []} />}

                {/* Tour & experience-only detail fields. */}
                {(draft.type === "tour" || draft.type === "experience") && (
                  <div className="grid gap-6">
                    <ListEditor
                      label={draft.type === "tour" ? "Itinerary" : "Highlights"}
                      numbered
                      values={itinerary}
                      onChange={setItinerary}
                      placeholder={draft.type === "tour" ? "e.g. Coffee tasting at a local roastery" : "e.g. Bake lavash in a tonir"}
                      helpText={draft.type === "tour" ? "Add each stop in order — shown as a timeline on your listing." : "Add each highlight; shown in order."}
                    />
                    <input type="hidden" name="highlights" value={itinerary.join(",")} readOnly />
                    <div className="grid gap-2">
                      <Label className="text-sm font-semibold">Starting point <span className="font-normal text-basalt/45">(where the tour begins/ends)</span></Label>
                      <Input name="fact_startpoint" placeholder="e.g. Armenian National Opera and Ballet Theatre" defaultValue={draft.facts?.find((f) => ["starting point", "meeting point", "start"].includes(f.label.toLowerCase()))?.value ?? ""} className={FIELD} />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm font-semibold">Not included <span className="font-normal text-basalt/45">(search or add your own)</span></Label>
                      <SearchableMultiSelect ref={notIncludedRef} options={NOT_INCLUDED_OPTIONS} defaultValue={draft.notIncluded ?? []} placeholder="Search what's not included" />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm font-semibold">What to bring <span className="font-normal text-basalt/45">(search or add your own)</span></Label>
                      <SearchableMultiSelect ref={whatToBringRef} options={WHAT_TO_BRING_OPTIONS} defaultValue={draft.whatToBring ?? []} placeholder="Search what to bring" />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm font-semibold">Who is this not suitable for? <span className="font-normal text-basalt/45">(search or add your own)</span></Label>
                      <SearchableMultiSelect ref={notSuitableForRef} options={NOT_SUITABLE_FOR_OPTIONS} defaultValue={draft.notSuitableFor ?? []} placeholder="Search groups this isn't suitable for" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="importantInfo" className="text-sm font-semibold">Important info <span className="font-normal text-basalt/45">(optional)</span></Label>
                      <Textarea id="importantInfo" name="importantInfo" rows={2} placeholder="Age restrictions, accessibility notes, cancellation policy…" defaultValue={draft.importantInfo} className="rounded-none text-base" />
                    </div>
                  </div>
                )}

                <div className="grid gap-6 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="price" className="text-sm font-semibold">Price in AMD ({draft.type === "stay" ? "per night" : "per person"})</Label>
                    <Input id="price" name="price" type="number" min={1} placeholder="e.g. 45000" defaultValue={draft.price || ""} className={FIELD} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="priceUnit" className="text-sm font-semibold">Price unit label</Label>
                    <Input id="priceUnit" name="priceUnit" placeholder={draft.type === "stay" ? "night" : "person"} defaultValue={draft.priceUnit} className={FIELD} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="maxGuests" className="text-sm font-semibold">Max guests</Label>
                    <Input id="maxGuests" name="maxGuests" type="number" min={1} max={50} placeholder={draft.type === "stay" ? "e.g. 4" : "e.g. 8"} defaultValue={draft.maxGuests || ""} className={FIELD} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="cleaningFee" className="text-sm font-semibold">Cleaning fee in AMD <span className="font-normal text-basalt/45">(optional, per booking)</span></Label>
                    <Input id="cleaningFee" name="cleaningFee" type="number" min={0} placeholder="e.g. 10000" defaultValue={draft.cleaningFeeCents ? draft.cleaningFeeCents / 100 : ""} className={FIELD} />
                  </div>
                </div>

                <div className="grid gap-4 border border-basalt/10 bg-chalk/60 p-4">
                  <div className="grid gap-2">
                    <Label htmlFor="cancellationPolicy" className="text-sm font-semibold">Cancellation policy</Label>
                    <Select name="cancellationPolicy" defaultValue={draft.cancellationPolicy ?? "flexible"}>
                      <SelectTrigger id="cancellationPolicy" className="h-12 rounded-none text-base"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flexible">Flexible — free cancellation up to a cutoff</SelectItem>
                        <SelectItem value="non_refundable">Non-refundable — cheaper, no refunds</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="freeCancelDays" className="text-sm font-semibold">Free-cancel window <span className="font-normal text-basalt/45">(flexible)</span></Label>
                      <Input id="freeCancelDays" name="freeCancelDays" type="number" min={0} max={365} placeholder="7" defaultValue={draft.freeCancelDays ?? 7} className={FIELD} />
                      <p className="text-xs text-basalt/45">Days before check-in that free cancellation ends. After it, no refund.</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="nonrefundableDiscountPercent" className="text-sm font-semibold">Non-refundable discount % <span className="font-normal text-basalt/45">(incentive)</span></Label>
                      <Input id="nonrefundableDiscountPercent" name="nonrefundableDiscountPercent" type="number" min={0} max={90} placeholder="5" defaultValue={draft.nonrefundableDiscountPercent ?? 5} className={FIELD} />
                      <p className="text-xs text-basalt/45">Applied only when the policy is non-refundable.</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 border border-basalt/10 bg-chalk/60 p-4">
                  <div>
                    <Label className="text-sm font-semibold">Discount <span className="font-normal text-basalt/45">(optional sale for a travel-date window)</span></Label>
                    <p className="mt-1 text-xs text-basalt/45">Applies when a guest's check-in falls within the dates below. Shows an "on sale" badge on your listing.</p>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="discountType" className="text-sm font-semibold">Type</Label>
                      <Select name="discountType" defaultValue={draft.discountType ?? "none"}>
                        <SelectTrigger id="discountType" className="h-12 rounded-none text-base"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No discount</SelectItem>
                          <SelectItem value="percent">Percentage off (%)</SelectItem>
                          <SelectItem value="amount">Amount off (AMD)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="discountValue" className="text-sm font-semibold">Amount <span className="font-normal text-basalt/45">(% or AMD)</span></Label>
                      <Input id="discountValue" name="discountValue" type="number" min={0} placeholder="e.g. 15 or 10000" defaultValue={draft.discountValue ? (draft.discountType === "amount" ? draft.discountValue / 100 : draft.discountValue) : ""} className={FIELD} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="discountStart" className="text-sm font-semibold">Sale starts</Label>
                      <Input id="discountStart" name="discountStart" type="date" defaultValue={draft.discountStart ?? ""} className={FIELD} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="discountEnd" className="text-sm font-semibold">Sale ends</Label>
                      <Input id="discountEnd" name="discountEnd" type="date" defaultValue={draft.discountEnd ?? ""} className={FIELD} />
                    </div>
                  </div>
                </div>

                {/* Tour essentials — duration + languages, shown on the detail page. */}
                {draft.type === "tour" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="tourDuration" className="text-sm font-semibold">Duration</Label>
                      <Input id="tourDuration" name="tourDuration" placeholder="e.g. 3 hours" defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "duration")?.value ?? ""} className={FIELD} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="tourLanguages" className="text-sm font-semibold">Language(s)</Label>
                      <Input id="tourLanguages" name="tourLanguages" placeholder="e.g. Armenian, English" defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "languages")?.value ?? ""} className={FIELD} />
                    </div>
                  </div>
                )}

                {/* Quick facts — collapsed by default to keep the form tidy; the
                    inputs stay in the DOM so any values still save even closed. */}
                <details className="group grid gap-3 border border-basalt/12 p-4" open={(draft.facts?.length ?? 0) > 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between">
                    <span className="text-sm font-semibold">Quick facts <span className="font-normal text-basalt/45">(optional — a few at-a-glance details)</span></span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-basalt/40 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-3 grid gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => {
                      const [exLabel, exValue] = FACT_EXAMPLES[draft.type][i];
                      return (
                        <div key={i} className="grid grid-cols-2 gap-2">
                          <Input name={`fact${i + 1}Label`} placeholder={`Label, e.g. ${exLabel}`} defaultValue={draft.facts?.[i]?.label} className="h-11 rounded-none" />
                          <Input name={`fact${i + 1}Value`} placeholder={`Value, e.g. ${exValue}`} defaultValue={draft.facts?.[i]?.value} className="h-11 rounded-none" />
                        </div>
                      );
                    })}
                  </div>
                </details>

                <PhotoUploader ref={photosRef} defaultValue={realPhotos(draft)} />

                <label className="flex items-center gap-3 border border-basalt/12 bg-chalk px-4 py-3 text-sm">
                  <input type="checkbox" name="featured" defaultChecked={draft.featured} className="h-4 w-4 accent-[#F15822]" />
                  Feature on the home page
                </label>

                <p className="flex items-start gap-2 text-xs leading-5 text-basalt/50">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-apricot" />
                  {saveOutcome(draft, isEdit)}
                </p>
              </div>

              {(stepError || error) && (
                <div className="mt-8 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {stepError || error}
                </div>
              )}
            </form>
          </div>

          {/* Bottom bar — progress + navigation */}
          <footer className="border-t border-basalt/10 bg-paper">
            <div className="h-1 w-full bg-basalt/10">
              <div className="h-full bg-apricot transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
              <Button type="button" variant="ghost" className="rounded-none px-2 text-sm disabled:opacity-0" onClick={goBack} disabled={step === 0}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <div className="flex items-center gap-2">
                {isLast && !isPublished && (
                  <Button type="button" variant="outline" className="rounded-none px-5" disabled={saving} onClick={() => persist(false)}>
                    Save as draft
                  </Button>
                )}
                <Button type="submit" form="listing-onboarding" className="rounded-none bg-apricot px-6 text-white hover:bg-apricot/90" disabled={saving}>
                  {isLast ? (saving ? "Saving…" : isPublished ? "Save changes" : "Submit for review") : "Continue"}
                </Button>
              </div>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function StatusBadge({ status, reviewNote }: { status: LiveListing["status"]; reviewNote?: string | null }) {
  if (status === "published") {
    return <span className="border border-sevan/30 bg-sevan/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-sevan">Published</span>;
  }
  if (status === "pending") {
    return <span className="border border-tuff/30 bg-tuff/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-tuff">Pending review</span>;
  }
  // draft: an admin rejection (has a note) vs. an operator's own unsubmitted draft.
  if (reviewNote) {
    return <span className="border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-destructive">Needs changes</span>;
  }
  return <span className="border border-basalt/25 bg-basalt/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/55">Draft</span>;
}

/** Per-listing Airbnb calendar (iCal) connect + sync control. One-way import: shows unavailable dates on Revamp, no prices. */
// Per-type calendar-source hint. The importer (server/ical.ts) accepts ANY
// iCalendar .ics feed, so this only tailors the copy/placeholder to the
// platform each type is most likely syncing from.
const ICAL_SOURCE: Record<ListingType, { name: string; placeholder: string }> = {
  stay: { name: "Airbnb", placeholder: "https://www.airbnb.com/calendar/ical/….ics" },
  tour: { name: "GetYourGuide", placeholder: "https://…/calendar/….ics (GetYourGuide, Viator, etc.)" },
  experience: { name: "your booking platform", placeholder: "https://…/….ics (any booking calendar)" },
  eat: { name: "your booking platform", placeholder: "https://…/….ics" },
};

function AvailabilityRow({ listing }: { listing: LiveListing }) {
  // Stays typically list on both Airbnb and Booking.com and want a two-way feed;
  // other types keep the simpler single-calendar import.
  return listing.type === "stay" ? <StayCalendarSync listing={listing} /> : <SingleCalendarSync listing={listing} />;
}

function SingleCalendarSync({ listing }: { listing: LiveListing }) {
  const { setIcalUrl, refresh } = useListings();
  const source = ICAL_SOURCE[listing.type];
  const [url, setUrl] = useState(listing.icalUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await setIcalUrl(listing.id, url.trim() || null);
      if (url.trim()) {
        const res = await syncIcal(listing.id);
        setMsg(`Synced — ${res.count} blocked date ${res.count === 1 ? "range" : "ranges"}.`);
      } else {
        setMsg("Calendar disconnected.");
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't sync that calendar.");
    } finally {
      setBusy(false);
    }
  };

  // A successful sync (this session's msg, or a prior synced-at with no error)
  // reads green; a failure reads red; everything else is muted.
  const isError = !!err || (!msg && !!listing.icalError);
  const isSynced = (!!msg && msg.startsWith("Synced")) || (!err && !msg && !!listing.icalSyncedAt && !listing.icalError);
  const statusText = err
    ? err
    : msg
      ? msg
      : listing.icalError
        ? `Last sync failed: ${listing.icalError}`
        : listing.icalSyncedAt
          ? `${listing.blockedRanges.length} blocked date ${listing.blockedRanges.length === 1 ? "range" : "ranges"} · last synced ${new Date(listing.icalSyncedAt).toLocaleString()}`
          : `Paste your ${source.name} calendar-export (.ics) link to show its unavailable dates on Revamp — any iCal feed works. One-way, availability only, so double-bookings are blocked; no prices imported.`;

  return (
    <div className="mt-3 border-t border-basalt/10 pt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">
        <CalendarClock className="h-3.5 w-3.5" /> Availability sync
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setMsg(null);
            setErr(null);
          }}
          placeholder={source.placeholder}
          className="h-9 min-w-0 flex-1 rounded-none text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9 shrink-0 rounded-none border-basalt/15 text-xs", isSynced && "border-green-600/40 bg-green-600/10 text-green-700 hover:bg-green-600/15")}
          disabled={busy}
          onClick={save}
        >
          {busy ? "Syncing…" : isSynced ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Synced</> : url.trim() ? "Save & sync" : "Save"}
        </Button>
      </div>
      <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", isError ? "text-destructive" : isSynced ? "font-semibold text-green-700" : "text-basalt/45")}>
        {isSynced && <Check className="h-3.5 w-3.5 shrink-0" />}
        {statusText}
      </p>
    </div>
  );
}

/** Stays: import Airbnb + Booking.com calendars AND expose an export .ics feed
 *  to paste back into those OTAs — a two-way availability sync. */
function StayCalendarSync({ listing }: { listing: LiveListing }) {
  const { setIcalFeeds, refresh } = useListings();
  const feedUrl = (label: string) => listing.icalFeeds.find((f) => f.label.toLowerCase() === label.toLowerCase())?.url ?? "";
  const [airbnb, setAirbnb] = useState(feedUrl("Airbnb") || (listing.icalUrl ?? ""));
  const [booking, setBooking] = useState(feedUrl("Booking.com"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const exportUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/ical/${listing.id}.ics`;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const feeds = [{ label: "Airbnb", url: airbnb }, { label: "Booking.com", url: booking }].filter((f) => f.url.trim());
      await setIcalFeeds(listing.id, feeds);
      if (feeds.length) {
        const res = await syncIcal(listing.id);
        const n = res.feeds ?? feeds.length;
        setMsg(`Synced ${n} calendar${n === 1 ? "" : "s"} — ${res.count} blocked date ${res.count === 1 ? "range" : "ranges"}.${res.errors?.length ? ` Issues: ${res.errors.join("; ")}` : ""}`);
      } else {
        setMsg("Calendars disconnected.");
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't sync those calendars.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(exportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const isError = !!err || (!msg && !!listing.icalError);
  const isSynced = (!!msg && msg.startsWith("Synced")) || (!err && !msg && !!listing.icalSyncedAt && !listing.icalError);
  const statusText = err
    ? err
    : msg
      ? msg
      : listing.icalError
        ? `Last sync issue: ${listing.icalError}`
        : listing.icalSyncedAt
          ? `${listing.blockedRanges.length} blocked date ${listing.blockedRanges.length === 1 ? "range" : "ranges"} · last synced ${new Date(listing.icalSyncedAt).toLocaleString()}`
          : "Paste your Airbnb and/or Booking.com calendar-export (.ics) links to block their dates on Revamp. One-way import, availability only.";

  return (
    <div className="mt-3 border-t border-basalt/10 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">
        <CalendarClock className="h-3.5 w-3.5" /> Import calendars
      </p>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-semibold text-basalt/60">Airbnb</span>
          <Input type="url" value={airbnb} onChange={(e) => { setAirbnb(e.target.value); setMsg(null); setErr(null); }} placeholder="https://www.airbnb.com/calendar/ical/….ics" className="h-9 min-w-0 flex-1 rounded-none text-xs" />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-semibold text-basalt/60">Booking.com</span>
          <Input type="url" value={booking} onChange={(e) => { setBooking(e.target.value); setMsg(null); setErr(null); }} placeholder="https://admin.booking.com/hotel/…/ical.html?…" className="h-9 min-w-0 flex-1 rounded-none text-xs" />
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="outline" size="sm" className={cn("h-9 rounded-none border-basalt/15 text-xs", isSynced && "border-green-600/40 bg-green-600/10 text-green-700 hover:bg-green-600/15")} disabled={busy} onClick={save}>
          {busy ? "Syncing…" : isSynced ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Synced</> : "Save & sync"}
        </Button>
      </div>
      <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", isError ? "text-destructive" : isSynced ? "font-semibold text-green-700" : "text-basalt/45")}>
        {isSynced && <Check className="h-3.5 w-3.5 shrink-0" />}
        {statusText}
      </p>

      <p className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">
        <CalendarClock className="h-3.5 w-3.5" /> Export to Airbnb / Booking.com
      </p>
      <div className="flex items-center gap-2">
        <Input readOnly value={exportUrl} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-none bg-chalk text-xs" />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 rounded-none border-basalt/15 text-xs" onClick={copy}>
          {copied ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied</> : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</>}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-basalt/45">Add this link under “Import calendar” on Airbnb and Booking.com so your Revamp bookings and blocked dates sync there too.</p>
    </div>
  );
}

function DashboardSection({ type, title, description, wizardMode }: { type: ListingType; title: string; description: string; wizardMode?: boolean }) {
  const { user } = useAuth();
  const { listings, deleteListing } = useListings();
  const [, navigate] = useLocation();
  const items = listings.filter((l) => l.type === type && l.operatorId === user?.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftListing | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // `wizardMode` (Experiences only) routes Add/Edit/prefill to the full-page
  // wizard (App.tsx's /dashboard/experiences/*) instead of the shared dialog.
  const openAdd = () => {
    if (wizardMode) { navigate("/dashboard/experiences/new"); return; }
    setDraft(emptyDraft(type));
    setDialogOpen(true);
  };
  const openEdit = (listing: LiveListing) => {
    if (wizardMode) { navigate(`/dashboard/experiences/${listing.id}/edit`); return; }
    setDraft(listing);
    setDialogOpen(true);
  };

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setImportError(null);
    try {
      const prefill = await importListingPrefill(url);
      if (wizardMode) {
        // Hand the prefill to the wizard via sessionStorage, then navigate.
        sessionStorage.setItem(
          EXPERIENCE_PREFILL_STORAGE_KEY,
          JSON.stringify({
            title: prefill.title ?? "",
            description: prefill.description ?? "",
            imageUrl: prefill.imageUrl,
            amenities: prefill.amenities ?? [],
            price: prefill.price ?? 0,
            city: prefill.city ?? "",
            region: prefill.region ?? "",
          }),
        );
        setImportUrl("");
        navigate("/dashboard/experiences/new");
        return;
      }
      setDraft({
        ...emptyDraft(type),
        title: prefill.title ?? "",
        shortDescription: prefill.description ?? "",
        amenities: prefill.amenities ?? [],
        city: prefill.city ?? "",
        region: prefill.region ?? "",
        price: prefill.price ?? 0,
        prefillImageUrl: prefill.imageUrl,
      });
      setDialogOpen(true);
      setImportUrl("");
      // Amenities/price/city/region only come through when the source page
      // publishes its own JSON-LD (see server/urlPrefill.ts) — most sites
      // only expose title/description, so flag what actually came in.
      const found: string[] = [];
      if (prefill.amenities?.length) found.push(`${prefill.amenities.length} amenities`);
      if (prefill.price) found.push("a price");
      if (prefill.city || prefill.region) found.push("a location");
      if (found.length > 0) toast(`Also pulled in ${found.join(", ")} from that page — review before saving.`);
    } catch (err) {
      setImportError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't fetch that link.");
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = async (listing: LiveListing) => {
    if (!window.confirm(`Remove "${listing.title}" from your catalog? This can't be undone.`)) return;
    setDeletingId(listing.id);
    try {
      await deleteListing(listing.id);
      toast(`${listing.title} removed.`);
    } catch (err) {
      toast(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't delete this listing.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="border-t border-basalt/10 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{title}</p>
          <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">{items.length} listed</h2>
          <p className="mt-2 max-w-md text-sm text-basalt/55">{description}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button onClick={openAdd} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
            <Plus className="mr-2 h-4 w-4" /> Add {type}
          </Button>
          <form onSubmit={handleImport} className="flex items-center gap-2">
            <Input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Or paste a listing link to prefill"
              className="h-9 w-64 rounded-none text-xs"
            />
            <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0 rounded-none border-basalt/15 text-xs" disabled={importing || !importUrl.trim()}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> {importing ? "Fetching…" : "Prefill"}
            </Button>
          </form>
        </div>
      </div>
      {importError && <p className="mt-2 text-right text-xs text-destructive">{importError}</p>}

      {items.length === 0 ? (
        <p className="mt-8 border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Nothing here yet — add your first one above.</p>
      ) : (
        <div className="mt-8 grid gap-3">
          {items.map((listing) => (
            <div key={listing.id} className="border border-basalt/10 bg-paper p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-display text-xl leading-tight">{listing.title}</p>
                    <StatusBadge status={listing.status} reviewNote={listing.reviewNote} />
                  </div>
                  <p className="mt-1 text-xs text-basalt/50">{listing.city}, {listing.region} · {listing.priceLabel}{listing.price > 0 ? ` / ${listing.priceUnit}` : ""}</p>
                  {listing.status === "draft" && listing.reviewNote && (
                    <p className="mt-2 max-w-md border-l-2 border-destructive/40 pl-2 text-xs leading-5 text-basalt/60">
                      <span className="font-semibold text-destructive">Admin feedback:</span> {listing.reviewNote}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-none border-basalt/15" onClick={() => openEdit(listing)}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit</Button>
                  <Button variant="outline" size="sm" className="rounded-none border-destructive/30 text-destructive hover:bg-destructive/5" disabled={deletingId === listing.id} onClick={() => confirmDelete(listing)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> {deletingId === listing.id ? "Removing…" : "Delete"}
                  </Button>
                </div>
              </div>
              <AvailabilityRow listing={listing} />
            </div>
          ))}
        </div>
      )}

      {!wizardMode && <ListingFormDialog draft={draft} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => setDialogOpen(false)} />}
    </section>
  );
}

type OperatorSection = "overview" | "listings" | "bookings" | "payouts" | "settings";
const OPERATOR_SECTIONS: { key: OperatorSection; label: string; icon: typeof Home }[] = [
  { key: "overview", label: "Dashboard", icon: LayoutDashboard },
  { key: "listings", label: "Listings", icon: List },
  { key: "bookings", label: "Bookings", icon: CalendarCheck },
  { key: "payouts", label: "Payouts", icon: Wallet },
  { key: "settings", label: "Settings", icon: Settings },
];

const BOOKINGS_VIEWS = [
  { key: "timeline", label: "Timeline", blurb: "Your listings across the calendar — bookings and synced-blocked dates at a glance." },
  { key: "calendar", label: "Calendar", blurb: "Open a single offer's calendar to see its bookings, set per-date prices, and block or open availability." },
  { key: "list", label: "List", blurb: "Reservations on your listings, grouped by type." },
] as const;
type BookingsView = (typeof BOOKINGS_VIEWS)[number]["key"];

function BookingsSection() {
  const [view, setView] = useState<BookingsView>("timeline");
  const blurb = BOOKINGS_VIEWS.find((v) => v.key === view)?.blurb ?? "";
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.03em] sm:text-5xl">Bookings</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-basalt/60">{blurb}</p>
        </div>
        <div className="flex shrink-0 border border-basalt/15">
          {BOOKINGS_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn("px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] transition-colors", view === v.key ? "bg-basalt text-paper" : "text-basalt/55 hover:text-basalt")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {view === "timeline" && <OperatorBookingsTimeline />}
      {view === "calendar" && <CalendarSection />}
      {view === "list" && <OperatorBookings />}
    </div>
  );
}

/** Per-listing calendar: pick one offer, then see/manage its month calendar. */
function CalendarSection() {
  const { user } = useAuth();
  const { listings } = useListings();
  const mine = useMemo(
    () => listings.filter((l) => l.operatorId === user?.id).sort((a, b) => a.title.localeCompare(b.title)),
    [listings, user?.id],
  );
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = mine.find((l) => l.id === selectedId) ?? null;

  if (mine.length === 0) {
    return <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Add a listing to view and manage its calendar here.</p>;
  }

  return (
    <div>
      <label className="mb-5 block max-w-md">
        <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Listing</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded-none border border-basalt/15 bg-paper px-3 py-2.5 text-sm focus:border-apricot focus:outline-none"
        >
          <option value="">Select an offer to open its calendar…</option>
          {mine.map((l) => (
            <option key={l.id} value={l.id}>{l.title} · {l.type}</option>
          ))}
        </select>
      </label>
      {selected ? (
        <PricingCalendar key={selected.id} listing={selected} />
      ) : (
        <p className="border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Choose an offer above to view and manage its calendar.</p>
      )}
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-4xl leading-[0.95] tracking-[-0.03em] sm:text-5xl">{title}</h1>
      <p className="mt-3 max-w-xl text-base leading-7 text-basalt/60">{sub}</p>
    </div>
  );
}

function StatTile({ n, label }: { n: number; label: string }) {
  return (
    <div className="border border-basalt/10 bg-paper p-5">
      <p className="font-display text-4xl font-normal tabular-nums">{n}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-basalt/45">{label}</p>
    </div>
  );
}

function DashboardContent() {
  const { profile, user } = useAuth();
  const { offline, listings } = useListings();
  const [, navigate] = useLocation();
  const search = useSearch();

  // Greet the operator by first name — the first word of their profile name
  // (person's display name preferred over a business name), lightly capitalized.
  const rawName = (profile?.displayName || profile?.businessName || "").trim();
  const firstWord = rawName.split(/\s+/)[0] ?? "";
  const firstName = firstWord ? firstWord.charAt(0).toUpperCase() + firstWord.slice(1) : "";

  useDocumentMeta({
    title: "Dashboard | Revamp Vacations",
    description: "Manage your own stay and tour listings on Revamp Vacations.",
    canonicalPath: "/dashboard",
    noindex: true,
  });

  // Section is driven by ?section= so it's deep-linkable (and the header's
  // "Dashboard" link lands on the overview).
  const initial = useMemo<OperatorSection>(() => {
    const s = new URLSearchParams(search).get("section");
    return OPERATOR_SECTIONS.some((x) => x.key === s) ? (s as OperatorSection) : "overview";
  }, [search]);
  const [section, setSectionState] = useState<OperatorSection>(initial);
  useEffect(() => setSectionState(initial), [initial]);
  const go = (s: OperatorSection) => {
    setSectionState(s);
    navigate(s === "overview" ? "/dashboard" : `/dashboard?section=${s}`);
  };

  const mine = useMemo(() => listings.filter((l) => l.operatorId === user?.id), [listings, user?.id]);
  const published = mine.filter((l) => l.status === "published").length;
  const pending = mine.filter((l) => l.status === "pending").length;

  const offlineBanner = offline && (
    <div className="mb-8 flex items-start gap-2 border border-tuff/40 bg-tuff/10 p-4 text-sm text-basalt">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tuff" />
      Can't reach the catalog right now — showing the built-in sample listings read-only. Adding, editing, and deleting will resume once the connection is back.
    </div>
  );

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader minimal wide />
      <main className="mx-auto w-full max-w-[1680px] px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-[96px] lg:self-start">
            <p className="hidden px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-basalt/40 lg:block">Operator</p>
            <nav className="mt-0 flex gap-1 overflow-x-auto pb-1 lg:mt-3 lg:flex-col lg:overflow-visible lg:pb-0">
              <Link href="/" className="flex items-center gap-2.5 whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-basalt/60 transition-colors hover:bg-chalk hover:text-basalt">
                <Home className="h-4 w-4" /> Homepage
              </Link>
              {OPERATOR_SECTIONS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => go(key)}
                  aria-current={section === key}
                  className={cn(
                    "flex items-center gap-2.5 whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors",
                    section === key ? "bg-basalt text-paper" : "text-basalt/60 hover:bg-chalk hover:text-basalt",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </nav>
          </aside>

          <div>
            {section === "overview" && (
              <div>
                <SectionHead title={firstName ? `Hi ${firstName}.` : "Welcome."} sub="Your listings, bookings, and payouts — all in one place." />
                {offlineBanner}
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatTile n={mine.length} label="Listings" />
                  <StatTile n={published} label="Published" />
                  <StatTile n={pending} label="Pending review" />
                </div>
                <div className="mt-6">
                  <OperatorAnalytics />
                </div>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button onClick={() => go("listings")} className="rounded-none bg-apricot text-white hover:bg-apricot/90">Manage listings</Button>
                  <Button variant="outline" onClick={() => go("bookings")} className="rounded-none border-basalt/20 bg-paper">View bookings <ArrowRight className="ml-2 h-4 w-4" /></Button>
                  <Button variant="outline" onClick={() => go("payouts")} className="rounded-none border-basalt/20 bg-paper">View payouts <ArrowRight className="ml-2 h-4 w-4" /></Button>
                </div>
              </div>
            )}

            {section === "listings" && (
              <div>
                <SectionHead title="Listings" sub="Add, edit, or remove your own stays, tours, and experiences. A new listing goes through a quick review before it's visible; edits to a live listing save immediately." />
                {offlineBanner}
                <DashboardSection type="stay" title="Stays" description="Guesthouses, cabins, and small hotels shown on /explore/stay and the home page." />
                <DashboardSection type="tour" title="Tours" description="Guided routes shown on /explore/tour and the home page." />
                <DashboardSection type="experience" title="Experiences" description="Hands-on classes and local activities shown on /explore/experience and the home page." wizardMode />
              </div>
            )}

            {section === "bookings" && <BookingsSection />}

            {section === "payouts" && (
              <div>
                <SectionHead title="Payouts" sub="What you're owed and what's already been paid out." />
                <OperatorPayouts />
              </div>
            )}

            {section === "settings" && (
              <div>
                <SectionHead title="Settings" sub="Your account, profile, and password." />
                <div className="grid gap-12">
                  <div>
                    <p className="mb-5 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Profile</p>
                    <ProfileTab />
                  </div>
                  <div className="border-t border-basalt/10 pt-10">
                    <p className="mb-5 text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Security</p>
                    <SecurityTab />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter minimal wide />
    </div>
  );
}

export default function Dashboard() {
  return (
    <RequireRole role="operator">
      <DashboardContent />
    </RequireRole>
  );
}
