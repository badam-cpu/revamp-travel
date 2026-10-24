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
import { PriceLog } from "@/components/PriceLog";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { AlertTriangle, ArrowLeft, ArrowRight, BarChart3, BookOpen, CalendarCheck, CalendarClock, CalendarDays, Check, ChevronDown, ChevronLeft, ExternalLink, MoreHorizontal, PauseCircle, PlayCircle, Copy, CreditCard, FileText, Footprints, Gift, Home, LayoutDashboard, Link2, List, MapPin, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plug, Plus, QrCode, RefreshCw, Route, Settings, Sparkles, Ticket, Trash2, Wallet, X } from "lucide-react";
import { Inbox } from "@/components/Inbox";
import { PartnerHub } from "@/components/PartnerHub";
import { OperatorIntegrations } from "@/components/OperatorIntegrations";
import { CommissionStatements } from "@/components/CommissionStatements";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RequireRole } from "@/components/RequireRole";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BoldButton } from "@/components/BoldButton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListings, LiveListing } from "@/contexts/ListingsContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ListingInput, ListingType, RoomType, RoomTypeInput } from "@shared/listings";
import { LISTING_LIMITS, LISTING_TEXT_LIMITS, STAY_SPACE_TYPES, firstListingTextProblem, listingOffers, suspensionLabel } from "@shared/listings";
import { EXTRA_FEE_TYPES } from "@shared/bookings";
import { CharCount } from "@/components/CharCount";
import { HotelCalendarSync } from "@/components/HotelCalendarSync";
import { CustomerJourney } from "@/components/CustomerJourney";
import { Switch } from "@/components/ui/switch";
import { TimeSelect } from "@/components/TimeSelect";
import { RoomTypesEditor, RoomTypesEditorHandle, validateRoomTypes } from "@/components/RoomTypesEditor";
import { fetchRoomTypes } from "@/lib/roomTypes";
import { ApiError, importListingPrefill, syncIcal } from "@/lib/api";
import { attachReferral, getStoredReferralCode, clearStoredReferralCode } from "@/lib/referrals";
import { cn } from "@/lib/utils";
import { PlaceAutocomplete } from "@/components/PlaceAutocomplete";
import { geocodeQuery } from "@/lib/googleMaps";
import { AmenityPicker, AmenityPickerHandle } from "@/components/AmenityPicker";
import { AhaAssist } from "@/components/AhaAssist";
import type { AhaCopyContext } from "@/lib/api";
import { HouseRulesPicker, HouseRulesPickerHandle } from "@/components/HouseRulesPicker";
import { RoomsEditor, RoomsEditorHandle } from "@/components/RoomsEditor";
import { RatesEditor, RatesEditorHandle } from "@/components/RatesEditor";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { HOTEL_MAX_PHOTOS, PhotoUploader, PhotoUploaderHandle } from "@/components/PhotoUploader";
import { VideoField, VideoFieldHandle } from "@/components/VideoField";
import { SearchableMultiSelect, SearchableMultiSelectHandle } from "@/components/SearchableMultiSelect";
import { ListEditor } from "@/components/ListEditor";
import { OperatorBookings } from "@/components/OperatorBookings";
import { HotelPricingCalendar, PricingCalendar } from "@/components/PricingCalendar";
import { OperatorBookingsTimeline } from "@/components/OperatorBookingsTimeline";
import { OperatorMultiCalendar } from "@/components/OperatorMultiCalendar";
import { ListingAvailabilityDialog, quickAvailability, type AvailabilityMode } from "@/components/ListingAvailabilityDialog";
import { TourEditor } from "@/components/TourEditor";
import { autoTourAfterSave, fetchToursFor, OPEN_TOUR_EVENT, TOUR_CHANGED_EVENT } from "@/lib/tours";
import type { ListingTour } from "@shared/tours";
import { suspensionBlocked } from "@/components/SuspensionNotice";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PromoCodes } from "@/components/PromoCodes";
import { OperatorReferrals } from "@/components/OperatorReferrals";
import { OperatorPayouts } from "@/components/OperatorPayouts";
import { OperatorSubscription } from "@/components/OperatorSubscription";
import { SessionScheduleEditor } from "@/components/SessionScheduleEditor";
import { OperatorAnalytics } from "@/components/OperatorAnalytics";
import { OperatorDocuments } from "@/components/OperatorDocuments";
import { QrManager } from "@/components/QrManager";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { OperatorResponseStat } from "@/components/OperatorResponseStat";
import { MessageTemplatesSettings } from "@/components/MessageTemplatesSettings";
import { OperatorSettings } from "@/components/OperatorSettings";
import { PageHeader, SubHeader } from "@/components/PageHeader";
import { EventInsights } from "@/components/EventInsights";
import { EXPERIENCE_PREFILL_STORAGE_KEY } from "@/pages/ExperienceOnboarding";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { toast } from "sonner";
import { deleteListingDraft, listListingDrafts, saveListingDraft, savedAgo, type DraftListingType, type ListingDraftRow } from "@/lib/listingDrafts";
import { EXPERIENCE_STEP_COUNT } from "@/pages/ExperienceOnboarding";

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

/** What a saved "Unfinished" stay/tour (0115, lib/listingDrafts.ts) holds. */
interface ListingDraftData {
  v: 1;
  listing: DraftListing;
  multiRoom?: boolean;
  roomTypes?: RoomTypeInput[];
}
/** Resuming an unfinished listing: its draft row, the step reached and (hotels) its room types. */
interface ListingResume {
  rowId: string;
  step: number;
  roomTypes?: RoomType[];
}
const inArmenia = (c?: { lat: number; lng: number }) => !!c && c.lat >= 38 && c.lat <= 42 && c.lng >= 43 && c.lng <= 47;
function restoreListingDraft(type: ListingType, d: ListingDraftData | null | undefined): DraftListing {
  const base = emptyDraft(type);
  const l = (d?.listing ?? {}) as DraftListing;
  return { ...base, ...l, type, coordinates: inArmenia(l.coordinates) ? l.coordinates : base.coordinates, multiRoom: !!d?.multiRoom, id: undefined, status: undefined };
}
/** Room types typed into an unfinished hotel → the editor's seed shape (never saved yet, so no ids). */
function restoreRoomTypes(inputs: RoomTypeInput[] | undefined): RoomType[] | undefined {
  if (!inputs?.length) return undefined;
  return inputs.map((t, i) => ({
    ...t,
    id: t.id as string,
    listingId: "",
    sortOrder: i,
    units: t.units.map((u, j) => ({ id: u.id as string, roomTypeId: "", name: u.name, priceCents: u.priceCents, seasonalRates: [], manualBlockedRanges: [], active: true, sortOrder: j })),
  }));
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
  coverFocus: string;
  videoUrl: string;
  photoCaptions: Record<string, string>;
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
    { label: "Space type", value: get("fact_spacetype").trim() },
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
    address: get("address").trim(),
    coordinates: { lat: Number(get("lat")) || 0, lng: Number(get("lng")) || 0 },
    // No photos → leave undefined so toRow() falls back to a brand illustration.
    image: photos[0] || undefined,
    gallery: photos.length ? photos : undefined,
    coverFocus: lists.coverFocus || undefined,
    // Sent when there are captions — or when clearing ones the listing had.
    photoCaptions: Object.keys(lists.photoCaptions).length || Object.keys(draft.photoCaptions ?? {}).length ? lists.photoCaptions : undefined,
    videoUrl: lists.videoUrl || undefined,
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
    guestsIncluded: draft.type === "stay" && Number(get("guestsIncluded")) > 0 ? Number(get("guestsIncluded")) : undefined,
    extraGuestFeeCents: draft.type === "stay" && Number(get("extraGuestFee")) > 0 ? Math.round(Number(get("extraGuestFee")) * 100) : undefined,
    cancellationPolicy: get("cancellationPolicy") === "non_refundable" ? "non_refundable" : "flexible",
    freeCancelDays: Number(get("freeCancelDays")) >= 0 && get("freeCancelDays") !== "" ? Number(get("freeCancelDays")) : 7,
    nonrefundableDiscountPercent: Number(get("nonrefundableDiscountPercent")) >= 0 && get("nonrefundableDiscountPercent") !== "" ? Number(get("nonrefundableDiscountPercent")) : 5,
    cleaningFeeCents: Number(get("cleaningFee")) > 0 ? Math.round(Number(get("cleaningFee")) * 100) : 0,
    extraFeeType: draft.type !== "stay" && get("extraFeeType") && get("extraFeeType") !== "none" ? get("extraFeeType") : null,
    extraFeePer: draft.type !== "stay" && get("extraFeePer") === "person" ? "person" : "booking",
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
    // revampstay offers (0091): stays only, and ONLY when the "How do you want
    // to offer it?" block is actually in the form (its nightly checkbox exists).
    // Otherwise return {} so offerColumns() sends no offer columns at all —
    // tours/experiences and every other path are byte-for-byte unchanged.
    ...(() => {
      const box = (name: string) => form.elements.namedItem(name) as HTMLInputElement | null;
      if (draft.type !== "stay" || !box("offer_nightly")) return {};
      const offerTypes: ListingInput["offerTypes"] = [];
      if (box("offer_nightly")?.checked) offerTypes.push("nightly");
      if (box("offer_monthly")?.checked) offerTypes.push("monthly");
      if (box("offer_sale")?.checked) offerTypes.push("sale");
      const num = (name: string) => (get(name).trim() === "" ? undefined : Number(get(name)));
      const cents = (name: string) => (num(name) !== undefined && Number(num(name)) > 0 ? Math.round(Number(num(name)) * 100) : undefined);
      const monthly = offerTypes.includes("monthly");
      const sale = offerTypes.includes("sale");
      const furnishedRaw = get("furnished").trim();
      const furnished = furnishedRaw === "furnished" || furnishedRaw === "semi" || furnishedRaw === "unfurnished" ? furnishedRaw : undefined;
      const saleStatusRaw = get("saleStatus").trim();
      const saleStatus = saleStatusRaw === "available" || saleStatusRaw === "under_offer" || saleStatusRaw === "sold" ? saleStatusRaw : undefined;
      return {
        offerTypes: offerTypes.length ? offerTypes : (["nightly"] as ListingInput["offerTypes"]),
        monthlyRentCents: monthly ? cents("monthlyRent") : undefined,
        depositCents: monthly ? cents("deposit") : undefined,
        minLeaseMonths: monthly && num("minLeaseMonths") !== undefined && Number(num("minLeaseMonths")) >= 1 ? Math.round(Number(num("minLeaseMonths"))) : undefined,
        furnished: monthly ? furnished : undefined,
        utilitiesIncluded: monthly ? box("utilitiesIncluded")?.checked || false : undefined,
        availableFrom: monthly ? get("availableFrom").trim() || undefined : undefined,
        salePriceCents: sale ? cents("salePrice") : undefined,
        areaM2: sale && num("areaM2") !== undefined && Number(num("areaM2")) > 0 ? Number(num("areaM2")) : undefined,
        floor: sale && num("floor") !== undefined ? Math.round(Number(num("floor"))) : undefined,
        totalFloors: sale && num("totalFloors") !== undefined ? Math.round(Number(num("totalFloors"))) : undefined,
        yearBuilt: sale && num("yearBuilt") !== undefined ? Math.round(Number(num("yearBuilt"))) : undefined,
        ownershipType: sale ? get("ownershipType").trim() || undefined : undefined,
        saleStatus: sale ? saleStatus ?? "available" : undefined,
      };
    })(),
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
  { title: "Amenities & photos", blurb: () => "What's included, a few quick facts, and your photos." },
  { title: "Pricing", blurb: () => "Your rate, discounts and cancellation terms." },
];
const LAST_STEP = STEPS.length - 1;

/** Roomy, brand-radius field sizing shared across the onboarding inputs. */
/** Roomy, brand-radius field sizing shared across EVERY control in the listing
 * form — 48px tall, 16px text — so text boxes and dropdowns all match. The
 * shared ui/Input drops to 14px on desktop (md:text-sm) and ui/SelectTrigger
 * pins 36px via data-[size=default]:h-9, so both are overridden here. */
const FIELD = "h-12 rounded-none text-base md:text-base";

/** Fee names offered for a tour/experience — the standard list, plus a listing's own legacy value. */
function extraFeeOptions(current?: string | null): string[] {
  const list: string[] = [...EXTRA_FEE_TYPES];
  return current && !list.includes(current) ? [current, ...list] : list;
}
const SELECT_TRIGGER = "h-12 data-[size=default]:h-12 w-full rounded-none text-base";
const NATIVE_SELECT = "h-12 w-full rounded-none border border-basalt/15 bg-paper px-3 text-base focus:border-apricot focus:outline-none";
/** A lone field that should line up with one column of the two-column pairs. */
const HALF = "sm:w-[calc(50%-0.5rem)]";

// Stay property types offered in the listing form (stored in facts as
// "Property type"; shown in place of the generic "Stay" on the listing page).
const PROPERTY_TYPES = [
  "Apartment", "Condo", "House", "Villa", "Guesthouse", "Cottage", "Cabin",
  "Studio", "Loft", "Hotel", "Boutique hotel", "Bed & breakfast", "Hostel",
  "Chalet", "Farm stay", "Townhouse",
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
  // `place` is admin-curated (not editable here); present only so this map stays total over ListingType.
  place: [["Hours", "10 AM – 6 PM"], ["Entry", "Free"], ["Best for", "An afternoon"], ["Good to know", "Café on site"]],
};

function ListingFormDialog({
  draft,
  open,
  onOpenChange,
  onSaved,
  resume = null,
  onDraftsChanged,
}: {
  draft: DraftListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Continuing an unfinished listing (0115). */
  resume?: ListingResume | null;
  onDraftsChanged?: () => void;
}) {
  const { createListing, updateListing, saveRoomTypes } = useListings();
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
  const videoRef = useRef<VideoFieldHandle>(null);
  const notIncludedRef = useRef<SearchableMultiSelectHandle>(null);
  const whatToBringRef = useRef<SearchableMultiSelectHandle>(null);
  const notSuitableForRef = useRef<SearchableMultiSelectHandle>(null);
  // Ordered tour/experience itinerary (stored in `highlights`).
  const [itinerary, setItinerary] = useState<string[]>(draft?.highlights ?? []);
  // revampstay offers (stays only). Checkbox state drives which price blocks
  // show; the actual values are read uncontrolled in toInputPayload at submit.
  // Seeded so editing a listing keeps its offers; a new stay defaults to nightly.
  const seededOffers = listingOffers({ offerTypes: draft?.offerTypes });
  const [offerMonthly, setOfferMonthly] = useState(seededOffers.includes("monthly"));
  const [offerSale, setOfferSale] = useState(seededOffers.includes("sale"));
  // Multi-room property (hotel, 0092): guests book a specific room type, so the
  // listing-level nightly price/guest fields give way to the room-type editor.
  const roomTypesRef = useRef<RoomTypesEditorHandle>(null);
  const [multiRoom, setMultiRoom] = useState(!!draft?.multiRoom);
  // Shows only the setting that applies: free-cancel window (flexible) or the
  // discount % (non-refundable). Both inputs stay mounted so their values save.
  const [policy, setPolicy] = useState(draft?.cancellationPolicy ?? "flexible");
  // Existing room types load async; the editor (uncontrolled) mounts once they're in.
  const [roomTypes, setRoomTypes] = useState<RoomType[] | null>(null);
  const draftId = draft?.id;
  const resumeId = resume?.rowId;
  // "Save and continue later" (0115) — NEW listings only: the form is kept in
  // listing_drafts while the operator works (a few seconds after a change, on
  // every step change, and on Save & exit) and deleted once the listing is created.
  const draftRowRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const doneRef = useRef(false);
  const stepRef = useRef(0);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveProgressRef = useRef<((mode: "auto" | "explicit") => Promise<boolean>) | null>(null);
  const [progressSavedAt, setProgressSavedAt] = useState<number | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  stepRef.current = step;
  // Reset whenever the dialog (re)opens or a different listing/draft loads.
  useEffect(() => {
    setStep(Math.max(0, Math.min(LAST_STEP, resume?.step ?? 0)));
    setStepError(null);
    setError(null);
    setItinerary(draft?.highlights ?? []);
    setMultiRoom(!!draft?.multiRoom);
    setPolicy(draft?.cancellationPolicy ?? "flexible");
    draftRowRef.current = resume?.rowId ?? null;
    dirtyRef.current = false;
    doneRef.current = false;
    setProgressSavedAt(null);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftId, resumeId]);
  useEffect(() => {
    let alive = true;
    setRoomTypes(null);
    if (draftId && draft?.multiRoom) fetchRoomTypes(draftId).then((r) => alive && setRoomTypes(r));
    else setRoomTypes(resume?.roomTypes ?? []);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftId, resumeId]);
  // Moving to another step saves what's there so far.
  useEffect(() => {
    if (open && dirtyRef.current) void saveProgressRef.current?.("auto");
  }, [step, open]);
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
  }, []);
  if (!draft) return null;
  const isEdit = Boolean(draft.id);
  const isLast = step === LAST_STEP;
  // A published listing stays published on edit (no draft/submit toggle).
  const isPublished = draft.status === "published";
  const canSaveProgress = !isEdit;

  const collectLists = (): RefLists => ({
    amenities: amenitiesRef.current?.getValue() ?? [],
    photos: photosRef.current?.getValue() ?? [],
    itinerary,
    notIncluded: notIncludedRef.current?.getValue() ?? [],
    whatToBring: whatToBringRef.current?.getValue() ?? [],
    notSuitableFor: notSuitableForRef.current?.getValue() ?? [],
    houseRules: houseRulesRef.current?.getValue() ?? [],
    rooms: roomsRef.current?.getValue() ?? [],
    seasonalRates: ratesRef.current?.getValue() ?? [],
    coverFocus: photosRef.current?.getCoverFocus() ?? "50% 50%",
    videoUrl: videoRef.current?.getValue() ?? "",
    photoCaptions: photosRef.current?.getCaptions() ?? {},
  });

  // Save the unfinished form to listing_drafts (0115). "auto" stays quiet on
  // failure (retried on the next change); "explicit" (Save & exit) tells the operator.
  const saveProgress = async (mode: "auto" | "explicit"): Promise<boolean> => {
    if (!canSaveProgress || doneRef.current) return true;
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    if (!dirtyRef.current) return true;
    const form = formRef.current;
    if (!form) return false;
    let title = "";
    let data: ListingDraftData;
    try {
      const payload = toInputPayload(draft, form, collectLists());
      title = payload.title;
      const typedRooms = draft.type === "stay" && multiRoom ? roomTypesRef.current?.getValue() : undefined;
      data = { v: 1, listing: { ...(payload as unknown as DraftListing), type: draft.type, prefillImageUrl: draft.prefillImageUrl }, multiRoom: draft.type === "stay" ? multiRoom : undefined, roomTypes: typedRooms };
    } catch (err) {
      console.error("[listing drafts] snapshot", err);
      return false;
    }
    dirtyRef.current = false;
    setSavingProgress(true);
    try {
      draftRowRef.current = await saveListingDraft({ id: draftRowRef.current, type: draft.type as DraftListingType, title, step: stepRef.current, data });
      setProgressSavedAt(Date.now());
      onDraftsChanged?.();
      return true;
    } catch (err) {
      dirtyRef.current = true;
      console.error("[listing drafts] save", err);
      if (mode === "explicit") toast.error("Couldn't save your progress. Check your connection and try again.");
      return false;
    } finally {
      setSavingProgress(false);
    }
  };
  saveProgressRef.current = saveProgress;

  // Any edit in the form marks it unsaved and saves a few seconds later.
  const markDirty = () => {
    if (!canSaveProgress || doneRef.current) return;
    dirtyRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => void saveProgressRef.current?.("auto"), 3000);
  };

  // Closing (Save & exit, Escape, the overlay): a new listing with unsaved
  // changes is saved first; if that fails the form stays open so nothing is lost.
  const close = async () => {
    if (canSaveProgress && (dirtyRef.current || draftRowRef.current) && !doneRef.current) {
      const ok = await saveProgress("explicit");
      if (!ok) return;
      if (draftRowRef.current) toast(`Saved — continue anytime from ${draft.type === "tour" ? "Tours" : "Stays"} → Unfinished.`);
    }
    onOpenChange(false);
  };

  // Google Places autocomplete fills the uncontrolled fields imperatively.
  const setField = (name: string, value: string) => {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
    if (!el) return;
    el.value = value;
    // Let listeners (character counters) see programmatic fills like Aha AI's.
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const fieldValue = (name: string) =>
    ((formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "").trim();
  const fieldChecked = (name: string) => !!(formRef.current?.elements.namedItem(name) as HTMLInputElement | null)?.checked;

  // Draft context Aha uses to write/improve copy (reads the live form values).
  const ahaContext = (): AhaCopyContext => ({
    title: fieldValue("title"),
    city: fieldValue("city"),
    region: fieldValue("region"),
    priceUnit: fieldValue("priceUnit"),
    amenities: amenitiesRef.current?.getValue() ?? [],
    facts: [
      { label: "Space type", value: fieldValue("fact_spacetype") },
      { label: "Property type", value: fieldValue("fact_propertytype") },
      { label: "Duration", value: fieldValue("tourDuration") },
      { label: "Languages", value: fieldValue("tourLanguages") },
      { label: "Starting point", value: fieldValue("fact_startpoint") },
    ].filter((f) => f.value),
    shortDescription: fieldValue("shortDescription"),
    longDescription: fieldValue("longDescription"),
    highlights: itinerary,
  });
  const fail = (message: string): boolean => {
    setStepError(message);
    return false;
  };

  // Per-step required checks (native validation is off — hidden steps can't be
  // focused, so we gate progression ourselves; the server still Zod-validates).
  const validateStep = (s: number): boolean => {
    if (s === 0) {
      if (!fieldValue("title") || !fieldValue("eyebrow")) return fail("Add a title and an eyebrow label to continue.");
      const lengthProblem = firstListingTextProblem({ title: fieldValue("title"), eyebrow: fieldValue("eyebrow") });
      if (lengthProblem) return fail(lengthProblem);
    }
    if (s === 1) {
      if (!fieldValue("city") || !fieldValue("region")) return fail("Add the city and region.");
      const lat = Number(fieldValue("lat"));
      const lng = Number(fieldValue("lng"));
      if (!fieldValue("lat") || !fieldValue("lng") || Number.isNaN(lat) || Number.isNaN(lng)) return fail("Add the latitude and longitude.");
      if (lat < 38 || lat > 42 || lng < 43 || lng > 47) return fail("Coordinates must be inside Armenia (lat 38–42, lng 43–47).");
    }
    if (s === 2) {
      if (!fieldValue("shortDescription") || !fieldValue("longDescription")) return fail("Add a short and a full description.");
      const lengthProblem = firstListingTextProblem({ shortDescription: fieldValue("shortDescription"), longDescription: fieldValue("longDescription") });
      if (lengthProblem) return fail(lengthProblem);
    }
    // Step 3 — a hotel's room types (with their rooms and prices) live in "Describe it".
    if (s === 2 && draft.type === "stay" && multiRoom) {
      const roomError = validateRoomTypes(roomTypesRef.current?.getValue() ?? []);
      if (roomError) return fail(roomError);
    }
    // Step 5 — pricing. A hotel is priced per room (step 3), so only the
    // single-unit nightly price/offers are checked here.
    if (s === 4 && !(draft.type === "stay" && multiRoom)) {
      // A stay with the offer block picks which prices are required; everything
      // else (and a stay offered nightly) still requires the nightly price.
      const hasOfferBlock = draft.type === "stay" && !!formRef.current?.elements.namedItem("offer_nightly");
      const needNightly = !hasOfferBlock || fieldChecked("offer_nightly");
      if (needNightly && !(Number(fieldValue("price")) > 0)) return fail("Set a nightly price greater than ֏0 (or turn off ‘Nightly stays’).");
      if (hasOfferBlock) {
        if (!fieldChecked("offer_nightly") && !fieldChecked("offer_monthly") && !fieldChecked("offer_sale")) return fail("Pick at least one way to offer this place.");
        if (fieldChecked("offer_monthly") && !(Number(fieldValue("monthlyRent")) > 0)) return fail("Set a monthly rent for the long-term rental.");
        if (fieldChecked("offer_sale") && !(Number(fieldValue("salePrice")) > 0)) return fail("Set an asking price for the sale.");
      }
    }
    setStepError(null);
    return true;
  };

  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  // Jump straight to any step (clickable stepper) — no gating, so editors can
  // hop to the section they want without pressing Continue through the rest.
  const goToStep = (n: number) => {
    setStepError(null);
    setStep(Math.max(0, Math.min(LAST_STEP, n)));
  };

  // Validate every step; returns the first invalid step index, or -1 if all
  // pass. validateStep sets the visible error message for the failing step.
  const validateAll = (): number => {
    for (let s = 0; s < STEPS.length; s++) {
      if (!validateStep(s)) return s;
    }
    return -1;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // New listings keep the guided flow: validate the current step, then advance.
    if (!isEdit && !isLast) {
      if (!validateStep(step)) return;
      setStepError(null);
      setStep((s) => s + 1);
      return;
    }
    // Editing (or the final step of a new listing): validate everything and jump
    // to the first problem, otherwise save.
    const bad = validateAll();
    if (bad >= 0) {
      setStep(bad);
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
    const bad = validateAll();
    if (!form || bad >= 0) {
      if (bad >= 0) setStep(bad);
      return;
    }
    setSaving(true);
    setError(null);
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    try {
      const payload = toInputPayload(draft, form, collectLists());

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

      // Hotel (0092): the listing's own price/guests derive from its rooms —
      // price = cheapest room ("From ֏X"; a DB trigger keeps it in sync after
      // later room edits), max guests = the roomiest type. Nightly-only in v1.
      // Turning the flag off is sent explicitly; an ordinary stay never sends it.
      const hotelRooms = draft.type === "stay" && multiRoom ? (roomTypesRef.current?.getValue() ?? []) : null;
      if (hotelRooms) {
        // Cheapest room anywhere: a room's own price, else its type's default.
        const minCents = Math.min(...hotelRooms.flatMap((t) => (t.units.length ? t.units.map((u) => u.priceCents ?? t.priceCents) : [t.priceCents])));
        payload.multiRoom = true;
        payload.price = minCents / 100;
        payload.priceLabel = `֏${Math.round(minCents / 100).toLocaleString()}`;
        payload.priceUnit = "night";
        payload.maxGuests = Math.max(...hotelRooms.map((r) => r.maxGuests));
        payload.guestsIncluded = undefined;
        payload.extraGuestFeeCents = undefined;
        payload.offerTypes = ["nightly"];
      } else if (draft.multiRoom) {
        payload.multiRoom = false;
      }

      const saved = isEdit && draft.id ? await updateListing(draft.id, payload, submitForReview) : await createListing(payload, submitForReview);
      if (hotelRooms) {
        // Two-step save: the rooms reference the listing, so they're written
        // once the listing row exists.
        try {
          await saveRoomTypes(saved.id, hotelRooms);
        } catch (roomErr) {
          // The listing exists now, so close (a retry here would create a
          // duplicate) and point the operator at editing it.
          console.error("[dashboard] room types save failed", roomErr);
          toast.error(`${payload.title} was saved, but its rooms weren't. Edit the listing and save again to add them.`);
          onSaved();
          return;
        }
      }
      toast(submitForReview ? `${payload.title} submitted for review.` : `${payload.title} saved as a draft.`);
      // The listing exists now — its unfinished copy (0115) is no longer needed.
      doneRef.current = true;
      dirtyRef.current = false;
      if (draftRowRef.current) {
        const rowId = draftRowRef.current;
        draftRowRef.current = null;
        void deleteListingDraft(rowId)
          .catch((e) => console.error("[listing drafts] delete", e))
          .finally(() => onDraftsChanged?.());
      }
      // Virtual tour (0109): build it from the photos, or add new ones — in the background.
      if (draft.type === "stay") void autoTourAfterSave(saved.id);
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
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-basalt/25 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-paper text-basalt outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2"
          aria-describedby={undefined}
        >
          {/* Top bar — brand + save & exit */}
          <header className="flex items-center justify-between border-b border-basalt/10 px-4 py-3.5 sm:px-8">
            <BrandMark />
            <div className="flex items-center gap-3">
              {canSaveProgress && (savingProgress || progressSavedAt) && (
                <span className="hidden text-xs text-basalt/45 sm:inline" aria-live="polite">
                  {savingProgress ? "Saving…" : "Progress saved"}
                </span>
              )}
              <button
                type="button"
                onClick={() => void close()}
                disabled={savingProgress && !canSaveProgress}
                className="inline-flex min-h-10 items-center gap-2 rounded-none border border-basalt/15 px-3.5 py-2 text-[11px] sm:min-h-0 font-bold uppercase tracking-[0.12em] text-basalt/65 transition-colors hover:border-apricot hover:text-apricot"
              >
                {canSaveProgress ? "Save & exit" : "Exit"} <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          {/* Scrollable middle — one section per screen */}
          <div className="flex-1 overflow-y-auto">
            <form ref={formRef} noValidate onSubmit={submit} onChange={markDirty} onInput={markDirty} id="listing-onboarding" className="listing-form mx-auto w-full max-w-2xl px-5 py-6 sm:px-8 sm:py-16">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-apricot">
                {isEdit ? `Editing ${draft.type}` : `New ${draft.type}`} · Step {step + 1} of {STEPS.length}
              </p>

              {/* Clickable step navigator — jump straight to any section. */}
              <div className="mt-4 flex flex-nowrap gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible">
                {STEPS.map((s, i) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => goToStep(i)}
                    aria-current={i === step}
                    className={cn(
                      "flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-0 sm:shrink sm:whitespace-normal",
                      i === step ? "border-apricot bg-apricot text-white" : "border-basalt/15 text-basalt/60 hover:border-apricot hover:text-apricot",
                    )}
                  >
                    <span className="tabular-nums opacity-60">{i + 1}</span> {s.title}
                  </button>
                ))}
              </div>

              <DialogPrimitive.Title asChild>
                <h2 className="mt-6 font-display text-2xl leading-[1.02] tracking-[-0.03em] sm:text-5xl">{meta.title}</h2>
              </DialogPrimitive.Title>
              <p className="mt-3 max-w-md text-base leading-7 text-basalt/55">{meta.blurb(draft.type)}</p>

              {/* Step 1 — the basics */}
              <div hidden={step !== 0} className="mt-6 sm:mt-10 grid gap-6">
                {draft.prefillImageUrl && (
                  <div className="flex items-start gap-3 border border-basalt/10 bg-chalk p-3">
                    <img src={draft.prefillImageUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                    <p className="text-xs leading-5 text-basalt/55">
                      Reference photo from the link you pasted — shown for reference only, it won't be saved. Add your own hosted photo URL on the last step (or leave it blank for a brand illustration).
                    </p>
                  </div>
                )}
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="title" className="text-sm font-semibold">Title</Label>
                    <AhaAssist field="title" listingType={draft.type} getContext={ahaContext} getCurrent={() => fieldValue("title")} onApplyText={(t) => setField("title", t)} />
                  </div>
                  <Input id="title" name="title" maxLength={LISTING_LIMITS.title} placeholder="e.g. Forest House Dilijan" defaultValue={draft.title} className={FIELD} />
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-basalt/45">{LISTING_TEXT_LIMITS.title.min}–{LISTING_TEXT_LIMITS.title.max} characters, so it fits on listing cards without being cut off.</p>
                    <CharCount forId="title" field="title" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="eyebrow" className="text-sm font-semibold">Eyebrow label</Label>
                  <Input id="eyebrow" name="eyebrow" maxLength={LISTING_LIMITS.eyebrow} placeholder="e.g. Timber hideaway" defaultValue={draft.eyebrow} className={FIELD} />
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-basalt/45">A short kicker ({LISTING_TEXT_LIMITS.eyebrow.min}–{LISTING_TEXT_LIMITS.eyebrow.max} characters) shown above the title on cards — not a full sentence.</p>
                    <CharCount forId="eyebrow" field="eyebrow" />
                  </div>
                </div>
                <div className={cn("grid gap-2", HALF)}>
                  <Label htmlFor="accent" className="text-sm font-semibold">Map marker color</Label>
                  <Select name="accent" defaultValue={draft.accent}>
                    <SelectTrigger id="accent" className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
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
              <div hidden={step !== 1} className="mt-6 sm:mt-10 grid gap-6">
                {/* Existing listing: show the saved address so it's clear the
                    location is already set — the search below only changes it. */}
                {isEdit && (draft.address || draft.city) && (
                  <div className="flex items-start gap-3 border border-basalt/12 bg-chalk p-4">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-apricot" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-basalt/45">Saved address</p>
                      <p className="mt-0.5 text-sm font-semibold text-basalt">
                        {draft.address || `${draft.city}${draft.region && draft.region !== draft.city ? `, ${draft.region}` : ""}`}
                      </p>
                      {draft.coordinates?.lat && draft.coordinates?.lng && (
                        <p className="mt-0.5 text-xs text-basalt/45">{draft.coordinates.lat.toFixed(5)}, {draft.coordinates.lng.toFixed(5)}</p>
                      )}
                    </div>
                  </div>
                )}
                {/* Optional Google Places autofill — self-gates: renders nothing
                    unless VITE_GOOGLE_MAPS_API_KEY is set. Only ever sets the
                    fields below; the operator can still edit each by hand. */}
                <PlaceAutocomplete
                  label={isEdit ? "Search for a new address (optional)" : "Search for the address (optional)"}
                  helpText={isEdit ? "Only needed if the location changed — picking a result overwrites the full address, city, region, and coordinates below." : undefined}
                  onSelect={(place) => {
                    if (place.formattedAddress) setField("address", place.formattedAddress);
                    if (place.city) setField("city", place.city);
                    if (place.region) setField("region", place.region);
                    if (typeof place.lat === "number") setField("lat", String(place.lat));
                    if (typeof place.lng === "number") setField("lng", String(place.lng));
                  }}
                />
                {/* Exact full street address (operator-facing; shared with the guest after booking, not published on the public listing). */}
                <div className="grid gap-2">
                  <Label htmlFor="address" className="text-sm font-semibold">Full address <span className="font-normal text-basalt/45">(exact street address)</span></Label>
                  <Input id="address" name="address" placeholder="e.g. 12 Aram St, Apt 4, Yerevan 0010" defaultValue={draft.address} className={FIELD} />
                  <p className="text-xs text-basalt/45">Kept private — shared with the guest after they book, not shown publicly.</p>
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2">
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
                      <Input id="lat" name="lat" type="number" step="0.0001" min={38} max={42} defaultValue={draft.coordinates?.lat} className={FIELD} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="lng" className="text-xs font-semibold text-basalt/60">Longitude</Label>
                      <Input id="lng" name="lng" type="number" step="0.0001" min={43} max={47} defaultValue={draft.coordinates?.lng} className={FIELD} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 — describe it */}
              <div hidden={step !== 2} className="mt-6 sm:mt-10 grid gap-6">
                {/* Stay-only: what kind of place it is, then how it's laid out — a hotel's
                    room types (with their rooms and prices), or a home's rooms & beds. */}
                {draft.type === "stay" && (
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="fact_spacetype" className="text-sm font-semibold">Space type</Label>
                      <select
                        id="fact_spacetype"
                        name="fact_spacetype"
                        defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "space type")?.value ?? ""}
                        className={NATIVE_SELECT}
                      >
                        <option value="">Select…</option>
                        {STAY_SPACE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <p className="text-xs text-basalt/45">What the guest books — shows as e.g. “Room in guesthouse”.</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="fact_propertytype" className="text-sm font-semibold">Property type</Label>
                      <select
                        id="fact_propertytype"
                        name="fact_propertytype"
                        defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "property type")?.value ?? ""}
                        className={NATIVE_SELECT}
                      >
                        <option value="">Select a type…</option>
                        {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                {draft.type === "stay" && (
                  <div className="grid gap-5">
                    <div className="flex items-start gap-4 border border-basalt/15 bg-chalk/40 p-5">
                      <Switch id="multiRoom" checked={multiRoom} onCheckedChange={setMultiRoom} className="mt-0.5" />
                      <div>
                        <Label htmlFor="multiRoom" className="text-sm font-semibold">This is a multi-room property (hotel)</Label>
                        <p className="mt-1 text-sm text-basalt/55">For hotels, guesthouses and hostels. Add your room types and their rooms, each with its price; guests choose a room type on your page.</p>
                      </div>
                    </div>
                    {multiRoom &&
                      (roomTypes === null ? (
                        <p className="text-sm text-basalt/50">Loading your room types…</p>
                      ) : (
                        <RoomTypesEditor ref={roomTypesRef} defaultValue={roomTypes} />
                      ))}
                  </div>
                )}
                {draft.type === "stay" && (
                  <div hidden={multiRoom}>
                    <RoomsEditor ref={roomsRef} defaultValue={draft.rooms ?? []} />
                  </div>
                )}

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="shortDescription" className="text-sm font-semibold">Short description</Label>
                    <AhaAssist field="shortDescription" listingType={draft.type} getContext={ahaContext} getCurrent={() => fieldValue("shortDescription")} onApplyText={(t) => setField("shortDescription", t)} />
                  </div>
                  <Textarea id="shortDescription" name="shortDescription" maxLength={LISTING_LIMITS.shortDescription} rows={2} placeholder="One or two lines shown on cards." defaultValue={draft.shortDescription} className="rounded-none text-base md:text-base" />
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-basalt/45">{LISTING_TEXT_LIMITS.shortDescription.min}–{LISTING_TEXT_LIMITS.shortDescription.max} characters — exactly the two lines a listing card shows.</p>
                    <CharCount forId="shortDescription" field="shortDescription" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="longDescription" className="text-sm font-semibold">Full description</Label>
                    <div className="flex items-center gap-2">
                      <BoldButton forId="longDescription" />
                      <AhaAssist field="longDescription" listingType={draft.type} getContext={ahaContext} getCurrent={() => fieldValue("longDescription")} onApplyText={(t) => setField("longDescription", t)} />
                    </div>
                  </div>
                  <Textarea id="longDescription" name="longDescription" maxLength={LISTING_LIMITS.longDescription} rows={5} placeholder="The full write-up shown on the listing page." defaultValue={draft.longDescription} className="rounded-none text-base md:text-base" />
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-basalt/45">At least {LISTING_TEXT_LIMITS.longDescription.min} characters — a few real sentences about the place. To make words bold, select them and press <strong className="font-semibold text-basalt/70">B</strong>.</p>
                    <CharCount forId="longDescription" field="longDescription" />
                  </div>
                </div>
                {draft.type === "stay" && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="neighborhood" className="text-sm font-semibold">Describe the neighborhood <span className="font-normal text-basalt/45">(optional)</span></Label>
                      <div className="flex items-center gap-2">
                        <BoldButton forId="neighborhood" />
                        <AhaAssist field="neighborhood" listingType={draft.type} getContext={ahaContext} getCurrent={() => fieldValue("neighborhood")} onApplyText={(t) => setField("neighborhood", t)} />
                      </div>
                    </div>
                    <Textarea id="neighborhood" name="neighborhood" rows={3} placeholder="What's the area like — the street, the vibe, what's within a short walk?" defaultValue={draft.neighborhood} className="rounded-none text-base md:text-base" />
                    <p className="text-xs text-basalt/45">Nearby major sights are shown automatically on your listing based on its location.</p>
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="tags" className="text-sm font-semibold">Tags <span className="font-normal text-basalt/45">(comma separated)</span></Label>
                  <Input id="tags" name="tags" placeholder="Forest, Breakfast, Design stay" defaultValue={draft.tags?.join(", ")} className={FIELD} />
                </div>
              </div>

              {/* Step 4 — amenities & photos */}
              <div hidden={step !== 3} className="mt-6 sm:mt-10 grid gap-8">
                <AmenityPicker ref={amenitiesRef} type={draft.type} defaultValue={draft.amenities ?? []} />

                {draft.type === "stay" && (
                  <div className="grid gap-3">
                    <div>
                      <p className="text-sm font-semibold">Check-in & checkout times <span className="font-normal text-basalt/45">(optional)</span></p>
                      <p className="mt-0.5 text-xs text-basalt/45">Shown on your listing and in the guest's confirmation email.</p>
                    </div>
                    <div className="grid items-start gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="fact_checkin" className="text-sm font-semibold">Check-in from</Label>
                        <TimeSelect
                          id="fact_checkin"
                          name="fact_checkin"
                          defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "check-in")?.value ?? ""}
                          className={NATIVE_SELECT}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="fact_checkout" className="text-sm font-semibold">Checkout by</Label>
                        <TimeSelect
                          id="fact_checkout"
                          name="fact_checkout"
                          defaultValue={draft.facts?.find((f) => f.label.toLowerCase() === "checkout")?.value ?? ""}
                          className={NATIVE_SELECT}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {draft.type === "stay" && <HouseRulesPicker ref={houseRulesRef} defaultValue={draft.houseRules ?? []} />}

                {/* Tour & experience-only detail fields. */}
                {(draft.type === "tour" || draft.type === "experience") && (
                  <div className="grid gap-6">
                    <div className="flex items-center justify-end">
                      <AhaAssist field="highlights" listingType={draft.type} getContext={ahaContext} getCurrent={() => itinerary.join("\n")} onApplyItems={(items) => setItinerary(items)} />
                    </div>
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
                      <Textarea id="importantInfo" name="importantInfo" rows={2} placeholder="Age restrictions, accessibility notes, cancellation policy…" defaultValue={draft.importantInfo} className="rounded-none text-base md:text-base" />
                    </div>
                  </div>
                )}

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
                        <div key={i} className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                          <Input name={`fact${i + 1}Label`} placeholder={`Label, e.g. ${exLabel}`} defaultValue={draft.facts?.[i]?.label} className={FIELD} />
                          <Input name={`fact${i + 1}Value`} placeholder={`Value, e.g. ${exValue}`} defaultValue={draft.facts?.[i]?.value} className={FIELD} />
                        </div>
                      );
                    })}
                  </div>
                </details>

                <PhotoUploader ref={photosRef} captions defaultCaptions={draft.photoCaptions} defaultValue={realPhotos(draft)} defaultFocus={draft.coverFocus} max={draft.type === "stay" && multiRoom ? HOTEL_MAX_PHOTOS : undefined} />

                <div className="grid gap-2">
                  <p className="text-sm font-semibold text-basalt">Intro video <span className="font-normal text-basalt/45">(optional — a short clip really helps)</span></p>
                  <VideoField ref={videoRef} defaultValue={draft.videoUrl} />
                </div>

                <label className="flex items-center gap-3 border border-basalt/12 bg-chalk px-4 py-3 text-sm">
                  <input type="checkbox" name="featured" defaultChecked={draft.featured} className="h-4 w-4 accent-[#F15822]" />
                  Feature on the home page
                </label>
              </div>

              {/* Step 5 — pricing */}
              <div hidden={step !== 4} className="mt-6 sm:mt-10 grid gap-8">

                {/* revampstay — "How do you want to offer it?" (stays only).
                    Nightly is always on (the price field below); monthly and
                    sale reveal their own blocks. Shown here because listing on
                    revampstay only needs the extra fields an operator opts into. */}
                {draft.type === "stay" && !multiRoom && (
                  <div className="rounded-none border border-basalt/15 bg-chalk/40 p-5">
                    <p className="text-sm font-semibold">How do you want to offer it?</p>
                    <p className="mt-1 text-sm text-basalt/55">Pick one or more. Nightly stays show on revampvacations; monthly rentals and sales show on revampstay.</p>
                    <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:gap-6">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="offer_nightly" defaultChecked className="h-4 w-4 accent-apricot" /> Nightly stays
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="offer_monthly" defaultChecked={offerMonthly} onChange={(e) => setOfferMonthly(e.currentTarget.checked)} className="h-4 w-4 accent-apricot" /> Long-term rental
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="offer_sale" defaultChecked={offerSale} onChange={(e) => setOfferSale(e.currentTarget.checked)} className="h-4 w-4 accent-apricot" /> For sale
                      </label>
                    </div>

                    {offerMonthly && (
                      <div className="mt-5 grid gap-4 border-t border-basalt/10 pt-5 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor="monthlyRent" className="text-sm font-semibold">Monthly rent in AMD</Label>
                          <Input id="monthlyRent" name="monthlyRent" type="number" min={0} placeholder="e.g. 420000" defaultValue={draft.monthlyRentCents ? draft.monthlyRentCents / 100 : ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="deposit" className="text-sm font-semibold">Deposit in AMD <span className="font-normal text-basalt/45">(optional)</span></Label>
                          <Input id="deposit" name="deposit" type="number" min={0} placeholder="e.g. 420000" defaultValue={draft.depositCents ? draft.depositCents / 100 : ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="minLeaseMonths" className="text-sm font-semibold">Minimum lease <span className="font-normal text-basalt/45">(months)</span></Label>
                          <Input id="minLeaseMonths" name="minLeaseMonths" type="number" min={1} max={36} placeholder="e.g. 3" defaultValue={draft.minLeaseMonths || ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="furnished" className="text-sm font-semibold">Furnishing</Label>
                          <Select name="furnished" defaultValue={draft.furnished ?? "furnished"}>
                            <SelectTrigger id="furnished" className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="furnished">Furnished</SelectItem>
                              <SelectItem value="semi">Semi-furnished</SelectItem>
                              <SelectItem value="unfurnished">Unfurnished</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="availableFrom" className="text-sm font-semibold">Available from <span className="font-normal text-basalt/45">(optional)</span></Label>
                          <Input id="availableFrom" name="availableFrom" type="date" defaultValue={draft.availableFrom ?? ""} className={FIELD} />
                        </div>
                        <label className="flex items-center gap-2 self-end pb-3 text-sm">
                          <input type="checkbox" name="utilitiesIncluded" defaultChecked={draft.utilitiesIncluded ?? false} className="h-4 w-4 accent-apricot" /> Utilities included
                        </label>
                      </div>
                    )}

                    {offerSale && (
                      <div className="mt-5 grid gap-4 border-t border-basalt/10 pt-5 sm:grid-cols-2">
                        <div className="grid gap-2 sm:col-span-2">
                          <Label htmlFor="salePrice" className="text-sm font-semibold">Asking price in AMD</Label>
                          <Input id="salePrice" name="salePrice" type="number" min={0} placeholder="e.g. 85000000" defaultValue={draft.salePriceCents ? draft.salePriceCents / 100 : ""} className={FIELD} />
                          <p className="text-xs text-basalt/45">Sales are listed for inquiry only — buyers request a viewing; no payment is taken on Revamp.</p>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="areaM2" className="text-sm font-semibold">Area (m²)</Label>
                          <Input id="areaM2" name="areaM2" type="number" min={0} step="0.1" placeholder="e.g. 72" defaultValue={draft.areaM2 || ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="yearBuilt" className="text-sm font-semibold">Year built <span className="font-normal text-basalt/45">(optional)</span></Label>
                          <Input id="yearBuilt" name="yearBuilt" type="number" min={1800} max={2100} placeholder="e.g. 2015" defaultValue={draft.yearBuilt || ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="floor" className="text-sm font-semibold">Floor <span className="font-normal text-basalt/45">(optional)</span></Label>
                          <Input id="floor" name="floor" type="number" placeholder="e.g. 4" defaultValue={draft.floor || ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="totalFloors" className="text-sm font-semibold">Total floors <span className="font-normal text-basalt/45">(optional)</span></Label>
                          <Input id="totalFloors" name="totalFloors" type="number" placeholder="e.g. 9" defaultValue={draft.totalFloors || ""} className={FIELD} />
                        </div>
                        <div className="grid gap-2 sm:col-span-2">
                          <Label htmlFor="ownershipType" className="text-sm font-semibold">Ownership <span className="font-normal text-basalt/45">(optional)</span></Label>
                          <Input id="ownershipType" name="ownershipType" placeholder="e.g. private, new build" defaultValue={draft.ownershipType ?? ""} className={FIELD} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid items-start gap-4 sm:grid-cols-2">
                  {/* A hotel's price, unit and guest caps come from its room types. */}
                  <div className="grid gap-2" hidden={multiRoom}>
                    <Label htmlFor="price" className="text-sm font-semibold">Price in AMD ({draft.type === "stay" ? "per night" : "per person"})</Label>
                    <Input id="price" name="price" type="number" min={1} placeholder="e.g. 45000" defaultValue={draft.price || ""} className={FIELD} />
                  </div>
                  <div className="grid gap-2" hidden={multiRoom}>
                    <Label htmlFor="priceUnit" className="text-sm font-semibold">Price unit label</Label>
                    <Input id="priceUnit" name="priceUnit" placeholder={draft.type === "stay" ? "night" : "person"} defaultValue={draft.priceUnit} className={FIELD} />
                  </div>
                  <div className="grid gap-2" hidden={multiRoom}>
                    <Label htmlFor="maxGuests" className="text-sm font-semibold">Max guests</Label>
                    <Input id="maxGuests" name="maxGuests" type="number" min={1} max={50} placeholder={draft.type === "stay" ? "e.g. 4" : "e.g. 8"} defaultValue={draft.maxGuests || ""} className={FIELD} />
                  </div>
                  {draft.type === "stay" ? (
                    <div className="grid gap-2">
                      <Label htmlFor="cleaningFee" className="text-sm font-semibold">Cleaning fee (AMD)</Label>
                      <Input id="cleaningFee" name="cleaningFee" type="number" min={0} placeholder="e.g. 10000" defaultValue={draft.cleaningFeeCents ? draft.cleaningFeeCents / 100 : ""} className={FIELD} />
                      <p className="text-xs text-basalt/45">Optional — charged once per booking.</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="extraFeeType" className="text-sm font-semibold">Extra fee</Label>
                        <Select name="extraFeeType" defaultValue={draft.extraFeeType || "none"}>
                          <SelectTrigger id="extraFeeType" className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {extraFeeOptions(draft.extraFeeType).map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                            <SelectItem value="none">Other (shown as “Extra fee”)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-basalt/45">Optional — what guests pay for on top of the price.</p>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="cleaningFee" className="text-sm font-semibold">Fee amount (AMD)</Label>
                        <Input id="cleaningFee" name="cleaningFee" type="number" min={0} placeholder="e.g. 3000" defaultValue={draft.cleaningFeeCents ? draft.cleaningFeeCents / 100 : ""} className={FIELD} />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="extraFeePer" className="text-sm font-semibold">Charge the fee</Label>
                        <Select name="extraFeePer" defaultValue={draft.extraFeePer === "person" ? "person" : "booking"}>
                          <SelectTrigger id="extraFeePer" className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="booking">Once per booking</SelectItem>
                            <SelectItem value="person">Per guest</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                  {draft.type === "stay" && !multiRoom && (
                    <>
                      <div className="grid gap-2">
                        <Label htmlFor="guestsIncluded" className="text-sm font-semibold">Guests included</Label>
                        <Input id="guestsIncluded" name="guestsIncluded" type="number" min={1} max={50} placeholder="e.g. 2" defaultValue={draft.guestsIncluded || ""} className={FIELD} />
                        <p className="text-xs text-basalt/45">Optional — guests covered by the nightly price.</p>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="extraGuestFee" className="text-sm font-semibold">Extra guest fee (AMD)</Label>
                        <Input id="extraGuestFee" name="extraGuestFee" type="number" min={0} placeholder="e.g. 8000" defaultValue={draft.extraGuestFeeCents ? draft.extraGuestFeeCents / 100 : ""} className={FIELD} />
                        <p className="text-xs text-basalt/45">Per extra guest, per night.</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Seasonal / per-date rates and minimum stay (a hotel prices per room instead). */}
                {draft.type === "stay" && (
                  <div hidden={multiRoom} className="grid gap-6">
                    <RatesEditor ref={ratesRef} defaultValue={draft.seasonalRates ?? []} rate={siteSettings.usdToAmdRate} />
                  </div>
                )}
                {draft.type === "stay" && (
                  <div className={cn("grid gap-2", HALF)}>
                    <Label htmlFor="fact_minstay" className="text-sm font-semibold">Minimum stay <span className="font-normal text-basalt/45">(nights)</span></Label>
                    <Input id="fact_minstay" name="fact_minstay" type="number" min={1} max={365} placeholder="e.g. 2" defaultValue={parseInt(draft.facts?.find((f) => f.label.toLowerCase() === "minimum stay")?.value ?? "", 10) || ""} className={FIELD} />
                  </div>
                )}

                <div className="grid gap-4 border border-basalt/10 bg-chalk/60 p-4">
                  <div className="grid gap-2">
                    <Label htmlFor="cancellationPolicy" className="text-sm font-semibold">Cancellation policy</Label>
                    <Select name="cancellationPolicy" defaultValue={draft.cancellationPolicy ?? "flexible"} onValueChange={(v) => setPolicy(v === "non_refundable" ? "non_refundable" : "flexible")}>
                      <SelectTrigger id="cancellationPolicy" className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flexible">Flexible — free cancellation up to a cutoff</SelectItem>
                        <SelectItem value="non_refundable">Non-refundable — cheaper, no refunds</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    <div className="grid gap-2" hidden={policy !== "flexible"}>
                      <Label htmlFor="freeCancelDays" className="text-sm font-semibold">Free-cancel window <span className="font-normal text-basalt/45">(days)</span></Label>
                      <Input id="freeCancelDays" name="freeCancelDays" type="number" min={0} max={365} placeholder="7" defaultValue={draft.freeCancelDays ?? 7} className={FIELD} />
                      <p className="text-xs text-basalt/45">Days before {draft.type === "stay" ? "check-in" : "the start"} that free cancellation ends. After it, no refund.</p>
                    </div>
                    <div className="grid gap-2" hidden={policy !== "non_refundable"}>
                      <Label htmlFor="nonrefundableDiscountPercent" className="text-sm font-semibold">Non-refundable discount %</Label>
                      <Input id="nonrefundableDiscountPercent" name="nonrefundableDiscountPercent" type="number" min={0} max={90} placeholder="5" defaultValue={draft.nonrefundableDiscountPercent ?? 5} className={FIELD} />
                      <p className="text-xs text-basalt/45">Off the price, as the reason to book without refunds.</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 border border-basalt/10 bg-chalk/60 p-4">
                  <div>
                    <Label className="text-sm font-semibold">Discount <span className="font-normal text-basalt/45">(optional sale for a travel-date window)</span></Label>
                    <p className="mt-1 text-xs text-basalt/45">Applies when a guest's check-in falls within the dates below. Shows an "on sale" badge on your listing.</p>
                  </div>
                  <div className="grid items-start gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="discountType" className="text-sm font-semibold">Type</Label>
                      <Select name="discountType" defaultValue={draft.discountType ?? "none"}>
                        <SelectTrigger id="discountType" className={SELECT_TRIGGER}><SelectValue /></SelectTrigger>
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
            <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-nowrap sm:gap-4 sm:px-8">
              {/* Phones: icon-only Back so Save as draft + Submit fit beside it. */}
              <Button type="button" variant="ghost" className="h-10 w-10 shrink-0 rounded-none px-0 text-sm disabled:opacity-0 sm:h-9 sm:w-auto sm:px-2" onClick={goBack} disabled={step === 0}>
                <ArrowLeft className="h-4 w-4 sm:mr-2" /> <span className="sr-only sm:not-sr-only">Back</span>
              </Button>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
                {/* When editing, save/submit is available from any step; a new
                    listing keeps the guided flow (Continue until the last step). */}
                {!isPublished && (isEdit || isLast) && (
                  <Button type="button" variant="outline" className="h-10 rounded-none px-3 sm:h-9 sm:px-5" disabled={saving} onClick={() => persist(false)}>
                    Save as draft
                  </Button>
                )}
                <Button type="submit" form="listing-onboarding" className="h-10 rounded-none bg-apricot px-3 text-white hover:bg-apricot/90 sm:h-9 sm:px-6" disabled={saving}>
                  {saving ? "Saving…" : !isEdit && !isLast ? "Continue" : isPublished ? "Save changes" : "Submit for review"}
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
const ICAL_SOURCE: Record<ListingType, { name: string; placeholder: string; helpUrl?: string; helpLabel?: string }> = {
  stay: { name: "Airbnb", placeholder: "https://www.airbnb.com/calendar/ical/….ics" },
  tour: { name: "GetYourGuide", placeholder: "https://…/calendar/….ics (GetYourGuide, Viator, etc.)" },
  experience: {
    name: "Fresha",
    placeholder: "https://…/….ics  —  Fresha ▸ Calendar ▸ Sync your calendar",
    helpUrl: "https://www.fresha.com/help-center/knowledge-base/calendar/208-sync-your-fresha-calendar",
    helpLabel: "How to get your Fresha calendar link",
  },
  eat: { name: "your booking platform", placeholder: "https://…/….ics" },
  // `place` is admin-curated and non-bookable; present only to keep this map total over ListingType.
  place: { name: "your booking platform", placeholder: "https://…/….ics" },
};

function AvailabilityRow({ listing }: { listing: LiveListing }) {
  // Stays typically list on both Airbnb and Booking.com and want a two-way feed;
  // other types keep the simpler single-calendar import.
  // Hotels sync per room: each room has its own Airbnb/Booking.com calendar.
  if (listing.type === "stay" && listing.multiRoom) return <HotelCalendarSync listingId={listing.id} published={listing.status === "published"} />;
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

  // Re-pull the ALREADY-SAVED calendar on demand (no URL edit needed). This is
  // the operator's manual refresh — handy if the daily auto-refresh is delayed.
  const resync = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await syncIcal(listing.id);
      setMsg(`Synced — ${res.count} blocked date ${res.count === 1 ? "range" : "ranges"}.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't sync that calendar.");
    } finally {
      setBusy(false);
    }
  };
  const hasSaved = !!listing.icalUrl;

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
          className="h-11 min-w-0 flex-1 rounded-none text-base sm:h-9 sm:text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-11 shrink-0 rounded-none border-basalt/15 text-xs sm:h-9", isSynced && "border-green-600/40 bg-green-600/10 text-green-700 hover:bg-green-600/15")}
          disabled={busy}
          onClick={save}
        >
          {busy ? "Syncing…" : isSynced ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Synced</> : url.trim() ? "Save & sync" : "Save"}
        </Button>
        {hasSaved && (
          <Button type="button" variant="ghost" size="sm" className="h-11 shrink-0 rounded-none text-xs text-basalt/60 hover:text-basalt sm:h-9" disabled={busy} onClick={resync} title="Re-pull the connected calendar now">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "animate-spin")} /> Re-sync
          </Button>
        )}
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

  // Re-pull the ALREADY-SAVED feeds on demand (no URL edit needed) — the
  // operator's manual refresh, independent of the daily auto-refresh cron.
  const resync = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await syncIcal(listing.id);
      const n = res.feeds ?? listing.icalFeeds.length;
      setMsg(`Synced ${n} calendar${n === 1 ? "" : "s"} — ${res.count} blocked date ${res.count === 1 ? "range" : "ranges"}.${res.errors?.length ? ` Issues: ${res.errors.join("; ")}` : ""}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't sync those calendars.");
    } finally {
      setBusy(false);
    }
  };
  const hasSaved = listing.icalFeeds.length > 0 || !!listing.icalUrl;

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
        <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-semibold text-basalt/60 sm:w-24">Airbnb</span>
          <Input type="url" value={airbnb} onChange={(e) => { setAirbnb(e.target.value); setMsg(null); setErr(null); }} placeholder="https://www.airbnb.com/calendar/ical/….ics" className="h-11 min-w-0 flex-1 rounded-none text-base sm:h-9 sm:text-xs" />
        </div>
        <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="shrink-0 text-xs font-semibold text-basalt/60 sm:w-24">Booking.com</span>
          <Input type="url" value={booking} onChange={(e) => { setBooking(e.target.value); setMsg(null); setErr(null); }} placeholder="https://admin.booking.com/hotel/…/ical.html?…" className="h-11 min-w-0 flex-1 rounded-none text-base sm:h-9 sm:text-xs" />
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        {hasSaved && (
          <Button type="button" variant="ghost" size="sm" className="h-10 rounded-none text-xs text-basalt/60 hover:text-basalt sm:h-9" disabled={busy} onClick={resync} title="Re-pull the connected calendars now">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "animate-spin")} /> Re-sync
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className={cn("h-10 rounded-none border-basalt/15 text-xs sm:h-9", isSynced && "border-green-600/40 bg-green-600/10 text-green-700 hover:bg-green-600/15")} disabled={busy} onClick={save}>
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
        <Input readOnly value={exportUrl} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-none bg-chalk text-base sm:h-9 sm:text-xs" />
        <Button type="button" variant="outline" size="sm" className="h-11 shrink-0 rounded-none border-basalt/15 text-xs sm:h-9" onClick={copy}>
          {copied ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied</> : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy</>}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-basalt/45">Add this link under “Import calendar” on Airbnb and Booking.com so your Revamp bookings and blocked dates sync there too.</p>
    </div>
  );
}

function DashboardSection({ type, title, description, wizardMode }: { type: ListingType; title: string; description: string; wizardMode?: boolean }) {
  const { user } = useAuth();
  const { listings } = useListings();
  const [, navigate] = useLocation();
  const items = listings.filter((l) => l.type === type && l.operatorId === user?.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftListing | null>(null);
  // Unfinished new listings of this type (0115) — "save and continue later".
  const [resume, setResume] = useState<ListingResume | null>(null);
  const [unfinished, setUnfinished] = useState<ListingDraftRow[]>([]);
  const reloadDrafts = useCallback(() => {
    if (user) void listListingDrafts(user.id, type as DraftListingType).then(setUnfinished);
  }, [user, type]);
  useEffect(reloadDrafts, [reloadDrafts]);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Virtual tours (0109) — stays only: each row's status chip + editor.
  const [tours, setTours] = useState<Map<string, ListingTour>>(new Map());
  const tourIds = type === "stay" ? items.map((l) => l.id).join(",") : "";
  const reloadTours = () => {
    if (tourIds) void fetchToursFor(tourIds.split(",")).then(setTours);
  };
  useEffect(() => {
    reloadTours();
    if (!tourIds) return;
    const on = () => reloadTours();
    window.addEventListener(TOUR_CHANGED_EVENT, on);
    return () => window.removeEventListener(TOUR_CHANGED_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourIds]);

  // `wizardMode` (Experiences only) routes Add/Edit/prefill to the full-page
  // wizard (App.tsx's /dashboard/experiences/*) instead of the shared dialog.
  const openAdd = () => {
    if (wizardMode) { navigate("/dashboard/experiences/new"); return; }
    setResume(null);
    setDraft(emptyDraft(type));
    setDialogOpen(true);
  };
  const openEdit = (listing: LiveListing) => {
    if (wizardMode) { navigate(`/dashboard/experiences/${listing.id}/edit`); return; }
    setResume(null);
    setDraft(listing);
    setDialogOpen(true);
  };
  const continueDraft = (row: ListingDraftRow) => {
    if (wizardMode) { navigate(`/dashboard/experiences/new?draft=${row.id}`); return; }
    const data = row.data as ListingDraftData;
    setDraft(restoreListingDraft(type, data));
    setResume({ rowId: row.id, step: row.step, roomTypes: restoreRoomTypes(data?.roomTypes) });
    setDialogOpen(true);
  };
  const discardDraft = async (row: ListingDraftRow) => {
    if (!window.confirm(`Discard "${row.title || `Untitled ${type}`}"? What you entered will be deleted.`)) return;
    try {
      await deleteListingDraft(row.id);
      setUnfinished((all) => all.filter((r) => r.id !== row.id));
      toast("Unfinished listing discarded.");
    } catch (e) {
      console.error("[listing drafts] discard", e);
      toast.error("Couldn't discard it. Please try again.");
    }
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
      setResume(null);
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

  return (
    <section className="border-t border-basalt/10 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight tracking-[-0.01em]">
            {title} <span className="font-normal tabular-nums text-basalt/50">· {items.length}</span>
          </h2>
          <p className="mt-1 max-w-md text-sm text-basalt/60">{description}</p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <Button onClick={openAdd} className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90 sm:h-9">
            <Plus className="mr-2 h-4 w-4" /> Add {type}
          </Button>
          <form onSubmit={handleImport} className="flex w-full items-center gap-2 sm:w-auto">
            <Input
              type="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="Or paste a listing link to prefill"
              className="h-12 min-w-0 flex-1 rounded-none text-base sm:h-9 sm:w-64 sm:flex-none sm:text-xs"
            />
            <Button type="submit" variant="outline" size="sm" className="h-12 shrink-0 rounded-none border-basalt/15 text-xs sm:h-9" disabled={importing || !importUrl.trim()}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> {importing ? "Fetching…" : "Prefill"}
            </Button>
          </form>
        </div>
      </div>
      {importError && <p className="mt-2 text-right text-xs text-destructive">{importError}</p>}

      {unfinished.length > 0 && (
        <div className="mt-5 border border-apricot/30 bg-apricot/[0.04]">
          <p className="border-b border-apricot/20 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-apricot">Unfinished · saved automatically</p>
          <ul className="divide-y divide-apricot/15">
            {unfinished.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.title || `Untitled ${type}`}</p>
                  <p className="text-xs text-basalt/55">
                    Stopped at step {row.step + 1} of {wizardMode ? EXPERIENCE_STEP_COUNT : STEPS.length} · saved {savedAgo(row.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => continueDraft(row)} className="h-10 rounded-none bg-apricot text-white hover:bg-apricot/90 sm:h-8">Continue</Button>
                  <Button size="sm" variant="ghost" onClick={() => void discardDraft(row)} className="h-10 rounded-none text-basalt/55 hover:text-destructive sm:h-8">Discard</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-5 border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">Nothing here yet — add your first one above.</p>
      ) : (
        <ul className="mt-5 divide-y divide-basalt/10 border border-basalt/10 bg-paper">
          {items.map((listing) => (
            <OperatorListingRow key={listing.id} listing={listing} onEdit={() => openEdit(listing)} tour={tours.get(listing.id) ?? null} onTourChanged={reloadTours} />
          ))}
        </ul>
      )}

      {!wizardMode && (
        <ListingFormDialog
          draft={draft}
          resume={resume}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSaved={() => {
            setDialogOpen(false);
            reloadDrafts();
          }}
          onDraftsChanged={reloadDrafts}
        />
      )}
    </section>
  );
}

/** "Synced 2h ago" / "Not connected" for a listing's calendar disclosure. */
function calendarStatus(listing: LiveListing): { text: string; warn: boolean } {
  if (listing.type === "stay" && listing.multiRoom) return { text: "Calendars per room", warn: false };
  const connected = listing.icalFeeds.length > 0 || !!listing.icalUrl;
  const sched = listing.type !== "stay" ? " · schedule" : "";
  if (!connected) return { text: `Not connected${sched}`, warn: false };
  if (listing.icalError) return { text: "Sync issue — check the link", warn: true };
  if (!listing.icalSyncedAt) return { text: "Not synced yet", warn: true };
  const h = (Date.now() - Date.parse(listing.icalSyncedAt)) / 3_600_000;
  const ago = h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  return { text: `Synced ${ago} ago${sched}`, warn: h > 6 };
}

/**
 * One listing in Dashboard → Listings: a compact row — photo, title (opens the
 * editor), status, place · price, and a link to the guest page in a new tab.
 * Calendar sync (import/export links) and the tour schedule fold away under
 * "Calendar", showing only its status until opened. The ⋯ menu also holds
 * Suspend bookings / Resume and the Active switch (0101) — listings are switched
 * off, never deleted, so existing bookings and history stay intact.
 */
function OperatorListingRow({ listing, onEdit, tour = null, onTourChanged }: { listing: LiveListing; onEdit: () => void; tour?: ListingTour | null; onTourChanged?: () => void }) {
  const { refresh } = useListings();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<AvailabilityMode | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const isStay = listing.type === "stay";
  // "Check tour" in the post-save toast opens this row's tour editor.
  useEffect(() => {
    if (!isStay) return;
    const on = (e: Event) => {
      if ((e as CustomEvent<{ listingId: string }>).detail?.listingId === listing.id) setTourOpen(true);
    };
    window.addEventListener(OPEN_TOUR_EVENT, on);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, on);
  }, [isStay, listing.id]);
  const cal = calendarStatus(listing);
  const active = listing.isActive !== false;
  const paused = suspensionBlocked(listing).length > 0;
  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3">
        {listing.image ? <img src={listing.image} alt="" className={cn("h-12 w-12 shrink-0 rounded-md object-cover", !active && "opacity-40 grayscale")} /> : <span aria-hidden className="h-12 w-12 shrink-0 rounded-md bg-chalk" />}
        <div className="min-w-0 flex-1">
          {/* Phones: title + ↗ get their own line, badges wrap below it. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
            <span className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto">
              <button type="button" onClick={onEdit} title="Edit listing" className="min-w-0 truncate text-left text-base font-semibold text-basalt underline-offset-4 hover:text-apricot hover:underline focus-visible:outline-2 focus-visible:outline-apricot">
                {listing.title}
              </button>
              <a href={`/listing/${listing.slug}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${listing.title} in a new tab`} title="Open the guest page in a new tab" className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-basalt/55 hover:bg-chalk hover:text-apricot sm:h-7 sm:w-7">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </span>
            <span className="shrink-0"><StatusBadge status={listing.status} reviewNote={listing.reviewNote} /></span>
            {!active && <span className="shrink-0 border border-basalt/30 bg-basalt px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-paper">Inactive</span>}
            {isStay && tour && (
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className={cn("hidden shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold sm:inline-flex", tour.status === "live" ? "border-basalt/15 text-basalt/60 hover:text-basalt" : "border-apricot/50 text-apricot hover:bg-apricot/5")}
              >
                <Footprints className="h-3 w-3" aria-hidden /> {tour.status === "live" ? "Tour live" : "Tour to check"}
              </button>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-basalt/60">
            {listing.city} · {listing.priceLabel}{listing.price > 0 ? ` / ${listing.priceUnit}` : ""}
            {paused && <span className="hidden font-semibold text-basalt sm:inline"> · Bookings suspended {suspensionLabel(listing)}</span>}
          </p>
          {paused && <p className="mt-0.5 text-xs font-semibold text-basalt sm:hidden">Bookings suspended {suspensionLabel(listing)}</p>}
          {/* The sync pill below is desktop-only; phones still need to see sync problems. */}
          <p className={cn("mt-0.5 flex items-center gap-1 text-xs sm:hidden", cal.warn ? "font-semibold text-apricot" : "text-basalt/50")}>
            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden /> {cal.text}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn("hidden h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold sm:inline-flex", cal.warn ? "border-apricot/50 text-apricot" : "border-basalt/15 text-basalt/70 hover:border-basalt/40 hover:text-basalt")}
        >
          <CalendarClock className="h-3.5 w-3.5" /> {cal.text}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`More actions for ${listing.title}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-basalt/60 hover:bg-chalk hover:text-basalt">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setOpen((o) => !o)}><CalendarClock className="mr-2 h-3.5 w-3.5" /> Calendar sync</DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/listing/${listing.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> Open guest page</a>
            </DropdownMenuItem>
            {isStay && (
              <DropdownMenuItem onSelect={() => setTourOpen(true)}>
                <Footprints className="mr-2 h-3.5 w-3.5" /> Virtual tour{tour ? (tour.status === "live" ? " · live" : " · to check") : ""}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog("suspend")} disabled={!active}>
              <PauseCircle className="mr-2 h-3.5 w-3.5" /> {paused ? "Change suspension" : "Suspend bookings"}
            </DropdownMenuItem>
            {paused && (
              <DropdownMenuItem onSelect={() => void quickAvailability(listing, "resume", refresh)}>
                <PlayCircle className="mr-2 h-3.5 w-3.5" /> Resume bookings
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (active) setDialog("deactivate");
                else void quickAvailability(listing, "activate", refresh);
              }}
              className="justify-between gap-6"
            >
              <span>Active</span>
              <Switch checked={active} aria-label={active ? "Make inactive" : "Make active"} className="pointer-events-none" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ListingAvailabilityDialog key={dialog ?? "closed"} listing={listing} mode={dialog} onClose={() => setDialog(null)} />
        {isStay && <TourEditor listing={{ id: listing.id, title: listing.title }} open={tourOpen} onClose={() => setTourOpen(false)} onChanged={onTourChanged} />}
      </div>
      {listing.status === "draft" && listing.reviewNote && (
        <p className="mx-4 mb-3 max-w-xl border-l-2 border-destructive/40 pl-2 text-xs leading-5 text-basalt/70">
          <span className="font-semibold text-destructive">Admin feedback:</span> {listing.reviewNote}
        </p>
      )}
      {open && (
        <div className="border-t border-basalt/8 bg-chalk/40 px-4 pb-4">
          <AvailabilityRow listing={listing} />
          {(listing.type === "tour" || listing.type === "experience") && <SessionScheduleEditor listing={listing} />}
        </div>
      )}
    </li>
  );
}

type OperatorSection = "overview" | "listings" | "analytics" | "bookings" | "calendar" | "promos" | "messages" | "journey" | "documents" | "qr" | "hub" | "integrations" | "payouts" | "billing" | "referrals" | "settings";
const OPERATOR_SECTIONS: { key: OperatorSection; label: string; icon: typeof Home }[] = [
  { key: "overview", label: "Dashboard", icon: LayoutDashboard },
  { key: "listings", label: "Listings", icon: List },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "bookings", label: "Bookings", icon: CalendarCheck },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "journey", label: "Customer journey", icon: Route },
  { key: "promos", label: "Promo codes", icon: Ticket },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "qr", label: "QR codes", icon: QrCode },
  { key: "hub", label: "Partner Hub", icon: BookOpen },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "payouts", label: "Payouts", icon: Wallet },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "referrals", label: "Refer & Earn", icon: Gift },
  { key: "settings", label: "Settings", icon: Settings },
];

/** The operator menu's links — the desktop sidebar and the phone sheet share them. */
function SectionNavItems({ section, collapsed, onGo }: { section: OperatorSection; collapsed: boolean; onGo: (s: OperatorSection) => void }) {
  return (
    <>
      <Link href="/" title={collapsed ? "Homepage" : undefined} className={cn("flex items-center gap-2.5 whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-basalt/60 transition-colors hover:bg-chalk hover:text-basalt", collapsed && "lg:justify-center lg:px-0")}>
        <Home className="h-4 w-4 shrink-0" /> <span className={cn(collapsed && "lg:sr-only")}>Homepage</span>
      </Link>
      {OPERATOR_SECTIONS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onGo(key)}
          aria-current={section === key ? "page" : undefined}
          title={collapsed ? label : undefined}
          className={cn(
            "flex items-center gap-2.5 whitespace-nowrap px-3 py-2.5 text-left text-sm font-semibold transition-colors",
            section === key ? "bg-basalt text-paper" : "text-basalt/60 hover:bg-chalk hover:text-basalt",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" /> <span className={cn(collapsed && "lg:sr-only")}>{label}</span>
        </button>
      ))}
    </>
  );
}

/** Bookings: the reservations list with its filters (OperatorBookings). */
function BookingsSection() {
  return (
    <div>
      <SectionHead title="Bookings" sub="Every reservation on your listings — search, filter by date, and open one to manage it." />
      <OperatorBookings />
    </div>
  );
}

const CALENDAR_VIEWS = [
  { key: "timeline", label: "Timeline", short: "Timeline", blurb: "Your listings across the calendar — bookings and synced-blocked dates at a glance." },
  { key: "calendar", label: "Prices & availability", short: "Prices", blurb: "Prices and availability for all your listings. Select one day or several to change the price or block dates." },
  { key: "pricelog", label: "Price log", short: "Price log", blurb: "Every change to your prices — what changed, when, and who or what made it." },
] as const;
type CalendarView = (typeof CALENDAR_VIEWS)[number]["key"];

const ANALYTICS_TABS = [
  { key: "engagement", label: "Performance", sub: "How travellers find and book your listings: seen, clicked, visited, booked." },
  { key: "bookings", label: "Bookings & revenue", sub: "Confirmed bookings and revenue over the last 12 months." },
  { key: "events", label: "Events & pricing", sub: "Holidays, festivals, concerts and matches found automatically from public sources — and how your prices compare on those dates." },
  { key: "response", label: "Response times", sub: "How fast you reply to guest inquiries — fast replies win bookings." },
] as const;
type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["key"];
const ANALYTICS_TAB_KEY = "revamp.analyticsTab";

/** Analytics: one section at a time behind pill tabs (same pattern as Calendar and Settings). */
function AnalyticsSection() {
  const [tab, setTab] = useState<AnalyticsTab>(() => {
    try {
      const v = localStorage.getItem(ANALYTICS_TAB_KEY);
      return ANALYTICS_TABS.some((t) => t.key === v) ? (v as AnalyticsTab) : "engagement";
    } catch {
      return "engagement";
    }
  });
  const choose = (t: AnalyticsTab) => {
    setTab(t);
    try {
      localStorage.setItem(ANALYTICS_TAB_KEY, t);
    } catch {
      /* private mode — not remembered */
    }
  };
  return (
    <div>
      <PageHeader
        title="Analytics"
        sub={ANALYTICS_TABS.find((t) => t.key === tab)?.sub}
        actions={
          <div role="group" aria-label="Section" className="inline-flex max-w-full flex-wrap rounded-[1.25rem] border border-basalt/15 bg-paper p-1">
            {ANALYTICS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => choose(t.key)}
                className={cn(
                  "h-9 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
                  tab === t.key ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === "engagement" && <AnalyticsDashboard scope="operator" embedded />}
      {tab === "bookings" && <OperatorAnalytics />}
      {tab === "events" && <EventInsights embedded />}
      {tab === "response" && <OperatorResponseStat showEmpty />}
    </div>
  );
}

/** Calendar: the bookings timeline and the multi-listing price/availability calendar. */
function CalendarViewsSection() {
  const [view, setView] = useState<CalendarView>("timeline");
  const blurb = CALENDAR_VIEWS.find((v) => v.key === view)?.blurb ?? "";
  return (
    <div>
      <PageHeader
        title="Calendar"
        sub={<span className="hidden sm:inline">{blurb}</span>}
        actions={
          /* View switch — pills, same family as the toolbar below. Phones get
             the short labels so all three fit on one line. */
        <div role="group" aria-label="View" className="inline-flex max-w-full shrink-0 rounded-full border border-basalt/15 bg-paper p-1">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              aria-label={v.label}
              onClick={() => setView(v.key)}
              className={cn(
                "h-9 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold sm:px-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot",
                view === v.key ? "bg-basalt text-paper" : "text-basalt/70 hover:text-basalt",
              )}
            >
              <span className="sm:hidden">{v.short}</span>
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>
        }
      />
      {view === "timeline" && <OperatorBookingsTimeline />}
      {view === "calendar" && <CalendarSection />}
      {view === "pricelog" && <PriceLog scope="operator" />}
    </div>
  );
}

/**
 * Calendar: every listing's prices and availability on one grid (Airbnb
 * multi-calendar). A listing's name opens its own month calendar — per-room
 * prices for hotels, minimum stay — with a way back.
 */
function CalendarSection() {
  const [detail, setDetail] = useState<LiveListing | null>(null);
  const { listings } = useListings();
  const current = detail ? listings.find((l) => l.id === detail.id) ?? detail : null;
  if (!current) return <OperatorMultiCalendar onOpenListing={setDetail} />;
  return (
    <div>
      <button type="button" onClick={() => setDetail(null)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-basalt/70 hover:text-apricot">
        <ChevronLeft className="h-4 w-4" /> All listings
      </button>
      <h2 className="mb-4 font-display text-2xl tracking-[-0.02em]">{current.title}</h2>
      {current.multiRoom ? <HotelPricingCalendar key={current.id} listing={current} /> : <PricingCalendar key={current.id} listing={current} />}
    </div>
  );
}

/** Every dashboard page's header — see PageHeader (compact title, one line of description). */
function SectionHead({ title, sub, actions }: { title: string; sub: string; actions?: React.ReactNode }) {
  return <PageHeader title={title} sub={sub} actions={actions} />;
}

function StatTile({ n, label }: { n: number; label: string }) {
  return (
    <div className="min-w-0 border border-basalt/10 bg-paper p-3 sm:p-5">
      <p className="font-display text-2xl font-normal tabular-nums sm:text-4xl">{n}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-basalt/45 sm:text-xs">{label}</p>
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

  // Referral attribution: if this operator signed up through a host's invite
  // link, attach the pending referral now (once). Best-effort — a bad/duplicate
  // code soft-fails server-side; we only keep the code to retry on a network error.
  useEffect(() => {
    if (profile?.role !== "operator" || !user?.id) return;
    const code = getStoredReferralCode();
    if (!code) return;
    attachReferral(code)
      .then(() => clearStoredReferralCode())
      .catch(() => {
        /* network error — leave the code to retry next load */
      });
  }, [profile?.role, user?.id]);

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

  // Desktop menu can shrink to an icon rail (more room for the timeline/calendar);
  // remembered per browser. Below lg the menu opens from the left (a sheet).
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem("revamp.dashboardNavCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleNav = () =>
    setNavCollapsed((c) => {
      try {
        localStorage.setItem("revamp.dashboardNavCollapsed", c ? "0" : "1");
      } catch {
        /* private mode — just don't remember */
      }
      return !c;
    });

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
      <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 sm:py-10 lg:px-10 lg:py-14">
        {/* grid-cols-[minmax(0,1fr)]: without an explicit column the implicit one
            sizes to its widest content (a calendar grid is thousands of px), and
            the whole page ends up wider than a phone. */}
        <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-5", navCollapsed ? "lg:grid-cols-[44px_minmax(0,1fr)] lg:gap-6" : "lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-8")}>
          <aside className="hidden lg:sticky lg:top-[96px] lg:block lg:self-start">
            <div className={cn("flex items-center", navCollapsed ? "justify-center" : "justify-between pl-3")}>
              {!navCollapsed && <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-basalt/40">Operator</p>}
              <button
                type="button"
                onClick={toggleNav}
                aria-label={navCollapsed ? "Expand menu" : "Collapse menu"}
                aria-expanded={!navCollapsed}
                title={navCollapsed ? "Expand menu" : "Collapse menu"}
                className="grid h-8 w-8 place-items-center text-basalt/45 transition-colors hover:bg-chalk hover:text-basalt focus-visible:outline-2 focus-visible:outline-apricot"
              >
                {navCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>
            <nav aria-label="Dashboard" className="mt-3 flex flex-col gap-1">
              <SectionNavItems section={section} collapsed={navCollapsed} onGo={go} />
            </nav>
          </aside>

          {/* Phones/tablets: the same menu, from the left, behind a "where am I" button. */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={mobileNavOpen}
              className="flex h-12 w-full items-center gap-2.5 rounded-none border border-basalt/15 bg-paper px-4 text-sm font-semibold hover:border-basalt/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-apricot"
            >
              {(() => {
                const cur = OPERATOR_SECTIONS.find((x) => x.key === section) ?? OPERATOR_SECTIONS[0];
                return (
                  <>
                    <cur.icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{cur.label}</span>
                  </>
                );
              })()}
              <span className="text-xs font-semibold text-basalt/55">Menu</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-basalt/55" />
            </button>
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetContent side="left" className="w-[82%] max-w-xs gap-0 overflow-y-auto bg-paper p-0">
                <SheetTitle className="px-5 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-basalt/40">Operator</SheetTitle>
                <SheetDescription className="sr-only">Go to another part of your dashboard.</SheetDescription>
                <nav aria-label="Dashboard" className="flex flex-col gap-1 px-2 pb-6">
                  <SectionNavItems
                    section={section}
                    collapsed={false}
                    onGo={(k) => {
                      setMobileNavOpen(false);
                      go(k);
                    }}
                  />
                </nav>
              </SheetContent>
            </Sheet>
          </div>

          <div>
            {section === "overview" && (
              <div>
                <SectionHead title={firstName ? `Hi ${firstName}.` : "Welcome."} sub="Your listings, bookings, and payouts — all in one place." />
                {offlineBanner}
                {/* Three across on phones too — stacked they filled the first screen. */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
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
                <SectionHead title="Listings" sub="Your stays, tours and experiences. New listings are reviewed before they go live; edits to live listings save right away." />
                {offlineBanner}
                <DashboardSection type="stay" title="Stays" description="Guesthouses, cabins, and small hotels shown on /explore/stay and the home page." />
                <DashboardSection type="tour" title="Tours" description="Guided routes shown on /explore/tour and the home page." />
                <DashboardSection type="experience" title="Experiences" description="Hands-on classes and local activities shown on /explore/experience and the home page." wizardMode />
              </div>
            )}

            {section === "analytics" && <AnalyticsSection />}
            {section === "bookings" && <BookingsSection />}
            {section === "calendar" && <CalendarViewsSection />}
            {section === "promos" && <PromoCodes />}

            {section === "messages" && (
              <div>
                <SectionHead title="Messages" sub="Talk with guests about their bookings. Keep bookings and payments on Revamp — off-platform deals aren't protected." />
                <OperatorResponseStat />
                {user && <Inbox userId={user.id} />}
                <div className="mt-10 border-t border-basalt/10 pt-8">
                  <SubHeader title="Templates & auto-reply" />
                  <MessageTemplatesSettings />
                </div>
              </div>
            )}

            {section === "documents" && <OperatorDocuments />}
            {section === "qr" && <QrManager scope="operator" />}
            {section === "hub" && <PartnerHub />}

            {section === "journey" && (
              <div>
                <SectionHead title="Customer journey" sub="Arrival instructions, check-ins and thank-you notes — sent by email and text, by hand or automatically." />
                <CustomerJourney />
              </div>
            )}
            {section === "integrations" && (
              <div>
                <SectionHead title="Integrations" sub="Connect Revamp with the tools you already use." />
                <OperatorIntegrations />
              </div>
            )}

            {section === "payouts" && (
              <div>
                <SectionHead title="Payouts" sub="What you're owed and what's already been paid out." />
                <OperatorPayouts />
              </div>
            )}

            {section === "billing" && (
              <div>
                <SectionHead title="Billing" sub="Your Revamp plan and, if guests pay you through your own PayLink, your monthly commission statements." />
                <div className="grid gap-8">
                  <CommissionStatements />
                  <OperatorSubscription />
                </div>
              </div>
            )}

            {section === "referrals" && <OperatorReferrals />}

            {section === "settings" && (
              <div>
                <SectionHead title="Settings" sub="Your business profile and your account." />
                <OperatorSettings />
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
