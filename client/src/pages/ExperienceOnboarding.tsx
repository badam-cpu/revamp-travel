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
import { Link, useLocation } from "wouter";
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AmenityPicker, AmenityPickerHandle } from "@/components/AmenityPicker";
import { PlaceAutocomplete } from "@/components/PlaceAutocomplete";
import { PhotoUploader, PhotoUploaderHandle } from "@/components/PhotoUploader";
import { ListEditor } from "@/components/ListEditor";
import type { ResolvedPlace } from "@/lib/googleMaps";
import { useListings, LiveListing } from "@/contexts/ListingsContext";
import type { ListingFact, ListingInput } from "@shared/listings";
import { ApiError } from "@/lib/api";
import { factValue } from "@/lib/tourFacts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";

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
  languages: string;
  minimumAge: string;
  amenities: string[];
  notIncluded: string[];
  whatToBring: string[];
  notSuitableFor: string[];
  importantInfo: string;
  photos: string[];
  prefillImageUrl?: string;
  price: number;
  priceUnit: string;
  cancellationPolicy: "flexible" | "non_refundable";
  freeCancelDays: number;
  nonrefundableDiscountPercent: number;
  featured: boolean;
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
    languages: "",
    minimumAge: "",
    amenities: [],
    notIncluded: [],
    whatToBring: [],
    notSuitableFor: [],
    importantInfo: "",
    photos: [],
    price: 0,
    priceUnit: "person",
    cancellationPolicy: "flexible",
    freeCancelDays: 7,
    nonrefundableDiscountPercent: 5,
    featured: false,
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
    languages: factValue(listing, "Languages") ?? "",
    minimumAge: factValue(listing, "Minimum age") ?? "",
    amenities: listing.amenities,
    notIncluded: listing.notIncluded ?? [],
    whatToBring: listing.whatToBring ?? [],
    notSuitableFor: listing.notSuitableFor ?? [],
    importantInfo: listing.importantInfo ?? "",
    photos: realPhotos(listing),
    price: listing.price,
    priceUnit: listing.priceUnit,
    cancellationPolicy: listing.cancellationPolicy ?? "flexible",
    freeCancelDays: listing.freeCancelDays ?? 7,
    nonrefundableDiscountPercent: listing.nonrefundableDiscountPercent ?? 5,
    featured: listing.featured ?? false,
    status: listing.status,
    reviewNote: listing.reviewNote,
  };
}

function buildFacts(data: WizardData): ListingFact[] {
  const pairs: [string, string][] = [
    ["Duration", data.duration.trim()],
    ["Group size", data.groupSize.trim()],
    ["Meeting point", data.meetingPoint.trim()],
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
    gallery: data.photos.length ? data.photos : undefined,
    shortDescription: data.shortDescription.trim(),
    longDescription: data.longDescription.trim(),
    price,
    priceLabel: `$${price}`,
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
  { title: "What's included", subtitle: "Check off everything guests don't have to bring or pay extra for." },
  { title: "Good to know", subtitle: "Safety notes, age limits, accessibility, cancellation terms — anything a guest should know before booking." },
  { title: "Add a cover photo", subtitle: "One hero image is enough to start — you can always add more later." },
  { title: "Set your price", subtitle: "What one guest pays, and the unit it's shown per." },
  { title: "Review & submit", subtitle: "Take one last look before it goes to review." },
];

const STEP_VALIDATORS: ((data: WizardData) => boolean)[] = [
  (d) => d.eyebrow.trim().length > 0 && d.title.trim().length > 0,
  (d) => d.city.trim().length > 0 && d.region.trim().length > 0,
  (d) => d.shortDescription.trim().length > 0 && d.longDescription.trim().length > 0,
  (d) => d.highlights.length > 0,
  (d) => d.duration.trim().length > 0 && d.groupSize.trim().length > 0 && d.meetingPoint.trim().length > 0,
  () => true,
  () => true,
  () => true,
  (d) => Number(d.price) > 0,
  () => true,
];

function StepField({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
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
    if (photos) setData((d) => ({ ...d, photos }));
  }, [currentStep]);

  useDocumentMeta({
    title: isEdit ? "Edit experience | Dashboard" : "Add an experience | Dashboard",
    description: "Operator-only experience listing onboarding.",
    canonicalPath: isEdit ? `/dashboard/experiences/${id}/edit` : "/dashboard/experiences/new",
    noindex: true,
  });

  const notFound = isEdit && hydrated === false && !listingsLoading && !existing;

  const set = <K extends keyof WizardData>(key: K, value: WizardData[K]) => setData((d) => ({ ...d, [key]: value }));

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

  const handleSubmit = async () => {
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
      if (isEdit && existing) {
        await updateListing(existing.id, payload);
        toast(`${payload.title} updated.`);
      } else {
        await createListing(payload);
        toast(`${payload.title} submitted for review.`);
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
      <main className="container py-10 lg:py-14">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-basalt/55 hover:text-apricot">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <p className="eyebrow mt-6">{isEdit ? "Edit experience" : "Add an experience"}</p>
        <h1 className="mt-2 font-display text-4xl leading-[0.98] tracking-[-0.035em] sm:text-5xl">
          {isEdit ? existing?.title || "Loading…" : "Host something hands-on."}
        </h1>

        {(listingsLoading && isEdit && !hydrated) ? (
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
                    <StepField label="Category label" help='Short and specific — e.g. "Hands-on kitchen class" or "Craft workshop".'>
                      <Input value={data.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} placeholder="Hands-on kitchen class" />
                    </StepField>
                    <StepField label="Title">
                      <Input value={data.title} onChange={(e) => set("title", e.target.value)} placeholder="Lavash & Wine Craft Afternoon" />
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
                    <StepField label="Short description" help="One or two sentences — shown on the listing card.">
                      <Textarea rows={2} value={data.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} />
                    </StepField>
                    <StepField label="Full description" help="The story of the experience — what makes it worth doing, told in your own voice.">
                      <Textarea rows={6} value={data.longDescription} onChange={(e) => set("longDescription", e.target.value)} />
                    </StepField>
                  </div>

                  {/* Step 3 — Itinerary */}
                  <div className={cn(currentStep !== 3 && "hidden")}>
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
                  <div className={cn("grid gap-6", currentStep !== 5 && "hidden")}>
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
                  <div className={cn("grid gap-6", currentStep !== 6 && "hidden")}>
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
                  <div className={cn("grid gap-4", currentStep !== 7 && "hidden")}>
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
                      <PhotoUploader key={hydrated ? "ready" : "loading"} ref={photosRef} defaultValue={data.photos} />
                    </StepField>
                  </div>

                  {/* Step 8 — Pricing */}
                  <div className={cn("grid gap-4 sm:grid-cols-2", currentStep !== 8 && "hidden")}>
                    <StepField label={`Price (per ${data.priceUnit || "person"})`}>
                      <Input
                        type="number"
                        min={1}
                        inputMode="decimal"
                        value={data.price || ""}
                        onChange={(e) => set("price", Number(e.target.value) || 0)}
                        placeholder="e.g. 120"
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
                  </div>

                  {/* Step 9 — Review & submit */}
                  <div className={cn("grid gap-6", currentStep !== 9 && "hidden")}>
                    <div className="grid gap-3 border border-basalt/10 bg-chalk p-5 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-xl leading-tight">{data.title || "Untitled experience"}</p>
                          <p className="text-basalt/55">{data.eyebrow || "No category label yet"}</p>
                        </div>
                        <p className="text-right text-basalt/55">
                          ${data.price || 0} / {data.priceUnit || "person"}
                        </p>
                      </div>
                      <p className="text-basalt/60">{data.city && data.region ? `${data.city}, ${data.region}` : "No location yet"}</p>
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
                <Button type="button" className="rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : <><Check className="mr-2 h-4 w-4" /> {isEdit ? "Save changes" : "Submit for review"}</>}
                </Button>
              ) : (
                <div className="text-right">
                  <Button type="button" className="rounded-none bg-apricot text-white hover:bg-apricot/90" onClick={goNext} disabled={!canAdvance}>
                    Next <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  {!canAdvance && <p className="mt-1.5 text-xs text-tuff">Fill in this step to continue.</p>}
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
