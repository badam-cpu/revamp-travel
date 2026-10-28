/**
 * Airbnb-style, full-page multi-step onboarding flow for adding or editing
 * a `type: "experience"` listing — the operator-facing surface this file
 * exists for is entirely new, but it deliberately writes into the *same*
 * Supabase columns `ListingFormDialog` (Dashboard.tsx) already writes for
 * stay/tour: no new migration, no new table. See
 * supabase/migrations/0003_experience_listing_type.sql for the columns and
 * CLAUDE.md's "Experience onboarding wizard" recipe for the full mapping.
 *
 * Structure is modeled on Airbnb's real Experience-host listing flow
 * (category → location → title/story → itinerary → group & duration →
 * what's included → guest requirements/good-to-know → photos → pricing →
 * review), adapted to what this catalog already has:
 *  - Airbnb's free-text "category" picker becomes the existing `eyebrow`
 *    field (a short label, e.g. "Hands-on kitchen class") plus optional
 *    `tags` — there's no fixed category taxonomy in this schema.
 *  - Airbnb's structured "itinerary" (a sequence of numbered steps) maps
 *    onto the existing `highlights: string[]` column — same data
 *    TourDetail.tsx already renders, just relabeled "Itinerary" on the
 *    public page for `type: "experience"` (see TourDetail.tsx).
 *  - Airbnb's "capacity, duration, minimum age, meeting point, languages"
 *    fields are all guided inputs here, but they still land in the
 *    generic `facts: ListingFact[]` array under fixed labels ("Duration",
 *    "Group size", "Meeting point", "Languages", "Minimum age") — the
 *    same free-form fact-pair mechanism tours already use, just with a
 *    guided form in front of it instead of raw label/value inputs. Editing
 *    a listing whose facts don't use these exact labels (e.g. one created
 *    before this wizard existed, or through the generic dialog) will show
 *    those steps blank — the underlying facts aren't lost, they just won't
 *    map back into named fields; see `listingToWizardData` below.
 *  - Airbnb's "what's included" checklist is the existing AmenityPicker's
 *    `EXPERIENCE_GROUPS` catalog; "what's not included" and "what to
 *    bring" are the existing `notIncluded`/`whatToBring` columns, edited
 *    here with the new ListEditor component instead of a comma-separated
 *    text input.
 *
 * All ten steps stay mounted at once (toggled with a `hidden` class, not
 * conditional rendering) so that step-local state — especially
 * AmenityPicker's own uncontrolled selection state, which only reads its
 * `defaultValue` prop once on mount — survives moving back and forth
 * through the wizard.
 *
 * Reachable at /dashboard/experiences/new and
 * /dashboard/experiences/:id/edit (see App.tsx); stay/tour keep using the
 * original inline ListingFormDialog in Dashboard.tsx entirely untouched.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { deleteListingDraft, getListingDraft, saveListingDraft } from "@/lib/listingDrafts";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RequireRole } from "@/components/RequireRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BoldButton } from "@/components/BoldButton";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AmenityPicker, AmenityPickerHandle } from "@/components/AmenityPicker";
import { PlaceAutocomplete } from "@/components/PlaceAutocomplete";
import { PhotoUploader, PhotoUploaderHandle } from "@/components/PhotoUploader";
import { VideoField, VideoFieldHandle } from "@/components/VideoField";
import { ListEditor } from "@/components/ListEditor";
import { AhaAssist } from "@/components/AhaAssist";
import type { ResolvedPlace } from "@/lib/googleMaps";
import { useListings, LiveListing } from "@/contexts/ListingsContext";
import type { ListingFact, ListingInput } from "@shared/listings";
import { LISTING_LIMITS, LISTING_TEXT_LIMITS, PARKING_OPTIONS, firstListingTextProblem } from "@shared/listings";
import { EXTRA_FEE_TYPES } from "@shared/bookings";
import { CharCount } from "@/components/CharCount";
import { saveSessionSchedule, ApiError, type AhaCopyContext } from "@/lib/api";
import { factValue } from "@/lib/tourFacts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { ScheduleFields, minutesFromText, scheduleFromValue, scheduleProblem, scheduleValueFrom, type ScheduleValue } from "@/components/ScheduleFields";
import { describeSchedule, scheduleHasSlots } from "@shared/sessions";

/** Written by Dashboard.tsx's "paste a link to prefill" control for the Experiences section before it navigates here — read once on mount, then cleared. */
export const EXPERIENCE_PREFILL_STORAGE_KEY = "revamp:experienceWizardPrefill";

interface WizardData {
  eyebrow: string;
  title: string;
  tags: string[];
  city: string;
  region: string;
  coordinates: { lat: number; lng: number };
  shortDescription: string;
  longDescription: string;
  highlights: string[];
  duration: string;
  groupSize: string;
  meetingPoint: string;
  parking: string;
  languages: string;
  minimumAge: string;
  amenities: string[];
  notIncluded: string[];
  whatToBring: string[];
  notSuitableFor: string[];
  importantInfo: string;
  photos: string[];
  coverFocus: string;
  photoCaptions: Record<string, string>;
  /** The listing already had captions when loaded — so clearing them must be saved. */
  hadPhotoCaptions?: boolean;
  videoUrl: string;
  videoPosition: number;
  prefillImageUrl?: string;
  price: number;
  priceUnit: string;
  cancellationPolicy: "flexible" | "non_refundable";
  freeCancelDays: number;
  nonrefundableDiscountPercent: number;
  cleaningFeeCents: number;
  /** What the extra fee covers ("" → shown as "Extra fee") and how it's charged (0095). */
  extraFeeType: string;
  extraFeePer: "booking" | "person";
  discountType: "none" | "percent" | "amount";
  discountValue: number;
  discountStart: string;
  discountEnd: string;
  featured: boolean;
  /** Schedule & spots — saved with saveSessionSchedule once the listing exists. */
  schedule: ScheduleValue;
  status?: LiveListing["status"];
  reviewNote?: string | null;
}

function emptyWizardData(): WizardData {
  return {
    eyebrow: "",
    title: "",
    tags: [],
    city: "",
    region: "",
    coordinates: { lat: 40.18, lng: 44.51 },
    shortDescription: "",
    longDescription: "",
    highlights: [],
    duration: "",
    groupSize: "",
    meetingPoint: "",
    parking: "",
    languages: "",
    minimumAge: "",
    amenities: [],
    notIncluded: [],
    whatToBring: [],
    notSuitableFor: [],
    importantInfo: "",
    photos: [],
    coverFocus: "50% 50%",
    photoCaptions: {},
    videoUrl: "",
    videoPosition: 1,
    price: 0,
    priceUnit: "person",
    cancellationPolicy: "flexible",
    freeCancelDays: 7,
    nonrefundableDiscountPercent: 5,
    cleaningFeeCents: 0,
    extraFeeType: "",
    extraFeePer: "booking",
    discountType: "none",
    discountValue: 0,
    discountStart: "",
    discountEnd: "",
    featured: false,
    schedule: scheduleValueFrom(null, "instant"),
  };
}

/** Existing real photos on a listing (drop the brand-illustration fallbacks under /images or /brand), for seeding the uploader when editing. */
function realPhotos(listing: LiveListing): string[] {
  const source = listing.gallery?.length ? listing.gallery : listing.image ? [listing.image] : [];
  return source.filter((u) => u && !u.startsWith("/images/") && !u.startsWith("/brand/"));
}

function readSessionPrefill(): Partial<WizardData> | null {
  try {
    const raw = sessionStorage.getItem(EXPERIENCE_PREFILL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      title?: string;
      description?: string;
      imageUrl?: string;
      amenities?: string[];
      price?: number;
      city?: string;
      region?: string;
    };
    return {
      title: parsed.title ?? "",
      shortDescription: parsed.description ?? "",
      prefillImageUrl: parsed.imageUrl,
      amenities: Array.isArray(parsed.amenities) ? parsed.amenities : [],
      price: typeof parsed.price === "number" ? parsed.price : 0,
      city: parsed.city ?? "",
      region: parsed.region ?? "",
    };
  } catch {
    return null;
  }
}

function listingToWizardData(listing: LiveListing): WizardData {
  return {
    eyebrow: listing.eyebrow,
    title: listing.title,
    tags: listing.tags,
    city: listing.city,
    region: listing.region,
    coordinates: listing.coordinates,
    shortDescription: listing.shortDescription,
    longDescription: listing.longDescription,
    highlights: listing.highlights ?? [],
    duration: factValue(listing, "Duration") ?? "",
    groupSize: factValue(listing, "Group size") ?? "",
    meetingPoint: factValue(listing, "Meeting point") ?? "",
    parking: factValue(listing, "Parking") ?? "",
    languages: factValue(listing, "Languages") ?? "",
    minimumAge: factValue(listing, "Minimum age") ?? "",
    amenities: listing.amenities,
    notIncluded: listing.notIncluded ?? [],
    whatToBring: listing.whatToBring ?? [],
    notSuitableFor: listing.notSuitableFor ?? [],
    importantInfo: listing.importantInfo ?? "",
    photos: realPhotos(listing),
    coverFocus: listing.coverFocus ?? "50% 50%",
    photoCaptions: listing.photoCaptions ?? {},
    hadPhotoCaptions: Object.keys(listing.photoCaptions ?? {}).length > 0,
    videoUrl: listing.videoUrl ?? "",
    videoPosition: listing.videoPosition ?? 1,
    price: listing.price,
    priceUnit: listing.priceUnit,
    cancellationPolicy: listing.cancellationPolicy ?? "flexible",
    freeCancelDays: listing.freeCancelDays ?? 7,
    nonrefundableDiscountPercent: listing.nonrefundableDiscountPercent ?? 5,
    cleaningFeeCents: listing.cleaningFeeCents ?? 0,
    extraFeeType: listing.extraFeeType ?? "",
    extraFeePer: listing.extraFeePer === "person" ? "person" : "booking",
    discountType: listing.discountType === "percent" || listing.discountType === "amount" ? listing.discountType : "none",
    discountValue: listing.discountType === "amount" ? (listing.discountValue ?? 0) / 100 : listing.discountValue ?? 0,
    discountStart: listing.discountStart ?? "",
    discountEnd: listing.discountEnd ?? "",
    featured: listing.featured ?? false,
    schedule: scheduleValueFrom(listing.sessionSchedule, listing.bookingMode),
    status: listing.status,
    reviewNote: listing.reviewNote,
  };
}

function buildFacts(data: WizardData): ListingFact[] {
  const pairs: [string, string][] = [
    ["Duration", data.duration.trim()],
    ["Group size", data.groupSize.trim()],
    ["Meeting point", data.meetingPoint.trim()],
    ["Parking", data.parking.trim()],
    ["Languages", data.languages.trim()],
    ["Minimum age", data.minimumAge.trim()],
  ];
  return pairs.filter(([, value]) => value).map(([label, value]) => ({ label, value }));
}

function toListingInput(data: WizardData): ListingInput {
  const price = Number(data.price) || 0;
  return {
    type: "experience",
    title: data.title.trim(),
    eyebrow: data.eyebrow.trim(),
    city: data.city.trim(),
    region: data.region.trim(),
    coordinates: data.coordinates,
    image: data.photos[0] || undefined,
    videoUrl: data.videoUrl || undefined,
    videoPosition: data.videoUrl ? data.videoPosition : undefined,
    gallery: data.photos.length ? data.photos : undefined,
    coverFocus: data.coverFocus || undefined,
    photoCaptions: Object.keys(data.photoCaptions).length || data.hadPhotoCaptions ? data.photoCaptions : undefined,
    shortDescription: data.shortDescription.trim(),
    longDescription: data.longDescription.trim(),
    price,
    priceLabel: `֏${Math.round(price).toLocaleString()}`,
    priceUnit: data.priceUnit.trim() || "person",
    tags: data.tags,
    facts: buildFacts(data),
    amenities: data.amenities,
    highlights: data.highlights,
    notIncluded: data.notIncluded,
    whatToBring: data.whatToBring,
    notSuitableFor: data.notSuitableFor,
    importantInfo: data.importantInfo.trim(),
    featured: data.featured,
    cancellationPolicy: data.cancellationPolicy,
    freeCancelDays: data.freeCancelDays,
    nonrefundableDiscountPercent: data.nonrefundableDiscountPercent,
    cleaningFeeCents: data.cleaningFeeCents,
    extraFeeType: data.extraFeeType || null,
    extraFeePer: data.extraFeePer,
    ...(() => {
      const type = data.discountType === "percent" || data.discountType === "amount" ? data.discountType : null;
      const value = type === "amount" ? Math.round(data.discountValue * 100) : Math.round(data.discountValue);
      const on = !!(type && value > 0 && data.discountStart && data.discountEnd);
      return {
        discountType: on ? type : null,
        discountValue: on ? value : 0,
        discountStart: on ? data.discountStart : undefined,
        discountEnd: on ? data.discountEnd : undefined,
      };
    })(),
    // Experiences don't expose the stay/tour marker-color picker — every
    // experience pin uses the same accent as the rest of the type
    // (Dashboard.tsx's emptyDraft default for type: "experience").
    accent: "apricot",
  };
}

const STEP_META: { title: string; subtitle: string }[] = [
  { title: "The basics", subtitle: "What kind of experience is this, and what should we call it?" },
  { title: "Where it happens", subtitle: "Search for the meeting address, or set the pin by hand." },
  { title: "Tell your story", subtitle: "Give travelers a real sense of what makes this worth their afternoon." },
  { title: "Build the itinerary", subtitle: "The steps a guest will actually move through, in order — this becomes the Itinerary section on your listing page." },
  { title: "Group, duration & meeting details", subtitle: "How long it runs, how many people, and where to meet." },
  { title: "Schedule & spots", subtitle: "Do guests book a set start time — a class, a group run, a tasting — or just pick a day?" },
  { title: "What's included", subtitle: "Check off everything guests don't have to bring or pay extra for." },
  { title: "Good to know", subtitle: "Safety notes, age limits, accessibility, cancellation terms — anything a guest should know before booking." },
  { title: "Add a cover photo", subtitle: "One hero image is enough to start — you can always add more later." },
  { title: "Set your price", subtitle: "What one guest pays, and the unit it's shown per." },
  { title: "Review & submit", subtitle: "Take one last look before it goes to review." },
];

/** The step's card-text length problem (shared rules), shown under "Next" — or null. */
function stepTextProblem(step: number, d: WizardData): string | null {
  if (step === 0) return firstListingTextProblem({ eyebrow: d.eyebrow, title: d.title });
  if (step === 2) return firstListingTextProblem({ shortDescription: d.shortDescription, longDescription: d.longDescription });
  return null;
}

/** For the Dashboard's "Unfinished" list ("Stopped at step N of …"). */
export const EXPERIENCE_STEP_COUNT = STEP_META.length;

/** Anything worth keeping in an unfinished experience (0115)? */
function hasContent(d: WizardData): boolean {
  return !!(d.title.trim() || d.eyebrow.trim() || d.shortDescription.trim() || d.longDescription.trim() || d.city.trim() || d.photos.length || d.highlights.length || d.price > 0);
}

const STEP_VALIDATORS: ((data: WizardData) => boolean)[] = [
  (d) => d.eyebrow.trim().length > 0 && d.title.trim().length > 0 && !stepTextProblem(0, d),
  (d) => d.city.trim().length > 0 && d.region.trim().length > 0,
  (d) => d.shortDescription.trim().length > 0 && d.longDescription.trim().length > 0 && !stepTextProblem(2, d),
  (d) => d.highlights.length > 0,
  (d) => d.duration.trim().length > 0 && d.groupSize.trim().length > 0 && d.meetingPoint.trim().length > 0,
  (d) => !scheduleProblem(d.schedule),
  () => true,
  () => true,
  () => true,
  (d) => Number(d.price) > 0,
  () => true,
];

function StepField({ label, help, action, children }: { label: string; help?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {action}
      </div>
      {help && <p className="-mt-1 text-xs text-basalt/45">{help}</p>}
      {children}
    </div>
  );
}

function ExperienceOnboardingContent({ id }: { id?: string }) {
  const isEdit = Boolean(id);
  const { listings, loading: listingsLoading, createListing, updateListing } = useListings();
  const existing = isEdit ? listings.find((l) => l.id === id) : undefined;
  const [, navigate] = useLocation();
  // Continuing an unfinished experience (0115): /dashboard/experiences/new?draft=<id>.
  const search = useSearch();
  const resumeId = !isEdit ? new URLSearchParams(search).get("draft") : null;
  const [resuming, setResuming] = useState(!!resumeId);

  const [data, setData] = useState<WizardData>(() => {
    if (isEdit) return emptyWizardData();
    const prefill = readSessionPrefill();
    return prefill ? { ...emptyWizardData(), ...prefill } : emptyWizardData();
  });
  const [hydrated, setHydrated] = useState(!isEdit);
  const [currentStep, setCurrentStep] = useState(0);
  const [maxUnlocked, setMaxUnlocked] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const amenitiesRef = useRef<AmenityPickerHandle>(null);
  const photosRef = useRef<PhotoUploaderHandle>(null);
  const videoRef = useRef<VideoFieldHandle>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLInputElement>(null);
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEdit || hydrated) return;
    if (existing) {
      setData(listingToWizardData(existing));
      setHydrated(true);
      setMaxUnlocked(STEP_META.length - 1);
    }
  }, [isEdit, hydrated, existing]);

  // Only cleared once, and only for a fresh "add" — an edit never reads or
  // touches the prefill handoff.
  useEffect(() => {
    if (!isEdit) sessionStorage.removeItem(EXPERIENCE_PREFILL_STORAGE_KEY);
  }, [isEdit]);

  // AmenityPicker owns its own selection state (see AmenityPicker.tsx's
  // header comment) and is never unmounted while the wizard is open, so the
  // only way to read its live value back into `data` is imperatively — do
  // it on every step change, which covers "left step 6", "jumped straight
  // to review", and "about to submit" alike.
  useEffect(() => {
    const value = amenitiesRef.current?.getValue();
    if (value) setData((d) => ({ ...d, amenities: value }));
    const photos = photosRef.current?.getValue();
    if (photos) setData((d) => ({ ...d, photos, coverFocus: photosRef.current?.getCoverFocus() ?? d.coverFocus, photoCaptions: photosRef.current?.getCaptions() ?? d.photoCaptions }));
    const video = videoRef.current?.getValue();
    if (video !== undefined) setData((d) => ({ ...d, videoUrl: video, videoPosition: videoRef.current?.getPosition() ?? d.videoPosition }));
  }, [currentStep]);

  // ── Save and continue later (0115) — new experiences only ──
  const draftRowRef = useRef<string | null>(resumeId);
  const lastSavedRef = useRef<string>("");
  const doneRef = useRef(false);
  const [progressSavedAt, setProgressSavedAt] = useState<number | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
  useEffect(() => {
    if (!resumeId) return;
    let alive = true;
    getListingDraft(resumeId)
      .then((row) => {
        if (!alive) return;
        const saved = row?.type === "experience" ? (row.data as { data?: Partial<WizardData>; maxUnlocked?: number }) : null;
        if (row && saved?.data) {
          const restored = { ...emptyWizardData(), ...saved.data };
          if (!restored.schedule) restored.schedule = emptyWizardData().schedule;
          setData(restored);
          const last = STEP_META.length - 1;
          setCurrentStep(Math.min(row.step, last));
          setMaxUnlocked(Math.min(Math.max(saved.maxUnlocked ?? 0, row.step), last));
        } else {
          draftRowRef.current = null;
          toast("That unfinished experience is no longer available — starting fresh.");
        }
      })
      .catch((e) => {
        console.error("[listing drafts] open", e);
        draftRowRef.current = null;
        toast.error("Couldn't open your saved progress. Please try again from the dashboard.");
      })
      .finally(() => alive && setResuming(false));
    return () => {
      alive = false;
    };
  }, [resumeId]);

  /** The wizard's data incl. the self-managed pickers (amenities, photos, video). */
  const currentData = (): WizardData => ({
    ...data,
    amenities: amenitiesRef.current?.getValue() ?? data.amenities,
    photos: photosRef.current?.getValue() ?? data.photos,
    coverFocus: photosRef.current?.getCoverFocus() ?? data.coverFocus,
    photoCaptions: photosRef.current?.getCaptions() ?? data.photoCaptions,
    videoUrl: videoRef.current?.getValue() ?? data.videoUrl,
    videoPosition: videoRef.current?.getPosition() ?? data.videoPosition,
  });
  const saveProgress = async (mode: "auto" | "explicit"): Promise<boolean> => {
    if (isEdit || resuming || doneRef.current) return true;
    const d = currentData();
    if (!hasContent(d)) return true;
    const json = JSON.stringify({ d, currentStep, maxUnlocked });
    if (json === lastSavedRef.current) return true;
    setSavingProgress(true);
    try {
      draftRowRef.current = await saveListingDraft({ id: draftRowRef.current, type: "experience", title: d.title, step: currentStep, data: { v: 1, data: d, maxUnlocked } });
      lastSavedRef.current = json;
      setProgressSavedAt(Date.now());
      return true;
    } catch (e) {
      console.error("[listing drafts] save", e);
      if (mode === "explicit") toast.error("Couldn't save your progress. Check your connection and try again.");
      return false;
    } finally {
      setSavingProgress(false);
    }
  };
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  // A few seconds after any change (and on every step change).
  useEffect(() => {
    if (isEdit || resuming) return;
    const t = setTimeout(() => void saveProgressRef.current("auto"), 3000);
    return () => clearTimeout(t);
  }, [data, currentStep, maxUnlocked, isEdit, resuming]);
  // Leaving the page another way (header link, back button) saves too.
  useEffect(() => () => void saveProgressRef.current("auto"), []);
  const saveAndExit = async () => {
    const ok = await saveProgress("explicit");
    if (!ok) return;
    if (draftRowRef.current) toast("Saved — continue anytime from Experiences → Unfinished.");
    navigate("/dashboard");
  };

  useDocumentMeta({
    title: isEdit ? "Edit experience | Dashboard" : "Add an experience | Dashboard",
    description: "Operator-only experience listing onboarding.",
    canonicalPath: isEdit ? `/dashboard/experiences/${id}/edit` : "/dashboard/experiences/new",
    noindex: true,
  });

  const notFound = isEdit && hydrated === false && !listingsLoading && !existing;

  const set = <K extends keyof WizardData>(key: K, value: WizardData[K]) => setData((d) => ({ ...d, [key]: value }));

  // Draft context handed to Aha so its suggestions are grounded in what the
  // operator has entered so far (type is always "experience" on this wizard).
  const ahaCtx = (): AhaCopyContext => ({
    title: data.title.trim() || undefined,
    city: data.city.trim() || undefined,
    region: data.region.trim() || undefined,
    priceUnit: data.priceUnit || undefined,
    amenities: data.amenities.length ? data.amenities : undefined,
    facts: buildFacts(data),
    shortDescription: data.shortDescription.trim() || undefined,
    longDescription: data.longDescription.trim() || undefined,
    highlights: data.highlights.length ? data.highlights : undefined,
  });

  const handlePlaceSelected = (place: ResolvedPlace) => {
    if (place.city) { set("city", place.city); if (cityRef.current) cityRef.current.value = place.city; }
    if (place.region) { set("region", place.region); if (regionRef.current) regionRef.current.value = place.region; }
    if (typeof place.lat === "number") { set("coordinates", { ...data.coordinates, lat: place.lat }); if (latRef.current) latRef.current.value = String(place.lat); }
    if (typeof place.lng === "number") { set("coordinates", { ...data.coordinates, lng: place.lng }); if (lngRef.current) lngRef.current.value = String(place.lng); }
  };

  const canAdvance = STEP_VALIDATORS[currentStep](data);

  const goNext = () => {
    if (!canAdvance) return;
    const next = Math.min(currentStep + 1, STEP_META.length - 1);
    setCurrentStep(next);
    setMaxUnlocked((m) => Math.max(m, next));
  };
  const goBack = () => setCurrentStep((s) => Math.max(0, s - 1));
  const jumpTo = (i: number) => { if (i <= maxUnlocked) setCurrentStep(i); };

  const handleSubmit = async (submitForReview = true) => {
    const firstInvalid = STEP_VALIDATORS.findIndex((isValid) => !isValid(data));
    if (firstInvalid !== -1) {
      setCurrentStep(firstInvalid);
      setMaxUnlocked((m) => Math.max(m, firstInvalid));
      setSubmitError("A few earlier steps still need something — jumped you back to the first one.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = toListingInput(data);
      // Schedule & spots references the listing, so it's saved once the row exists
      // (new listings with class times, or any change on an edit).
      const saveSchedule = async (listingId: string) => {
        const next = scheduleFromValue(data.schedule);
        const before = existing && scheduleHasSlots(existing.sessionSchedule) ? existing.sessionSchedule : null;
        const changed = !existing ? !!next : JSON.stringify(next) !== JSON.stringify(before) || (!!next && data.schedule.mode !== (existing.bookingMode ?? "instant"));
        if (!changed) return;
        try {
          await saveSessionSchedule(listingId, next, data.schedule.mode);
        } catch (schedErr) {
          console.error("[experience] schedule save failed", schedErr);
          toast.error(`${payload.title} was saved, but its start times weren't. Open ⋯ → Schedule & spots to add them.`);
        }
      };
      if (isEdit && existing) {
        await updateListing(existing.id, payload, submitForReview);
        await saveSchedule(existing.id);
        toast(submitForReview ? `${payload.title} submitted for review.` : `${payload.title} saved as a draft.`);
      } else {
        const created = await createListing(payload, submitForReview);
        await saveSchedule(created.id);
        toast(submitForReview ? `${payload.title} submitted for review.` : `${payload.title} saved as a draft.`);
        // The listing exists now — its unfinished copy (0115) is no longer needed.
        doneRef.current = true;
        if (draftRowRef.current) void deleteListingDraft(draftRowRef.current).catch((e) => console.error("[listing drafts] delete", e));
        draftRowRef.current = null;
      }
      navigate("/dashboard");
    } catch (err) {
      setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't save this experience. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const isLastStep = currentStep === STEP_META.length - 1;
  const progressPct = ((currentStep + 1) / STEP_META.length) * 100;

  const submitCopy = !isEdit
    ? "Submitted for review — it'll go live once an admin approves it."
    : data.status === "draft"
      ? "An admin sent this back with feedback — saving resubmits it for review."
      : data.status === "pending"
        ? "Still awaiting review — your changes save as part of that same submission."
        : "This experience is already live — changes save immediately, no re-review needed.";

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="listing-form container py-10 lg:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-basalt/55 hover:text-apricot">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          {!isEdit && !resuming && (
            <div className="flex items-center gap-3">
              {(savingProgress || progressSavedAt) && <span className="text-xs text-basalt/45" aria-live="polite">{savingProgress ? "Saving…" : "Progress saved"}</span>}
              <Button type="button" variant="outline" size="sm" onClick={() => void saveAndExit()} disabled={savingProgress} className="rounded-none border-basalt/20">
                Save &amp; exit
              </Button>
            </div>
          )}
        </div>

        <p className="eyebrow mt-6">{isEdit ? "Edit experience" : "Add an experience"}</p>
        <h1 className="mt-2 font-display text-4xl leading-[0.98] tracking-[-0.035em] sm:text-5xl">
          {isEdit ? existing?.title || "Loading…" : "Host something hands-on."}
        </h1>

        {resuming ? (
          <p className="mt-10 text-sm text-basalt/50">Opening your saved progress…</p>
        ) : (listingsLoading && isEdit && !hydrated) ? (
          <p className="mt-10 text-sm text-basalt/50">Loading your listing…</p>
        ) : notFound ? (
          <div className="mt-10 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Couldn't find that experience — it may have been removed, or it isn't one of yours.
            <Link href="/dashboard" className="ml-1 font-semibold underline">Back to dashboard</Link>
          </div>
        ) : (
          <>
            <div className="mt-8">
              <div className="flex items-center justify-between text-xs font-semibold text-basalt/50">
                <span>Step {currentStep + 1} of {STEP_META.length}</span>
                <span>{Math.round(progressPct)}%</span>
              </div>
              <Progress value={progressPct} className="mt-2 h-1.5 bg-basalt/10" />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STEP_META.map((step, i) => (
                  <button
                    key={step.title}
                    type="button"
                    onClick={() => jumpTo(i)}
                    disabled={i > maxUnlocked}
                    aria-current={i === currentStep}
                    title={step.title}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      i === currentStep ? "bg-apricot" : i <= maxUnlocked ? "bg-apricot/30 hover:bg-apricot/50" : "bg-basalt/10",
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <p className="eyebrow">{STEP_META[currentStep].title}</p>
                <p className="mt-2 max-w-xl text-sm leading-6 text-basalt/55">{STEP_META[currentStep].subtitle}</p>

                <div className="mt-8 grid gap-6">
                  {/* Step 0 — The basics */}
                  <div className={cn("grid gap-6", currentStep !== 0 && "hidden")}>
                    <StepField label="Category label" help={`Short and specific (${LISTING_TEXT_LIMITS.eyebrow.min}–${LISTING_TEXT_LIMITS.eyebrow.max} characters) — e.g. "Hands-on kitchen class" or "Craft workshop".`}>
                      <Input value={data.eyebrow} maxLength={LISTING_LIMITS.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} placeholder="Hands-on kitchen class" />
                      <CharCount field="eyebrow" value={data.eyebrow} className="justify-self-end" />
                    </StepField>
                    <StepField
                      label="Title"
                      help={`${LISTING_TEXT_LIMITS.title.min}–${LISTING_TEXT_LIMITS.title.max} characters, so it fits on listing cards without being cut off.`}
                      action={<AhaAssist field="title" listingType="experience" getContext={ahaCtx} getCurrent={() => data.title} onApplyText={(t) => set("title", t)} />}
                    >
                      <Input value={data.title} maxLength={LISTING_LIMITS.title} onChange={(e) => set("title", e.target.value)} placeholder="Lavash & Wine Craft Afternoon" />
                      <CharCount field="title" value={data.title} className="justify-self-end" />
                    </StepField>
                    <ListEditor
                      label="Tags (optional)"
                      placeholder="Add a tag, e.g. Craft"
                      values={data.tags}
                      onChange={(v) => set("tags", v)}
                      helpText="Shown as filter chips on the listing card."
                    />
                  </div>

                  {/* Step 1 — Where it happens */}
                  <div className={cn("grid gap-6", currentStep !== 1 && "hidden")}>
                    <PlaceAutocomplete onSelect={handlePlaceSelected} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <StepField label="City">
                        <Input ref={cityRef} defaultValue={data.city} onChange={(e) => set("city", e.target.value)} />
                      </StepField>
                      <StepField label="Region">
                        <Input ref={regionRef} defaultValue={data.region} onChange={(e) => set("region", e.target.value)} />
                      </StepField>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <StepField label="Latitude">
                        <Input
                          ref={latRef}
                          type="number"
                          step="0.0001"
                          min={38}
                          max={42}
                          defaultValue={data.coordinates.lat}
                          onChange={(e) => set("coordinates", { ...data.coordinates, lat: Number(e.target.value) || 0 })}
                        />
                      </StepField>
                      <StepField label="Longitude">
                        <Input
                          ref={lngRef}
                          type="number"
                          step="0.0001"
                          min={43}
                          max={47}
                          defaultValue={data.coordinates.lng}
                          onChange={(e) => set("coordinates", { ...data.coordinates, lng: Number(e.target.value) || 0 })}
                        />
                      </StepField>
                    </div>
                    <p className="-mt-2 text-xs text-basalt/45">Coordinates must fall inside Armenia (lat 38–42, lng 43–47) — used to place the pin on the atlas.</p>
                  </div>

                  {/* Step 2 — Tell your story */}
                  <div className={cn("grid gap-6", currentStep !== 2 && "hidden")}>
                    <StepField
                      label="Short description"
                      help={`${LISTING_TEXT_LIMITS.shortDescription.min}–${LISTING_TEXT_LIMITS.shortDescription.max} characters — exactly the two lines a listing card shows.`}
                      action={<AhaAssist field="shortDescription" listingType="experience" getContext={ahaCtx} getCurrent={() => data.shortDescription} onApplyText={(t) => set("shortDescription", t)} />}
                    >
                      <Textarea rows={2} value={data.shortDescription} maxLength={LISTING_LIMITS.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} />
                      <CharCount field="shortDescription" value={data.shortDescription} className="justify-self-end" />
                    </StepField>
                    <StepField
                      label="Full description"
                      help={`The story of the experience — what makes it worth doing, told in your own voice. At least ${LISTING_TEXT_LIMITS.longDescription.min} characters. To make words bold, select them and press B.`}
                      action={
                        <div className="flex items-center gap-2">
                          <BoldButton forId="exp-longDescription" />
                          <AhaAssist field="longDescription" listingType="experience" getContext={ahaCtx} getCurrent={() => data.longDescription} onApplyText={(t) => set("longDescription", t)} />
                        </div>
                      }
                    >
                      <Textarea id="exp-longDescription" rows={6} value={data.longDescription} maxLength={LISTING_LIMITS.longDescription} onChange={(e) => set("longDescription", e.target.value)} />
                      <CharCount field="longDescription" value={data.longDescription} className="justify-self-end" />
                    </StepField>
                  </div>

                  {/* Step 3 — Itinerary */}
                  <div className={cn(currentStep !== 3 && "hidden")}>
                    <div className="mb-2 flex items-center justify-end">
                      <AhaAssist
                        field="highlights"
                        listingType="experience"
                        getContext={ahaCtx}
                        getCurrent={() => data.highlights.join("\n")}
                        onApplyItems={(items) => set("highlights", items)}
                      />
                    </div>
                    <ListEditor
                      label="Itinerary steps"
                      placeholder="e.g. Bake traditional lavash against a working tonir oven"
                      values={data.highlights}
                      onChange={(v) => set("highlights", v)}
                      numbered
                      minRecommended={3}
                      helpText="Shown in order on the public listing page as the experience's Itinerary."
                    />
                  </div>

                  {/* Step 4 — Group, duration & meeting details */}
                  <div className={cn("grid gap-6", currentStep !== 4 && "hidden")}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <StepField label="Duration">
                        <Input value={data.duration} onChange={(e) => set("duration", e.target.value)} placeholder="3 hours" />
                      </StepField>
                      <StepField label="Group size">
                        <Input value={data.groupSize} onChange={(e) => set("groupSize", e.target.value)} placeholder="Up to 8" />
                      </StepField>
                    </div>
                    <StepField label="Meeting point" help="Search for the spot to fill in a real address, or just type it.">
                      <div className="grid gap-2">
                        <PlaceAutocomplete
                          label={null}
                          helpText={null}
                          onSelect={(p) => set("meetingPoint", p.formattedAddress || [p.city, p.region].filter(Boolean).join(", "))}
                        />
                        <Input value={data.meetingPoint} onChange={(e) => set("meetingPoint", e.target.value)} placeholder="e.g. Republic Square, Yerevan" />
                      </div>
                    </StepField>
                    <StepField label="Parking at the meeting point (optional)" help="Used to answer guests who drive there.">
                      <select
                        value={data.parking}
                        onChange={(e) => set("parking", e.target.value)}
                        aria-label="Parking at the meeting point"
                        className="h-12 w-full rounded-none border border-basalt/15 bg-paper px-3 text-base focus:border-apricot focus:outline-none sm:h-10 sm:text-sm"
                      >
                        <option value="">Not set</option>
                        {[...(data.parking && !(PARKING_OPTIONS as readonly string[]).includes(data.parking) ? [data.parking] : []), ...PARKING_OPTIONS].map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </StepField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <StepField label="Languages">
                        <Input value={data.languages} onChange={(e) => set("languages", e.target.value)} placeholder="Armenian, English" />
                      </StepField>
                      <StepField label="Minimum age (optional)">
                        <Input value={data.minimumAge} onChange={(e) => set("minimumAge", e.target.value)} placeholder="e.g. 6+" />
                      </StepField>
                    </div>
                  </div>

                  {/* Step 5 — What's included */}
                  {/* Step 5 — Schedule & spots */}
                  <div className={cn("grid gap-6", currentStep !== 5 && "hidden")}>
                    <ScheduleFields
                      value={data.schedule}
                      idPrefix="exp-wizard"
                      onChange={(v) => {
                        // Switching to class times the first time: start from the group size and length given on the step before.
                        if (v.kind === "slots" && data.schedule.kind === "day" && !scheduleHasSlots(existing?.sessionSchedule)) {
                          const cap = parseInt(data.groupSize.replace(/[^0-9]/g, ""), 10);
                          const mins = minutesFromText(data.duration);
                          v = { ...v, capacity: cap > 0 ? String(cap) : v.capacity, durationMin: mins ? String(mins) : v.durationMin };
                        }
                        set("schedule", v);
                      }}
                    />
                  </div>

                  <div className={cn("grid gap-6", currentStep !== 6 && "hidden")}>
                    <AmenityPicker ref={amenitiesRef} type="experience" defaultValue={data.amenities} />
                    <ListEditor
                      label="Not included"
                      placeholder="e.g. Hotel pickup"
                      values={data.notIncluded}
                      onChange={(v) => set("notIncluded", v)}
                    />
                    <ListEditor
                      label="What to bring"
                      placeholder="e.g. Comfortable clothing"
                      values={data.whatToBring}
                      onChange={(v) => set("whatToBring", v)}
                    />
                  </div>

                  {/* Step 6 — Good to know */}
                  <div className={cn("grid gap-6", currentStep !== 7 && "hidden")}>
                    <ListEditor
                      label="Who is this not suitable for?"
                      placeholder="e.g. People with altitude sickness"
                      values={data.notSuitableFor}
                      onChange={(v) => set("notSuitableFor", v)}
                    />
                    <StepField label="Important info (optional)" help="Age restrictions, accessibility notes, cancellation policy…">
                      <Textarea rows={4} value={data.importantInfo} onChange={(e) => set("importantInfo", e.target.value)} />
                    </StepField>
                  </div>

                  {/* Step 7 — Photos */}
                  <div className={cn("grid gap-4", currentStep !== 8 && "hidden")}>
                    {data.prefillImageUrl && (
                      <div className="flex items-start gap-3 border border-basalt/10 bg-chalk p-3">
                        <img src={data.prefillImageUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                        <p className="text-xs leading-5 text-basalt/55">
                          Reference photo from the link you pasted — shown for reference only, it won't be saved. Add your own photos below (or leave it blank for a brand illustration).
                        </p>
                      </div>
                    )}
                    <StepField label="Photos" help="Drag &amp; drop or click to upload — the first photo is the cover. Leave empty to use a brand illustration.">
                      {/* keyed on `hydrated` so an edit reseeds the uploader once the listing's photos load */}
                      <PhotoUploader key={hydrated ? "ready" : "loading"} ref={photosRef} captions defaultCaptions={data.photoCaptions} defaultValue={data.photos} defaultFocus={data.coverFocus} />
                    </StepField>
                    <StepField label="Intro video (optional)" help="A short clip (≤ 60s) really helps bookings — upload one, or paste a YouTube/Vimeo link.">
                      <VideoField key={hydrated ? "v-ready" : "v-loading"} ref={videoRef} defaultValue={data.videoUrl} defaultPosition={data.videoPosition} />
                    </StepField>
                  </div>

                  {/* Step 8 — Pricing */}
                  <div className={cn("grid gap-4 sm:grid-cols-2", currentStep !== 9 && "hidden")}>
                    <StepField label={`Price in AMD (per ${data.priceUnit || "person"})`}>
                      <Input
                        type="number"
                        min={1}
                        inputMode="decimal"
                        value={data.price || ""}
                        onChange={(e) => set("price", Number(e.target.value) || 0)}
                        placeholder="e.g. 45000"
                      />
                    </StepField>
                    <StepField label="Charged per">
                      <Select value={data.priceUnit} onValueChange={(v) => set("priceUnit", v)}>
                        <SelectTrigger><SelectValue placeholder="person" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="person">Person</SelectItem>
                          <SelectItem value="group">Group</SelectItem>
                          <SelectItem value="session">Session</SelectItem>
                          <SelectItem value="class">Class</SelectItem>
                          <SelectItem value="visit">Visit</SelectItem>
                          <SelectItem value="couple">Couple</SelectItem>
                          <SelectItem value="ticket">Ticket</SelectItem>
                          <SelectItem value="day">Day</SelectItem>
                        </SelectContent>
                      </Select>
                    </StepField>
                    <StepField label="Extra fee (optional)" help="What guests pay for on top of the price.">
                      <Select value={data.extraFeeType || "none"} onValueChange={(v) => set("extraFeeType", v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(data.extraFeeType && !(EXTRA_FEE_TYPES as readonly string[]).includes(data.extraFeeType) ? [data.extraFeeType, ...EXTRA_FEE_TYPES] : [...EXTRA_FEE_TYPES]).map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                          <SelectItem value="none">Other (shown as “Extra fee”)</SelectItem>
                        </SelectContent>
                      </Select>
                    </StepField>
                    <StepField label="Fee amount in AMD">
                      <Input type="number" min={0} value={data.cleaningFeeCents ? data.cleaningFeeCents / 100 : ""} onChange={(e) => set("cleaningFeeCents", Math.round((Number(e.target.value) || 0) * 100))} placeholder="e.g. 3000" />
                    </StepField>
                    <StepField label="Charge the fee">
                      <Select value={data.extraFeePer} onValueChange={(v) => set("extraFeePer", v === "person" ? "person" : "booking")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="booking">Once per booking</SelectItem>
                          <SelectItem value="person">Per guest</SelectItem>
                        </SelectContent>
                      </Select>
                    </StepField>
                    <div className="sm:col-span-2">
                      <StepField label="Cancellation policy" help="Flexible gives free cancellation up to a cutoff; non-refundable is cheaper but never refunds.">
                        <Select value={data.cancellationPolicy} onValueChange={(v) => set("cancellationPolicy", v as WizardData["cancellationPolicy"])}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="flexible">Flexible — free cancellation up to a cutoff</SelectItem>
                            <SelectItem value="non_refundable">Non-refundable — cheaper, no refunds</SelectItem>
                          </SelectContent>
                        </Select>
                      </StepField>
                    </div>
                    {data.cancellationPolicy === "flexible" ? (
                      <StepField label="Free-cancel window (days before start)" help="After this cutoff, no refund.">
                        <Input type="number" min={0} max={365} value={data.freeCancelDays} onChange={(e) => set("freeCancelDays", Number(e.target.value) || 0)} placeholder="7" />
                      </StepField>
                    ) : (
                      <StepField label="Non-refundable discount %" help="Applied off the base price as the incentive.">
                        <Input type="number" min={0} max={90} value={data.nonrefundableDiscountPercent} onChange={(e) => set("nonrefundableDiscountPercent", Number(e.target.value) || 0)} placeholder="5" />
                      </StepField>
                    )}
                    <div className="grid gap-4 border-t border-basalt/10 pt-4 sm:col-span-2 sm:grid-cols-2">
                      <p className="text-sm font-semibold sm:col-span-2">Discount <span className="font-normal text-basalt/45">(optional sale for a travel-date window — shows an "on sale" badge)</span></p>
                      <StepField label="Type">
                        <Select value={data.discountType} onValueChange={(v) => set("discountType", v as WizardData["discountType"])}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No discount</SelectItem>
                            <SelectItem value="percent">Percentage off (%)</SelectItem>
                            <SelectItem value="amount">Amount off (AMD)</SelectItem>
                          </SelectContent>
                        </Select>
                      </StepField>
                      <StepField label="Amount (% or AMD)">
                        <Input type="number" min={0} value={data.discountValue || ""} onChange={(e) => set("discountValue", Number(e.target.value) || 0)} placeholder="e.g. 15 or 10000" />
                      </StepField>
                      <StepField label="Sale starts">
                        <Input type="date" value={data.discountStart} onChange={(e) => set("discountStart", e.target.value)} />
                      </StepField>
                      <StepField label="Sale ends">
                        <Input type="date" value={data.discountEnd} onChange={(e) => set("discountEnd", e.target.value)} />
                      </StepField>
                    </div>
                  </div>

                  {/* Step 9 — Review & submit */}
                  <div className={cn("grid gap-6", currentStep !== 10 && "hidden")}>
                    <div className="grid gap-3 border border-basalt/10 bg-chalk p-5 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-xl leading-tight">{data.title || "Untitled experience"}</p>
                          <p className="text-basalt/55">{data.eyebrow || "No category label yet"}</p>
                        </div>
                        <p className="text-right text-basalt/55">
                          ֏{Math.round(data.price || 0).toLocaleString()} / {data.priceUnit || "person"}
                        </p>
                      </div>
                      <p className="text-basalt/60">{data.city && data.region ? `${data.city}, ${data.region}` : "No location yet"}</p>
                      <p className="text-basalt/60">{data.schedule.kind === "slots" ? describeSchedule(scheduleFromValue(data.schedule)) : "Guests pick a day"}</p>
                      <p className="text-basalt/70">{data.shortDescription || "No short description yet"}</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-basalt/55 sm:grid-cols-4">
                        <span>{data.highlights.length} itinerary step{data.highlights.length === 1 ? "" : "s"}</span>
                        <span>{data.amenities.length} included</span>
                        <span>{data.notIncluded.length} not included</span>
                        <span>{data.whatToBring.length} to bring</span>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={data.featured}
                        onChange={(e) => set("featured", e.target.checked)}
                        className="h-4 w-4 accent-[#F15822]"
                      />
                      Feature on the home page
                    </label>

                    <p className="text-xs leading-5 text-basalt/50">{submitCopy}</p>
                  </div>
                </div>
              </div>

              <aside className="hidden lg:block">
                <div className="sticky top-[104px] border border-basalt/12 bg-chalk p-5">
                  <div className="flex items-center gap-2 text-apricot"><Sparkles className="h-4 w-4" /><p className="text-[11px] font-bold uppercase tracking-[0.14em]">Modeled on Airbnb</p></div>
                  <p className="mt-3 text-xs leading-5 text-basalt/55">
                    This flow follows the same shape Airbnb uses for hosting an Experience — category and title, location, story, itinerary, group details, inclusions, guest info, photos, price, then review. Everything you enter here maps onto the same listing fields tours already use, so it shows up everywhere a stay or tour listing would.
                  </p>
                </div>
              </aside>
            </div>

            {submitError && (
              <div className="mt-8 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {submitError}
              </div>
            )}

            <div className="mt-8 flex items-center justify-between border-t border-basalt/10 pt-6">
              <Button type="button" variant="outline" className="rounded-none border-basalt/15" onClick={goBack} disabled={currentStep === 0 || submitting}>
                Back
              </Button>
              {isLastStep ? (
                <div className="flex items-center gap-2">
                  {data.status !== "published" && (
                    <Button type="button" variant="outline" className="rounded-none border-basalt/15" onClick={() => handleSubmit(false)} disabled={submitting}>
                      Save as draft
                    </Button>
                  )}
                  <Button type="button" className="rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={() => handleSubmit(true)} disabled={submitting}>
                    {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : <><Check className="mr-2 h-4 w-4" /> {data.status === "published" ? "Save changes" : "Submit for review"}</>}
                  </Button>
                </div>
              ) : (
                <div className="text-right">
                  <Button type="button" className="rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={goNext} disabled={!canAdvance}>
                    Next <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  {!canAdvance && <p className="mt-1.5 text-xs text-tuff">{stepTextProblem(currentStep, data) ?? "Fill in this step to continue."}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

export default function ExperienceOnboarding({ params }: { params?: { id?: string } }) {
  return (
    <RequireRole role="operator">
      <ExperienceOnboardingContent id={params?.id} />
    </RequireRole>
  );
}
