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
 */
import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertTriangle, Link2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { RequireRole } from "@/components/RequireRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useListings, LiveListing } from "@/contexts/ListingsContext";
import { useAuth } from "@/contexts/AuthContext";
import type { ListingInput, ListingType } from "@shared/listings";
import { ApiError, importListingPrefill } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { isGoogleMapsConfigured } from "@/lib/googleMaps";
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

function toInputPayload(draft: DraftListing, form: HTMLFormElement): ListingInput {
  const get = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  const price = Number(get("price")) || 0;
  const tags = get("tags").split(",").map((t) => t.trim()).filter(Boolean);
  const amenities = get("amenities").split(",").map((t) => t.trim()).filter(Boolean);
  const facts = [1, 2, 3]
    .map((n) => ({ label: get(`fact${n}Label`).trim(), value: get(`fact${n}Value`).trim() }))
    .filter((f) => f.label && f.value);

  return {
    type: draft.type,
    title: get("title").trim(),
    eyebrow: get("eyebrow").trim(),
    city: get("city").trim(),
    region: get("region").trim(),
    coordinates: { lat: Number(get("lat")) || 0, lng: Number(get("lng")) || 0 },
    image: get("image").trim() || undefined,
    shortDescription: get("shortDescription").trim(),
    longDescription: get("longDescription").trim(),
    price,
    priceLabel: `$${price}`,
    priceUnit: get("priceUnit").trim() || (draft.type === "stay" ? "night" : "person"),
    tags,
    facts,
    amenities,
    featured: (form.elements.namedItem("featured") as HTMLInputElement | null)?.checked || false,
    accent: (get("accent") as ListingInput["accent"]) || "apricot",
  };
}

/** What saving this draft will actually do — differs by whether it's new, awaiting review, or already live. */
function dialogDescription(draft: DraftListing, isEdit: boolean): string {
  if (!isEdit) return "Submitted for review — it'll go live once an admin approves it.";
  if (draft.status === "draft") return "An admin sent this back with feedback — saving resubmits it for review.";
  if (draft.status === "pending") return "Still awaiting review — your changes are saved as part of that same submission.";
  return "This listing is already live — changes save immediately, no re-review needed.";
}

const STEP_TITLES = ["The basics", "Where it is", "Details & pricing"];
const LAST_STEP = STEP_TITLES.length - 1;

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
  const draftId = draft?.id;
  // Reset to the first step whenever the dialog (re)opens or a different draft loads.
  useEffect(() => {
    setStep(0);
    setStepError(null);
    setError(null);
  }, [open, draftId]);
  if (!draft) return null;
  const isEdit = Boolean(draft.id);
  const isLast = step === LAST_STEP;

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
    setStepError(null);
    return true;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateStep(step)) return;
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = toInputPayload(draft, event.currentTarget);
      if (isEdit && draft.id) {
        await updateListing(draft.id, payload);
        toast(`${payload.title} updated.`);
      } else {
        await createListing(payload);
        toast(`${payload.title} added to the catalog.`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't save this listing. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{isEdit ? `Edit your ${draft.type}` : `Add a ${draft.type}`}</DialogTitle>
          <DialogDescription>{dialogDescription(draft, isEdit)}</DialogDescription>
        </DialogHeader>

        {/* Progress: which of the short steps you're on. */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-apricot">
            Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}
          </p>
          <div className="mt-2 flex gap-1.5" aria-hidden="true">
            {STEP_TITLES.map((_, i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-apricot" : "bg-basalt/15")} />
            ))}
          </div>
        </div>

        <form ref={formRef} noValidate onSubmit={submit} className="grid gap-4">
          {draft.prefillImageUrl && step === 0 && (
            <div className="flex items-start gap-3 border border-basalt/10 bg-chalk p-3">
              <img src={draft.prefillImageUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
              <p className="text-xs leading-5 text-basalt/55">
                Reference photo from the link you pasted — shown for reference only, it won't be saved. Add your own hosted photo URL in the final step (or leave it blank for a brand illustration).
              </p>
            </div>
          )}

          {/* Step 1 — the basics */}
          <div hidden={step !== 0} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="title">Title</Label><Input id="title" name="title" placeholder="e.g. Forest House Dilijan" defaultValue={draft.title} /></div>
              <div className="grid gap-1.5"><Label htmlFor="eyebrow">Eyebrow label</Label><Input id="eyebrow" name="eyebrow" placeholder="e.g. Timber hideaway" defaultValue={draft.eyebrow} /></div>
            </div>
            <div className="grid gap-1.5 sm:max-w-[14rem]">
              <Label htmlFor="accent">Marker color</Label>
              <Select name="accent" defaultValue={draft.accent}>
                <SelectTrigger id="accent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="apricot">Apricot</SelectItem>
                  <SelectItem value="sevan">Charcoal</SelectItem>
                  <SelectItem value="tuff">Tuff</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-basalt/45">The color of this listing's pin on the map.</p>
            </div>
          </div>

          {/* Step 2 — where it is */}
          <div hidden={step !== 1} className="grid gap-4">
            {isGoogleMapsConfigured && (
              <AddressAutocomplete
                onSelect={(s) => {
                  setField("lat", String(s.lat));
                  setField("lng", String(s.lng));
                  if (s.city) setField("city", s.city);
                  if (s.region) setField("region", s.region);
                }}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="city">City</Label><Input id="city" name="city" placeholder="e.g. Yerevan" defaultValue={draft.city} /></div>
              <div className="grid gap-1.5"><Label htmlFor="region">Region</Label><Input id="region" name="region" placeholder="e.g. Kotayk" defaultValue={draft.region} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="lat">Latitude</Label><Input id="lat" name="lat" type="number" step="0.0001" min={38} max={42} defaultValue={draft.coordinates?.lat} /></div>
              <div className="grid gap-1.5"><Label htmlFor="lng">Longitude</Label><Input id="lng" name="lng" type="number" step="0.0001" min={43} max={47} defaultValue={draft.coordinates?.lng} /></div>
            </div>
            <p className="-mt-1 text-xs text-basalt/45">Coordinates must fall inside Armenia (lat 38–42, lng 43–47) — used to place the pin on the atlas.</p>
          </div>

          {/* Step 3 — details & pricing */}
          <div hidden={step !== 2} className="grid gap-4">
            <div className="grid gap-1.5"><Label htmlFor="shortDescription">Short description</Label><Textarea id="shortDescription" name="shortDescription" rows={2} placeholder="One or two lines shown on cards." defaultValue={draft.shortDescription} /></div>
            <div className="grid gap-1.5"><Label htmlFor="longDescription">Full description</Label><Textarea id="longDescription" name="longDescription" rows={4} placeholder="The full write-up shown on the listing page." defaultValue={draft.longDescription} /></div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="price">Price ({draft.type === "stay" ? "per night" : "per person"})</Label><Input id="price" name="price" type="number" min={0} defaultValue={draft.price} /></div>
              <div className="grid gap-1.5"><Label htmlFor="priceUnit">Price unit label</Label><Input id="priceUnit" name="priceUnit" placeholder={draft.type === "stay" ? "night" : "person"} defaultValue={draft.priceUnit} /></div>
            </div>

            <div className="grid gap-1.5"><Label htmlFor="tags">Tags (comma separated)</Label><Input id="tags" name="tags" placeholder="Forest, Breakfast, Design stay" defaultValue={draft.tags?.join(", ")} /></div>
            <div className="grid gap-1.5"><Label htmlFor="amenities">Amenities (comma separated)</Label><Input id="amenities" name="amenities" placeholder="Wi-Fi, Breakfast basket, Local transfers" defaultValue={draft.amenities?.join(", ")} /></div>

            <div>
              <Label className="mb-2 block">Quick facts (up to 3, optional)</Label>
              <div className="grid gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="grid grid-cols-2 gap-2">
                    <Input name={`fact${i + 1}Label`} placeholder="Label, e.g. Sleeps" defaultValue={draft.facts?.[i]?.label} />
                    <Input name={`fact${i + 1}Value`} placeholder="Value, e.g. 2 guests" defaultValue={draft.facts?.[i]?.value} />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5"><Label htmlFor="image">Image URL (optional)</Label><Input id="image" name="image" placeholder="Leave blank to use a brand illustration" defaultValue={draft.image} /></div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="featured" defaultChecked={draft.featured} className="h-4 w-4 accent-[#F15822]" />
              Feature on the home page
            </label>
          </div>

          {stepError && (
            <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {stepError}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-none"
                  onClick={() => {
                    setStepError(null);
                    setStep((s) => Math.max(0, s - 1));
                  }}
                >
                  Back
                </Button>
              )}
            </div>
            <Button type="submit" className="rounded-none bg-apricot text-white hover:bg-apricot/90" disabled={saving}>
              {isLast ? (saving ? "Saving…" : isEdit ? "Save changes" : "Submit for review") : "Continue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: LiveListing["status"] }) {
  if (status === "published") {
    return <span className="border border-sevan/30 bg-sevan/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-sevan">Published</span>;
  }
  if (status === "pending") {
    return <span className="border border-tuff/30 bg-tuff/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-tuff">Pending review</span>;
  }
  return <span className="border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-destructive">Needs changes</span>;
}

function DashboardSection({ type, title, description }: { type: ListingType; title: string; description: string }) {
  const { user } = useAuth();
  const { listings, deleteListing } = useListings();
  const items = listings.filter((l) => l.type === type && l.operatorId === user?.id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftListing | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const openAdd = () => { setDraft(emptyDraft(type)); setDialogOpen(true); };
  const openEdit = (listing: LiveListing) => { setDraft(listing); setDialogOpen(true); };

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setImportError(null);
    try {
      const prefill = await importListingPrefill(url);
      setDraft({
        ...emptyDraft(type),
        title: prefill.title ?? "",
        shortDescription: prefill.description ?? "",
        city: prefill.city ?? "",
        region: prefill.region ?? "",
        price: prefill.price ?? 0,
        prefillImageUrl: prefill.imageUrl,
      });
      setDialogOpen(true);
      setImportUrl("");
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
            <div key={listing.id} className="flex flex-wrap items-center justify-between gap-4 border border-basalt/10 bg-paper p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-display text-xl leading-tight">{listing.title}</p>
                  <StatusBadge status={listing.status} />
                </div>
                <p className="mt-1 text-xs text-basalt/50">{listing.city}, {listing.region} · {listing.priceLabel} / {listing.priceUnit}</p>
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
          ))}
        </div>
      )}

      <ListingFormDialog draft={draft} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => setDialogOpen(false)} />
    </section>
  );
}

function DashboardContent() {
  const { profile } = useAuth();
  const { offline } = useListings();

  return (
    <div className="min-h-screen bg-paper text-basalt">
      <SiteHeader />
      <main className="container py-12 lg:py-16">
        <p className="eyebrow">Operator dashboard</p>
        <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.04em] sm:text-6xl">
          {profile?.businessName || profile?.displayName || "Your listings"}.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-basalt/60">
          Add, edit, or remove your own stays and tours — nobody else can see or edit them but you. A new listing goes through a quick review before it's visible to travelers; edits to an already-live listing save immediately.
        </p>
        {offline && (
          <div className="mt-6 flex items-start gap-2 border border-tuff/40 bg-tuff/10 p-4 text-sm text-basalt">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-tuff" />
            Can't reach the catalog right now — showing the built-in sample listings read-only. Adding, editing, and deleting will resume once the connection is back.
          </div>
        )}

        <DashboardSection type="stay" title="Stays" description="Guesthouses, cabins, and small hotels shown on /explore/stay and the home page." />
        <DashboardSection type="tour" title="Tours" description="Guided routes and experiences shown on /explore/tour and the home page." />

        <section className="border-t border-basalt/10 py-12">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-apricot" /><p className="eyebrow">Coming soon</p></div>
          <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Bookings & payouts.</h2>
          <p className="mt-2 max-w-md text-sm text-basalt/55">Once real payments are live, confirmed bookings for your listings will show up here.</p>
        </section>
      </main>
      <SiteFooter />
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
